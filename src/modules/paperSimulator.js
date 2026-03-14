import { THREE } from "../lib/three.js";
import { MSG } from "../core/messages.js";
import {
  clipConvexPolygonWithLine,
  distancePointToLine,
  getRectPolygon,
  polygonToGeometry,
} from "./geometry.js";

export class PaperSimulator {
  constructor({ scene, camera, canvas, bus }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.bus = bus;

    this.paperGroup = new THREE.Group();
    this.scene.add(this.paperGroup);

    const origamiMaps = createOrigamiMaps();
    this.paper = {
      width: 2.6,
      height: 2.6,
      creaseP0: new THREE.Vector2(-0.7, -0.5),
      creaseP1: new THREE.Vector2(0.7, 0.5),
      hasUserCrease: false,
      creaseColor: 0x2f66ff,
      foldAngleDeg: 0,
      foldTargetAngleDeg: 0,
      movingSide: "positive",
      activeTargetLayerId: null,
      activeTargetLayerIds: null,
      baseMaterial: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: origamiMaps.colorMap,
        roughnessMap: origamiMaps.roughnessMap,
        bumpMap: origamiMaps.bumpMap,
        bumpScale: 0.03,
        roughness: 0.72,
        metalness: 0.01,
        side: THREE.DoubleSide,
      }),
    };

    this.foldLimits = {
      minAngle: -179.5,
      maxAngle: 179.5,
      smoothFactor: 0.18,
      snapStartAngle: 138,
      snapTargetAngle: 179.2,
    };

    this.interaction = {
      mode: "draw",
      pointerDown: false,
      activePointerId: null,
      dragKind: null, // draw | fold | null
      drawStart: null,
      drawEnd: null,
      foldDragging: false,
      foldStartAngle: 0,
      foldAllowedSign: 1,
      foldDragStartClientX: 0,
      foldDragStartClientY: 0,
      foldScreenNormalX: 1,
      foldScreenNormalY: 0,
      foldPxToLocal: 0.01,
      foldLastSignedDelta: 0,
      foldMoved: false,
      autoSettling: false,
      selectedLayerId: null,
      selectedLayerIds: null,
      selectedSide: null,
    };

    this.pointerNdc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.interactionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.tmpWorldPoint = new THREE.Vector3();
    this.tmpPlaneOrigin = new THREE.Vector3();
    this.tmpPlaneNormal = new THREE.Vector3();
    this.tmpPlaneNormalTip = new THREE.Vector3();
    this.rectPolygon = getRectPolygon(this.paper.width, this.paper.height);

    this.renderMeshes = [];
    this.renderEdges = [];
    this.pickMeshes = [];
    this.creaseLine = null;
    this.drawPreviewLine = null;
    this.guideVerticalLine = null;
    this.guideHorizontalLine = null;
    this.basePolygon = this.rectPolygon.map((p) => p.clone());
    this.foldOps = [];
    this.baseLayerId = "layer-0";
    this.layers = [{ id: this.baseLayerId, poly: this.basePolygon.map((p) => p.clone()) }];
    this.layerGap = 0.0008;
    this.guidePulseTime = Math.random() * Math.PI * 2;

    this.unsubscribers = [
      this.bus.subscribe(MSG.APP_MODE_CHANGED, ({ mode }) => this.onModeChanged(mode)),
      this.bus.subscribe(MSG.APP_RESET_FOLD, () => this.onResetFold()),
      this.bus.subscribe(MSG.PAPER_SHAPE_COMMAND, (payload) => this.onShapeCommand(payload)),
      this.bus.subscribe(MSG.INPUT_POINTER_DOWN, (payload) => this.onPointerDown(payload)),
      this.bus.subscribe(MSG.INPUT_POINTER_MOVE, (payload) => this.onPointerMove(payload)),
      this.bus.subscribe(MSG.INPUT_POINTER_UP, (payload) => this.onPointerUp(payload)),
    ];

    this.createCenterGuides();
    this.createPaperMeshes();
  }

  onModeChanged(mode) {
    if (mode !== "draw" && mode !== "fold") return;
    this.interaction.mode = mode;
    this.cancelPrimaryPointer();
    this.updateGuideVisibility();
  }

  onResetFold() {
    this.paper.foldAngleDeg = 0;
    this.paper.foldTargetAngleDeg = 0;
    this.paper.activeTargetLayerId = null;
    this.paper.activeTargetLayerIds = null;
    this.interaction.selectedLayerId = null;
    this.interaction.selectedLayerIds = null;
    this.interaction.selectedSide = null;
    this.applyFoldTransform();
    this.updateGuideVisibility();
    this.bus.publish(MSG.UI_SET_HINT, { text: "각도를 초기화했습니다." });
  }

  onShapeCommand({ action } = {}) {
    if (action !== "wing-spread") return;
    this.applyWingSpreadShaping();
  }

  onPointerDown({ button, pointerId, clientX, clientY }) {
    if (button !== 0 && button !== 2) return;
    if (this.interaction.pointerDown && this.interaction.activePointerId !== pointerId) return;

    this.interaction.pointerDown = true;
    this.interaction.activePointerId = pointerId;

    if (button === 0) {
      this.interaction.dragKind = "draw";
      if (this.paper.hasUserCrease && Math.abs(this.paper.foldTargetAngleDeg) > 1) {
        this.commitCurrentFoldToLayers();
        this.createPaperMeshes();
      }
      const local = this.getPaperLocalPointFromPointer(clientX, clientY);
      if (!local) {
        this.bus.publish(MSG.UI_SET_HINT, { text: "종이 안쪽에서 좌클릭해 시작해주세요." });
        this.cancelPrimaryPointer();
        return;
      }
      this.interaction.drawStart = local.clone();
      this.interaction.drawEnd = local.clone();
      const snapped = this.getSnappedCreasePoints(
        this.interaction.drawStart,
        this.interaction.drawEnd
      );
      this.updateDrawPreview(snapped.start, snapped.end);
      this.bus.publish(MSG.UI_SET_HINT, { text: "드래그를 끝내면 접힘선이 생성됩니다." });
      return;
    }

    this.interaction.dragKind = "fold";
    if (!this.paper.hasUserCrease) {
      this.bus.publish(MSG.UI_SET_HINT, {
        text: "먼저 좌클릭 드래그로 접힘선을 만들어주세요.",
      });
      this.cancelPrimaryPointer();
      return;
    }
    const preferredSide =
      Math.abs(this.paper.foldTargetAngleDeg) > 3 ? this.paper.movingSide : null;
    const hit = this.pickFoldTargetAtPointer(clientX, clientY, preferredSide);
    if (!hit) {
      this.bus.publish(MSG.UI_SET_HINT, { text: "접으려는 종이 위치에서 우클릭해 주세요." });
      this.cancelPrimaryPointer();
      return;
    }

    if (this.distanceFromCrease(hit.localPoint) < this.getMinGrabDistance()) {
      this.bus.publish(MSG.UI_SET_HINT, {
        text: "접힘선에서 조금 더 먼 부분을 잡아주세요.",
      });
      this.cancelPrimaryPointer();
      return;
    }

    // 이미 접힌 상태에서는 접히는 면 기준을 고정해, 우클릭 순간 반전되는 점프를 방지합니다.
    const sideForDrag =
      Math.abs(this.paper.foldTargetAngleDeg) > 3 ? this.paper.movingSide : hit.side;
    const targetLayerIds = hit.layerIds?.length ? hit.layerIds : [hit.layerId];
    this.interaction.selectedLayerId = hit.layerId;
    this.interaction.selectedLayerIds = targetLayerIds.slice();
    this.interaction.selectedSide = sideForDrag;
    this.paper.activeTargetLayerId = hit.layerId;
    this.paper.activeTargetLayerIds = targetLayerIds.slice();
    const foldInit = this.beginFoldDrag(sideForDrag, hit.localPoint, targetLayerIds);
    this.interaction.foldStartAngle = foldInit.startAngle;
    this.interaction.foldAllowedSign = foldInit.allowedSign;
    this.interaction.foldDragStartClientX = clientX;
    this.interaction.foldDragStartClientY = clientY;
    this.interaction.foldScreenNormalX = foldInit.screenNormalX;
    this.interaction.foldScreenNormalY = foldInit.screenNormalY;
    this.interaction.foldPxToLocal = foldInit.pxToLocal;
    this.interaction.foldLastSignedDelta = 0;
    this.interaction.foldMoved = false;
    this.interaction.foldDragging = true;
    this.interaction.autoSettling = false;
    this.bus.publish(MSG.UI_SET_HINT, { text: "접힘선 쪽으로 드래그해 접는 각도를 조절하세요." });
  }

  onPointerMove({ pointerId, clientX, clientY }) {
    if (!this.interaction.pointerDown || this.interaction.activePointerId !== pointerId) {
      return;
    }

    if (this.interaction.dragKind === "draw") {
      const local = this.getPaperLocalPointFromPointer(clientX, clientY);
      if (!local) return;
      this.interaction.drawEnd = local;
      const snapped = this.getSnappedCreasePoints(
        this.interaction.drawStart,
        this.interaction.drawEnd
      );
      this.updateDrawPreview(snapped.start, snapped.end);
      return;
    }

    if (this.interaction.dragKind !== "fold") return;
    this.interaction.autoSettling = false;

    const deltaX = clientX - this.interaction.foldDragStartClientX;
    const deltaY = clientY - this.interaction.foldDragStartClientY;
    const projectedPx =
      deltaX * this.interaction.foldScreenNormalX +
      deltaY * this.interaction.foldScreenNormalY;
    const towardCreaseDeltaRaw = projectedPx * this.interaction.foldPxToLocal;
    if (Math.abs(towardCreaseDeltaRaw) > 0.0025) {
      this.interaction.foldMoved = true;
    }

    this.updateFoldTargetFromDrag(
      towardCreaseDeltaRaw,
      this.interaction.foldAllowedSign,
      this.interaction.foldStartAngle
    );
  }

  onPointerUp({ pointerId }) {
    if (this.interaction.activePointerId !== pointerId) return;

    if (
      this.interaction.dragKind === "draw" &&
      this.interaction.drawStart &&
      this.interaction.drawEnd
    ) {
      const result = this.setCreaseFromDraw(
        this.interaction.drawStart,
        this.interaction.drawEnd
      );
      const hint = !result.ok
        ? result.tooShortForDrag
          ? "좌클릭 드래그로 접힘선을 만들어주세요."
          : "선이 너무 짧습니다. 더 길게 그려주세요."
        : "접힘선 생성 완료. 접기 모드로 전환해 보세요.";
      this.bus.publish(MSG.UI_SET_HINT, { text: hint });
    }

    if (this.interaction.dragKind === "fold") {
      this.interaction.foldDragging = false;
      if (!this.interaction.foldMoved) {
        this.paper.activeTargetLayerId = null;
        this.paper.activeTargetLayerIds = null;
        this.applyFoldTransform();
        this.bus.publish(MSG.UI_SET_HINT, {
          text: "우클릭 후 접을 방향으로 드래그해 주세요.",
        });
      }
      // 접는 방향으로 끝났을 때만 자동 안착합니다. (펼치기 의도는 보존)
      if (this.interaction.foldMoved && this.interaction.foldLastSignedDelta > 0.0025) {
        this.tryAutoSettleFold();
      }
    }

    this.cancelPrimaryPointer();
  }

  cancelPrimaryPointer() {
    this.interaction.pointerDown = false;
    this.interaction.activePointerId = null;
    this.interaction.dragKind = null;
    this.interaction.drawStart = null;
    this.interaction.drawEnd = null;
    this.interaction.foldDragging = false;
    this.interaction.foldMoved = false;
    this.interaction.selectedLayerId = null;
    this.interaction.selectedLayerIds = null;
    this.interaction.selectedSide = null;
    this.clearDrawPreview();
  }

  pointerToNdc(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  getPaperLocalPointFromPointer(clientX, clientY) {
    const local = this.getPlaneLocalPointFromPointer(clientX, clientY);
    if (!local) return null;
    if (!this.isInsideAnyLayer(local)) return null;
    return local;
  }

  getPlaneLocalPointFromPointer(clientX, clientY) {
    this.updateInteractionPlane();
    this.pointerToNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.interactionPlane, this.tmpWorldPoint);
    if (!hit) return null;
    const local = this.paperGroup.worldToLocal(hit.clone());
    return new THREE.Vector2(local.x, local.y);
  }

  updateInteractionPlane() {
    this.paperGroup.localToWorld(this.tmpPlaneOrigin.set(0, 0, 0));
    this.paperGroup.localToWorld(this.tmpPlaneNormalTip.set(0, 0, 1));
    this.tmpPlaneNormal
      .subVectors(this.tmpPlaneNormalTip, this.tmpPlaneOrigin)
      .normalize();
    this.interactionPlane.setFromNormalAndCoplanarPoint(
      this.tmpPlaneNormal,
      this.tmpPlaneOrigin
    );
  }

  pickFoldTargetAtPointer(clientX, clientY, preferredSide = null) {
    const localPoint = this.getPaperLocalPointFromPointer(clientX, clientY);
    if (!localPoint) return null;
    const targetSide = this.getLocalPointSide(localPoint, preferredSide);

    this.pointerToNdc(clientX, clientY);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const candidates = this.pickMeshes.filter(Boolean);
    const hits = this.raycaster.intersectObjects(candidates, false);
    if (hits.length === 0) return null;

    const hit = this.pickBestLayerHit(hits, targetSide);
    if (!hit) return null;
    const seedLayerId = hit.object.userData.layerId ?? null;
    if (!seedLayerId) return null;
    const packetLayerIds = this.pickConnectedLayerPacket(seedLayerId, targetSide);
    const finalLayerIds = packetLayerIds.length > 0 ? packetLayerIds : [seedLayerId];

    return {
      side: targetSide,
      layerId: seedLayerId,
      layerIds: finalLayerIds,
      localPoint,
    };
  }

  pickConnectedLayerPacket(seedLayerId, targetSide) {
    const seedLayer = this.layers.find((layer) => layer.id === seedLayerId);
    if (!seedLayer) return [];
    if (!this.layerSupportsTargetSide(seedLayer.poly, targetSide)) {
      return [seedLayerId];
    }

    const eligibleLayers = this.layers.filter((layer) =>
      this.layerSupportsTargetSide(layer.poly, targetSide)
    );
    const byId = new Map(eligibleLayers.map((layer) => [layer.id, layer]));
    if (!byId.has(seedLayerId)) return [seedLayerId];

    const visited = new Set([seedLayerId]);
    const queue = [seedLayerId];
    while (queue.length > 0) {
      const currentId = queue.shift();
      const current = byId.get(currentId);
      if (!current) continue;

      for (const candidate of eligibleLayers) {
        if (visited.has(candidate.id)) continue;
        if (!shouldPropagatePacketAcrossLayers(current.poly, candidate.poly)) continue;
        visited.add(candidate.id);
        queue.push(candidate.id);
      }
    }
    return Array.from(visited);
  }

  layerSupportsTargetSide(poly, targetSide) {
    const onPositive = clipConvexPolygonWithLine(poly, this.paper.creaseP0, this.paper.creaseP1, true);
    const onNegative = clipConvexPolygonWithLine(poly, this.paper.creaseP0, this.paper.creaseP1, false);
    const active = targetSide === "positive" ? onPositive : onNegative;
    return active.length >= 3 && polygonAreaAbs(active) > 1e-7;
  }

  pickBestLayerHit(hits, targetSide) {
    const grouped = new Map();
    for (const hit of hits) {
      const layerId = hit.object?.userData?.layerId;
      if (!layerId) continue;
      const hitSide = hit.object?.userData?.side ?? null;
      const supportsTargetSide = hitSide === null || hitSide === targetSide;

      let entry = grouped.get(layerId);
      if (!entry) {
        entry = {
          bestAny: null,
          bestSide: null,
        };
        grouped.set(layerId, entry);
      }

      if (!entry.bestAny || hit.distance < entry.bestAny.distance) {
        entry.bestAny = hit;
      }
      if (supportsTargetSide && (!entry.bestSide || hit.distance < entry.bestSide.distance)) {
        entry.bestSide = hit;
      }
    }

    let best = null;
    for (const entry of grouped.values()) {
      const candidate = entry.bestSide ?? entry.bestAny;
      if (!candidate) continue;
      if (!best || candidate.distance < best.distance) {
        best = candidate;
      }
    }
    return best;
  }

  getLocalPointSide(localPoint, preferredSide = null) {
    if (preferredSide === "positive" || preferredSide === "negative") return preferredSide;
    const sideValue = cross2(
      new THREE.Vector2().subVectors(this.paper.creaseP1, this.paper.creaseP0),
      new THREE.Vector2().subVectors(localPoint, this.paper.creaseP0)
    );
    if (sideValue >= 0) return "positive";
    return "negative";
  }

  getMinGrabDistance() {
    return Math.min(this.paper.width, this.paper.height) * 0.12;
  }

  distanceFromCrease(localPoint) {
    return distancePointToLine(localPoint, this.paper.creaseP0, this.paper.creaseP1);
  }

  setCreaseFromDraw(start, end) {
    const len = start.distanceTo(end);
    if (len <= 0.02) return { ok: false, snappedGuide: null, tooShortForDrag: false };
    if (len <= 0.08) return { ok: false, snappedGuide: null, tooShortForDrag: true };

    // 이전 접기 결과를 평면 레이어 상태로 확정한 뒤 새 접힘선을 받습니다.
    if (this.paper.hasUserCrease) {
      if (Math.abs(this.paper.foldTargetAngleDeg) > 1) {
        this.commitCurrentFoldToLayers();
      } else {
        this.paper.hasUserCrease = false;
        this.paper.foldAngleDeg = 0;
        this.paper.foldTargetAngleDeg = 0;
        this.paper.activeTargetLayerId = null;
        this.paper.activeTargetLayerIds = null;
        this.interaction.selectedLayerId = null;
        this.interaction.selectedLayerIds = null;
        this.interaction.selectedSide = null;
      }
    }

    const snapped = this.getSnappedCreasePoints(start, end);
    this.paper.creaseP0.copy(snapped.start);
    this.paper.creaseP1.copy(snapped.end);
    this.paper.hasUserCrease = true;
    this.paper.foldAngleDeg = 0;
    this.paper.foldTargetAngleDeg = 0;
    this.paper.activeTargetLayerId = null;
    this.paper.activeTargetLayerIds = null;
    this.interaction.selectedLayerId = null;
    this.interaction.selectedLayerIds = null;
    this.interaction.selectedSide = null;
    this.createPaperMeshes();
    return { ok: true, snappedGuide: snapped.snappedGuide, tooShortForDrag: false };
  }

  beginFoldDrag(side, localPoint, layerIds = null) {
    this.paper.movingSide = side;
    // 이미 접힌 상태에서는 현재 접힘 부호를 유지해야 자연스럽게 다시 펼칠 수 있습니다.
    const currentSign = Math.sign(this.paper.foldTargetAngleDeg);
    const foldedNow = Math.abs(this.paper.foldTargetAngleDeg) > 2;
    const allowedSign =
      foldedNow
        ? (currentSign || (side === "positive" ? 1 : -1))
        : this.detectPreferredFoldSign(side, layerIds);
    const screenBasis = this.computeFoldScreenBasis(localPoint);
    if (foldedNow) {
      // 접힌 상태에서 재드래그 시 사용자 기준 펼치기 방향이 자연스럽도록 축을 반전합니다.
      screenBasis.normalX *= -1;
      screenBasis.normalY *= -1;
    }
    const startAngle = this.clampFoldAngleForDesk(
      this.paper.foldTargetAngleDeg,
      allowedSign
    );
    this.paper.foldTargetAngleDeg = startAngle;
    this.paper.foldAngleDeg = startAngle;
    this.applyFoldTransform();

    return {
      startAngle,
      allowedSign,
      screenNormalX: screenBasis.normalX,
      screenNormalY: screenBasis.normalY,
      pxToLocal: screenBasis.pxToLocal,
    };
  }

  updateFoldTargetFromDrag(
    towardCreaseDeltaRaw,
    allowedSign,
    startAngle
  ) {
    // 양방향 UX: 접힘선 쪽(+)은 접기, 반대(-)는 펼치기로 해석합니다.
    const noiseDeadzone = 0.0025;
    let signedDelta = towardCreaseDeltaRaw;
    if (Math.abs(signedDelta) < noiseDeadzone) signedDelta = 0;
    else signedDelta -= Math.sign(signedDelta) * noiseDeadzone;
    this.interaction.foldLastSignedDelta = signedDelta;

    const absDelta = Math.abs(signedDelta);
    const curved = (absDelta * absDelta) / (absDelta + 0.22);
    const signedCurved = Math.sign(signedDelta) * curved;

    // 허용된 접힘 방향(allowedSign)을 각도 변화에 반영합니다.
    const nextAngle = THREE.MathUtils.clamp(
      startAngle + signedCurved * 75 * allowedSign,
      this.foldLimits.minAngle,
      this.foldLimits.maxAngle
    );
    const clampedAngle = this.clampFoldAngleForDesk(
      nextAngle,
      allowedSign
    );

    // 드래그 중에는 목표 추종이 아닌 즉시 반영으로 왕복 진동을 원천 차단합니다.
    this.paper.foldTargetAngleDeg = clampedAngle;
    this.paper.foldAngleDeg = clampedAngle;
    this.applyFoldTransform();
  }

  tick() {
    if (this.interaction.foldDragging) return;

    const angleDiff = this.paper.foldTargetAngleDeg - this.paper.foldAngleDeg;
    if (Math.abs(angleDiff) > 0.01) {
      this.paper.foldAngleDeg += angleDiff * this.foldLimits.smoothFactor;
      this.applyFoldTransform();
      return;
    }
    if (this.paper.foldAngleDeg !== this.paper.foldTargetAngleDeg) {
      this.paper.foldAngleDeg = this.paper.foldTargetAngleDeg;
      this.applyFoldTransform();
    }
    if (this.interaction.autoSettling && Math.abs(angleDiff) <= 0.2) {
      this.paper.foldAngleDeg = this.paper.foldTargetAngleDeg;
      this.applyFoldTransform();
      this.interaction.autoSettling = false;
    }
    this.updateGuideGlow();
    this.updateGuideVisibility();
  }

  updateDrawPreview(start, end) {
    this.clearDrawPreview();
    const points = [
      new THREE.Vector3(start.x, start.y, 0.003),
      new THREE.Vector3(end.x, end.y, 0.003),
    ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    this.drawPreviewLine = new THREE.Line(
      geom,
      new THREE.LineDashedMaterial({
        color: 0xffd36f,
        dashSize: 0.08,
        gapSize: 0.05,
      })
    );
    this.drawPreviewLine.computeLineDistances();
    this.paperGroup.add(this.drawPreviewLine);
  }

  clearDrawPreview() {
    if (!this.drawPreviewLine) return;
    this.paperGroup.remove(this.drawPreviewLine);
    this.drawPreviewLine.geometry.dispose();
    this.drawPreviewLine.material.dispose();
    this.drawPreviewLine = null;
  }

  createCenterGuides() {
    const hw = this.paper.width * 0.5;
    const hh = this.paper.height * 0.5;

    const vGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -hh, 0.0022),
      new THREE.Vector3(0, hh, 0.0022),
    ]);
    this.guideVerticalLine = new THREE.Line(
      vGeom,
      new THREE.LineDashedMaterial({
        color: 0x9fc3ff,
        dashSize: 0.12,
        gapSize: 0.16,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.guideVerticalLine.computeLineDistances();
    this.paperGroup.add(this.guideVerticalLine);

    const hGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, 0, 0.0022),
      new THREE.Vector3(hw, 0, 0.0022),
    ]);
    this.guideHorizontalLine = new THREE.Line(
      hGeom,
      new THREE.LineDashedMaterial({
        color: 0x9fc3ff,
        dashSize: 0.12,
        gapSize: 0.16,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.guideHorizontalLine.computeLineDistances();
    this.paperGroup.add(this.guideHorizontalLine);
  }

  getSnappedCreasePoints(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      return { start: start.clone(), end: end.clone(), snappedGuide: null };
    }

    const drawDir = new THREE.Vector2(dx / len, dy / len);
    const midX = (start.x + end.x) * 0.5;
    const midY = (start.y + end.y) * 0.5;
    const mid = new THREE.Vector2(midX, midY);
    const guides = this.getSnapGuides();

    const maxAngleDeg = 16;
    const minAlign = Math.cos(THREE.MathUtils.degToRad(maxAngleDeg));
    const snapDist = Math.min(this.paper.width, this.paper.height) * 0.0375;

    let bestGuide = null;
    let bestScore = -Infinity;
    for (const guide of guides) {
      const align = Math.abs(drawDir.dot(guide.dir));
      if (align < minAlign) continue;

      const dist = pointToInfiniteLineDistance(mid, guide.point, guide.dir);
      if (dist > snapDist) continue;

      const score = align * 2 - dist * 8;
      if (score > bestScore) {
        bestScore = score;
        bestGuide = guide;
      }
    }

    if (bestGuide) {
      const clipped = this.clipGuideLineToRect(bestGuide.point, bestGuide.dir);
      if (clipped) {
        return {
          start: clipped.start,
          end: clipped.end,
          snappedGuide: bestGuide.id,
        };
      }
    }

    return { start: start.clone(), end: end.clone(), snappedGuide: null };
  }

  getSnapGuides() {
    const w = this.paper.width;
    const h = this.paper.height;
    const diagTR = new THREE.Vector2(w, h).normalize();
    const diagTL = new THREE.Vector2(-w, h).normalize();
    const diagBR = new THREE.Vector2(w, -h).normalize();
    const diagBL = new THREE.Vector2(-w, -h).normalize();

    const leftMid = new THREE.Vector2(-w * 0.5, 0);
    const rightMid = new THREE.Vector2(w * 0.5, 0);
    const topMid = new THREE.Vector2(0, h * 0.5);
    const bottomMid = new THREE.Vector2(0, -h * 0.5);

    const innerLTDir = new THREE.Vector2().subVectors(topMid, leftMid).normalize();
    const innerLBDir = new THREE.Vector2().subVectors(bottomMid, leftMid).normalize();
    const innerRTDir = new THREE.Vector2().subVectors(topMid, rightMid).normalize();
    const innerRBDir = new THREE.Vector2().subVectors(bottomMid, rightMid).normalize();

    return [
      { id: "center-vertical", point: new THREE.Vector2(0, 0), dir: new THREE.Vector2(0, 1) },
      { id: "center-horizontal", point: new THREE.Vector2(0, 0), dir: new THREE.Vector2(1, 0) },
      { id: "quarter-vertical-left", point: new THREE.Vector2(-w * 0.25, 0), dir: new THREE.Vector2(0, 1) },
      { id: "quarter-vertical-right", point: new THREE.Vector2(w * 0.25, 0), dir: new THREE.Vector2(0, 1) },
      { id: "quarter-horizontal-bottom", point: new THREE.Vector2(0, -h * 0.25), dir: new THREE.Vector2(1, 0) },
      { id: "quarter-horizontal-top", point: new THREE.Vector2(0, h * 0.25), dir: new THREE.Vector2(1, 0) },
      { id: "third-vertical-left", point: new THREE.Vector2(-w / 6, 0), dir: new THREE.Vector2(0, 1) },
      { id: "third-vertical-right", point: new THREE.Vector2(w / 6, 0), dir: new THREE.Vector2(0, 1) },
      { id: "third-horizontal-bottom", point: new THREE.Vector2(0, -h / 6), dir: new THREE.Vector2(1, 0) },
      { id: "third-horizontal-top", point: new THREE.Vector2(0, h / 6), dir: new THREE.Vector2(1, 0) },
      // 보이지 않는 대각 가이드: 중심에서 각 꼭짓점으로 향하는 4방향
      { id: "center-diagonal-tr", point: new THREE.Vector2(0, 0), dir: diagTR },
      { id: "center-diagonal-tl", point: new THREE.Vector2(0, 0), dir: diagTL },
      { id: "center-diagonal-br", point: new THREE.Vector2(0, 0), dir: diagBR },
      { id: "center-diagonal-bl", point: new THREE.Vector2(0, 0), dir: diagBL },
      // 내부 대각 가이드: 가로 중심선 끝점과 세로 중심선 끝점을 잇는 4개 라인
      { id: "inner-diagonal-left-top", point: new THREE.Vector2(-w * 0.25, h * 0.25), dir: innerLTDir },
      { id: "inner-diagonal-left-bottom", point: new THREE.Vector2(-w * 0.25, -h * 0.25), dir: innerLBDir },
      { id: "inner-diagonal-right-top", point: new THREE.Vector2(w * 0.25, h * 0.25), dir: innerRTDir },
      { id: "inner-diagonal-right-bottom", point: new THREE.Vector2(w * 0.25, -h * 0.25), dir: innerRBDir },
    ];
  }

  clipGuideLineToRect(point, dir) {
    const hw = this.paper.width * 0.5;
    const hh = this.paper.height * 0.5;
    const rect = [
      new THREE.Vector2(-hw, -hh),
      new THREE.Vector2(hw, -hh),
      new THREE.Vector2(hw, hh),
      new THREE.Vector2(-hw, hh),
    ];

    const intersections = [];
    for (let i = 0; i < rect.length; i += 1) {
      const a = rect[i];
      const b = rect[(i + 1) % rect.length];
      const hit = intersectInfiniteLineWithSegment(point, dir, a, b);
      if (!hit) continue;
      if (!intersections.some((p) => p.distanceToSquared(hit) < 1e-8)) {
        intersections.push(hit);
      }
    }

    if (intersections.length < 2) return null;

    let bestA = intersections[0];
    let bestB = intersections[1];
    let bestDist = bestA.distanceToSquared(bestB);
    for (let i = 0; i < intersections.length; i += 1) {
      for (let j = i + 1; j < intersections.length; j += 1) {
        const d = intersections[i].distanceToSquared(intersections[j]);
        if (d > bestDist) {
          bestDist = d;
          bestA = intersections[i];
          bestB = intersections[j];
        }
      }
    }

    return { start: bestA, end: bestB };
  }

  createPaperMeshes() {
    this.disposePaperMeshes();

    const creaseDir = new THREE.Vector2().subVectors(this.paper.creaseP1, this.paper.creaseP0);
    if (creaseDir.lengthSq() < 1e-6) {
      this.paper.creaseP0.set(-0.7, -0.5);
      this.paper.creaseP1.set(0.7, 0.5);
    }

    this.pickMeshes = [];
    this.renderMeshes = [];
    this.renderEdges = [];

    const axis = new THREE.Vector3(
      this.paper.creaseP1.x - this.paper.creaseP0.x,
      this.paper.creaseP1.y - this.paper.creaseP0.y,
      0
    ).normalize();
    const sideSign = this.paper.movingSide === "positive" ? 1 : -1;
    const signedAngle = THREE.MathUtils.degToRad(this.paper.foldAngleDeg * sideSign);
    const rot = new THREE.Matrix4().makeRotationAxis(axis, signedAngle);
    const t1 = new THREE.Matrix4().makeTranslation(-this.paper.creaseP0.x, -this.paper.creaseP0.y, 0);
    const t2 = new THREE.Matrix4().makeTranslation(this.paper.creaseP0.x, this.paper.creaseP0.y, 0);
    const foldMatrix = new THREE.Matrix4().multiplyMatrices(t2, rot).multiply(t1);
    // 같은 레이어 내부(static/moving) seam 틈이 과하게 보이지 않도록 미세 분리만 유지합니다.
    const seamLift = 0.00012;

    const previewTargetLayerIds = this.paper.hasUserCrease
      ? new Set(this.getActiveTargetLayerIds())
      : null;

    for (let i = 0; i < this.layers.length; i += 1) {
      const layer = this.layers[i];
      const poly = layer.poly;
      const layerId = layer.id;
      const zLift = i * this.layerGap;

      if (
        !this.paper.hasUserCrease ||
        !previewTargetLayerIds ||
        previewTargetLayerIds.size === 0 ||
        !previewTargetLayerIds.has(layerId)
      ) {
        const mesh = new THREE.Mesh(
          polygonToGeometry(poly, this.paper.width, this.paper.height),
          this.paper.baseMaterial
        );
        // 분할되지 않은 단일 면은 side 판정을 픽업 단계에서 계산합니다.
        mesh.userData.side = null;
        mesh.userData.layerId = layerId;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.position.z = zLift;
        this.paperGroup.add(mesh);
        this.renderMeshes.push(mesh);
        this.pickMeshes.push(mesh);

        const edge = makeBoundaryEdgeFromPolygons([poly], {
          zOffset: 0.001 + zLift,
        });
        if (edge) {
          this.paperGroup.add(edge);
          this.renderEdges.push(edge);
        }
        continue;
      }

      const posPoly = clipConvexPolygonWithLine(poly, this.paper.creaseP0, this.paper.creaseP1, true);
      const negPoly = clipConvexPolygonWithLine(poly, this.paper.creaseP0, this.paper.creaseP1, false);

      const staticPoly = this.paper.movingSide === "positive" ? negPoly : posPoly;
      const movingPoly = this.paper.movingSide === "positive" ? posPoly : negPoly;

      if (staticPoly.length >= 3) {
        const mesh = new THREE.Mesh(
          polygonToGeometry(staticPoly, this.paper.width, this.paper.height),
          this.paper.baseMaterial
        );
        mesh.userData.side = this.paper.movingSide === "positive" ? "negative" : "positive";
        mesh.userData.layerId = layerId;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.position.z = zLift;
        this.paperGroup.add(mesh);
        this.renderMeshes.push(mesh);
        this.pickMeshes.push(mesh);

        const edge = makeBoundaryEdgeFromPolygons([staticPoly], {
          zOffset: 0.001 + zLift,
          hideOnCreaseLine: {
            p0: this.paper.creaseP0,
            p1: this.paper.creaseP1,
            epsilon: 1e-4,
          },
        });
        if (edge) {
          this.paperGroup.add(edge);
          this.renderEdges.push(edge);
        }
      }

      if (movingPoly.length >= 3) {
        const mesh = new THREE.Mesh(
          polygonToGeometry(movingPoly, this.paper.width, this.paper.height),
          this.paper.baseMaterial
        );
        mesh.userData.side = this.paper.movingSide;
        mesh.userData.layerId = layerId;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.matrixAutoUpdate = false;
        const zMat = new THREE.Matrix4().makeTranslation(0, 0, zLift + seamLift);
        mesh.matrix.copy(new THREE.Matrix4().multiplyMatrices(zMat, foldMatrix));
        mesh.matrixWorldNeedsUpdate = true;
        this.paperGroup.add(mesh);
        this.renderMeshes.push(mesh);
        this.pickMeshes.push(mesh);

        const edge = makeBoundaryEdgeFromPolygons([movingPoly], {
          zOffset: 0.001 + zLift + seamLift,
          hideOnCreaseLine: {
            p0: this.paper.creaseP0,
            p1: this.paper.creaseP1,
            epsilon: 1e-4,
          },
          transformMatrix: foldMatrix,
        });
        if (edge) {
          this.paperGroup.add(edge);
          this.renderEdges.push(edge);
        }
      }
    }

    const creaseGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(this.paper.creaseP0.x, this.paper.creaseP0.y, 0.0025),
      new THREE.Vector3(this.paper.creaseP1.x, this.paper.creaseP1.y, 0.0025),
    ]);
    this.creaseLine = new THREE.Line(
      creaseGeom,
      new THREE.LineBasicMaterial({
        color: 0x8eb5ff,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.paperGroup.add(this.creaseLine);

    this.updateGuideVisibility();
  }

  disposePaperMeshes() {
    for (const obj of [...this.renderMeshes, ...this.renderEdges, this.creaseLine]) {
      if (!obj) continue;
      this.paperGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else if (obj.material !== this.paper.baseMaterial) obj.material.dispose();
      }
    }
    this.renderMeshes = [];
    this.renderEdges = [];
    this.pickMeshes = [];
    this.creaseLine = null;
  }

  applyFoldTransform() {
    // 레이어 기반 렌더는 각도 변경 시 전체 재구성으로 일관성을 유지합니다.
    this.createPaperMeshes();
  }

  clampFoldAngleForDesk(angleDeg, allowedSign) {
    const directionalMin = allowedSign > 0 ? 0 : this.foldLimits.minAngle;
    const directionalMax = allowedSign > 0 ? this.foldLimits.maxAngle : 0;
    return THREE.MathUtils.clamp(angleDeg, directionalMin, directionalMax);
  }

  detectPreferredFoldSign(movingSide, targetLayerIds = null) {
    const sampleDeg = 10;
    const nearDistPos = this.computeMovingSideCameraDistance(
      movingSide,
      1,
      sampleDeg,
      targetLayerIds
    );
    const nearDistNeg = this.computeMovingSideCameraDistance(
      movingSide,
      -1,
      sampleDeg,
      targetLayerIds
    );

    if (!Number.isFinite(nearDistPos) && !Number.isFinite(nearDistNeg)) {
      return movingSide === "positive" ? 1 : -1;
    }
    if (!Number.isFinite(nearDistPos)) return -1;
    if (!Number.isFinite(nearDistNeg)) return 1;
    return nearDistPos <= nearDistNeg ? 1 : -1;
  }

  computeMovingSideCameraDistance(movingSide, allowedSign, sampleDeg, targetLayerIds = null) {
    const axis = new THREE.Vector3(
      this.paper.creaseP1.x - this.paper.creaseP0.x,
      this.paper.creaseP1.y - this.paper.creaseP0.y,
      0
    );
    if (axis.lengthSq() < 1e-10) return Infinity;
    axis.normalize();

    const sideSign = movingSide === "positive" ? 1 : -1;
    const signedAngle = THREE.MathUtils.degToRad(sampleDeg * allowedSign * sideSign);
    const rot = new THREE.Matrix4().makeRotationAxis(axis, signedAngle);
    const t1 = new THREE.Matrix4().makeTranslation(-this.paper.creaseP0.x, -this.paper.creaseP0.y, 0);
    const t2 = new THREE.Matrix4().makeTranslation(this.paper.creaseP0.x, this.paper.creaseP0.y, 0);
    const foldMatrix = new THREE.Matrix4().multiplyMatrices(t2, rot).multiply(t1);

    const local = new THREE.Vector3();
    const world = new THREE.Vector3();
    let sumDistance = 0;
    let count = 0;

    const targetSet =
      Array.isArray(targetLayerIds) && targetLayerIds.length > 0 ? new Set(targetLayerIds) : null;
    for (const layer of this.layers) {
      if (targetSet && !targetSet.has(layer.id)) continue;
      const poly = layer.poly;
      const posPoly = clipConvexPolygonWithLine(poly, this.paper.creaseP0, this.paper.creaseP1, true);
      const negPoly = clipConvexPolygonWithLine(poly, this.paper.creaseP0, this.paper.creaseP1, false);
      const movingPoly = movingSide === "positive" ? posPoly : negPoly;
      if (!movingPoly || movingPoly.length < 3) continue;

      for (const p of movingPoly) {
        local.set(p.x, p.y, 0).applyMatrix4(foldMatrix);
        world.copy(local);
        this.paperGroup.localToWorld(world);
        sumDistance += world.distanceTo(this.camera.position);
        count += 1;
      }
    }

    if (count === 0) return Infinity;
    return sumDistance / count;
  }

  commitCurrentFoldToLayers() {
    if (!this.paper.hasUserCrease) return;
    const targetLayerIds = this.getActiveTargetLayerIds();
    if (targetLayerIds.length === 0) return;
    const targetLayerId = targetLayerIds[0];

    const opId = this.foldOps.length + 1;
    this.foldOps.push({
      opId,
      creaseP0: this.paper.creaseP0.clone(),
      creaseP1: this.paper.creaseP1.clone(),
      movingSide: this.paper.movingSide,
      targetLayerId,
      targetLayerIds: targetLayerIds.slice(),
      foldStrength: 1,
      timestamp: Date.now(),
    });
    this.rebuildLayersFromOps();

    this.publishFoldCommitted(targetLayerId, targetLayerIds);
    this.paper.hasUserCrease = false;
    this.paper.foldAngleDeg = 0;
    this.paper.foldTargetAngleDeg = 0;
    this.paper.activeTargetLayerId = null;
    this.paper.activeTargetLayerIds = null;
    this.interaction.selectedLayerId = null;
    this.interaction.selectedLayerIds = null;
    this.interaction.selectedSide = null;
  }

  publishFoldCommitted(
    lastTargetLayerId = this.paper.activeTargetLayerId ?? null,
    lastTargetLayerIds = this.paper.activeTargetLayerIds ?? null
  ) {
    const layerAreas = this.layers.map((layer) => polygonAreaAbs(layer.poly));
    const totalArea = layerAreas.reduce((sum, area) => sum + area, 0);
    const silhouette = computeLayerSilhouette(this.layers.map((layer) => layer.poly));

    this.bus.publish(MSG.PAPER_FOLD_COMMITTED, {
      layerCount: this.layers.length,
      layerAreas,
      totalArea,
      layers: this.layers.map((layer) => layer.poly.map((p) => ({ x: p.x, y: p.y }))),
      silhouette,
      movingSide: this.paper.movingSide,
      lastTargetLayerId,
      lastTargetLayerIds,
      foldOpsCount: this.foldOps.length,
      foldOps: this.foldOps.map((op) => ({
        opId: op.opId,
        creaseP0: { x: op.creaseP0.x, y: op.creaseP0.y },
        creaseP1: { x: op.creaseP1.x, y: op.creaseP1.y },
        movingSide: op.movingSide,
        targetLayerId: op.targetLayerId,
        targetLayerIds: op.targetLayerIds ?? (op.targetLayerId ? [op.targetLayerId] : []),
        foldStrength: op.foldStrength,
      })),
      lastCrease: {
        p0: { x: this.paper.creaseP0.x, y: this.paper.creaseP0.y },
        p1: { x: this.paper.creaseP1.x, y: this.paper.creaseP1.y },
      },
    });
  }

  rebuildLayersFromOps() {
    let rebuilt = [{ id: this.baseLayerId, poly: this.basePolygon.map((p) => p.clone()) }];
    for (const op of this.foldOps) {
      rebuilt = this.applyFoldOpToLayers(rebuilt, op);
    }
    this.layers = rebuilt.filter(
      (layer) => layer.poly.length >= 3 && polygonAreaAbs(layer.poly) > 1e-6
    );
    if (this.layers.length === 0) {
      this.layers = [{ id: this.baseLayerId, poly: this.basePolygon.map((p) => p.clone()) }];
    }
  }

  applyFoldOpToLayers(inputLayers, op) {
    const output = [];
    const strength = THREE.MathUtils.clamp(op.foldStrength ?? 1, 0, 1);
    const targetIds =
      Array.isArray(op.targetLayerIds) && op.targetLayerIds.length > 0
        ? new Set(op.targetLayerIds)
        : new Set(op.targetLayerId ? [op.targetLayerId] : []);
    for (const layer of inputLayers) {
      const poly = layer.poly;
      if (!targetIds.has(layer.id)) {
        output.push({
          id: layer.id,
          poly: poly.map((p) => p.clone()),
        });
        continue;
      }

      const pos = clipConvexPolygonWithLine(poly, op.creaseP0, op.creaseP1, true);
      const neg = clipConvexPolygonWithLine(poly, op.creaseP0, op.creaseP1, false);
      const moving = op.movingSide === "positive" ? pos : neg;
      const fixed = op.movingSide === "positive" ? neg : pos;
      const fixedId = `${layer.id}|${op.opId}|fixed`;
      const movingId = `${layer.id}|${op.opId}|moving`;

      if (fixed.length >= 3) {
        output.push({
          id: fixedId,
          poly: fixed.map((p) => p.clone()),
        });
      }
      if (moving.length >= 3) {
        const folded = moving.map((p) => {
          const reflected = reflectPointAcrossLine(p, op.creaseP0, op.creaseP1);
          return new THREE.Vector2(
            THREE.MathUtils.lerp(p.x, reflected.x, strength),
            THREE.MathUtils.lerp(p.y, reflected.y, strength)
          );
        });
        output.push({
          id: movingId,
          poly: folded,
        });
      }
    }
    return output;
  }

  applyWingSpreadShaping() {
    if (this.foldOps.length === 0) {
      this.bus.publish(MSG.UI_SET_HINT, { text: "아직 펼칠 날개 형태가 없습니다." });
      return;
    }

    if (this.paper.hasUserCrease) {
      if (Math.abs(this.paper.foldTargetAngleDeg) > 1) this.commitCurrentFoldToLayers();
      else {
        this.paper.hasUserCrease = false;
        this.paper.foldAngleDeg = 0;
        this.paper.foldTargetAngleDeg = 0;
        this.paper.activeTargetLayerId = null;
        this.paper.activeTargetLayerIds = null;
        this.interaction.selectedLayerId = null;
        this.interaction.selectedLayerIds = null;
        this.interaction.selectedSide = null;
      }
    }

    const targetStrength = 0.78;
    const selected = this.pickWingFoldOpIndices();
    if (selected.length === 0) {
      this.bus.publish(MSG.UI_SET_HINT, { text: "날개 후보를 찾지 못해 최근 접기를 완만하게 펼칩니다." });
      const idx = this.foldOps.length - 1;
      this.foldOps[idx].foldStrength = Math.min(this.foldOps[idx].foldStrength, 0.84);
    } else {
      for (const idx of selected) {
        this.foldOps[idx].foldStrength = Math.min(this.foldOps[idx].foldStrength, targetStrength);
      }
    }

    this.rebuildLayersFromOps();
    this.createPaperMeshes();
    this.publishFoldCommitted();
  }

  pickWingFoldOpIndices() {
    if (this.foldOps.length < 2) return [];
    const width = this.paper.width;
    for (let i = this.foldOps.length - 1; i >= 1; i -= 1) {
      const a = this.foldOps[i];
      const b = this.foldOps[i - 1];
      if (a.movingSide === b.movingSide) continue;

      const aDir = new THREE.Vector2().subVectors(a.creaseP1, a.creaseP0).normalize();
      const bDir = new THREE.Vector2().subVectors(b.creaseP1, b.creaseP0).normalize();
      const parallel = Math.abs(aDir.dot(bDir));
      if (parallel < 0.9) continue;

      const aMidX = (a.creaseP0.x + a.creaseP1.x) * 0.5;
      const bMidX = (b.creaseP0.x + b.creaseP1.x) * 0.5;
      const mirrored = Math.abs(aMidX + bMidX) <= width * 0.18;
      const enoughOffset =
        Math.abs(aMidX) > width * 0.08 || Math.abs(bMidX) > width * 0.08;
      if (mirrored && enoughOffset) return [i - 1, i];
    }
    return [];
  }

  getPaperGroup() {
    return this.paperGroup;
  }

  getActiveTargetLayerIds() {
    const fromPaper = this.paper.activeTargetLayerIds;
    if (Array.isArray(fromPaper) && fromPaper.length > 0) return fromPaper.slice();
    const fromInteraction = this.interaction.selectedLayerIds;
    if (Array.isArray(fromInteraction) && fromInteraction.length > 0) {
      return fromInteraction.slice();
    }
    const single =
      this.paper.activeTargetLayerId ?? this.interaction.selectedLayerId ?? null;
    return single ? [single] : [];
  }

  isInsideAnyLayer(point) {
    for (const layer of this.layers) {
      if (isPointInConvexPolygon(point, layer.poly)) return true;
    }
    return false;
  }

  computeFoldScreenBasis(grabLocalPoint) {
    const p0 = this.localPointToScreen(this.paper.creaseP0);
    const p1 = this.localPointToScreen(this.paper.creaseP1);
    const grab = this.localPointToScreen(grabLocalPoint);
    const mid = {
      x: (p0.x + p1.x) * 0.5,
      y: (p0.y + p1.y) * 0.5,
    };

    const dirX = p1.x - p0.x;
    const dirY = p1.y - p0.y;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen < 1e-5) {
      return { normalX: 1, normalY: 0, pxToLocal: 0.01 };
    }

    let normalX = -dirY / dirLen;
    let normalY = dirX / dirLen;

    const towardX = mid.x - grab.x;
    const towardY = mid.y - grab.y;
    const towardDot = towardX * normalX + towardY * normalY;
    if (towardDot < 0) {
      normalX *= -1;
      normalY *= -1;
    }

    const creaseLocalLen = this.paper.creaseP0.distanceTo(this.paper.creaseP1);
    const pxToLocal = THREE.MathUtils.clamp(
      creaseLocalLen / Math.max(dirLen, 1),
      0.002,
      0.03
    );

    return { normalX, normalY, pxToLocal };
  }

  localPointToScreen(localPoint2) {
    const world = this.paperGroup.localToWorld(
      new THREE.Vector3(localPoint2.x, localPoint2.y, 0)
    );
    const ndc = world.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
    };
  }

  updateGuideVisibility() {
    const folded = Math.abs(this.paper.foldAngleDeg) > 1.0;
    const showGuides = this.interaction.mode === "draw" && !folded;
    const showCrease = this.paper.hasUserCrease && !folded;

    if (this.guideVerticalLine) this.guideVerticalLine.visible = showGuides;
    if (this.guideHorizontalLine) this.guideHorizontalLine.visible = showGuides;
    if (this.creaseLine) this.creaseLine.visible = showCrease;
  }

  updateGuideGlow() {
    this.guidePulseTime += 0.035;
    const pulse = 0.5 + 0.5 * Math.sin(this.guidePulseTime);

    // 강하지 않은 저강도 펄스: 흐릿->살짝 진함
    const guideOpacity = 0.22 + pulse * 0.18;
    const creaseOpacity = 0.2 + pulse * 0.16;
    if (this.guideVerticalLine?.material) {
      this.guideVerticalLine.material.opacity = guideOpacity;
      this.guideVerticalLine.material.color.setRGB(
        0.58 + pulse * 0.08,
        0.72 + pulse * 0.08,
        1.0
      );
    }
    if (this.guideHorizontalLine?.material) {
      this.guideHorizontalLine.material.opacity = guideOpacity;
      this.guideHorizontalLine.material.color.setRGB(
        0.58 + pulse * 0.08,
        0.72 + pulse * 0.08,
        1.0
      );
    }
    if (this.creaseLine?.material) {
      this.creaseLine.material.opacity = creaseOpacity;
      this.creaseLine.material.color.setRGB(
        0.56 + pulse * 0.08,
        0.7 + pulse * 0.08,
        1.0
      );
    }
  }

  tryAutoSettleFold() {
    const absAngle = Math.abs(this.paper.foldTargetAngleDeg);
    if (absAngle < this.foldLimits.snapStartAngle) return;

    const sign =
      Math.sign(this.paper.foldTargetAngleDeg) ||
      this.interaction.foldAllowedSign ||
      1;
    this.paper.foldTargetAngleDeg = sign * this.foldLimits.snapTargetAngle;
    this.interaction.autoSettling = true;
  }

  destroy() {
    this.unsubscribers.forEach((unsub) => unsub());
    this.clearDrawPreview();
    this.disposePaperMeshes();
  }
}

