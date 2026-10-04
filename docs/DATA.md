# Data used to check the demand model

Two public traffic-count datasets were compared with the demand model. **Neither is from Chennai**,
so they test the _shape_ of a day and a vehicle mix, not Chennai's volumes. The raw files are not
in the repository (`data/` is git-ignored: they are large and carry their own terms). Running
`node scripts/fit-demand.mjs` on them writes the small summary `docs/data-fit.json`, which is.

| Dataset                                     | What it is                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `fedesoriano/traffic-prediction-dataset`    | Hourly vehicle counts at four junctions, Nov 2015 to Jun 2017 (three have the full 20 months, one about six). |
| `hasibullahaman/traffic-prediction-dataset` | 15-minute counts of cars, bikes, buses and trucks over about three months, with a labelled traffic situation. |

## What the comparison found

Shape of the working day, each curve divided by its own mean, compared hour by hour with the
model's weekday curve:

|                    | Correlation with the model | Typical difference |
| ------------------ | -------------------------- | ------------------ |
| Dataset 1, weekday | 0.49                       | 0.44               |
| Dataset 2, weekday | 0.71                       | 0.35               |
| Dataset 1, weekend | 0.63                       | 0.40               |
| Dataset 2, weekend | 0.40                       | 0.49               |

- **The two datasets disagree with each other.** Dataset 1 has no morning peak: counts climb from
  5 am to a plateau from noon to 10 pm. Dataset 2 has sharp peaks at 6 to 8 am and 4 to 6 pm and
  almost nothing from 10 pm to 4 am, and its weekend looks the same as its weekday, which real
  roads do not do. Neither is a good stand-in for Chennai on its own.
- **The model's curve was not changed.** It keeps commuter peaks at about 8 to 10 am and 5:30 to
  7:30 pm, which is how Chennai is generally described, and the data do not contradict a morning
  and evening rush so much as disagree about when. The model's correlation with the data is
  moderate, which is what you would expect when it was drawn from local knowledge and the data
  come from elsewhere.
- **Weekend volume.** In dataset 1 a weekend day carries about 76 % of a weekday's traffic. The
  model's weekend curve carries about 84 %. The difference is small, so it was left alone.
- **The "traffic situation" labels in dataset 2 overlap** (the middle half of "low" and "normal"
  counts sit in the same range), so they were not used as ground truth for the low, busy and
  jammed levels.
- **Vehicle mix in dataset 2** is 60 % cars, 12 % bikes, 12 % buses and 16 % trucks. That is not
  what Chennai looks like, where two-wheelers dominate, so it was not used for the Indian mix; see
  `src/lib/vehicle-mix.ts`.

## How to replace the assumption with a measurement

Counted data from the road itself is the only thing that settles this. Three or four junctions
counted for a day each, with the totals entered per hour, would replace the curve in
`WEEKDAY_KNOTS` and `WEEKEND_KNOTS` in `src/lib/sim-core.ts` and could be checked with the same
script.
