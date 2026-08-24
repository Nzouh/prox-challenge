import Image from "next/image";
import insidePanel from "@/product-inside.webp";
import type { DutyCycleArtifact } from "@/lib/agent/artifacts";
import { ProvenanceBadge } from "./ProvenanceBadge";

const PROCESS_LABEL: Record<DutyCycleArtifact["process"], string> = {
  MIG: "MIG",
  flux_cored: "Flux-Cored",
  TIG: "TIG",
  stick: "Stick",
};

/**
 * DAY 1: a static readout. Day 5 makes it a real calculator — amperage slider, live
 * recompute, the other five component types alongside it.
 */
export function DutyCycleCalculator(props: DutyCycleArtifact) {
  const onMinutes = (props.periodMinutes * props.dutyCyclePct) / 100;
  const offMinutes = props.periodMinutes - onMinutes;

  return (
    <div className="artifact">
      <div className="artifact-kind">Duty cycle</div>

      <div className="artifact-headline">
        <span className="artifact-value">{props.dutyCyclePct}%</span>
      </div>
      <div className="artifact-conditions">
        {PROCESS_LABEL[props.process]} · {props.amperage}A output · {props.inputVoltage}V input
        · {props.periodMinutes}-minute period
      </div>

      <div className="period">
        <div className="period-on" style={{ flex: props.dutyCyclePct }} />
        <div className="period-off" style={{ flex: 100 - props.dutyCyclePct }} />
      </div>
      <div className="period-legend">
        <span>{formatMinutes(onMinutes)} welding</span>
        <span>{formatMinutes(offMinutes)} cooling</span>
      </div>

      <ProvenanceBadge provenance={props.provenance} />

      <details className="source-evidence">
        <summary>View the source placard</summary>
        <div className="placard-crop">
          <Image
            src={insidePanel}
            alt="Rated duty-cycle placard inside the Vulcan OmniPro 220 wire-feed door"
            sizes="(max-width: 760px) 92vw, 700px"
          />
        </div>
        <p>The rated-duty-cycle table is printed across the top of the inside panel.</p>
      </details>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (Number.isInteger(minutes)) return `${minutes} min`;
  return `${minutes.toFixed(1)} min`;
}
