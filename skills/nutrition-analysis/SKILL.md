---
name: Nutrition analysis
description: Use when someone asks which foods or diet changes can affect a marker, or how much of a nutrient a food contains.
---

# Nutrition analysis

## Steps

1. Call `get_levers` for the marker. It returns graded claims (food, diet, supplement, habit) and, for foods, measured nutrient amounts per example portion from the UK CoFID 2021 food table. Safety filters for the user's log are already applied.
2. Lead with the strongest evidence. Keep whole foods and supplements apart: a supplement result doesn't show what the food does, and the reverse.
3. When you give amounts, use only the numbers the tool returned, with the portion ("80 g red pepper: 101 mg vitamin C"). Don't estimate amounts for foods the tool didn't return.
4. If a nutrition MCP tool is connected, you may use it for foods not in the app's table; say which source the numbers came from.
5. Always add: "Nutrient numbers cover about 150 measured compounds; foods contain thousands more that aren't tracked."
6. Suggest testing it on themselves (the "self-experiment design" skill): log the change, re-test, compare against normal variation.

## Rules

- No calorie targets, weight-loss plans or "eat less than X".
- Examples are examples, not "the best meal for you".
- If the log shows a blood thinner, kidney disease, pregnancy or a diabetes medicine, say that diet and supplement changes need their doctor's input, and don't suggest increasing any nutrient.
- Explain, don't prescribe: no supplement doses.
