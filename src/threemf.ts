// 3MF export: a ZIP package with a 3D model XML (OPC structure)
// Unlike STL it carries explicit units (mm) and an indexed, welded mesh.
import { strToU8, zipSync } from 'fflate';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

// round to 0.1 µm and drop trailing zeros — halves the XML size
const fmt = (v: number): string => String(Math.round(v * 10000) / 10000);

/** Builds a 3MF file from a triangle soup (xyz by 9); name shows up in the slicer */
export function buildThreeMf(positions: Float32Array, name: string): Blob {
  // weld identical vertices into an indexed mesh
  const vertexIndex = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  const indexOf = (x: number, y: number, z: number): number => {
    // weld by the ROUNDED coordinates — keying on raw floats would emit
    // duplicate vertices whenever the source differs below the precision
    const fx = fmt(x), fy = fmt(y), fz = fmt(z);
    const key = `${fx},${fy},${fz}`;
    let idx = vertexIndex.get(key);
    if (idx === undefined) {
      idx = vertices.length;
      vertexIndex.set(key, idx);
      vertices.push(`<vertex x="${fx}" y="${fy}" z="${fz}"/>`);
    }
    return idx;
  };
  for (let i = 0; i < positions.length; i += 9) {
    const a = indexOf(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    const b = indexOf(positions[i + 3]!, positions[i + 4]!, positions[i + 5]!);
    const c = indexOf(positions[i + 6]!, positions[i + 7]!, positions[i + 8]!);
    if (a !== b && b !== c && c !== a) triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model" name="${name}">
      <mesh>
        <vertices>${vertices.join('')}</vertices>
        <triangles>${triangles.join('')}</triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`;

  const zip = zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  });
  return new Blob([zip.buffer as ArrayBuffer], { type: 'model/3mf' });
}
