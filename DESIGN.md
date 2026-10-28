---
name: Biomarker Tracker
description: A person's bloodwork over the years, on their own computer, in plain words.
colors:
  canvas: "#f4f6f7"
  page: "#ffffff"
  surface: "#ffffff"
  sunken: "#f5f7f9"
  ink: "#12161b"
  ink-2: "#545b65"
  muted: "#69707a"
  line: "#e4e7eb"
  line-strong: "#cfd4da"
  accent: "#17785d"
  accent-ink: "#ffffff"
  accent-soft: "#e8f5f0"
  chart-line: "#1e9070"
  chart-band: "#1e9070"
  chart-out: "#b4391e"
  ok: "#17785d"
  ok-soft: "#e7f4ee"
  warn: "#8a6206"
  warn-soft: "#fbf3df"
  danger: "#b4391e"
  danger-soft: "#fbece8"
  danger-strong: "#b4391e"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, Times New Roman, serif"
    fontSize: "4.5rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
  headline:
    fontFamily: "Instrument Serif, Georgia, Times New Roman, serif"
    fontSize: "3rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Instrument Serif, Georgia, Times New Roman, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.33
  body:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter Variable, Inter, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Kode Mono Variable, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.14em"
rounded:
  md: "6px"
  lg: "8px"
  xl: "12px"
  sheet: "16px"
  full: "9999px"
spacing:
  gap-tight: "12px"
  card: "16px"
  card-sm: "20px"
  section: "24px"
  page-x: "16px"
  page-x-lg: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.sunken}"
  button-quiet:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  flag-badge-out:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  flag-badge-critical:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  flag-badge-normal:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
---

# Design System: Biomarker Tracker

## Overview

**Creative North Star: "The Quiet Clinic Chart"**

White cards on a near-white ground, ink text, hairline borders and one green. The system reads like a well-kept medical chart: calm, legible, and dense enough to show years of results at once without decoration. Large numbers are set in Instrument Serif so a figure reads as a figure; everything you read in sentences is Inter; small labels, axis ticks and group names are Kode Mono in uppercase.

Colour is spent on meaning. Green is the person's own line and the one action colour. Amber means out of range, red means critical. Grey is everything else, including calendar age. Nothing glows, nothing is tinted for mood, and status never rides on colour alone.

Light is the default. Dark exists only when chosen in Settings, and swaps the same token names to darker surfaces and brighter state colours (see the sidecar). Fonts are bundled with the app (Fontsource), never fetched from a font service.

**Key Characteristics:**
- Near-white canvas (`canvas`) with white cards (`surface`) separated by 1px hairlines, not shadows.
- One accent green for the person's data line, the active nav item and the primary button.
- Amber for out of range, red for critical, always paired with a word or arrow.
- Serif numerals for figures, sans for prose, mono uppercase for labels and ticks.
- 12px cards, 8px controls, full-round chips; 44px minimum targets everywhere.
- Short ease-out motion, all of it switched off under reduced motion.

## Colors

A neutral, slightly cool white palette with a single deep green and two state colours.

### Primary
- **Chart Green** (`accent`): the primary button, active navigation, links, focus ring, caret and selection tint. In dark mode it brightens.
- **Line Green** (`chart-line`, `chart-band`): the person's own data line in every chart, the dots on it, and (at 10–15% opacity) the reference-range band and the gap between biological and calendar age.
- **Mint Wash** (`accent-soft`): active nav background, highlighted select options, chosen radio cards, ongoing log bars on the timeline, the Ask Brain panel (at 60%), Brain's user messages and avatar.

### Secondary (state)
- **Lab Amber** (`warn`, `warn-soft`): a result outside its reference range; the example-profile banner; "Due" re-tests.
- **Critical Red** (`danger`, `danger-soft`, `danger-strong`): critical values, save failures, destructive buttons (`danger-strong`).
- **Range Green** (`ok`, `ok-soft`): the "Normal" flag badge.

### Neutral
- **Ground** (`canvas`): the app background behind cards.
- **Paper** (`surface`, `page`): cards, sidebar, top bar, popups.
- **Well** (`sunken`): hover fill for rows and quiet buttons, info notices, ended log bars.
- **Ink** (`ink`): body text and figures. **Ink 2** (`ink-2`): secondary text, ticks, calendar-age line. **Muted** (`muted`): placeholders only.
- **Hairline** (`line`): card borders, dividers, year gridlines. **Hairline Strong** (`line-strong`): input and secondary-button borders, hovered card borders, in-range marks.

### Named Rules
**The Colour Means State Rule.** Amber is out of range, red is critical, green is the person's line or an action. No other use of amber or red, and no decorative tints.

