# Design: Aurora Glass

A control room for a city, built from frosted glass. The Chennai signal network is a real map:
every junction is a dot coloured by congestion, and the operator works from glass panels floating
over a deep indigo aurora. The map answers three questions: where is it bad, what will it be like
later, and what does a trip cost once the signals are counted. Everything around it is quiet,
translucent and disciplined. The one 3D piece is the junction view, which earns its place by showing
queues and signal heads you cannot see on a map.

## Palette

| Token                        | Value                          | Use                                                                    |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Void                         | `oklch(0.13 0.03 275)`         | page background, with a saturated aurora wash for the glass to refract |
| Deep space                   | `oklch(0.17 0.04 272)`         | inset surfaces                                                         |
| Glass                        | `oklch(0.22 0.045 275 / 0.55)` | panels, blurred 20px                                                   |
| Aurora                       | `oklch(0.82 0.13 205)`         | primary accent, live data                                              |
| Nebula                       | `oklch(0.68 0.19 295)`         | secondary accent, glow                                                 |
| Starlight                    | `oklch(0.96 0.01 270)`         | text                                                                   |
| Signal low / moderate / high | green / amber / red            | traffic status only, never decoration                                  |

Status colours carry meaning (free-flowing, busy, jammed). They are not used as accents.

## Type

- Display: Sora, 600. Headings and big readouts.
- Body: Manrope, 400 to 600.
- Numerics: JetBrains Mono with tabular figures, readouts only.
- Labels are sentence case. No tracked all-caps eyebrows, no middle-dot meta strings.

## Layout

```
 [ dock: mark, status, recalculate ]
 [ Explore | Directions ] [ map: search, legend, time bar ] [ place card + detail ]
 [   glass 290-350px   ] [                               ] [    glass 330-430px   ]
```

Mobile stacks: map first (520px tall), then Explore or Directions, then the place card and detail.

## Motion

- One orchestrated moment: the map flies to the selected junction (~0.8s).
- The guided tour is the showpiece: a day of traffic sweeps across the map (about 40 seconds),
  jammed junctions glow and send rings outward, and a caption card narrates each stop.
- Signal heads go amber, then all red, at every handover: the 4 s the model charges as lost time.
- Jammed junctions send red rings outward; busy ones carry a soft glow.
- Nothing else moves unprompted; the signal heads in the junction view pulse while green.
- Approach cards tilt a few degrees toward the pointer.
- Numbers ease to new values. Everything respects `prefers-reduced-motion`.
- Animate transform and opacity only.

## Data honesty

All traffic readings are simulated and the UI says so ("Simulated data" or "Simulated demand"). The
signal model (Webster cycle and delay) is real; the demand feeding it is synthetic.

Camera views and CCTV charts are drawn from the simulated queue and say "Simulated" on the
panel. The comparison with the fixed timer is shown as a signed number with the count of
junctions where the adaptive plan is predicted to do worse; a gain is never clamped to zero.
Reduced motion is honoured globally in CSS, and charts and the camera loop check the setting too.
