// manifold-3d (WASM) singleton: exact 3D booleans with a manifold-output
// guarantee. The binary is embedded as base64 by scripts/build-worker.ts —
// a Blob-URL worker cannot resolve external assets reliably.
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import wasmB64 from './manifold-wasm';

let instance: Promise<ManifoldToplevel> | null = null;

export function getManifold(): Promise<ManifoldToplevel> {
  instance ??= Module({
    wasmBinary: Uint8Array.from(atob(wasmB64), c => c.charCodeAt(0)).buffer,
  } as unknown as Parameters<typeof Module>[0]).then(m => {
    m.setup();
    return m;
  });
  return instance;
}

export type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
