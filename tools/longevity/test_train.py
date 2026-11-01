"""Offline numerical compatibility checks using invented data only.

Run from the repository root after installing requirements.txt:
  python -B -m unittest discover -s tools/longevity -p "test_*.py"
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from tools.longevity import train


class ImportTests(unittest.TestCase):
    def test_xpt_zero_correction_preserves_small_values_and_integer_keys(self):
        sentinel = float(train._parse_float_vec(np.array([b"\x00" * 8], dtype="S8"))[0])
        small = 1e-80
        source = pd.DataFrame({"SEQN": [1.0, 2.0, 3.0, 4.0], "value": [sentinel, small, np.nan, 12.0]})
        audit = {}
        with patch.object(pd, "read_sas", return_value=source):
            actual = train.read_xpt("SYNTHETIC", Path(tempfile.gettempdir()), audit)
        self.assertEqual(actual.SEQN.dtype, np.dtype("int64"))
        np.testing.assert_allclose(actual.value, [0.0, small, np.nan, 12.0], rtol=0, atol=0, equal_nan=True)
        self.assertEqual(audit["SYNTHETIC"]["exactZeroDecoderCorrections"], int(sentinel != 0))

    def test_xpt_rejects_missing_or_fractional_identifiers(self):
        for invalid in (np.nan, 1.5):
            with self.subTest(identifier=invalid):
                with patch.object(pd, "read_sas", return_value=pd.DataFrame({"SEQN": [invalid]})):
                    with self.assertRaisesRegex(ValueError, "identifier metadata"):
                        train.read_xpt("SYNTHETIC", Path(tempfile.gettempdir()), {})

    def test_activity_aggregates_details_without_turning_unknowns_into_zero(self):
        screen = pd.DataFrame({
            "SEQN": [1, 2, 3, 4, 5],
            "PAD320": [1, 2, 1, 3, 9],
            "PAD200": [1, 2, 2, 2, 2],
        })
        details = pd.DataFrame({
            "SEQN": [1, 1, 1, 2, 3, 4],
            "PADLEVEL": [1, 1, 2, 1, 1, 1],
            "PADTIMES": [2, 3, 4, 1, 2, 1],
            "PADDURAT": [30, 20, 15, 30, np.nan, 30],
        })
        actual = train.activity_minutes(screen, details).set_index("SEQN")
        self.assertAlmostEqual(actual.loc[1, "activityWeekly"], 180 * 7 / 30)
        self.assertEqual(actual.loc[2, "activityWeekly"], 0)
        self.assertTrue(actual.loc[2, "activity1Conflict"])
        self.assertTrue(np.isnan(actual.loc[3, "activityWeekly"]))
        self.assertTrue(actual.loc[3, "activity1YesIncomplete"])
        self.assertEqual(actual.loc[4, "activityWeekly"], 0)
        self.assertTrue(actual.loc[4, "activity1Unable"])
        self.assertTrue(actual.loc[4, "activity1Conflict"])
        self.assertTrue(np.isnan(actual.loc[5, "activityWeekly"]))


class NumericalTests(unittest.TestCase):
    def test_cox_fit_export_matches_native_predictions_without_mutating_inputs(self):
        rng = np.random.default_rng(42)
        count = 200
        design = pd.DataFrame({"x": rng.normal(size=count)})
        followup = rng.exponential(7 * np.exp(-0.4 * design.x.to_numpy()))
        months = np.minimum(followup, train.HORIZON) * 12
        months[0] = 0
        base = pd.DataFrame({
            "PERMTH_EXM": months,
            "duration": np.maximum(months, 0.5) / 12,
            "event": (followup <= train.HORIZON).astype(int),
            "weight": rng.uniform(0.5, 2, count),
            "cluster": np.repeat(np.arange(count // 4), 4),
        })
        before_base, before_design = base.copy(deep=True), design.copy(deep=True)
        with pd.option_context("mode.copy_on_write", True):
            model = train.fit_cox(base, design, ["x"], penalty=0.01)
            actual = train.predict_fit(model, design)
        native = 1 - model.predict_survival_function(design, times=[train.HORIZON]).iloc[0].to_numpy()
        np.testing.assert_allclose(actual, native, rtol=0, atol=1e-10)
        self.assertTrue(np.isfinite(actual).all())
        self.assertTrue(((actual >= 0) & (actual <= 1)).all())
        pd.testing.assert_frame_equal(base, before_base)
        pd.testing.assert_frame_equal(design, before_design)

    def test_metrics_excludes_censored_endpoints_and_zero_weights(self):
        base = pd.DataFrame({
            "known10": [True, True, True, False, True],
            "weight": [1.0, 2.0, 1.0, 99.0, 0.0],
            "event": [0, 1, 0, 0, 1],
        })
        actual = train.metrics(base, np.array([0.1, 0.8, 0.4, 0.99, 0.99]))
        self.assertEqual(actual["people"], 3)
        self.assertEqual(actual["deaths"], 1)
        self.assertEqual(actual["auc"], 1.0)
        self.assertAlmostEqual(actual["brier"], (0.01 + 2 * 0.04 + 0.16) / 4)
        self.assertAlmostEqual(actual["weightedEventRate"], 0.5)
        self.assertAlmostEqual(actual["weightedMeanPrediction"], (0.1 + 2 * 0.8 + 0.4) / 4)
        pd.testing.assert_series_equal(base.weight, pd.Series([1.0, 2.0, 1.0, 99.0, 0.0], name="weight"))

    def test_metrics_applies_resampling_weights(self):
        base = pd.DataFrame({"known10": [True, True, True], "weight": [1.0, 2.0, 1.0], "event": [0, 1, 0]})
        actual = train.metrics(base, np.array([0.1, 0.8, 0.4]), np.array([2.0, 0.5, 0.0]))
        self.assertEqual(actual["people"], 2)
        self.assertAlmostEqual(actual["brier"], (2 * 0.01 + 0.04) / 3)
        self.assertAlmostEqual(actual["weightedEventRate"], 1 / 3)


if __name__ == "__main__":
    unittest.main()
