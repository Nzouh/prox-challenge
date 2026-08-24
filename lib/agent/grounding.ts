import type { DutyCycleArtifact } from "./artifacts";
import type { DutyCycleSpecResult } from "./specs";

export type FoundSpecResult = DutyCycleSpecResult;

/**
 * The model chooses when to render, but it does not get to invent the values.
 * Every field in a duty-cycle artifact must match a lookup that completed successfully
 * earlier in the same agent run.
 */
export function artifactMatchesLookup(
  artifact: DutyCycleArtifact,
  lookup: FoundSpecResult,
): boolean {
  return (
    artifact.process === lookup.conditions.process &&
    artifact.inputVoltage === lookup.conditions.inputVoltage &&
    artifact.amperage === lookup.conditions.amperage &&
    artifact.dutyCyclePct === lookup.value &&
    artifact.periodMinutes === lookup.conditions.periodMinutes &&
    JSON.stringify(artifact.provenance) === JSON.stringify(lookup.provenance)
  );
}
