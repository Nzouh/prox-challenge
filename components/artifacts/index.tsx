import type { Artifact } from "@/lib/agent/artifacts";
import { DutyCycleCalculator } from "./DutyCycleCalculator";

/**
 * The registry. Adding a member to the Artifact union without adding a case here is a
 * compile error, which is the point.
 */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case "duty_cycle":
      return <DutyCycleCalculator {...artifact} />;
    default: {
      const unhandled: never = artifact.type;
      throw new Error(`No renderer for artifact type: ${String(unhandled)}`);
    }
  }
}
