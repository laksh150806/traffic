# Design: ARGUS

Chennai signal intelligence. An armoured eye hangs over the live map and watches the city: its
aperture closes as average load rises, its plates flare and turn red with the share of jammed
junctions, it pulses on each fresh reading, and a tether runs from it to the lock-on reticle of
the junction being watched. Monochrome black and titanium with one red; signal colours only for
traffic status. Every effect carries a reading: split-flap boards flip when a value changes,
leader bars light to the value, the control-loop stepper follows the real 2 s / 12 s loop, the
day spiral plots the next 24 hours of forecast jams, the folder fans out the junction files, and
the terminal line (`argus@junction ›`) opens the command palette. Cursor grid, swarm and glow
borders are desktop-pointer only and off with reduced motion. The eye shader is adapted from the
owner's Jarvis sun, made neutral and driven by traffic data instead of voice.

## Palette

| Token                        | Value                         | Use                                   |
| ---------------------------- | ----------------------------- | ------------------------------------- |
| Black                        | `oklch(0.1 0.003 260)`        | page background, one faint red glow   |
| Glass                        | `oklch(0.2 0.004 260 / 0.55)` | panels, blurred 20px                  |
| Titanium                     | `oklch(0.95 0.004 260)`       | primary: selection, actions, readouts |
| Hot red                      | `oklch(0.62 0.2 27)`          | live and urgent trim, text selection  |
| Signal low / moderate / high | green / amber / red           | traffic status only, never decoration |

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
- Control-room finish: white corner brackets and red and white trim on the map frame, a prismatic
  rim on every panel, scanlines, a projected floor grid, a light along the header, a silver title
  gradient, text that decodes when the selected junction changes, tiles that lean toward the
  pointer with a foil light, and a tab title that reports the jam count while hidden. All of it animates
  transform or opacity only, is switched off by reduced motion, and is toned down on phones.
- Real roads are coloured by TomTom speed on request (the Road speeds button).
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

## Hero instruments

Each one is a vector SVG tied to live or modelled data, with a text equivalent for screen readers.

- **Signal compass** (`SignalCompass`, place card): four bands, one per approach. Width is the queue, colour is the signal head now, a dashed ghost is the queue the fixed timer would leave, the outer arc counts down the green. Forecast hours show queues only.
- **Day dial** (`DayDial`, place card): the typical day as a ring, one spoke per hour, length is load. The red hand is the time on the map. Click a spoke to move the map to that hour.

## Deck layout

On wide screens the map is the whole table, edge to edge. The controls float over it as two smoked-glass columns, and the map frames itself inside the open middle (`--deck-l` / `--deck-r`). Interface language acts on the real map: a lock-on reticle with a projected name tag marks the selected junction, and a scan line crosses the table each time fresh readings land. Figures are hairline readouts, not boxed tiles. On phones it stacks: map first, then the columns.
