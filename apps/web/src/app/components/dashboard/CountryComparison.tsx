import { useMemo } from "react";
import { compareLifeTables, lifeTablePeriod, type LifeTableFile } from "@bt/shared/core/lifeTable";
import { href } from "../../router";
import { cx } from "../ui";

export function CountryComparison({ file, age, sex, selectedCountry }: { file: LifeTableFile; age: number; sex: "f" | "m" | undefined; selectedCountry?: string }) {
  const comparison = useMemo(() => compareLifeTables(file, age, sex), [file, age, sex]);
  const who = sex === "f" ? "women" : sex === "m" ? "men" : "both sexes";
  if (!comparison.rows.length || comparison.maxRemainingYears <= 0) return null;
  return (
    <figure className="flex min-w-0 flex-col gap-3 border-t border-line pt-5">
      <figcaption className="font-medium">Compare countries</figcaption>
      <p className="max-w-3xl text-sm text-ink-2">Average remaining life for {who} alive at age {age.toFixed(1)}, longest first. Same age and sex across {comparison.rows.length} available population tables, including the EU average. Bars start at zero; your saved country is highlighted.</p>
      <div className="grid grid-cols-[7rem_minmax(0,1fr)_3.5rem] gap-3 text-sm text-ink-2 sm:grid-cols-[12rem_minmax(0,1fr)_4rem]" aria-hidden="true"><span>Country · period</span><span>Average remaining life</span><span className="text-right">Years</span></div>
      <div role="region" aria-label="All-country life expectancy comparison" tabIndex={0} className="max-h-[32rem] overflow-y-auto overscroll-contain pr-2 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <ol className="flex flex-col gap-3">
          {comparison.rows.map((row) => {
            const selected = row.country === selectedCountry;
            return <li key={row.country} aria-current={selected ? "true" : undefined} className={cx("grid grid-cols-[7rem_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_4rem]", selected && "text-accent")}>
              <div className="min-w-0 text-sm"><p className={cx("break-words", selected && "font-semibold")}>{row.country === "EU27_2020" ? "EU average" : row.name}</p><p className="text-xs text-ink-2">{lifeTablePeriod(row.source.period)}{selected && <span className="font-medium text-accent"> · Your country</span>}</p></div>
              <svg viewBox={`0 0 ${comparison.maxRemainingYears} 1`} preserveAspectRatio="none" className="h-3 w-full" aria-hidden="true"><rect x={0} y={0} width={row.meanRemainingYears} height={1} fill={selected ? "var(--color-accent)" : "var(--color-ink-2)"} /></svg>
              <span className={cx("text-right text-sm tabular-nums", selected && "font-semibold")}>{row.meanRemainingYears.toFixed(1)}<span className="sr-only"> years remaining</span></span>
            </li>;
          })}
        </ol>
      </div>
      <p className="max-w-3xl text-sm text-ink-2">Scroll the chart to see every country. Reporting periods and population definitions differ, so this is not a same-year ranking, a healthcare score, or a prediction of what moving country would do to your life.</p>
      {comparison.missingSex.length > 0 && <p className="max-w-3xl text-sm text-ink-2">Not compared without sex: {comparison.missingSex.map((row) => row.name).join(", ")}. Their sources do not publish combined-sex tables. <a href={href({ name: "data", tab: "data" })}>Add your sex in Settings</a> to include them.</p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-medium">Comparison sources and limits</summary>
        <ul className="flex flex-col gap-3 py-2 text-sm text-ink-2">
          {comparison.rows.map((row) => <li key={row.country}><a href={row.source.url} target="_blank" rel="noopener noreferrer" className="text-accent">{row.name} — {row.source.name}</a> · {lifeTablePeriod(row.source.period)}{row.source.note && <p className="mt-1">{row.source.note}</p>}</li>)}
        </ul>
      </details>
    </figure>
  );
}
