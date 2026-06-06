// three.js viewport: scene, camera, lights, orbit controls
// the model is in mm with z up; the whole group is rotated for three (y up)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface Viewport {
  /** Group for the mesh + dimensions (mm, z up); cleared on rebuild */
  modelGroup: THREE.Group;
  material: THREE.Material;
  fitCamera(): void;
}

export function createViewport(container: HTMLElement): Viewport {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1b26);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(80, 60, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xc0caf5, 0x24283b, 1.1));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(60, 100, 40);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(200, 20, 0x3b4261, 0x2a2e44));

  const modelGroup = new THREE.Group();
  modelGroup.rotation.x = -Math.PI / 2;
  scene.add(modelGroup);

  function resize(): void {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function fitCamera(): void {
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    camera.position.set(center.x + size * 0.75, center.y + size * 0.65, center.z + size * 0.75);
    controls.target.copy(center);
  }

  const material = new THREE.MeshStandardMaterial({ color: 0x7aa2f7, roughness: 0.45, metalness: 0.05 });

  return { modelGroup, material, fitCamera };
}
