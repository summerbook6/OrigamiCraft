import * as THREE_ from "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js";

const THREE = { ...THREE_ };

const patchUpdateMorphTargets = (ClassRef) => {
  if (ClassRef && ClassRef.prototype && ClassRef.prototype.updateMorphTargets) {
    const orig = ClassRef.prototype.updateMorphTargets;
    ClassRef.prototype.updateMorphTargets = function() {
      if (!this.geometry) {
        console.error(`[${this.type}] HAS NO GEOMETRY IN updateMorphTargets!`, this);
        return;
      }
      orig.call(this);
    };
  }
};

patchUpdateMorphTargets(THREE.Mesh);
patchUpdateMorphTargets(THREE.Line);
patchUpdateMorphTargets(THREE.LineSegments);
patchUpdateMorphTargets(THREE.Points);

export { THREE };
