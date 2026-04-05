import * as THREE from "three";
import { nanoid } from "./objectIds";

const DEFAULT_MAX_SIDE = 0.42;
const MIN_SIDE = 0.05;
const MAX_SIDE = 2.5;
const DEFAULT_OPACITY = 0.68;

const HANDLE_NAMES = {
  body: "body",
  edgeXPos: "edge-x-pos",
  edgeXNeg: "edge-x-neg",
  edgeYPos: "edge-y-pos",
  edgeYNeg: "edge-y-neg",
  cornerPP: "corner-pp",
  cornerPN: "corner-pn",
  cornerNP: "corner-np",
  cornerNN: "corner-nn",
  twistPP: "twist-pp",
  twistPN: "twist-pn",
  twistNP: "twist-np",
  twistNN: "twist-nn"
} as const;

export type HandleName = (typeof HANDLE_NAMES)[keyof typeof HANDLE_NAMES];

export interface HandleIntersection {
  object: ArtworkObject;
  handle: HandleName;
  point: THREE.Vector3;
}

export interface CreateArtworkOptions {
  position?: THREE.Vector3;
  quaternion?: THREE.Quaternion;
  texture?: THREE.Texture | null;
}

function createHandleMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function disposeTexture(texture: THREE.Texture | null): void {
  if (!texture || !texture.userData.generatedByApp) {
    return;
  }

  texture.dispose();
}

export class ArtworkObject {
  readonly id = nanoid();
  readonly root = new THREE.Group();
  readonly content = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly selectionRoot = new THREE.Group();
  readonly raycastTargets: THREE.Object3D[] = [];

  locked = false;
  selected = false;
  private texture: THREE.Texture | null = null;
  private readonly size = new THREE.Vector2(1, 1);
  private readonly boxLine: THREE.LineSegments;
  private readonly handles = new Map<HandleName, THREE.Object3D>();

  constructor(options: CreateArtworkOptions = {}) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: DEFAULT_OPACITY,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.name = HANDLE_NAMES.body;
    this.mesh.renderOrder = 10;

    this.content.add(this.mesh);
    this.root.add(this.content);
    this.root.add(this.selectionRoot);