**The Never Colour Alone Rule.** Every status colour sits next to a word, arrow or count (flag badge text, "Out of range: …", legends). Charts carry a screen-reader table.

**The Grey Calendar Rule.** Calendar age and any "expected" reference line is `ink-2`, dashed; only the person's measured line is green.

## Typography

**Display Font:** Instrument Serif (with Georgia, Times New Roman)
**Body Font:** Inter Variable (with -apple-system, Segoe UI, Helvetica Neue, Arial)
**Label/Mono Font:** Kode Mono Variable (with ui-monospace, Menlo)

**Character:** A soft editorial serif for numbers and headings over a plain, very legible sans. The mono gives the chart-and-lab feel to labels without shouting.

### Hierarchy
- **Display** (400, 3.75rem → 4.5rem at sm, line-height 1, tabular numerals): the biological-age figure only.
- **Headline** (400, 2.25rem → 3rem at sm, tight tracking): the Dashboard page title. Other pages use `PageTitle` at 1.875rem → 2.25rem.
- **Figure** (Instrument Serif 400, 2.25rem → 3rem, line-height 1, tabular): key-figure tiles; marker values at 1.875rem.
- **Title** (Instrument Serif 400, 1.5rem): section headings inside a page ("Timeline", "Markers"); side-panel headings at 1.25rem.
- **Body** (Inter 400, 1rem, 1.5): prose, buttons (500), inputs. **Body small** (0.875rem): help text, card feet, legends at 0.75rem.
- **Label** (Kode Mono 500, 11px, 0.14em, uppercase): the name of a figure tile, nav group names, menu group names, year ticks (11px) and age ticks (10px, no tracking).

### Named Rules
**The Serif Is For Numbers Rule.** Instrument Serif sets figures and headings, always weight 400. Never bold it, never use it for sentences.

**The Label Names Something Rule.** Mono uppercase labels name the thing they sit on (a figure tile, a nav group, an axis). They are never a teaser line above a heading.

## Layout

App shell: on large screens (≥1024px) a fixed 256px white sidebar with a hairline right border; content is offset by it. Below that, a sticky top bar (logo, Add, profile) and a fixed bottom tab bar (Dashboard, Blood, Habits, Brain, More), both `surface` at 95% with a light backdrop blur and safe-area padding.

Content column: centred, `max-w-4xl` for most pages, `max-w-7xl` for wide pages (Dashboard). Horizontal padding 16px → 24px (sm) → 40px (lg); bottom padding 112px on phones to clear the tab bar.

Rhythm: 24px between page sections, 12px between tiles in a grid, 16px (20px at sm) inside cards. Dashboard figures are a 2-column grid on phones and 5 columns on large screens (biological age spans 2). Marker tiles go 1 → 2 → 3 columns; on phones they become a single divided list. Side panels sit in a 20rem right column at lg.

Everything must work at 360px width.

## Elevation & Depth

Flat by default. Depth comes from the tonal step between `canvas` and white `surface`, plus 1px hairlines. Shadows only appear on things that float above the page or as a hover response.

### Shadow Vocabulary
- **Hover lift** (Tailwind `shadow-sm`, with a 1px upward move and `line-strong` border): clickable figure and marker tiles on hover.
- **Popover** (`shadow-lg`): select popups, the profile menu, the timeline test popover.
- **Sheet** (`shadow-xl`): the phone More sheet, over a 30% black backdrop.

### Named Rules
**The Hairline First Rule.** Separate with a 1px `line` border before reaching for a shadow. A resting card never has a shadow.

## Shapes

Gently rounded and consistent. Cards, notices and popovers use 12px (`rounded.xl`). Buttons, inputs, nav items, select popups and radio cards use 8px (`rounded.lg`). Flag badges, "Soon" chips, test marks, log bars and in-range marks are fully round. The phone sheet rounds its top corners at 16px. Icons are one family: 24px grid drawn at 20px, 1.75 stroke, round caps and joins.

## Components

### Buttons
- **Shape:** gently rounded (8px), minimum height 44px, 16px side padding, Inter 500 at 1rem.
- **Primary:** `accent` with `accent-ink` text. Hover brightens (110%), active dims (95%) and presses to 97% scale.
- **Secondary:** white with a `line-strong` border, hover `sunken`.
- **Quiet:** no fill, `ink-2` text, hover `sunken` and `ink`.
- **Danger:** `danger-strong` with white text.
- **Focus:** a 2px `accent` outline, 2px offset (global). Disabled is 50% opacity.

