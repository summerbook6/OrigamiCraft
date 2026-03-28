import { MessageBus } from "./core/messageBus.js";
import { MSG } from "./core/messages.js";
import { THREE } from "./lib/three.js";
import { CameraOrbitController } from "./modules/cameraOrbitController.js";
import { PaperSimulator } from "./modules/paperSimulator.js";
import { PaperPoseController } from "./modules/paperPoseController.js";
import { FoldHistoryManager } from "./modules/foldHistoryManager.js";
import { AirplaneEvaluator } from "./modules/airplaneEvaluator.js";
import { SceneSystem } from "./modules/sceneSetup.js";

if (window.__origamiCraftBootstrapped) {
  throw new Error("OrigamiCraft main was initialized more than once.");
}
window.__origamiCraftBootstrapped = true;

const canvas = document.getElementById("scene");
const hint = document.getElementById("hint");
const controlHint = document.getElementById("controlHint");
const btnUndo = document.getElementById("btnUndo");
const btnFlip = document.getElementById("btnFlip");
const btnStand = document.getElementById("btnStand");
const btnSpread = document.getElementById("btnSpread");

const bus = new MessageBus();
const sceneSystem = new SceneSystem({ canvas });
window.app = { sceneSystem };

const cameraOrbit = new CameraOrbitController({
  camera: sceneSystem.camera,
  bus,
});
window.app.cameraOrbit = cameraOrbit;

const paperSimulator = new PaperSimulator({
  scene: sceneSystem.scene,
  camera: sceneSystem.camera,
  canvas,
  bus,
});
window.app.paperSimulator = paperSimulator;

const paperPose = new PaperPoseController({
  paperGroup: paperSimulator.getPaperGroup(),
  bus,
});
window.app.paperPose = paperPose;

new FoldHistoryManager({ bus });

new AirplaneEvaluator({
  bus,
  paperSize: {
    width: paperSimulator.paper.width,
    height: paperSimulator.paper.height,
  },
});

const clock = new THREE.Clock();

let mode = "draw";
let activeDragPointerId = null;
let controlHideTimer = null;
let controlShowTimer = null;
let hintHideTimer = null;
let poseStanding = false;

bus.subscribe(MSG.UI_SET_HINT, ({ text }) => {
  if (typeof text !== "string" || !text.trim()) return;
  showHint(text, 3000);
});
bus.subscribe(MSG.PAPER_POSE_CHANGED, ({ pose, reason }) => {
  if (!pose) return;
  const prevStanding = poseStanding;
  poseStanding = !!pose.isStanding;
  if (reason === "toFlat" || (prevStanding && !poseStanding)) {
    bus.publish(MSG.PAPER_SHAPE_COMMAND, { action: "wing-spread" });
    showHint("수평으로 복귀하고 날개를 살짝 펼쳤어요.", 3000);
  } else if (reason === "toStand") {
    showHint("종이를 세웠습니다. 다시 누르면 수평 복귀 + 성형됩니다.", 3000);
  }
});

setMode("draw");

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerCancel);
canvas.addEventListener("wheel", onWheel, { passive: false });
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
window.addEventListener("resize", () => sceneSystem.onResize());
window.addEventListener("keydown", onKeyDown);
btnUndo?.addEventListener("click", onUndoClick);
btnFlip?.addEventListener("click", onFlipClick);
btnStand?.addEventListener("click", onStandClick);
btnSpread?.addEventListener("click", onSpreadClick);

bus.subscribe(MSG.AIRPLANE_COMPLETED, () => {
  if (btnSpread) {
    btnSpread.style.display = "inline-block";
  }
});

let _animFrameId;
animate();

function animate() {
  if (_animFrameId) cancelAnimationFrame(_animFrameId);
  _animFrameId = requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  sceneSystem.tick(dt);
  cameraOrbit.tick(dt);
  paperPose.tick(dt);
  paperSimulator.tick();
  
  sceneSystem.renderer.render(sceneSystem.scene, sceneSystem.camera);
}

function setMode(nextMode) {
  if (activeDragPointerId !== null) return;
  mode = nextMode;
  bus.publish(MSG.APP_MODE_CHANGED, { mode: nextMode });
}

function normalizePointerPayload(ev) {
  return {
    pointerId: ev.pointerId,
    button: ev.button,
    clientX: ev.clientX,
    clientY: ev.clientY,
    mode,
  };
}

