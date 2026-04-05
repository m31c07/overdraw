import * as THREE from "three";

export interface PlanePose {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

export class ArtworkPlane {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly group: THREE.Group;
  readonly textureLoader = new THREE.TextureLoader();
  private readonly size = new THREE.Vector2(0.5, 0.5);

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 10;

    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.add(this.mesh);
    this.applySize(0.5);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get quaternion(): THREE.Quaternion {
    return this.group.quaternion;
  }

  get normal(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).normalize();
  }

  get width(): number {
    return this.size.x;
  }

  get height(): number {
    return this.size.y;
  }

  applyPose(pose: PlanePose): void {
    this.group.position.copy(pose.position);
    this.group.quaternion.copy(makeQuaternionFromNormal(pose.normal));
    this.group.visible = true;
  }

  applyPoseWithQuaternion(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    this.group.visible = true;
  }

  applySize(maxSideMeters: number): void {
    const aspect = this.size.x / this.size.y;
    if (aspect >= 1) {
      this.mesh.scale.set(maxSideMeters, maxSideMeters / aspect, 1);
    } else {
      this.mesh.scale.set(maxSideMeters * aspect, maxSideMeters, 1);
    }
  }

  multiplyScale(factor: number): void {
    const nextX = THREE.MathUtils.clamp(this.mesh.scale.x * factor, 0.05, 2.5);
    const nextY = THREE.MathUtils.clamp(this.mesh.scale.y * factor, 0.05, 2.5);
    this.mesh.scale.set(nextX, nextY, 1);
  }

  rotateOnSurface(radians: number): void {
    const axis = new THREE.Vector3(0, 0, 1);
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, radians);
    this.mesh.quaternion.multiply(rotation);
  }

  setOpacity(opacity: number): void {
    this.mesh.material.opacity = THREE.MathUtils.clamp(opacity, 0.05, 1);
  }

  async loadImage(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const texture = await this.textureLoader.loadAsync(objectUrl);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.mesh.material.map = texture;
      this.mesh.material.needsUpdate = true;
      const image = texture.image as { width?: number; height?: number };
      const width = image.width ?? 1;
      const height = image.height ?? 1;
      this.size.set(width, height);
      this.applySize(Math.max(this.mesh.scale.x, this.mesh.scale.y));
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  reset(): void {
    this.group.visible = false;
    this.group.position.setScalar(0);
    this.group.quaternion.identity();
    this.mesh.quaternion.identity();
    this.mesh.scale.set(0.5, 0.5, 1);
  }
}

export function makeQuaternionFromNormal(normalInput: THREE.Vector3): THREE.Quaternion {
  const normal = normalInput.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let upProjected = worldUp.clone().sub(normal.clone().multiplyScalar(worldUp.dot(normal)));

  if (upProjected.lengthSq() < 1e-6) {
    upProjected = new THREE.Vector3(1, 0, 0).sub(
      normal.clone().multiplyScalar(normal.x)
    );
  }

  upProjected.normalize();
  const right = new THREE.Vector3().crossVectors(upProjected, normal).normalize();
  const basisUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  const matrix = new THREE.Matrix4().makeBasis(right, basisUp, normal);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}