function makeBoundaryEdgeFromPolygons(
  polygons,
  { zOffset = 0.001, hideOnCreaseLine = null, transformMatrix = null } = {}
) {
  const segments = collectBoundarySegments(polygons, hideOnCreaseLine);
  if (segments.length === 0) return null;

  const positions = [];
  for (const seg of segments) {
    positions.push(seg.a.x, seg.a.y, 0, seg.b.x, seg.b.y, 0);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const edge = new THREE.LineSegments(
    geom,
    new THREE.LineBasicMaterial({ color: 0x6e7482, transparent: true, opacity: 0.8 })
  );

  if (transformMatrix) {
    edge.matrixAutoUpdate = false;
    const zMat = new THREE.Matrix4().makeTranslation(0, 0, zOffset);
    edge.matrix.copy(new THREE.Matrix4().multiplyMatrices(zMat, transformMatrix));
    edge.matrixWorldNeedsUpdate = true;
  } else {
    edge.position.z = zOffset;
  }

  return edge;
}

function collectBoundarySegments(polygons, hideOnCreaseLine = null) {
  const map = new Map();

  for (const poly of polygons) {
    if (!poly || poly.length < 2) continue;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b || a.distanceToSquared(b) < 1e-12) continue;

      if (
        hideOnCreaseLine &&
        isSegmentOnLine(a, b, hideOnCreaseLine.p0, hideOnCreaseLine.p1, hideOnCreaseLine.epsilon)
      ) {
        continue;
      }

      const key = makeUndirectedSegmentKey(a, b);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          count: 1,
          a: new THREE.Vector2(a.x, a.y),
          b: new THREE.Vector2(b.x, b.y),
        });
      } else {
        prev.count += 1;
      }
    }
  }

  const out = [];
  for (const value of map.values()) {
    if (value.count === 1) {
      out.push({ a: value.a, b: value.b });
    }
  }
  return out;
}