    const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));
    this.boxLine = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false
      })
    );
    this.boxLine.renderOrder = 30;
    this.selectionRoot.add(this.boxLine);

    this.createHandles();
    this.applyPosition(options.position ?? new THREE.Vector3(0, 1.35, -1));
    this.root.quaternion.copy(options.quaternion ?? new THREE.Quaternion());

    if (options.texture) {
      this.setTexture(options.texture);
    } else {
      this.applyPlaceholderLook();
    }

    this.applySize(DEFAULT_MAX_SIDE);
    this.setEditingState(false, false);
  }

  private createHandles(): void {
    const edgeGeometry = new THREE.BoxGeometry(0.18, 0.05, 0.005);
    const edgeVerticalGeometry = new THREE.BoxGeometry(0.05, 0.18, 0.005);
    const cornerGeometry = new THREE.BoxGeometry(0.08, 0.08, 0.005);

    const add = (name: HandleName, object: THREE.Object3D, raycastObjects: THREE.Object3D[] = [object]) => {
      object.name = name;
      object.renderOrder = 31;
      this.selectionRoot.add(object);
      this.handles.set(name, object);
      this.raycastTargets.push(...raycastObjects);
    };

    this.raycastTargets.push(this.mesh);
    add(HANDLE_NAMES.edgeXPos, new THREE.Mesh(edgeVerticalGeometry, createHandleMaterial(0xf66b6b)));
    add(HANDLE_NAMES.edgeXNeg, new THREE.Mesh(edgeVerticalGeometry, createHandleMaterial(0xf66b6b)));
    add(HANDLE_NAMES.edgeYPos, new THREE.Mesh(edgeGeometry, createHandleMaterial(0x65db7c)));
    add(HANDLE_NAMES.edgeYNeg, new THREE.Mesh(edgeGeometry, createHandleMaterial(0x65db7c)));
    add(HANDLE_NAMES.cornerPP, new THREE.Mesh(cornerGeometry, createHandleMaterial(0xffb36b)));
    add(HANDLE_NAMES.cornerPN, new THREE.Mesh(cornerGeometry, createHandleMaterial(0xffb36b)));
    add(HANDLE_NAMES.cornerNP, new THREE.Mesh(cornerGeometry, createHandleMaterial(0xffb36b)));
    add(HANDLE_NAMES.cornerNN, new THREE.Mesh(cornerGeometry, createHandleMaterial(0xffb36b)));
    add(HANDLE_NAMES.twistPP, ...this.createTriangleHandle(HANDLE_NAMES.twistPP, 0x6ab7ff, 0));
    add(HANDLE_NAMES.twistPN, ...this.createTriangleHandle(HANDLE_NAMES.twistPN, 0x6ab7ff, Math.PI * 0.5));
    add(HANDLE_NAMES.twistNP, ...this.createTriangleHandle(HANDLE_NAMES.twistNP, 0x6ab7ff, -Math.PI * 0.5));
    add(HANDLE_NAMES.twistNN, ...this.createTriangleHandle(HANDLE_NAMES.twistNN, 0x6ab7ff, Math.PI));

    this.layoutHandles();
  }

  private createTriangleHandle(
    name: HandleName,
    color: number,
    rotationZ: number
  ): [THREE.Group, THREE.Object3D[]] {
    const group = new THREE.Group();
    const triangle = new THREE.Mesh(
      new THREE.BufferGeometry(),
      createHandleMaterial(color)
    );
    const vertices = new Float32Array([
      -0.024, -0.018, 0.003,
      0.024, -0.018, 0.003,
      0, 0.024, 0.003
    ]);
    triangle.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    triangle.geometry.computeVertexNormals();
    triangle.name = name;
    triangle.userData.handleName = name;
    group.rotation.z = rotationZ;
    group.add(triangle);
    return [group, [triangle]];
  }

  private layoutHandles(): void {
    const halfX = this.content.scale.x * 0.5;
    const halfY = this.content.scale.y * 0.5;
    const handleZ = 0.002;
    const innerOffsetX = Math.min(halfX * 0.45, 0.11);
    const innerOffsetY = Math.min(halfY * 0.45, 0.11);

    this.boxLine.scale.set(this.content.scale.x, this.content.scale.y, 1);
    this.selectionRoot.quaternion.copy(this.content.quaternion);

    this.handles.get(HANDLE_NAMES.edgeXPos)?.position.set(halfX, 0, handleZ);
    this.handles.get(HANDLE_NAMES.edgeXNeg)?.position.set(-halfX, 0, handleZ);
    this.handles.get(HANDLE_NAMES.edgeYPos)?.position.set(0, halfY, handleZ);
    this.handles.get(HANDLE_NAMES.edgeYNeg)?.position.set(0, -halfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerPP)?.position.set(halfX, halfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerPN)?.position.set(halfX, -halfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerNP)?.position.set(-halfX, halfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerNN)?.position.set(-halfX, -halfY, handleZ);
    this.handles.get(HANDLE_NAMES.twistPP)?.position.set(halfX - innerOffsetX, halfY - innerOffsetY, handleZ);
    this.handles.get(HANDLE_NAMES.twistPN)?.position.set(halfX - innerOffsetX, -halfY + innerOffsetY, handleZ);
    this.handles.get(HANDLE_NAMES.twistNP)?.position.set(-halfX + innerOffsetX, halfY - innerOffsetY, handleZ);
    this.handles.get(HANDLE_NAMES.twistNN)?.position.set(-halfX + innerOffsetX, -halfY + innerOffsetY, handleZ);
  }

  private applyPlaceholderLook(): void {
    this.mesh.material.map = null;
    this.mesh.material.color.set(0xf3f3f3);
    this.mesh.material.opacity = DEFAULT_OPACITY;
    this.mesh.material.needsUpdate = true;
  }

  applyPosition(position: THREE.Vector3): void {
    this.root.position.copy(position);
    this.root.visible = true;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get quaternion(): THREE.Quaternion {
    return this.root.quaternion;
  }

  get contentQuaternion(): THREE.Quaternion {
    return this.content.quaternion;
  }

  get normal(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, 1)
      .applyQuaternion(this.mesh.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
  }

  get width(): number {
    return this.content.scale.x;
  }

  get height(): number {
    return this.content.scale.y;
  }

  setTexture(texture: THREE.Texture): void {
    disposeTexture(this.texture);
    this.texture = texture;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
    this.texture.userData.generatedByApp = true;

    this.mesh.material.map = this.texture;
    this.mesh.material.color.set(0xffffff);
    this.mesh.material.needsUpdate = true;

    const image = texture.image as { width?: number; height?: number } | undefined;
    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    this.size.set(width, height);
    this.applySize(Math.max(this.width, this.height, DEFAULT_MAX_SIDE));
  }

  applySize(maxSideMeters: number): void {
    const aspect = this.size.x / Math.max(this.size.y, 1e-6);
    const clamped = THREE.MathUtils.clamp(maxSideMeters, MIN_SIDE, MAX_SIDE);

    if (aspect >= 1) {
      this.content.scale.set(clamped, clamped / aspect, 1);
    } else {
      this.content.scale.set(clamped * aspect, clamped, 1);
    }

    this.layoutHandles();
  }

  scaleLocal(deltaWidth: number, deltaHeight: number): void {
    const nextWidth = THREE.MathUtils.clamp(this.width + deltaWidth, MIN_SIDE, MAX_SIDE);
    const nextHeight = THREE.MathUtils.clamp(this.height + deltaHeight, MIN_SIDE, MAX_SIDE);
    this.content.scale.set(nextWidth, nextHeight, 1);
    this.layoutHandles();
  }

  scaleUniform(factor: number): void {
    const nextWidth = THREE.MathUtils.clamp(this.width * factor, MIN_SIDE, MAX_SIDE);
    const nextHeight = THREE.MathUtils.clamp(this.height * factor, MIN_SIDE, MAX_SIDE);
    this.content.scale.set(nextWidth, nextHeight, 1);
    this.layoutHandles();
  }

  setLocalSize(width: number, height: number): void {
    this.content.scale.set(
      THREE.MathUtils.clamp(width, MIN_SIDE, MAX_SIDE),
      THREE.MathUtils.clamp(height, MIN_SIDE, MAX_SIDE),
      1
    );
    this.layoutHandles();
  }

  rotateOnSurface(radians: number): void {
    const axis = new THREE.Vector3(0, 0, 1);
    this.content.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, radians));
    this.layoutHandles();
  }

  setContentQuaternion(quaternion: THREE.Quaternion): void {
    this.content.quaternion.copy(quaternion);
    this.layoutHandles();
  }

  setDisplayOpacity(opacity: number): void {
    this.mesh.material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
  }

  setEditingState(editing: boolean, selected: boolean): void {
    this.selected = selected;
    this.selectionRoot.visible = editing && selected;
    if (!editing || !selected) {
      this.setHoveredHandle(null);
    }
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  setHoveredHandle(handle: HandleName | null): void {
    for (const [name, object] of this.handles) {
      const scale = name === handle ? 1.1 : 1;
      object.scale.setScalar(scale);
    }
  }

  matchesTarget(target: THREE.Object3D): HandleName | null {
    if (target === this.mesh) {
      return HANDLE_NAMES.body;
    }

    const targetHandle = target.userData.handleName as HandleName | undefined;
    if (targetHandle) {
      return targetHandle;
    }

    for (const [name, object] of this.handles) {
      if (target === object) {
        return name;
      }
    }

    return null;
  }

  dispose(): void {
    disposeTexture(this.texture);
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.boxLine.geometry.dispose();
    (this.boxLine.material as THREE.Material).dispose();

    for (const object of this.handles.values()) {
      const mesh = object as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}

export class ArtworkStore {
  private readonly scene: THREE.Scene;
  private readonly raycaster = new THREE.Raycaster();
  private readonly textureLoader = new THREE.TextureLoader();
  readonly objects: ArtworkObject[] = [];
  selected: ArtworkObject | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.raycaster.layers.enableAll();
  }

  create(options: CreateArtworkOptions = {}): ArtworkObject {
    const artwork = new ArtworkObject(options);
    this.addExisting(artwork);
    return artwork;
  }

  addExisting(artwork: ArtworkObject): ArtworkObject {
    this.objects.push(artwork);
    this.scene.add(artwork.root);
    return artwork;
  }

  removeSelected(): boolean {
    if (!this.selected) {
      return false;
    }

    const index = this.objects.findIndex((item) => item === this.selected);
    if (index >= 0) {
      const [removed] = this.objects.splice(index, 1);
      this.scene.remove(removed.root);
      removed.dispose();
    }

    this.selected = null;
    return true;
  }

  select(target: ArtworkObject | null, editing: boolean): void {
    this.selected = target && !target.locked ? target : null;
    for (const artwork of this.objects) {
      artwork.setEditingState(editing, artwork === this.selected);
    }
  }

  setEditingVisuals(editing: boolean): void {
    for (const artwork of this.objects) {
      artwork.setEditingState(editing, editing && artwork === this.selected);
    }
  }

  setHoveredHandle(handle: HandleName | null): void {
    for (const artwork of this.objects) {
      artwork.setHoveredHandle(artwork === this.selected ? handle : null);
    }
  }

  setGlobalOpacity(opacity: number): void {
    for (const artwork of this.objects) {
      artwork.setDisplayOpacity(opacity);
    }
  }

  async applyTextureFromFile(target: ArtworkObject, file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    try {
      const texture = await this.textureLoader.loadAsync(objectUrl);
      target.setTexture(texture);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async applyTextureFromUrl(target: ArtworkObject, url: string): Promise<void> {
    const texture = await this.textureLoader.loadAsync(url);
    target.setTexture(texture);
  }

  findIntersection(ray: THREE.Ray, editing: boolean): HandleIntersection | null {
    const targets = editing
      ? this.objects.flatMap((item) => {
          if (item !== this.selected || item.locked) {
            return [item.mesh];
          }
          return item.raycastTargets.length > 0 ? item.raycastTargets : item.selectionRoot.children;
        })
      : [];

    this.raycaster.ray.copy(ray);
    const hits = this.raycaster.intersectObjects(targets, false);

    for (const hit of hits) {
      const owner = this.objects.find((item) => item.raycastTargets.includes(hit.object) || hit.object === item.mesh);
      if (!owner || owner.locked) {
        continue;
      }

      const handle = owner.matchesTarget(hit.object);
      if (!handle) {
        continue;
      }

      return {
        object: owner,
        handle,
        point: hit.point.clone()
      };
    }

    return null;
  }
}
