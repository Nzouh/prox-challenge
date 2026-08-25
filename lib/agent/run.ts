import type { AgentEvent } from "./events";
import type { AgentInput } from "./input";
import { runValidatedAgent } from "./validated-run";

/** Public entry point kept stable for the API route. */
export async function* runAgent(
  input: AgentInput,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  for await (const event of runValidatedAgent(input, sessionId, signal)) {
    yield event;
  }
}
