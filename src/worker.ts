// worker: heavy geometry computation off the main thread
import type { Contour, Params } from './types';
import { generate } from './generate';

interface Req { id: number; contours: Contour[]; params: Params }

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = async (e: MessageEvent<Req>) => {
  const { id, contours, params } = e.data;
  try {
    const result = await generate(contours, params);
    ctx.postMessage({ id, ok: true, result }, [result.positions.buffer]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
