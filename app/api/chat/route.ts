import { chatRequestSchema } from "@/lib/agent/input";
import { runAgent } from "@/lib/agent/run";
import { encodeSSE } from "@/lib/sse";

// The Agent SDK spawns a subprocess, so this cannot run on the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { input, sessionId } = parsed.data;
  const agentAbortController = new AbortController();
  const abortAgent = () => agentAbortController.abort();
  request.signal.addEventListener("abort", abortAgent, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAgent(input, sessionId, agentAbortController.signal)) {
          controller.enqueue(encodeSSE(event));
        }
      } catch (err) {
        if (!agentAbortController.signal.aborted) {
          controller.enqueue(
            encodeSSE({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } finally {
        request.signal.removeEventListener("abort", abortAgent);
        if (!agentAbortController.signal.aborted) controller.close();
      }
    },
    cancel() {
      agentAbortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
