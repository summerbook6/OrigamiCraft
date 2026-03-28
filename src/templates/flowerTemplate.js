import { MSG } from "../core/messages.js";
import { polygonAreaAbs, polygonCentroid, clamp01 } from "../utils/evaluationUtils.js";

export class FlowerEvaluator {
  constructor({ bus, paperSize }) {
    this.bus = bus;
    this.paperSize = paperSize;
    this.latestPose = { xDeg: 0, yDeg: 0, zDeg: 0 };
    this.hasCompleted = false;

    this.unsubscribers = [
      this.bus.subscribe(MSG.PAPER_POSE_CHANGED, ({ pose }) => {
        if (!pose) return;
        this.latestPose = { ...pose };
      }),
      this.bus.subscribe(MSG.PAPER_FOLD_COMMITTED, (payload) => {
        this.evaluateFromPayload(payload);
      }),
    ];
  }

  evaluateFromPayload(payload = {}) {
    const layerCount = payload.layerCount ?? 0;
    const layers = payload.layers ?? [];
    const silhouette = payload.silhouette ?? { width: 0, height: 0 };

    const symmetryScore = this.computeRadialSymmetryScore(layers);
    const roundnessScore = this.computeSilhouetteRoundness(silhouette);
    const score = symmetryScore * 0.55 + roundnessScore * 0.45;

    const completed = score >= 0.68 && layerCount >= 3;

    if (completed && !this.hasCompleted) {
      this.hasCompleted = true;
      this.bus.publish(MSG.UI_SET_HINT, {
        text: "꽃 형태에 가까워졌어요. 겹을 더 쌓아 다듬어 보세요.",
      });
    }

    if (!completed && score < 0.48) {
      this.hasCompleted = false;
    }
  }

  computeSilhouetteRoundness(silhouette) {
    const w = silhouette?.width ?? 0;
    const h = silhouette?.height ?? 0;
    if (w <= 1e-6 || h <= 1e-6) return 0;
    const aspect = Math.min(w, h) / Math.max(w, h);
    return aspect;
  }

  computeRadialSymmetryScore(layers) {
    if (!layers || layers.length === 0) return 0;
    let cxSum = 0;
    let cySum = 0;
    let areaSum = 0;
    
    for (const poly of layers) {
      const area = polygonAreaAbs(poly);
      if (area <= 1e-8) continue;
      const c = polygonCentroid(poly);
      cxSum += c.x * area;
      cySum += c.y * area;
      areaSum += area;
    }
    
    if (areaSum <= 1e-8) return 0;
    
    const meanX = cxSum / areaSum;
    const meanY = cySum / areaSum;
    const distFromOrigin = Math.hypot(meanX, meanY);
    
    const norm = Math.max(this.paperSize.width * 0.25, 1e-6);
    return 1 - clamp01(distFromOrigin / norm);
  }

  destroy() {
    this.unsubscribers.forEach((unsub) => unsub());
  }
}
