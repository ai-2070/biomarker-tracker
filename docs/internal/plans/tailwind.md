# Moving the page to Tailwind CSS 4

The page's styles are Tailwind 4. `web/styles/app.css` is the entry: `scripts/build-web.ts` compiles it
(Tailwind scans `web/` and `public/index.html` for class names) into `public/dist/app.css`.

## How the styles are laid out

Cascade layers, lowest first:

| Layer | What | Where |
|---|---|---|
| `theme` | tokens (`--color-accent`, `--font-mono`, …) | `@theme` in `app.css` |
| `base` | Tailwind's reset (preflight) + our element styles: body, links, `p`, `pre`, `code`, text inputs, `select`, headings stay bold | `base.css` |
| `openui` | the chats' OpenUI stylesheet (wrapped by the build) | `public/dist/openui.css` |
| `helpers` | old helper classes (`.row`, `.dim`, …) until every area uses utilities | `legacy/helpers.css` |
| `components` | the shared pieces (`btn`, `card`, `pill`, `modal`, `st-menu`, …), then the old per-area styles not moved yet | `components.css`, `legacy/<area>.css` |
| `utilities` | Tailwind utilities: they win over everything above | in the markup |

`components.css` is the only hand-written CSS that stays: pieces used across the app, Markdown output
(`.md`), and things utilities can't reach. Everything specific to one page or panel is utilities in its
markup.

## Tokens

- Colors: `bg`, `floor`, `panel`, `panel-2`, `line`, `line-2`, `ink`, `dim`, `faint`, `accent`, `accent-hover`,
  `accent-dim`, `on-accent`, `amber`, `ok`, `ice`, `red`, `glass`, `glass-strong`, `white`, `black` →
  `text-dim`, `bg-panel-2`, `border-line-2`, `bg-accent/10`. Tailwind's own palette is off.
  `look.ts` swaps `--color-accent*` at runtime, so always use the token, never the hex.
- Fonts: `font-sans` (Archivo), `font-mono` (JetBrains Mono), `font-chat` (Merriweather) for the text of chat messages. They come with the page: `scripts/build-fonts.ts` copies them from the Fontsource packages into `public/dist/fonts`, so nothing is fetched from Google. Settings → Look can set `--font-chat` to another font (`CHAT_FONTS` in `shared/look.ts`); Google Sans, Roboto and Inter for those come with the page the same way. Body is 15px/1.55 sans.
- Radius: `rounded-ctl` (7px: buttons, inputs, chips), `rounded-box` (10px: panels, cards, dialogs), `rounded-full`.
- `shadow-pop`, `ease-soft`, `w-nav` (216px sidebar).
- Animations: `animate-pulse` `animate-blink` `animate-fade` `animate-fade-fast` `animate-pop` `animate-in-up`
  `animate-in-right` `animate-rise-in` `animate-cw-pop`; every keyframe in `app.css` also works as
  `animate-[rise-in_0.22s_var(--ease-soft)]`.
- Breakpoints are the app's: `max-sm:` ≤700px, `max-md:` ≤820px, `md:` ≥821px, `max-lg:` ≤1100px. Others:
  `max-[1201px]:` for `max-width: 1200px` (one more than the old number, so the edge stays the same).

## Writing old CSS as utilities

- Spacing is 4px steps: `p-2.5` = 10px, `gap-3.5` = 14px, `mt-4.5` = 18px, `px-1.75` = 7px. Any whole
  pixel value works this way (N px → N/4).
- Font sizes are the old pixel values: `text-[12.5px]`, `leading-[1.4]`, `tracking-[0.14em]`. (Tailwind's
  `text-sm` etc. would also change line-height.)
- `font: 700 11px/1 var(--font-mono)` is `font-mono text-[11px] leading-none font-bold`. The `font`
  shorthand also reset what it didn't name: `font: 11px var(--font-mono)` means `leading-[normal] font-normal` too (Tailwind's `leading-normal` is 1.5, not `normal`).
- Mixed colors: `color-mix(in srgb, var(--color-red) 45%, var(--color-line))` →
  `border-[color-mix(in_srgb,var(--color-red)_45%,var(--color-line))]`. A color over transparent → `bg-accent/10`.
- Custom properties set inline (`--c`, `--agent-color`, `--team-color`): `bg-(--c)`, `shadow-[0_0_8px_var(--c)]`.
- States: `:hover` → `hover:`; a class set by script (`.on`, `.active`, `.open`, …) → `[&.on]:…` (keep the class);
  a parent's state → `group` on the parent and `group-[.on]:…` / `group-hover:…` on the child; body states →
  `in-[.station-mode]:…`. `data-*` from Base UI → `data-checked:…`, `data-[side=top]:…`.
