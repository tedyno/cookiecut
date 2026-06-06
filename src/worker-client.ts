// geometry worker client: sends requests, drops stale responses
//
// Bun's bundler cannot handle `new Worker(new URL(...))` — the worker is
// prebundled (`bun run build:worker` -> src/worker.gen.js), inlined as text
// and started via a Blob URL.
import workerCode from './worker.gen.js' with { type: 'text' };
import type { Contour, GenResult, Params } from './types';

export interface Generator {
  request(contours: Contour[], params: Params): void;
}

interface Resp { id: number; ok: boolean; result?: GenResult; error?: string }

export function createGenerator(handlers: {
  onResult(r: GenResult): void;
  onError(message: string): void;
}): Generator {
  const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module' });
  let reqId = 0;

  worker.onmessage = (e: MessageEvent<Resp>) => {
    const { id, ok, result, error } = e.data;
    if (id !== reqId) return; // a newer request has been made meanwhile
    if (ok && result) handlers.onResult(result);
    else handlers.onError(error || 'Generation failed.');
  };
  worker.onerror = (e: ErrorEvent) => {
    console.error(e);
    handlers.onError(`Worker error: ${e.message}`);
  };

  return {
    request(contours, params) {
      reqId++;
      worker.postMessage({ id: reqId, contours, params });
    },
  };
}
