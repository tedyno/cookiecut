declare module 'clipper-lib';

// text import of the prebundled worker (bun: with { type: 'text' })
declare module '*.gen.js' {
  const source: string;
  export default source;
}

declare module 'cdt2d' {
  interface Cdt2dOptions {
    delaunay?: boolean;
    interior?: boolean;
    exterior?: boolean;
    infinity?: boolean;
  }
  function cdt2d(
    points: number[][],
    edges?: [number, number][],
    options?: Cdt2dOptions,
  ): [number, number, number][];
  export default cdt2d;
}
