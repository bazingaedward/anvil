export type RequestTiming = {
  type: "model-timing";
  id: string;
  phase:
    "started" | "headers" | "first-byte" | "completed" | "failed" | "cancelled";
  elapsedMs: number;
  status?: number;
};

// Worker-local instrumentation. Never inspect credentials or body contents.
export function timedModelFetch(
  fetcher: typeof fetch,
  baseURL: string,
  report: (event: RequestTiming) => void,
): typeof fetch {
  const base = new URL(baseURL);
  let sequence = 0;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method =
      init?.method || (input instanceof Request ? input.method : "GET");
    if (
      method.toUpperCase() !== "POST" ||
      url.origin !== base.origin ||
      !(
        url.pathname === base.pathname ||
        url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
      )
    )
      return fetcher(input, init);

    const id = String(++sequence);
    const start = performance.now();
    const signal =
      init?.signal || (input instanceof Request ? input.signal : undefined);
    let status: number | undefined;
    let terminal = false;
    const emit = (phase: RequestTiming["phase"]) => {
      if (terminal) return;
      if (["completed", "failed", "cancelled"].includes(phase)) terminal = true;
      try {
        report({
          type: "model-timing",
          id,
          phase,
          elapsedMs: Math.round(performance.now() - start),
          status,
        });
      } catch {
        /* Diagnostics must not alter model execution. */
      }
    };
    emit("started");
    try {
      const response = await fetcher(input, init);
      status = response.status;
      emit("headers");
      if (!response.body) {
        emit(response.ok ? "completed" : "failed");
        return response;
      }
      const reader = response.body.getReader();
      let first = true;
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                emit(response.ok ? "completed" : "failed");
                controller.close();
              } else {
                if (first && chunk.value.byteLength) {
                  first = false;
                  emit("first-byte");
                }
                controller.enqueue(chunk.value);
              }
            } catch (error) {
              emit(signal?.aborted ? "cancelled" : "failed");
              controller.error(error);
            }
          },
          async cancel(reason) {
            emit("cancelled");
            await reader.cancel(reason);
          },
        },
        { highWaterMark: 0 },
      );
      const wrapped = new Response(body, {
        status,
        statusText: response.statusText,
        headers: response.headers,
      });
      for (const field of ["url", "redirected", "type"] as const)
        Object.defineProperty(wrapped, field, { value: response[field] });
      return wrapped;
    } catch (error) {
      emit(signal?.aborted ? "cancelled" : "failed");
      throw error;
    }
  };
}
