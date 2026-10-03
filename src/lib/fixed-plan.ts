/**
 * The fixed-time timer each junction is compared against.
 *
 * A real timer is programmed once from historical counts and then ignores the
 * hour, so the baseline here is a Webster plan for the junction's long-run
 * (all-day average) demand, not an arbitrary equal split. The adaptive plan
 * therefore has to beat a timer that is correct on average, and it can lose at
 * the hours where the timer happens to suit the traffic better.
 */
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { APPROACHES_PER_JUNCTION, MEAN_DAY_FACTOR, approachDemandVph } from "@/lib/sim-core";
import { fixedPlanFromDemand, saturationFlow, type SignalPlan } from "@/lib/traffic-model";

/** Road ids follow the order the demo engine (and the seed migration) number them in. */
export function roadIdFor(junctionIndex: number, approachIndex: number) {
  return junctionIndex * APPROACHES_PER_JUNCTION + approachIndex + 1;
}

const cache = new Map<number, SignalPlan>();

/** The fixed plan for a seeded junction, or undefined for one the model does not know. */
export function fixedPlanForJunction(junctionId: number): SignalPlan | undefined {
  const cached = cache.get(junctionId);
  if (cached) return cached;
  const index = SEED_JUNCTIONS.findIndex((j) => j.id === junctionId);
  const seed = SEED_JUNCTIONS[index];
  if (!seed) return undefined;

  const demand: number[] = [];
  const saturation: number[] = [];
  for (let a = 0; a < APPROACHES_PER_JUNCTION; a += 1) {
    demand.push(
      approachDemandVph({
        roadId: roadIdFor(index, a),
        maxCapacity: seed.capacity,
        factor: MEAN_DAY_FACTOR,
      }),
    );
    saturation.push(saturationFlow(seed.capacity));
  }
  const plan = fixedPlanFromDemand(demand, saturation);
  cache.set(junctionId, plan);
  return plan;
}
