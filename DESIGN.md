# Design system

HAI Scholar is a personal doctoral reading list that you mostly *listen* to. The look draws on the materials of studying papers: printed pages, blue-black ink, pencil notes in the margins, and one highlighter.

## Tokens

| Token | Light | Role |
| --- | --- | --- |
| `--paper` | `oklch(0.99 0.002 250)` | Page. A cool white, never cream. |
| `--tray` | `oklch(0.962 0.006 260)` | Grouped controls, sheets, answer choices. |
| `--ink` | `oklch(0.24 0.03 265)` | Text. Blue-black ink, never `#111`. |
| `--pencil` | `oklch(0.52 0.02 265)` | Secondary text and meta. |
| `--rule` | `oklch(0.89 0.008 265)` | Hairlines and the path rail. |
| `--pen` | `oklch(0.47 0.17 264)` | Actions only: buttons, links, the play button. |
| `--hl` | `oklch(0.93 0.16 108)` | The highlighter. |

Dark mode uses the same roles through `light-dark()`. Correct answers are green ink and wrong answers are red pencil; both appear only on quiz feedback.

## Type

- **New York** (`ui-serif`): everything you *read*, including paper and module titles, large titles, questions and the reader body.
- **SF Pro** (`system-ui`): everything you *operate*, including buttons, meta lines, settings and the player.
- Scale: 13 / 15 / 17 / 20 / 24 / 34. Section headings are sentence-case serif, never all-caps eyebrows.

## The one bold thing: the highlighter

Yellow means "you are here" and nothing else. It marks:
- the current step on Today,
- the current module in the path,
- the current stage number,
- the sentence being read aloud.

On Today it draws across the current step once when the page loads (skipped with reduced motion).

## Layout

- **Today** reads like a syllabus page: a date heading, then a numbered plan on bare paper with hairlines, then the path.
- **The path** is a vertical rail, because stages really are a sequence. Each stage number sits on the rail, and its modules hang beneath it.
- **Trays** (filled, 14px radius) are only for things you act on as a group: settings, answer choices, the recall sheet.

## Rules

- No gradients, dashed boxes, tinted left borders, uppercase labels or uniform card shadows.
- Every pressable element gets `:active` feedback (`scale(.97)`, 160ms ease-out), and hover styles live inside `(hover: hover)`. Focus uses `:focus-visible` outlines.
- Movement only inside `prefers-reduced-motion: no-preference`. Easing is `cubic-bezier(.23,1,.32,1)`, and UI motion stays under 300ms.
- Numbers that change (times, counts, percents) use `tabular-nums`.
- Sources: [good-css.com](https://good-css.com) techniques, Anthropic's `frontend-design` skill, and Emil Kowalski's `mobile-native` skill.
