import type { CableConnection, CableEndpoint, PolarityMapArtifact } from "@/lib/agent/artifacts";
import { ProvenanceBadge } from "./ProvenanceBadge";

const PROCESS_LABEL: Record<PolarityMapArtifact["process"], string> = {
  MIG: "MIG",
  flux_cored: "Flux-Cored",
  TIG: "TIG",
  stick: "Stick",
};

const ENDPOINT_LABEL: Record<CableEndpoint, string> = {
  positive_terminal: "Positive terminal",
  negative_terminal: "Negative terminal",
  wire_feed: "Wire feed",
  gas_regulator: "Gas regulator",
  internal_connection: "Inside the welder",
  unconnected: "Not connected",
};

const ROLE_LABEL: Record<CableConnection["role"], string> = {
  electrode: "Electrode lead",
  work: "Work lead",
  auxiliary: "Auxiliary",
};

const STATE_LABEL: Record<CableConnection["state"], string> = {
  required: "Required",
  optional: "Optional",
  disconnected: "Leave disconnected",
};

/** Component ids come from the validated setup record, so the fallback has to stay safe
 *  for an id this map has not been taught yet. */
const COMPONENT_LABEL: Record<string, string> = {
  ground_clamp: "Ground clamp",
  electrode_holder: "Electrode holder",
  wire_feed_power: "Wire-feed power lead",
  tig_torch: "TIG torch",
  mig_gun: "MIG gun",
  shielding_gas: "Gas line",
  foot_pedal: "Foot pedal",
  wire_feed_control: "Wire-feed control cable",
};

function componentLabel(component: string): string {
  return COMPONENT_LABEL[component] ?? component.replaceAll("_", " ");
}

const ROW_HEIGHT = 58;
const DIAGRAM_WIDTH = 720;
const MACHINE_X = 20;
const MACHINE_WIDTH = 152;
const TERMINAL_X = MACHINE_X + MACHINE_WIDTH;
const CHIP_X = 424;
const CHIP_WIDTH = DIAGRAM_WIDTH - CHIP_X - 20;
const CHIP_HEIGHT = 44;
const TOP = 26;

/**
 * Every lead drawn here reached this component from the validated cable stage of
 * getSetup, by way of buildPolarityMapArtifact (lib/agent/polarity-map.ts). The geometry
 * is computed from that list; the model contributes nothing to it, not even a label.
 * The diagram is presentational for assistive tech — the connection list below carries
 * exactly the same facts as text.
 */
export function PolarityCableMap(props: PolarityMapArtifact) {
  const terminalLeads = props.connections.filter(
    (connection) =>
      connection.endpoint === "positive_terminal" || connection.endpoint === "negative_terminal",
  );
  const otherLeads = props.connections.filter((connection) => !terminalLeads.includes(connection));

  const rows = Math.max(terminalLeads.length, 2);
  const height = TOP * 2 + rows * ROW_HEIGHT;
  const machineHeight = rows * ROW_HEIGHT - 14;
  const positiveY = TOP + machineHeight * 0.32;
  const negativeY = TOP + machineHeight * 0.68;
  const chipY = (index: number) => TOP + index * ROW_HEIGHT;

  return (
    <div className="artifact polarity-map">
      <div className="artifact-headline">
        <span className="artifact-kind">Polarity cable map</span>
        <span className="artifact-value polarity-map-process">{PROCESS_LABEL[props.process]}</span>
      </div>

      {props.polarity ? (
        <p className="polarity-map-summary">
          <span className="polarity-map-label">{props.polarity.label}</span>
          <span>
            electrode lead on the {props.polarity.electrodeTerminal} terminal, work lead on the{" "}
            {props.polarity.workTerminal} terminal
          </span>
        </p>
      ) : (
        <p className="artifact-conditions">
          The validated setup does not place the electrode and work leads on opposite terminals,
          so this map carries no polarity name.
        </p>
      )}

      {props.prerequisites.length > 0 && (
        <ul className="polarity-map-prereqs">
          {props.prerequisites.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      <svg
        className="polarity-map-diagram"
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${height}`}
        role="presentation"
        aria-hidden="true"
      >
        <rect
          className="polarity-map-machine"
          x={MACHINE_X}
          y={TOP}
          width={MACHINE_WIDTH}
          height={machineHeight}
          rx={14}
        />
        <text className="polarity-map-machine-text" x={MACHINE_X + 18} y={TOP + 26}>
          OmniPro 220
        </text>
        <text className="polarity-map-machine-sub" x={MACHINE_X + 18} y={TOP + 43}>
          {PROCESS_LABEL[props.process]}
        </text>

        {terminalLeads.map((connection, index) => {
          const polarity = connection.endpoint === "positive_terminal" ? "positive" : "negative";
          const y = chipY(index);
          const start = polarity === "positive" ? positiveY : negativeY;
          const end = y + CHIP_HEIGHT / 2;
          return (
            <g key={`${connection.order}-${connection.component}`} className={`polarity-lead-${polarity}`}>
              <path
                className={`polarity-cable cable-${polarity}`}
                d={`M ${TERMINAL_X} ${start} C ${TERMINAL_X + 110} ${start}, ${CHIP_X - 110} ${end}, ${CHIP_X} ${end}`}
                fill="none"
                strokeDasharray={connection.state === "optional" ? "7 6" : undefined}
              />
              <circle className={`polarity-terminal terminal-${polarity}`} cx={TERMINAL_X} cy={start} r={13} />
              <text className="polarity-terminal-glyph" x={TERMINAL_X} y={start + 5} textAnchor="middle">
                {polarity === "positive" ? "+" : "−"}
              </text>
              <rect
                className={`polarity-chip chip-${polarity}`}
                x={CHIP_X}
                y={y}
                width={CHIP_WIDTH}
                height={CHIP_HEIGHT}
                rx={10}
              />
              <text className="polarity-chip-name" x={CHIP_X + 14} y={y + 19}>
                {componentLabel(connection.component)}
              </text>
              <text className="polarity-chip-meta" x={CHIP_X + 14} y={y + 34}>
                {ENDPOINT_LABEL[connection.endpoint]} · {ROLE_LABEL[connection.role]}
              </text>
            </g>
          );
        })}
      </svg>

      <ol className="polarity-map-connections">
        {props.connections.map((connection) => (
          <li
            key={`${connection.order}-${connection.component}`}
            className={`polarity-connection polarity-connection-${connection.state}`}
          >
            <span className="polarity-connection-order">{connection.order}</span>
            <span className="polarity-connection-body">
              <span className="polarity-connection-instruction">{connection.instruction}</span>
              <span className="polarity-connection-meta">
                {ROLE_LABEL[connection.role]} · {ENDPOINT_LABEL[connection.endpoint]} ·{" "}
                {STATE_LABEL[connection.state]}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {otherLeads.length > 0 && (
        <p className="polarity-map-note">
          {otherLeads.length === 1
            ? "One further validated connection does not land on a welding terminal, so it is listed above rather than drawn on the map."
            : `${otherLeads.length} further validated connections do not land on a welding terminal, so they are listed above rather than drawn on the map.`}
        </p>
      )}

      <details className="source-evidence polarity-map-provenance">
        <summary>Show sources</summary>
        <div className="polarity-map-provenance-list">
          {props.polarity && <ProvenanceBadge provenance={props.polarity.provenance} />}
          {props.provenance.map((item, index) => (
            <ProvenanceBadge key={`${item.source}-${index}`} provenance={item} />
          ))}
        </div>
      </details>
    </div>
  );
}