function isSegmentOnLine(a, b, p0, p1, epsilon = 1e-4) {
  if (!p0 || !p1) return false;
  return (
    distancePointToLine(a, p0, p1) <= epsilon &&
    distancePointToLine(b, p0, p1) <= epsilon
  );
}

function makeUndirectedSegmentKey(a, b) {
  const ax = quantizeCoord(a.x);
  const ay = quantizeCoord(a.y);
  const bx = quantizeCoord(b.x);
  const by = quantizeCoord(b.y);
  if (ax < bx || (ax === bx && ay <= by)) {
    return `${ax},${ay}|${bx},${by}`;
  }
  return `${bx},${by}|${ax},${ay}`;
}

function polygonEdgeKeySet(poly) {
  const set = new Set();
  if (!poly || poly.length < 2) return set;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b || a.distanceToSquared(b) < 1e-12) continue;
    set.add(makeUndirectedSegmentKey(a, b));
  }
  return set;
}

function polygonsShareAnyBoundaryEdge(polyA, polyB) {
  if (!polyA || !polyB || polyA.length < 2 || polyB.length < 2) return false;
  const aKeys = polygonEdgeKeySet(polyA);
  if (aKeys.size === 0) return false;
  const bKeys = polygonEdgeKeySet(polyB);
  for (const key of bKeys) {
    if (aKeys.has(key)) return true;
  }
  return false;
}

