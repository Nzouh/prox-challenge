import type {
  CableConnection,
  CableEndpoint,
  CableTerminal,
  PolarityMapArtifact,
} from "./artifacts";
import type { WeldProcess } from "./domain";
import type { Provenance } from "./provenance";
import type { SetupResult } from "./setups";
import { resolveSpecQuery } from "./specs";

/**
 * The polarity cable map is generated entirely from get_setup's validated cable stage.
 * Nothing here accepts model input: the endpoints come from an exact-match table over the
 * reviewed instruction sentences, and every check below fails closed — an unrecognised
 * sentence, an ambiguous one, or a derived polarity that contradicts the published
 * `polarity` fact withholds the whole artifact rather than drawing a guess. A wrong cable
 * map is worse than no cable map: it is a reversed-polarity weld at best.
 */

/** Each pattern must be unambiguous against the others; `endpointFor` requires exactly one
 *  match, so an instruction that hits two patterns is treated as unreadable. */
const ENDPOINT_PATTERNS: ReadonlyArray<readonly [RegExp, CableEndpoint]> = [
  [/\bto the positive terminal\b/i, "positive_terminal"],
  [/\bto the negative terminal\b/i, "negative_terminal"],
  [/\bto the wire feed\b/i, "wire_feed"],
  [/\bto the gas regulator\b/i, "gas_regulator"],
  [/\binside the welder\b/i, "internal_connection"],
  [/\bdisconnected\b/i, "unconnected"],
];

function endpointFor(instruction: string): CableEndpoint | null {
  const matched = ENDPOINT_PATTERNS.filter(([pattern]) => pattern.test(instruction));
  return matched.length === 1 ? matched[0][1] : null;
}

const TERMINAL_FOR_ENDPOINT: Partial<Record<CableEndpoint, CableTerminal>> = {
  positive_terminal: "positive",
  negative_terminal: "negative",
};

/** Which lead carries the electrode for each process. This is a fixed property of the
 *  process, not a connection: the terminal it lands on is still read from the manual. */
const ELECTRODE_COMPONENT: Record<WeldProcess, string> = {
  MIG: "wire_feed_power",
  flux_cored: "wire_feed_power",
  TIG: "tig_torch",
  stick: "electrode_holder",
};
const WORK_COMPONENT = "ground_clamp";

/** get_setup component ids → the keys the published `polarity` fact uses, so the two
 *  independently extracted records can be compared. */
const FACT_KEY_FOR_COMPONENT: Record<string, string> = {
  ground_clamp: "ground",
  wire_feed_power: "wire_feed_power",
  tig_torch: "torch",
  electrode_holder: "electrode_holder",
};

function roleFor(process: WeldProcess, component: string): CableConnection["role"] {
  if (component === ELECTRODE_COMPONENT[process]) return "electrode";
  if (component === WORK_COMPONENT) return "work";
  return "auxiliary";
}

/**
 * Cross-check the terminals derived from the cable diagram against the separately
 * extracted `polarity` structured fact. Returns false only on an actual contradiction; a
 * process with no published polarity fact is uncorroborated, not wrong.
 */
function agreesWithPublishedPolarity(
  process: WeldProcess,
  connections: readonly CableConnection[],
): boolean {
  const fact = resolveSpecQuery({ spec: "polarity", process });
  if (!fact.found || fact.spec !== "polarity") return true;
  if (!fact.value || typeof fact.value !== "object") return false;
  const published = fact.value as Record<string, unknown>;

  for (const connection of connections) {
    const terminal = TERMINAL_FOR_ENDPOINT[connection.endpoint];
    if (!terminal) continue;
    const key = FACT_KEY_FOR_COMPONENT[connection.component];
    if (!key || !(key in published)) continue;
    if (published[key] !== terminal) return false;
  }
  return true;
}

function derivePolarity(
  process: WeldProcess,
  connections: readonly CableConnection[],
): PolarityMapArtifact["polarity"] {
  const terminalOf = (role: CableConnection["role"]) => {
    const live = connections.filter(
      (connection) => connection.role === role && connection.state !== "disconnected",
    );
    const terminals = new Set(
      live.map((connection) => TERMINAL_FOR_ENDPOINT[connection.endpoint]).filter(Boolean),
    );
    return terminals.size === 1 ? [...terminals][0]! : null;
  };

  const electrodeTerminal = terminalOf("electrode");
  const workTerminal = terminalOf("work");
  if (!electrodeTerminal || !workTerminal || electrodeTerminal === workTerminal) return null;

  const label = electrodeTerminal === "positive" ? "DCEP" : "DCEN";
  const provenance: Provenance = {
    tier: 3,
    source: "Polarity naming convention",
    basis: `The electrode lead lands on the ${electrodeTerminal} terminal and the work lead on the ${workTerminal} terminal in the validated setup, which is ${label} (direct current, electrode ${electrodeTerminal}).`,
  };
  return { label, electrodeTerminal, workTerminal, provenance };
}

/**
 * Host-side rendering of the cable stage as a polarity map. Returns null whenever the
 * validated data cannot support the drawing: a result without cable steps, fewer than two
 * connections, an instruction the endpoint table does not recognise, a state that
 * disagrees with its endpoint, or a contradiction with the published polarity fact.
 */
export function buildPolarityMapArtifact(result: SetupResult): PolarityMapArtifact | null {
  if (!result.found) return null;

  const cableSteps = result.steps.filter(
    (step): step is Extract<typeof step, { component: string }> =>
      step.stage === "cables" && "component" in step,
  );
  if (cableSteps.length < 2) return null;

  const connections: CableConnection[] = [];
  for (const step of cableSteps) {
    const endpoint = endpointFor(step.instruction);
    if (!endpoint) return null;
    // A lead the manual deliberately leaves off must read as disconnected on both the
    // state and the endpoint, or the record is not self-consistent enough to draw.
    if ((endpoint === "unconnected") !== (step.state === "disconnected")) return null;
    connections.push({
      order: step.order,
      component: step.component,
      role: roleFor(result.process, step.component),
      endpoint,
      state: step.state,
      instruction: step.instruction,
      provenance: step.provenance,
    });
  }

  if (!agreesWithPublishedPolarity(result.process, connections)) return null;

  return {
    type: "polarity_map",
    process: result.process,
    polarity: derivePolarity(result.process, connections),
    prerequisites: result.prerequisites,
    connections: connections.sort((left, right) => left.order - right.order),
    provenance: result.provenance,
  };
}
