import { MSG } from "../core/messages.js";

export class FoldHistoryManager {
  constructor({ bus }) {
    this.bus = bus;
    this.entries = [];
    this.latestPose = { xDeg: 0, yDeg: 0, zDeg: 0 };

    this.unsubscribers = [
      this.bus.subscribe(MSG.PAPER_POSE_CHANGED, ({ pose }) => {
        if (!pose) return;
        this.latestPose = { ...pose };
      }),
      this.bus.subscribe(MSG.PAPER_FOLD_COMMITTED, (payload) => {
        this.onFoldCommitted(payload);
      }),
    ];
  }

  onFoldCommitted(payload = {}) {
    const entry = {
      step: this.entries.length + 1,
      timestamp: Date.now(),
      pose: { ...this.latestPose },
      fold: {
        layerCount: payload.layerCount ?? 0,
        layerAreas: payload.layerAreas ?? [],
        totalArea: payload.totalArea ?? 0,
        foldOpsCount: payload.foldOpsCount ?? 0,
        lastCrease: payload.lastCrease ?? null,
        movingSide: payload.movingSide ?? null,
        silhouette: payload.silhouette ?? null,
      },
    };

    this.entries.push(entry);
  }

  getEntries() {
    return this.entries.slice();
  }

  getLatestEntry() {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
  }

  destroy() {
    this.unsubscribers.forEach((unsub) => unsub());
  }
}
