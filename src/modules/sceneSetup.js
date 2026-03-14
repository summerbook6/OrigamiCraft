import { THREE } from "../lib/three.js";

export class SceneSystem {
  constructor({ canvas }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x121722);
    this.scene.fog = new THREE.Fog(0x111722, 8, 20);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );

    this.scene.add(new THREE.HemisphereLight(0xbfd2ff, 0x2a2230, 0.56));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    this.keyLight = new THREE.DirectionalLight(0xfff7ef, 1.1);
    this.keyLight.position.set(4.2, -3.8, 6.3);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 24;
    this.keyLight.shadow.bias = -0.00035;
    this.keyLight.shadow.normalBias = 0.012;
    this.keyLight.shadow.camera.left = -6;
    this.keyLight.shadow.camera.right = 6;
    this.keyLight.shadow.camera.top = 6;
    this.keyLight.shadow.camera.bottom = -6;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x92b6ff, 0.34);
    this.fillLight.position.set(-4.8, 5.6, 3.0);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0xff9ad0, 0.23);
    this.rimLight.position.set(-2.1, -7.2, 4.8);
    this.scene.add(this.rimLight);

    const deskMaps = createDeskMaps();

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0xb48a63,
        map: deskMaps.colorMap,
        normalMap: deskMaps.normalMap,
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.9,
        metalness: 0.01,
      })
    );
    this.ground.receiveShadow = true;
    this.ground.position.z = -0.025;
    this.scene.add(this.ground);

    this.ambientGroup = new THREE.Group();
    this.scene.add(this.ambientGroup);
    this.setupDustParticles();

    this._time = 0;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  tick(dtSec = 1 / 60) {
    this._time += dtSec;

    const sway = Math.sin(this._time * 0.45) * 0.28;
    this.keyLight.position.x = 4.2 + sway;
    this.keyLight.position.y = -3.8 + Math.cos(this._time * 0.31) * 0.18;
    this.fillLight.position.z = 3.0 + Math.sin(this._time * 0.52) * 0.15;
    this.ambientGroup.rotation.z += dtSec * 0.03;
  }

  setupDustParticles() {
    const count = 240;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      pos[i * 3] = (Math.random() - 0.5) * 8.4;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8.4;
      pos[i * 3 + 2] = 0.25 + Math.random() * 1.8;
      seed[i] = Math.random() * Math.PI * 2;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

    const material = new THREE.PointsMaterial({
      color: 0xf6efe7,
      size: 0.02,
      transparent: true,
      opacity: 0.23,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geom, material);
    points.position.z = 0.03;
    this.ambientGroup.add(points);
  }
}

function createDeskMaps() {
  const size = 512;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");

  const grad = cctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#c99b73");
  grad.addColorStop(0.5, "#af7f59");
  grad.addColorStop(1, "#956a4b");
  cctx.fillStyle = grad;
  cctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 6) {
    const alpha = 0.025 + Math.random() * 0.04;
    cctx.fillStyle = `rgba(70,38,20,${alpha})`;
    cctx.fillRect(0, y, size, 2 + Math.random() * 2);
  }
  for (let i = 0; i < 2200; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = 0.02 + Math.random() * 0.035;
    cctx.fillStyle = `rgba(255,255,255,${a})`;
    cctx.fillRect(x, y, 1, 1);
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.repeat.set(3, 3);
  colorMap.colorSpace = THREE.SRGBColorSpace;

  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nctx = normalCanvas.getContext("2d");
  nctx.fillStyle = "rgb(128,128,255)";
  nctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 7) {
    const n = 118 + Math.floor(Math.random() * 18);
    nctx.fillStyle = `rgb(${n},${n},255)`;
    nctx.fillRect(0, y, size, 1);
  }

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(3, 3);

  return { colorMap, normalMap };
}
