import { MSG } from "../core/messages.js";
import { polygonAreaAbs, polygonCentroid, clamp01 } from "../utils/evaluationUtils.js";

export class AirplaneEvaluator {
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
    const lastCrease = payload.lastCrease;

    const symmetryScore = computeSymmetryScore(layers, this.paperSize.width);
    const centerAlignScore = computeCenterAlignScore(lastCrease, this.paperSize.width);
    const elongationScore = computeElongationScore(silhouette);
    const layerDepthScore = Math.min(Math.max((layerCount - 1) / 4, 0), 1);
    const poseScore = computePoseScore(this.latestPose);

    const score =
      symmetryScore * 0.3 +
      centerAlignScore * 0.25 +
      elongationScore * 0.2 +
      layerDepthScore * 0.2 +
      poseScore * 0.05;

    const completed = score >= 0.72 && layerCount >= 3;

    this.bus.publish(MSG.AIRPLANE_EVAL_UPDATED, {
      score,
      completed,
      breakdown: {
        symmetryScore,
        centerAlignScore,
        elongationScore,
        layerDepthScore,
        poseScore,
      },
    });

    if (completed && !this.hasCompleted) {
      this.hasCompleted = true;
      this.bus.publish(MSG.AIRPLANE_COMPLETED, { score });
      this.bus.publish(MSG.UI_SET_HINT, {
        text: "종이비행기 형태가 완성됐어요! 우측 상단 '날개 펴기'를 눌러 완성하세요.",
      });
    }

    if (!completed && score < 0.55) {
      this.hasCompleted = false;
    }
  }

  destroy() {
    this.unsubscribers.forEach((unsub) => unsub());
  }
}

function computeSymmetryScore(layers, paperWidth) {
  if (!layers || layers.length === 0) return 0;
  let weightedAbsX = 0;
  let areaSum = 0;
  for (const poly of layers) {
    const area = polygonAreaAbs(poly);
    if (area <= 1e-8) continue;
    const c = polygonCentroid(poly);
    weightedAbsX += Math.abs(c.x) * area;
    areaSum += area;
  }
  if (areaSum <= 1e-8) return 0;
  const meanAbsX = weightedAbsX / areaSum;
  const norm = Math.max(paperWidth * 0.35, 1e-6);
  return 1 - clamp01(meanAbsX / norm);
}

function computeCenterAlignScore(lastCrease, paperWidth) {
  if (!lastCrease?.p0 || !lastCrease?.p1) return 0.3;
  const dx = lastCrease.p1.x - lastCrease.p0.x;
  const dy = lastCrease.p1.y - lastCrease.p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0.3;

  const dirYAlign = Math.abs(dy / len);
  const midX = (lastCrease.p0.x + lastCrease.p1.x) * 0.5;
  const centerDist = Math.abs(midX) / Math.max(paperWidth * 0.5, 1e-6);
  const centerScore = 1 - clamp01(centerDist);
  return dirYAlign * 0.6 + centerScore * 0.4;
}

function computeElongationScore(silhouette) {
  const w = silhouette?.width ?? 0;
  const h = silhouette?.height ?? 0;
  if (w <= 1e-6 || h <= 1e-6) return 0;
  const ratio = Math.max(w, h) / Math.max(Math.min(w, h), 1e-6);
  return clamp01((ratio - 1.15) / 1.1);
}

function computePoseScore(pose) {
  if (!pose) return 0.5;
  const flatness = 1 - clamp01(Math.abs(pose.xDeg) / 90);
  return flatness;
}