### Chips (flag badges)
- **Style:** fully round, 2px × 10px padding, 0.875rem Inter 500, soft state background with state text, and a leading direction mark (small stroked SVG from the icon family) plus the word ("High", "Low", "Critical").
- **State:** out of range = amber, critical = red, normal = green, unknown = `sunken`/`ink-2`. On the dashboard only flagged markers show a badge.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** `surface` on the `canvas` ground.
- **Shadow Strategy:** none at rest; clickable tiles lift 1px with `shadow-sm` on hover.
- **Border:** 1px `line`; `line-strong` on hover for clickable cards.
- **Internal Padding:** 16px, 20px from sm.
- **Notices:** same shape; info `sunken`, warn `warn-soft` with a 30% amber border, danger `danger-soft` with a 40% red border. Text stays `ink`.

### Inputs / Fields
- **Style:** 44px high, 8px radius, `line-strong` border, white fill, 1rem text, `muted` placeholder.
- **Focus:** 2px `accent` outline drawn just inside the border.
- **Error:** border turns `danger`; message in 0.875rem `danger` 500.
- **Select (Base UI):** same trigger; popup is 8px, `shadow-lg`, options 44px high with `accent-soft` highlight and an accent check; groups divided by a hairline and named with a mono label.
- **Choice group:** radio cards, 44px, `line-strong` border; the chosen one gets an `accent` border and `accent-soft` fill.

### Navigation
- **Sidebar:** logo (serif, 1.25rem), profile menu, nav groups named with mono labels (Health, Habits, Connect, Insights), then Add results (primary, full width) and Settings pinned at the bottom above a hairline.
- **Items:** 44px, 15px Inter, `ink-2` with a 20px icon; hover `sunken` + `ink`; active `accent-soft` fill, `accent` text and icon, weight 500, `aria-current="page"`. Unbuilt sections carry a small round "Soon" chip and stay reachable.
- **Phone:** bottom tabs 56px high, icon over an 11px label, active in `accent`; "More" opens a bottom sheet with the full grouped nav. Top bar holds a round 44px Add button and the profile menu.
- **Skip link:** a button that focuses `main` (the hash is used for routing).

### Charts
- **Lines:** the person's line is `chart-line`, 2px (2.25px on the timeline), round joins; sparklines keep 2px at any width (non-scaling stroke).
- **Bands:** reference ranges are `chart-band` at 12–15%; the gap between biological and calendar age is `chart-band` at 10%.
- **Calendar age:** `ink-2`, 1.5px, dashed 5/5 (3/3 in the small figure line).
- **Points:** filled `chart-line` dots with a `surface` ring; an approximate value is a hollow dot.
- **Test marks (timeline):** hollow `ink-2` ring when all in range; filled amber when out of range, red when critical; radius grows by 1px per out-of-range marker (5 → 11px); tests within 16px merge into one mark with "×n".
- **Log bars:** fully round lanes, ongoing in `accent-soft` with a 40% accent stroke, ended in `sunken` with `line-strong`.
- **Axes:** year gridlines as `line` hairlines, ticks in mono `ink-2`; end values written at the line's end.
- **Legends:** always shown under the chart, 0.75rem `ink-2`, each with a swatch drawn in the chart's own style.
- **Access:** each hit target is a focusable button with a full spoken label; a hidden table repeats the data.

### Timeline (signature)
Biological age against calendar age, every blood test as a mark sized by how much was out of range, and the log as bars beneath. Hovering or focusing a test draws a dashed vertical guide and opens a popover (12px, `shadow-lg`) with the date, result count, biological age and the out-of-range markers in amber or red; clicking pins it. The person's line draws itself in once (1.1s).

### Motion
Short and calm: `--ease-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`) for entrances (8px rise, 320–360ms), lists stagger children by 35ms, fades 220ms, control states 150ms ease-out. `prefers-reduced-motion` cuts every transition and animation to effectively zero.

## Do's and Don'ts

### Do:
- **Do** put white `surface` cards (12px, 1px `line`) on the `canvas` ground.
- **Do** keep every touch target at least 44px (`min-h-11`), bottom tabs at 56px.
- **Do** use amber for out of range and red for critical, each with a word or arrow next to it.
- **Do** draw the person's data in `chart-line` at 2px and calendar or expected lines dashed in `ink-2`.
- **Do** set figures in Instrument Serif 400 with tabular numerals, and the unit beside them in Inter `ink-2`.
- **Do** give every chart a legend and a screen-reader table.
- **Do** mark unbuilt sections "Soon" and keep them honest inside.
- **Do** test at 360px wide and with reduced motion on.

### Don't:
- **Don't** add a second accent colour or use amber/red for anything but state.
- **Don't** put shadows on resting cards; use hairlines.
- **Don't** invent composite scores or decorative numbers; every figure is computed.
- **Don't** use mono uppercase as a teaser line above a heading.
- **Don't** load fonts from a font service; they are bundled.
- **Don't** bold Instrument Serif.
