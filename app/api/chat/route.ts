import { chatRequestSchema } from "@/lib/agent/input";
import { encodeSSE } from "@/lib/sse";

// The Agent SDK spawns a subprocess, so this cannot run on the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 300;

function agentBackendUrl(): string | null {
  const origin = process.env.AGENT_BACKEND_URL?.trim().replace(/\/$/, "");
  return origin ? `${origin}/api/chat` : null;
}

async function proxyAgentRequest(url: string, body: unknown, signal: AbortSignal) {
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

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

  const backendUrl = agentBackendUrl();
  if (backendUrl) return proxyAgentRequest(backendUrl, parsed.data, request.signal);

  const { input, sessionId } = parsed.data;
  const { runAgent } = await import("@/lib/agent/run");
  const agentAbortController = new AbortController();
  const abortAgent = () => agentAbortController.abort();
  request.signal.addEventListener("abort", abortAgent, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Do not return the long-running agent promise from start(). Web Streams wait for
      // an async start hook to settle before making queued chunks readable, which would
      // buffer every status and SSE event until the complete answer finished.
      void (async () => {
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
      })();
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
