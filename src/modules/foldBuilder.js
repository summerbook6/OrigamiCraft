import { THREE } from "../lib/three.js";
import { distancePointToLine } from "./geometry.js";

// Helper to format float coords to avoid floating point mismatch
function quantize(val) {
  return Math.round(val * 10000) / 10000;
}

function pointKey(p) {
  return `${quantize(p.x)},${quantize(p.y)}`;
}

export function buildFoldObjectFromLayers(flatLayers, foldOps) {
  const verticesMap = new Map();
  const verticesCoords = [];
  
  function getOrAddVertex(p) {
    const key = pointKey(p);
    if (verticesMap.has(key)) return verticesMap.get(key);
    const idx = verticesCoords.length;
    verticesCoords.push([p.x, p.y, 0]);
    verticesMap.set(key, idx);
    return idx;
  }

  const facesVertices = [];
  const edgesMap = new Map();

  function addEdge(v1, v2, type) {
    const minV = Math.min(v1, v2);
    const maxV = Math.max(v1, v2);
    const key = `${minV}-${maxV}`;
    if (!edgesMap.has(key)) {
      edgesMap.set(key, { v1: minV, v2: maxV, type, refs: 1 });
    } else {
      const existing = edgesMap.get(key);
      existing.refs++;
      if (existing.type === "B" && type === "B") {
        existing.type = "F"; 
      }
    }
    return key;
  }

  const fixedNodeIndicesSet = new Set();

  for (const layer of flatLayers) {
    const poly = layer.poly;
    if (poly.length < 3) continue;

    const vIndices = poly.map(getOrAddVertex);
    
    // The active fold operation is always the last one
    const activeOp = foldOps[foldOps.length - 1];
    
    // Determine if this layer is part of the "fixed" side of the current active crease
    let isFixedLayer = true;
    if (activeOp && activeOp.opId === "active-interactive") {
        // Find if this layer was created from the moving side of the active op
        const targetIds = activeOp.targetLayerIds ? 
            new Set(activeOp.targetLayerIds) : 
            new Set([activeOp.targetLayerId]);
            
        // If this layer or its ancestor is a target, and it represents the moving side
        // Note: rebuildFlatLayersFromOps appends '|active-interactive|moving' to moving layers
        if (layer.id.includes("active-interactive|moving") || (layer.id.includes("moving") && targetIds.has(layer.id.split('|')[0]))) {
            isFixedLayer = false;
        }
    } else {
        // Fallback for non-interactive state
        isFixedLayer = !layer.id.includes("moving");
    }
    
    if (isFixedLayer) {
        for (const idx of vIndices) {
            fixedNodeIndicesSet.add(idx);
        }
    }

    for (let i = 0; i < poly.length; i++) {
      const v1 = vIndices[i];
      const v2 = vIndices[(i + 1) % poly.length];
      addEdge(v1, v2, "B");
    }

    for (let i = 1; i < poly.length - 1; i++) {
      facesVertices.push([vIndices[0], vIndices[i], vIndices[i + 1]]);
      if (isFixedLayer && facesVertices.anchorFaceIndex === undefined) {
          facesVertices.anchorFaceIndex = facesVertices.length - 1;
      }
      if (i > 1) {
        addEdge(vIndices[0], vIndices[i], "F");
      }
    }
  }

  // If no anchor face was found, just use face 0
  if (facesVertices.anchorFaceIndex === undefined) {
      facesVertices.anchorFaceIndex = 0;
  }

  // Now identify which shared edges are creases
  for (const edge of edgesMap.values()) {
    edge.foldAngle = 0;
    if (edge.type === "F") {
      // Find if this edge aligns with any foldOp crease (in flat space!)
      const p1 = new THREE.Vector2(verticesCoords[edge.v1][0], verticesCoords[edge.v1][1]);
      const p2 = new THREE.Vector2(verticesCoords[edge.v2][0], verticesCoords[edge.v2][1]);
      
      // Iterate backwards to get the most recent fold op that created this crease
      let foundCrease = false;
      for (let i = foldOps.length - 1; i >= 0 && !foundCrease; i--) {
        const op = foldOps[i];
        if (!op.flatLines) continue;
        
        for (const flatLine of op.flatLines) {
            if (isSegmentOnLine(p1, p2, flatLine.p0, flatLine.p1)) {
               // We found the crease!
               const sign = op.movingSide === "positive" ? 1 : -1;
               // If folded, set angle
               edge.type = "M"; // Mark as crease
               if (op.opId === "active-interactive") {
                   edge.foldAngle = op.targetAngleDeg || 0; // We will pass targetAngleDeg from foldOps
               } else if (op.targetAngleDeg !== undefined) {
                   edge.foldAngle = op.targetAngleDeg;
               } else {
                   edge.foldAngle = 0;
               }
               foundCrease = true;
               break;
            }
        }
      }
    }
  }

  const edgesVertices = [];
  const edgesAssignment = [];
  const edgesFoldAngle = [];

  for (const edge of edgesMap.values()) {
    edgesVertices.push([edge.v1, edge.v2]);
    edgesAssignment.push(edge.type);
    edgesFoldAngle.push(edge.foldAngle);
  }

  return {
    vertices_coords: verticesCoords,
    faces_vertices: facesVertices,
    edges_vertices: edgesVertices,
    edges_assignment: edgesAssignment,
    edges_foldAngle: edgesFoldAngle,
    anchorFaceIndex: facesVertices.anchorFaceIndex,
    fixedNodeIndices: Array.from(fixedNodeIndicesSet)
  };
}

function isSegmentOnLine(a, b, p0, p1, epsilon = 1e-4) {
  if (!p0 || !p1) return false;
  return (
    distancePointToLine(a, p0, p1) <= epsilon &&
    distancePointToLine(b, p0, p1) <= epsilon
  );
}