function onPointerDown(ev) {
  if (activeDragPointerId !== null && activeDragPointerId !== ev.pointerId) return;
  if (ev.button === 0 || ev.button === 1 || ev.button === 2) {
    activeDragPointerId = ev.pointerId;
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    markUserInteraction();
    if (ev.button === 1) {
      showHint("휠 버튼을 누른 채 마우스를 움직이면 카메라를 조절할 수 있어요.", 3000);
    }
  }
  bus.publish(MSG.INPUT_POINTER_DOWN, normalizePointerPayload(ev));
}

function onPointerMove(ev) {
  if (activeDragPointerId !== null && ev.pointerId !== activeDragPointerId) return;
  bus.publish(MSG.INPUT_POINTER_MOVE, normalizePointerPayload(ev));
}

function onPointerUp(ev) {
  if (activeDragPointerId !== null && ev.pointerId !== activeDragPointerId) return;
  bus.publish(MSG.INPUT_POINTER_UP, normalizePointerPayload(ev));
  if (canvas.hasPointerCapture(ev.pointerId)) {
    canvas.releasePointerCapture(ev.pointerId);
  }
  if (activeDragPointerId === ev.pointerId) activeDragPointerId = null;
}

function onPointerCancel(ev) {
  if (activeDragPointerId !== null && ev.pointerId !== activeDragPointerId) return;
  bus.publish(MSG.INPUT_POINTER_UP, normalizePointerPayload(ev));
  if (canvas.hasPointerCapture(ev.pointerId)) {
    canvas.releasePointerCapture(ev.pointerId);
  }
  if (activeDragPointerId === ev.pointerId) activeDragPointerId = null;
}

function onWheel(ev) {
  ev.preventDefault();
  markUserInteraction();
  bus.publish(MSG.INPUT_WHEEL, {
    deltaY: ev.deltaY,
  });
}

function onKeyDown(ev) {
  if (ev.repeat) return;

  if (ev.code === "Digit1") {
    applyStandPose();
    return;
  }
  if (ev.code === "Digit2") {
    applyFlipPose();
    return;
  }
  if (ev.code === "Digit0") {
    applyResetPose();
  }
}

function onUndoClick() {
  markUserInteraction();
  bus.publish(MSG.APP_RESET_FOLD);
}

function onSpreadClick() {
  markUserInteraction();
  bus.publish(MSG.PAPER_SHAPE_COMMAND, { action: "wing-spread" });
  if (btnSpread) {
    btnSpread.style.display = "none";
  }
}

function onFlipClick() {
  markUserInteraction();
  applyFlipPose();
}

function onStandClick() {
  markUserInteraction();
  applyStandPose();
}

function applyStandPose() {
  bus.publish(MSG.PAPER_POSE_COMMAND, { action: "toggleStand" });
}

function applyFlipPose() {
  bus.publish(MSG.PAPER_POSE_COMMAND, { action: "flip" });
  showHint("종이를 뒤집었습니다. (1: 세우기 / 2: 뒤집기 / 0: 초기화)", 3000);
}

function applyResetPose() {
  bus.publish(MSG.PAPER_POSE_COMMAND, { action: "reset" });
  showHint("종이 자세를 작업면 기준으로 초기화했습니다.", 3000);
}

function markUserInteraction() {
  if (!controlHint) return;

  if (controlHideTimer) clearTimeout(controlHideTimer);
  if (controlShowTimer) clearTimeout(controlShowTimer);

  controlHint.classList.remove("is-hidden");

  // 조작 후 3초 뒤 페이드아웃
  controlHideTimer = setTimeout(() => {
    controlHint.classList.add("is-hidden");
  }, 3000);

  // 추가 조작이 없으면 5초 뒤 다시 표시 (총 8초 시점)
  controlShowTimer = setTimeout(() => {
    controlHint.classList.remove("is-hidden");
  }, 8000);
}

function showHint(text, durationMs = 3000) {
  if (!hint) return;
  hint.textContent = text;
  hint.classList.remove("is-hidden");
  if (hintHideTimer) clearTimeout(hintHideTimer);
  hintHideTimer = setTimeout(() => {
    hint.classList.add("is-hidden");
  }, durationMs);
}
