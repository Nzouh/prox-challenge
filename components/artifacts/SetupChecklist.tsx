import type { SetupChecklistArtifact, SetupChecklistStep } from "@/lib/agent/artifacts";
import { ProvenanceBadge } from "./ProvenanceBadge";

const PROCESS_LABEL: Record<SetupChecklistArtifact["process"], string> = {
  MIG: "MIG",
  flux_cored: "Flux-Cored",
  TIG: "TIG",
  stick: "Stick",
};

const STAGE_LABEL: Record<SetupChecklistStep["stage"], string> = {
  cables: "Cables",
  workpiece: "Workpiece",
  consumables: "Consumables",
  power_controls: "Power & controls",
  shutdown: "Shutdown",
};

const STATE_LABEL: Record<SetupChecklistStep["state"], string> = {
  required: "Required",
  optional: "Optional",
  disconnected: "Leave disconnected",
  conditional: "If applicable",
};

function groupByStage(steps: readonly SetupChecklistStep[]): Array<[SetupChecklistStep["stage"], SetupChecklistStep[]]> {
  const groups = new Map<SetupChecklistStep["stage"], SetupChecklistStep[]>();
  for (const step of steps) {
    const group = groups.get(step.stage);
    if (group) group.push(step);
    else groups.set(step.stage, [step]);
  }
  return [...groups.entries()];
}

/** Every step here came straight from getSetup's deterministic traversal (lib/agent/setups.ts,
 *  buildSetupChecklistArtifact); the agent never authors this list. */
export function SetupChecklist(props: SetupChecklistArtifact) {
  const groups = groupByStage(props.steps);

  return (
    <div className="artifact setup-checklist">
      <div className="artifact-headline">
        <span className="artifact-kind">Setup checklist</span>
        <span className="artifact-value setup-checklist-process">{PROCESS_LABEL[props.process]}</span>
      </div>

      {props.prerequisites.length > 0 && (
        <ul className="setup-checklist-prereqs">
          {props.prerequisites.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      {groups.map(([stage, steps]) => (
        <div key={stage} className="setup-checklist-group">
          <div className="setup-checklist-stage">{STAGE_LABEL[stage]}</div>
          <ol className="setup-checklist-steps">
            {steps.map((step) => (
              <li key={`${stage}-${step.order}`} className={`setup-step setup-step-${step.state}`}>
                <span className="setup-step-order">{step.order}</span>
                <span className="setup-step-body">
                  <span className="setup-step-instruction">{step.instruction}</span>
                  <span className="setup-step-meta">
                    {STATE_LABEL[step.state]}
                    {step.condition ? ` · ${step.condition}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      <details className="source-evidence setup-checklist-provenance">
        <summary>Show sources</summary>
        <div className="setup-checklist-provenance-list">
          {props.provenance.map((item, index) => (
            <ProvenanceBadge key={`${item.source}-${index}`} provenance={item} />
          ))}
        </div>
      </details>
    </div>
  );
}
