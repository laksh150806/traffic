# Design: Aurora Glass

Mission control for a city, built from frosted glass. The Chennai signal network is a 3D glass
city: every junction is a light column whose height and colour show congestion, joined by a faint
network, and the operator works from glass panels floating over a deep indigo aurora. The 3D city is
the one memorable thing; everything around it is quiet, translucent and disciplined.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Void | `oklch(0.13 0.03 275)` | page background, with a saturated aurora wash for the glass to refract |
| Deep space | `oklch(0.17 0.04 272)` | inset surfaces |
| Glass | `oklch(0.22 0.045 275 / 0.55)` | panels, blurred 22px |
| Aurora | `oklch(0.82 0.13 205)` | primary accent, live data |
| Nebula | `oklch(0.68 0.19 295)` | secondary accent, glow |
| Starlight | `oklch(0.96 0.01 270)` | text |
| Signal low / moderate / high | green / amber / red | traffic status only, never decoration |

Status colours carry meaning (free-flowing, busy, jammed). They are not used as accents.

## Type

- Display: Sora, 600. Headings and big readouts.
- Body: Manrope, 400 to 600.
- Numerics: JetBrains Mono with tabular figures, readouts only.
- Labels are sentence case. No tracked all-caps eyebrows, no middle-dot meta strings.

## Layout

```
 [ dock: mark, 3D city | Street map, status, recalculate ]
 [ junction rail ] [        3D city stage        ] [ inspector ]
 [  glass 300px  ] [ HUD: selected + KPIs over scene ] [ glass 460px ]
```

Mobile stacks: stage first (360px tall), then the inspector, then the junction list.

## Motion

- One orchestrated moment: the camera glides to the selected junction (eased, ~1s).
- Columns grow or shrink to their congestion and pulse a floor ring. Nothing else moves unprompted.
- Cards tilt a few degrees toward the pointer and catch a moving highlight.
- Numbers ease to new values. Everything respects `prefers-reduced-motion`.
- Animate transform and opacity only.

## Data honesty

All traffic readings are simulated and the UI says so ("Demo data" or "Simulated demand"). The
signal model (Webster cycle and delay) is real; the demand feeding it is synthetic.
