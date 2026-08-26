import type { Artifact } from "@/lib/agent/artifacts";
import { DutyCycleCalculator } from "./DutyCycleCalculator";
import { SourceVisual } from "./SourceVisual";
import { SetupChecklist } from "./SetupChecklist";
import { PolarityCableMap } from "./PolarityCableMap";
import { TroubleshootingFlow } from "./TroubleshootingFlow";

/**
 * The registry. Adding a member to the Artifact union without adding a case here is a
 * compile error, which is the point.
 */
export function ArtifactView({ artifact }: { artifact: Artifact }) {
  // Switching on the property directly (`artifact.type`) instead of this local no longer
  // narrows `artifact` itself in the default branch once the union has three members —
  // an inference gap between TypeScript's aliased-discriminant analysis and zod's
  // discriminatedUnion output. Binding the discriminant first keeps exhaustiveness checked.
  const kind = artifact.type;
  switch (kind) {
    case "duty_cycle":
      return <DutyCycleCalculator {...artifact} />;
    case "source_visual":
      return <SourceVisual {...artifact} />;
    case "setup_checklist":
      return <SetupChecklist {...artifact} />;
    case "polarity_map":
      return <PolarityCableMap {...artifact} />;
    case "troubleshooting_flow":
      return <TroubleshootingFlow {...artifact} />;
    default: {
      const unhandled: never = kind;
      throw new Error(`No renderer for artifact type: ${String(unhandled)}`);
    }
  }
}