- Children you can't put classes on (rendered Markdown, third-party DOM, another area's element): from your
  own element, `[&_p]:m-0`, `*:min-w-0`, `[&>.x]:…`, `[&_.model-chip]:h-7` (keep the marker class it targets).
- Pseudo-elements: `before:content-[''] before:absolute …`, `after:…`, `placeholder:text-faint`.
- Things that stay CSS: keyframes, scrollbars (`[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`
  works too), selectors nothing else can say. Prefer an arbitrary variant before adding CSS.
- Never build class names from pieces (`` `bg-${c}` ``): Tailwind reads the source text, so every class must
  appear whole. Pick between whole strings instead.

## The reset (preflight)

Elements start bare: no margins (except `p`: 0 0 10px), lists without bullets, buttons with no padding or
background, `img`/`svg`/`canvas`/`video` are `display: block`, borders are 0 wide and solid. Headings stay
bold but have no size or margin of their own. What the old CSS left to the browser must now be written.

## Shared pieces (components.css)

`btn` (+ `ghost` `danger` `small` `tiny`), `icon-btn`, `img-button`, `field`, `label`, `hint`, `lede`,
`h2.section`, `seg`, `chips`/`chip` (+`on`), `toggle`, `switch`, `badge` (+`hot`), `pill` (+ `ok` `warn` `bad` `info`
`mem`), `dot` (+ `on` `busy` `warn`), `st-dot`, `st-badge` (+`lg`), `tc-lead`, `skill-ico`, `panel`, `panel-head`,
`cards`, `card` (+ `clickable` `card-top` `card-title` `card-sub` `card-foot` `corner`), `avatar` (+`lg`), `list`,
`list-row`, `empty` (+`box`), `kv`, `tabs`, `dom-contents`, `st-menu` (+ `st-menu-head` `st-menu-item` `st-menu-sep`),
`model-menu` `model-list` `model-sub` `model-latest`, `tc-suggest` `tc-sopt` `tc-act`, `messages`, `msg` (+ `user`
`assistant` `error` `meta`), `tool`, `tool-images`, `cursor`, `composer`, `queued-*`, `cmd-chip(s)`, `att-*`,
`compaction`, `compacted`, `approval`, `question`, `modal-back` `modal` (+`narrow`) `modal-head` `modal-body`
`modal-foot`, `lightbox`, `toast`, `md`, `ico-svg`, `logo-svg`, `craft-icon`.

Use them as they are and change one with utilities on the element: `btn ghost small h-6.5`. A utility beats
the piece's own `:hover`/`:active` for that property too, so when you change a button's background or color,
also write the hover: `bg-transparent hover:bg-panel-2`.

## Old helper classes → utilities

| Old | Utilities |
|---|---|
| `mono` | `font-mono` |
| `dim` `faint` `accent` `amber` `red` | `text-dim` `text-faint` `text-accent` `text-amber` `text-red` |
| `grow` | `flex-1 min-w-0` |
| `row` | `flex flex-wrap items-center gap-2.5` |
| `row nowrap` | `flex items-center gap-2.5` |
| `col` | `flex flex-col gap-2.5` |
| `between` | `justify-between` |
| `gap-lg` | `gap-4.5` |
| `mt` / `mt-lg` | `mt-3.5` / `mt-7` |
| `nowrap` (not on a row) | `whitespace-nowrap` |
| `pre-wrap` | `whitespace-pre-wrap` |
| `grid-2` | `grid grid-cols-2 gap-3.5 max-md:grid-cols-1` |
| `two-col` | `grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1` |

The helpers were the weakest styles: any other rule on the same element won. So when an element had a
helper and another class setting the same property (`card row`: the card's 8px gap won), leave the
helper's utility out.

## Moving an area

1. Its old styles are in `web/styles/legacy/<area>.css`, in the same layer as the shared pieces and after
   them. Only what actually won in that cascade counts: `.att-btn { color: var(--color-dim) }` lost to
   `.btn.ghost` (more specific), so it doesn't become `text-dim`.
2. Write each rule as utilities on the elements it matched; drop the old class names.
3. Keep a class as a bare marker when code or tests look it up (`querySelector`, `closest`, `classList`,
   `tests/`) or another area's CSS selects it. `grep -rn "\.name\b\|'name'" web tests` before removing one.
4. Empty the area's legacy file when its rules are all moved.

Check class names with the checker (see the summary of this change) and run `bun run typecheck` and the
tests. The final check compares every page's computed styles before and after.
