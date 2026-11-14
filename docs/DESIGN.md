# Design system (design pass, 2026-11-13)

Unbranded newsroom look: serif headlines, sans interface, ink on paper, thin rules, one red accent.
WLBT branding can be layered on later by changing the tokens and the brand mark.

## Tokens (`src/app/globals.css` `:root`)

- **Type:** Newsreader (headlines, deks, big numbers) + Inter (interface, tables). Both are self-hosted by
  `next/font`, so readers' browsers never call Google. Numbers use tabular figures.
- **Color:** ink `#111418` on paper; background `#f6f5f1`; rules `#e4e1da`; accent red `#c8102e`, used only
  for kickers, the brand mark, the first counter, active nav and focus.
- **Data colors** (`src/lib/palette.ts`, the single source for the map, legends, charts and embeds) use the
  Okabe-Ito colorblind-safe set:
  - Verified blighted: vermillion `#d55e00`
  - City action: orange `#e69f00`
  - City-flagged: reddish purple `#cc79a7`
  - Resolved: blue `#0072b2`
  - Not reported: warm grey
  - Owner types: State wine, City blue, other public teal, delinquent orange.
  - Choropleths use a sequential orange ramp (lightness carries the signal).

## Patterns

- **Masthead:** brand mark + serif wordmark, public sections, and one "Staff" dropdown grouped into
  Reporting and Admin. Under 860px everything folds behind "Menu". The same header is used on every
  page, including the full-bleed map.
- **Page head** (`PageHead`): red kicker, serif headline, serif dek, closing ink rule. Used on every public page.
- **Counters:** serif figure with an ink top rule (accent on the first).
- **Tables:** uppercase micro-headers over an ink rule, hairline rows, right-aligned tabular numbers.
  Under 640px, secondary columns (`hide-sm`) drop away; CSV exports keep everything.
- **Tabs:** underline style with an accent bar; they scroll sideways on phones.
- **Charts:** horizontal bars are HTML (`.hbar`), so labels stay legible on phones and in narrow embeds.
  Weekly columns in embeds stay SVG; the City page uses HTML columns (`WeeklyBars`).
- **Methodology** is styled as an article (`.article-section`), not boxes.

## Dark theme ("Night desk")

- Light is the Broadsheet look above; dark adopts the "Night desk" look: near-black desk (`#0e1116`),
  panels `#12161c`, Space Grotesk headlines, IBM Plex Mono figures and kickers (`// KICKER`), and a
  lime accent (`#d4ff3a`) for the current nav item, first counter and chart highlight.
- Errors and destructive buttons use `--danger`, which stays red in both themes (the accent doesn't).
- Data colors stay Okabe-Ito; on dark, blue becomes sky blue `#56b4e9` and grey goes dark
  (`themed()` in `src/lib/palette.ts`). Choropleths use a dim-to-bright ramp (`RAMP_DARK`).
- Follows the system setting until a reader uses the masthead toggle; the choice is a `theme`
  cookie, so the server renders it with no flash. Embeds are always light.
- Maps switch basemap (OpenFreeMap positron / dark) live via `useMapTheme`, keeping our layers.
- Weekly demolitions on the City page: HTML columns (`WeeklyBars`), current week highlighted.

## Still open

- WLBT branding: logo, colors, fonts.
- Social share images (Open Graph cards) for the public pages.
