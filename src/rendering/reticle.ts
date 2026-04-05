import * as THREE from "three";

export class SurfaceReticle {
  readonly mesh: THREE.Sprite;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context is unavailable.");
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#eef5ff";
    ctx.beginPath();
    ctx.arc(32, 32, 10, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    this.mesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 11;
    this.mesh.scale.set(0.018, 0.018, 1);
  }

  update(position: THREE.Vector3): void {
    this.mesh.position.copy(position);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
