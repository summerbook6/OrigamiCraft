import { THREE } from "../lib/three.js";
import { MSG } from "../core/messages.js";

export class CameraOrbitController {
  constructor({ camera, bus, opts = {} }) {
    this.camera = camera;
    this.bus = bus;

    this.orbit = {
      target: opts.target ?? new THREE.Vector3(0, 0, 0.12),
      radius: opts.radius ?? 4.85,
      yaw: opts.yaw ?? 0.58,
      pitch: opts.pitch ?? 0.86,
      targetYaw: opts.yaw ?? 0.58,
      targetPitch: opts.pitch ?? 0.86,
      yawRange: opts.yawRange ?? 1.18,
      pitchRange: opts.pitchRange ?? 0.43,
      minRadius: opts.minRadius ?? 2.6,
      maxRadius: opts.maxRadius ?? 9.5,
      dragSpeed: opts.dragSpeed ?? 0.0038,
      smoothFactor: opts.smoothFactor ?? 0.2,
    };
    this.orbit.baseYaw = this.orbit.yaw;
    this.orbit.basePitch = this.orbit.pitch;

    this.drag = {
      active: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
    };

    this.unsubscribers = [
      this.bus.subscribe(MSG.INPUT_POINTER_DOWN, (payload) =>
        this.onPointerDown(payload)
      ),
      this.bus.subscribe(MSG.INPUT_POINTER_MOVE, (payload) =>
        this.onPointerMove(payload)
      ),
      this.bus.subscribe(MSG.INPUT_POINTER_UP, (payload) => this.onPointerUp(payload)),
      this.bus.subscribe(MSG.INPUT_WHEEL, (payload) => this.onWheel(payload)),
    ];

    this.applyCameraPose();
  }

  applyCameraPose() {
    const cp = Math.cos(this.orbit.pitch);
    this.camera.position.set(
      this.orbit.target.x + this.orbit.radius * cp * Math.sin(this.orbit.yaw),
      this.orbit.target.y - this.orbit.radius * cp * Math.cos(this.orbit.yaw),
      this.orbit.target.z + this.orbit.radius * Math.sin(this.orbit.pitch)
    );
    this.camera.lookAt(this.orbit.target);
  }

  onPointerDown({ button, pointerId, clientX, clientY }) {
    if (button !== 1) return;
    if (this.drag.active && this.drag.pointerId !== pointerId) return;
    this.drag.active = true;
    this.drag.pointerId = pointerId;
    this.drag.lastX = clientX;
    this.drag.lastY = clientY;
  }

  onPointerMove({ pointerId, clientX, clientY }) {
    if (!this.drag.active || this.drag.pointerId !== pointerId) return;
    const dx = clientX - this.drag.lastX;
    const dy = clientY - this.drag.lastY;
    this.drag.lastX = clientX;
    this.drag.lastY = clientY;

    this.orbit.targetYaw = THREE.MathUtils.clamp(
      this.orbit.targetYaw - dx * this.orbit.dragSpeed,
      this.orbit.baseYaw - this.orbit.yawRange,
      this.orbit.baseYaw + this.orbit.yawRange
    );
    this.orbit.targetPitch = THREE.MathUtils.clamp(
      this.orbit.targetPitch + dy * this.orbit.dragSpeed,
      this.orbit.basePitch - this.orbit.pitchRange,
      this.orbit.basePitch + this.orbit.pitchRange
    );
  }

  onPointerUp({ pointerId }) {
    if (!this.drag.active || this.drag.pointerId !== pointerId) return;
    this.drag.active = false;
    this.drag.pointerId = null;
  }

  onWheel({ deltaY }) {
    const zoomStep = 0.42;
    const nextRadius =
      deltaY < 0 ? this.orbit.radius - zoomStep : this.orbit.radius + zoomStep;
    this.orbit.radius = THREE.MathUtils.clamp(
      nextRadius,
      this.orbit.minRadius,
      this.orbit.maxRadius
    );
    this.applyCameraPose();
  }

  tick(dtSec = 1 / 60) {
    void dtSec;

    const yawDiff = this.orbit.targetYaw - this.orbit.yaw;
    const pitchDiff = this.orbit.targetPitch - this.orbit.pitch;
    if (Math.abs(yawDiff) <= 1e-4 && Math.abs(pitchDiff) <= 1e-4) return;

    this.orbit.yaw += yawDiff * this.orbit.smoothFactor;
    this.orbit.pitch += pitchDiff * this.orbit.smoothFactor;
    this.applyCameraPose();
  }

  destroy() {
    this.unsubscribers.forEach((unsub) => unsub());
  }
}
