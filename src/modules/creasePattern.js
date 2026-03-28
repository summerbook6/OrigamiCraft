import { buildFoldObjectFromLayers } from "./foldBuilder.js";

export function generateCreaseParams(fold) {
  const creaseParams = [];
  const edgeToFaces = new Map();

  for (let i = 0; i < fold.faces_vertices.length; i++) {
    const face = fold.faces_vertices[i];
    for (let j = 0; j < 3; j++) {
      const v1 = face[j];
      const v2 = face[(j + 1) % 3];
      const minV = Math.min(v1, v2);
      const maxV = Math.max(v1, v2);
      const key = `${minV}-${maxV}`;
      
      if (!edgeToFaces.has(key)) {
        edgeToFaces.set(key, []);
      }
      edgeToFaces.get(key).push({ faceIndex: i, oppositeVert: face[(j + 2) % 3] });
    }
  }

  for (let i = 0; i < fold.edges_vertices.length; i++) {
    const edge = fold.edges_vertices[i];
    const minV = Math.min(edge[0], edge[1]);
    const maxV = Math.max(edge[0], edge[1]);
    const key = `${minV}-${maxV}`;
    
    const faces = edgeToFaces.get(key) || [];
    if (faces.length === 2) {
      const angle = fold.edges_foldAngle[i] || 0;
      creaseParams.push([
        faces[0].faceIndex,
        faces[0].oppositeVert,
        faces[1].faceIndex,
        faces[1].oppositeVert,
        i,
        angle
      ]);
    }
  }

  return creaseParams;
}
