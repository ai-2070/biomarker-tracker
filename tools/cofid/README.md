# CoFID extraction

Builds the app's food tables from McCance and Widdowson's CoFID 2021 spreadsheet
(UK Government, Open Government Licence v3.0):
https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid

- `build-all.mjs`: every food with the nutrients the meal builder shows → `knowledge/foods/cofid-all.json`
- `build-foods.mjs`: the small curated list with example portions used by the evidence levers → `knowledge/foods/cofid-foods.json`

Values are copied as published: "Tr" (trace) becomes 0, "N" (not measured) or empty is left out. Never type values by hand.

Not part of the app: run it separately with the `xlsx` package (0.18.5).

```sh
cd tools/cofid
bun add xlsx@0.18.5
node build-all.mjs /path/to/cofid2021.xlsx ../../knowledge/foods/cofid-all.json
```
