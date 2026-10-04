// Reads the two traffic-count datasets in data/ and writes docs/data-fit.json: the shape of a day
// for weekdays and weekends, the vehicle mix by hour, and what the labelled "traffic situation"
// corresponds to in counts. Run with: node scripts/fit-demand.mjs
//
// Neither dataset is from Chennai. They give the shape of a day and a labelled mix, not Chennai's
// volumes. docs/DATA.md says so; the app does not read the datasets, only the small JSON this writes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) =>
  fs
    .readFileSync(path.join(root, p), "utf8")
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","));

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const round = (x, d = 3) => Number(x.toFixed(d));

// ---- Dataset 1: hourly counts at four junctions, Nov 2015 to Jun 2017 ------------------------
const rows1 = read("data/traffic.csv").map(([dt, junction, vehicles]) => {
  const [date, time] = dt.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const hour = Number(time.slice(0, 2));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return {
    junction: Number(junction),
    hour,
    weekend: dow === 0 || dow === 6,
    dow,
    vehicles: Number(vehicles),
  };
});

/** Mean count by hour for weekdays and weekends, each junction scaled by its own all-week mean. */
function shape(rows) {
  const out = { weekday: Array(24).fill(0), weekend: Array(24).fill(0) };
  const junctions = [...new Set(rows.map((r) => r.junction))];
  const perJunction = [];
  for (const j of junctions) {
    const mine = rows.filter((r) => r.junction === j);
    const all = mean(mine.map((r) => r.vehicles));
    const curve = { weekday: [], weekend: [] };
    for (const kind of ["weekday", "weekend"]) {
      for (let h = 0; h < 24; h += 1) {
        const sel = mine.filter((r) => r.hour === h && r.weekend === (kind === "weekend"));
        curve[kind].push(mean(sel.map((r) => r.vehicles)) / all);
      }
    }
    perJunction.push({ junction: j, rows: mine.length, ...curve });
  }
  // Junction 4 has only about six months, so it joins the average but is flagged.
  for (const kind of ["weekday", "weekend"]) {
    for (let h = 0; h < 24; h += 1) out[kind][h] = round(mean(perJunction.map((p) => p[kind][h])));
  }
  return { curve: out, perJunction };
}
const fit1 = shape(rows1);
// How much quieter a weekend day is than a weekday, from the junctions with a full record.
const weekendRatio = round(
  mean(
    [1, 2, 3].map(
      (j) =>
        mean(rows1.filter((r) => r.junction === j && r.weekend).map((r) => r.vehicles)) /
        mean(rows1.filter((r) => r.junction === j && !r.weekend).map((r) => r.vehicles)),
    ),
  ),
);

// ---- Dataset 2: 15-minute counts by class with a labelled situation -------------------------
const DAYS = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};
const rows2 = [
  ...read("data/hasibullahaman/Traffic.csv"),
  ...read("data/hasibullahaman/TrafficTwoMonth.csv"),
].map(([time, date, day, car, bike, bus, truck, total, situation]) => {
  const [clock, ampm] = time.split(" ");
  let hour = Number(clock.split(":")[0]) % 12;
  if (ampm === "PM") hour += 12;
  const dow = DAYS[day];
  return {
    hour,
    weekend: dow === 0 || dow === 6,
    car: Number(car),
    bike: Number(bike),
    bus: Number(bus),
    truck: Number(truck),
    total: Number(total),
    situation,
  };
});
const all2 = mean(rows2.map((r) => r.total));
const curve2 = { weekday: [], weekend: [] };
for (const kind of ["weekday", "weekend"]) {
  for (let h = 0; h < 24; h += 1) {
    const sel = rows2.filter((r) => r.hour === h && r.weekend === (kind === "weekend"));
    curve2[kind].push(round(mean(sel.map((r) => r.total)) / all2));
  }
}
const sum = (k) => rows2.reduce((a, r) => a + r[k], 0);
const grand = sum("car") + sum("bike") + sum("bus") + sum("truck");
const mix = {
  car: round(sum("car") / grand),
  bike: round(sum("bike") / grand),
  bus: round(sum("bus") / grand),
  truck: round(sum("truck") / grand),
};
const situations = {};
for (const s of [...new Set(rows2.map((r) => r.situation))]) {
  const totals = rows2
    .filter((r) => r.situation === s)
    .map((r) => r.total)
    .sort((a, b) => a - b);
  situations[s] = {
    rows: totals.length,
    median: totals[Math.floor(totals.length / 2)],
    p10: totals[Math.floor(totals.length * 0.1)],
    p90: totals[Math.floor(totals.length * 0.9)],
  };
}

const result = {
  note: "Fitted from public datasets that are not from Chennai. See docs/DATA.md.",
  hourly: {
    dataset1: {
      source: "fedesoriano/traffic-prediction-dataset",
      rows: rows1.length,
      ...fit1.curve,
    },
    dataset2: {
      source: "hasibullahaman/traffic-prediction-dataset",
      rows: rows2.length,
      ...curve2,
    },
  },
  perJunction: fit1.perJunction.map((p) => ({
    junction: p.junction,
    rows: p.rows,
    weekday: p.weekday.map((x) => round(x)),
    weekend: p.weekend.map((x) => round(x)),
  })),
  weekendToWeekdayVolume: { dataset1: weekendRatio },
  vehicleMix: { source: "dataset2", share: mix },
  situationByTotal: situations,
};
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/data-fit.json"), JSON.stringify(result, null, 1) + "\n");
console.log("weekday d1", fit1.curve.weekday.join(" "));
console.log("weekend d1", fit1.curve.weekend.join(" "));
console.log("weekday d2", curve2.weekday.join(" "));
console.log("weekend d2", curve2.weekend.join(" "));
console.log("weekend/weekday volume", weekendRatio);
console.log("mix", JSON.stringify(mix));
console.log("situations", JSON.stringify(situations));
