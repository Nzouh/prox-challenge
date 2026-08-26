import type { DutyCycleArtifact } from "@/lib/agent/artifacts";

/**
 * DAY 1: a static readout. Day 5 makes it a real calculator — amperage slider, live
 * recompute, the other five component types alongside it.
 */
export function DutyCycleCalculator(props: DutyCycleArtifact) {
  const onMinutes = (props.periodMinutes * props.dutyCyclePct) / 100;
  const offMinutes = props.periodMinutes - onMinutes;

  return (
    <div className="artifact">
      <div className="artifact-headline">
        <span className="artifact-kind">Duty cycle</span>
        <span className="artifact-value">{props.dutyCyclePct}%</span>
      </div>

      <div className="period">
        <div className="period-on" style={{ flex: props.dutyCyclePct }} />
        <div className="period-off" style={{ flex: 100 - props.dutyCyclePct }} />
      </div>
      <div className="period-legend">
        <span>{formatMinutes(onMinutes)} welding</span>
        <span>{formatMinutes(offMinutes)} cooling</span>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (Number.isInteger(minutes)) return `${minutes} min`;
  return `${minutes.toFixed(1)} min`;
}