function shouldPropagatePacketAcrossLayers(polyA, polyB) {
  // 단순 인접(한 변만 맞닿음)까지 묶지 않고, 실제로 겹쳐진 스택만 함께 접습니다.
  if (!polygonsShareAnyBoundaryEdge(polyA, polyB)) return false;
  const overlapRatio = estimateAabbOverlapRatio(polyA, polyB);
  return overlapRatio >= 0.42;
}

function estimateAabbOverlapRatio(polyA, polyB) {
  const areaA = polygonAreaAbs(polyA);
  const areaB = polygonAreaAbs(polyB);
  const minArea = Math.min(areaA, areaB);
  if (minArea <= 1e-8) return 0;

  const a = computePolyAabb(polyA);
  const b = computePolyAabb(polyB);
  const interMinX = Math.max(a.minX, b.minX);
  const interMinY = Math.max(a.minY, b.minY);
  const interMaxX = Math.min(a.maxX, b.maxX);
  const interMaxY = Math.min(a.maxY, b.maxY);
  const w = interMaxX - interMinX;
  const h = interMaxY - interMinY;
  if (w <= 1e-8 || h <= 1e-8) return 0;

  const interArea = w * h;
  return interArea / minArea;
}

function computePolyAabb(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function quantizeCoord(v) {
  return Math.round(v * 100000);
}

function pointToInfiniteLineDistance(point, linePoint, lineDir) {
  const rel = new THREE.Vector2().subVectors(point, linePoint);
  const cross = rel.x * lineDir.y - rel.y * lineDir.x;
  return Math.abs(cross) / Math.max(lineDir.length(), 1e-6);
}

function intersectInfiniteLineWithSegment(linePoint, lineDir, segA, segB) {
  const s = new THREE.Vector2().subVectors(segB, segA);
  const denom = cross2(lineDir, s);
  if (Math.abs(denom) < 1e-8) return null;

  const ap = new THREE.Vector2().subVectors(segA, linePoint);
  const t = cross2(ap, s) / denom;
  const u = cross2(ap, lineDir) / denom;
  if (u < -1e-6 || u > 1 + 1e-6) return null;

  return new THREE.Vector2(
    linePoint.x + lineDir.x * t,
    linePoint.y + lineDir.y * t
  );
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function isPointInConvexPolygon(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let hasPos = false;
  let hasNeg = false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = cross2(
      new THREE.Vector2(b.x - a.x, b.y - a.y),
      new THREE.Vector2(point.x - a.x, point.y - a.y)
    );
    if (cross > 1e-7) hasPos = true;
    else if (cross < -1e-7) hasNeg = true;
    if (hasPos && hasNeg) return false;
  }
  return true;
}

function reflectPointAcrossLine(point, lineA, lineB) {
  const line = new THREE.Vector2().subVectors(lineB, lineA);
  const lenSq = Math.max(line.lengthSq(), 1e-8);
  const ap = new THREE.Vector2().subVectors(point, lineA);
  const t = ap.dot(line) / lenSq;
  const proj = new THREE.Vector2(lineA.x + line.x * t, lineA.y + line.y * t);
  return new THREE.Vector2(2 * proj.x - point.x, 2 * proj.y - point.y);
}

function polygonAreaAbs(poly) {
  if (!poly || poly.length < 3) return 0;
  let area2 = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) * 0.5;
}

