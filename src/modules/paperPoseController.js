import { THREE } from "../lib/three.js";
import { MSG } from "../core/messages.js";

export class PaperPoseController {
  constructor({ paperGroup, bus, opts = {} }) {
    this.paperGroup = paperGroup;
    this.bus = bus;

    this.smoothFactor = opts.smoothFactor ?? 0.16;
    this.snapEpsilon = opts.snapEpsilon ?? 1e-4;

    this.currentQuat = new THREE.Quaternion().copy(this.paperGroup.quaternion);
    this.targetQuat = new THREE.Quaternion().copy(this.paperGroup.quaternion);
    this._tmpEuler = new THREE.Euler(0, 0, 0, "XYZ");
    this.isStanding = false;

    this.unsubscribers = [
      this.bus.subscribe(MSG.PAPER_POSE_COMMAND, (payload) => this.onPoseCommand(payload)),
    ];

    this.publishPoseChanged("init");
  }

  onPoseCommand({ action } = {}) {
    if (!action) return;

    if (action === "reset") {
      this.setTargetEuler(0, 0, 0);
      this.isStanding = false;
      this.publishPoseChanged("reset");
      return;
    }

    if (action === "stand") {
      this.setTargetEuler(-Math.PI * 0.5, 0, 0);
      this.isStanding = true;
      this.publishPoseChanged("stand");
      return;
    }

    if (action === "toggleStand") {
      if (this.isStanding) {
        this.setTargetEuler(0, 0, 0);
        this.isStanding = false;
        this.publishPoseChanged("toFlat");
      } else {
        this.setTargetEuler(-Math.PI * 0.5, 0, 0);
        this.isStanding = true;
        this.publishPoseChanged("toStand");
      }
      return;
    }

    if (action === "flip") {
      this._tmpEuler.setFromQuaternion(this.targetQuat, "XYZ");
      this.setTargetEuler(this._tmpEuler.x, this._tmpEuler.y + Math.PI, this._tmpEuler.z);
      this.publishPoseChanged("flip");
    }
  }

  setTargetEuler(x, y, z) {
    const euler = new THREE.Euler(normalizeAngle(x), normalizeAngle(y), normalizeAngle(z), "XYZ");
    this.targetQuat.setFromEuler(euler);
  }

  tick() {
    const dot = Math.abs(this.currentQuat.dot(this.targetQuat));
    if (1 - dot < this.snapEpsilon) {
      if (!this.paperGroup.quaternion.equals(this.targetQuat)) {
        this.currentQuat.copy(this.targetQuat);
        this.paperGroup.quaternion.copy(this.targetQuat);
      }
      return;
    }

    this.currentQuat.slerp(this.targetQuat, this.smoothFactor);
    this.paperGroup.quaternion.copy(this.currentQuat);
  }

  getPoseState() {
    const e = new THREE.Euler().setFromQuaternion(this.targetQuat, "XYZ");
    return {
      xDeg: THREE.MathUtils.radToDeg(e.x),
      yDeg: THREE.MathUtils.radToDeg(e.y),
      zDeg: THREE.MathUtils.radToDeg(e.z),
      isStanding: this.isStanding,
    };
  }

  publishPoseChanged(reason = "update") {
    this.bus.publish(MSG.PAPER_POSE_CHANGED, {
      pose: this.getPoseState(),
      reason,
    });
  }

  destroy() {
    this.unsubscribers.forEach((unsub) => unsub());
  }
}

function normalizeAngle(rad) {
  let angle = rad;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