function computeLayerSilhouette(layers) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const poly of layers) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!Number.isFinite(minX)) {
    return { width: 0, height: 0 };
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
  };
}

function createOrigamiMaps() {
  const size = 512;

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");

  const grad = cctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#ffb4da");
  grad.addColorStop(0.5, "#f889c1");
  grad.addColorStop(1, "#ef71b3");
  cctx.fillStyle = grad;
  cctx.fillRect(0, 0, size, size);

  // 과한 줄무늬 대신, 저대비의 미세 입자 위주로 색종이 결을 만듭니다.
  for (let i = 0; i < 5200; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = 0.008 + Math.random() * 0.018;
    cctx.fillStyle = `rgba(255,255,255,${a})`;
    cctx.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 4200; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = 0.006 + Math.random() * 0.016;
    cctx.fillStyle = `rgba(35,18,35,${a})`;
    cctx.fillRect(x, y, 1, 1);
  }

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext("2d");
  rctx.fillStyle = "rgb(188,188,188)";
  rctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2800; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 176 + Math.floor(Math.random() * 36);
    rctx.fillStyle = `rgb(${v},${v},${v})`;
    rctx.fillRect(x, y, 1, 1);
  }

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");
  bctx.fillStyle = "rgb(127,127,127)";
  bctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const v = 118 + Math.floor(Math.random() * 20);
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(x, y, 1, 1);
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  [colorMap, roughnessMap, bumpMap].forEach((map) => {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1, 1);
  });

  return { colorMap, roughnessMap, bumpMap };
}
