import * as THREE from "three";
import { nanoid } from "./objectIds";

const DEFAULT_MAX_SIDE = 0.42;
const MIN_SIDE = 0.01;
const MAX_SIDE = 2.0;
const MIN_GIZMO_SIZE = 0.2;
const DEFAULT_OPACITY = 0.68;
export const PANEL_BUTTON_NAME = "depth-button" as const;
export const PANEL_RESET_BUTTON_NAME = "reset-button" as const;
export const PANEL_TRANSPARENCY_BUTTON_NAME = "opacity-button" as const;
export const PANEL_EXIT_BUTTON_NAME = "exit-button" as const;

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
export type InteractionName =
  | HandleName
  | typeof PANEL_BUTTON_NAME
  | typeof PANEL_RESET_BUTTON_NAME
  | typeof PANEL_TRANSPARENCY_BUTTON_NAME
  | typeof PANEL_EXIT_BUTTON_NAME;

export interface HandleIntersection {
  object: ArtworkObject;
  handle: InteractionName;
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

function createRoundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const clampedRadius = Math.min(radius, halfWidth, halfHeight);

  shape.moveTo(-halfWidth + clampedRadius, -halfHeight);
  shape.lineTo(halfWidth - clampedRadius, -halfHeight);
  shape.absarc(halfWidth - clampedRadius, -halfHeight + clampedRadius, clampedRadius, -Math.PI * 0.5, 0, false);
  shape.lineTo(halfWidth, halfHeight - clampedRadius);
  shape.absarc(halfWidth - clampedRadius, halfHeight - clampedRadius, clampedRadius, 0, Math.PI * 0.5, false);
  shape.lineTo(-halfWidth + clampedRadius, halfHeight);
  shape.absarc(-halfWidth + clampedRadius, halfHeight - clampedRadius, clampedRadius, Math.PI * 0.5, Math.PI, false);
  shape.lineTo(-halfWidth, -halfHeight + clampedRadius);
  shape.absarc(-halfWidth + clampedRadius, -halfHeight + clampedRadius, clampedRadius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function createRoundedRectGeometry(width: number, height: number, radius: number): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(createRoundedRectShape(width, height, radius));
}

function createLabelTexture(text: string, fontSize = 36): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable.");
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#eef5ff";
  ctx.font = `600 ${fontSize}px Segoe UI`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createLabelMesh(
  text: string,
  width: number,
  height: number,
  fontSize: number
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const texture = createLabelTexture(text, fontSize);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );
  mesh.renderOrder = 42;
  return mesh;
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
  private baseOpacity = DEFAULT_OPACITY;
  private opacityMultiplier = 1;
  private readonly boxLine: THREE.LineSegments;
  private readonly glassMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly projectionLines: THREE.LineSegments;
  private readonly handles = new Map<HandleName, THREE.Object3D>();
  private readonly controls = new Map<InteractionName, THREE.Object3D>();
  private readonly panelRoot: THREE.Group;
  private readonly panelBackground: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly panelButton: THREE.Group;
  private readonly panelButtonHitArea: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly panelResetButton: THREE.Group;
  private readonly panelResetButtonHitArea: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly panelOpacityButton: THREE.Group;
  private readonly panelOpacityButtonHitArea: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly panelExitButton: THREE.Group;
  private readonly panelExitButtonHitArea: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly initialRootPosition = new THREE.Vector3();
  private readonly initialRootQuaternion = new THREE.Quaternion();
  private readonly initialContentQuaternion = new THREE.Quaternion();

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

    this.glassMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xe9f2ff,
        transparent: true,
        opacity: 0.2,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.glassMesh.name = HANDLE_NAMES.body;
    this.glassMesh.renderOrder = 29;
    this.glassMesh.visible = false;
    this.selectionRoot.add(this.glassMesh);

    this.projectionLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: 0xffd36b,
        transparent: true,
        opacity: 0.85,
        dashSize: 0.018,
        gapSize: 0.012,
        depthTest: false,
        depthWrite: false
      })
    );
    this.projectionLines.renderOrder = 28;
    this.projectionLines.visible = false;
    this.selectionRoot.add(this.projectionLines);

    this.panelRoot = new THREE.Group();
    this.panelRoot.renderOrder = 40;
    this.selectionRoot.add(this.panelRoot);

    this.panelBackground = new THREE.Mesh(
      createRoundedRectGeometry(0.92, 0.15, 0.075),
      new THREE.MeshBasicMaterial({
        color: 0x0b1118,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false
      })
    );
    this.panelBackground.renderOrder = 40;
    this.panelRoot.add(this.panelBackground);

    this.panelButton = new THREE.Group();
    this.panelButton.renderOrder = 41;
    this.panelButton.position.set(-0.285, 0, 0.002);
    this.panelRoot.add(this.panelButton);

    this.panelButtonHitArea = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 40),
      new THREE.MeshBasicMaterial({
        color: 0x2a8cff,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false
      })
    );
    this.panelButtonHitArea.renderOrder = 41;
    this.panelButton.add(this.panelButtonHitArea);
    this.controls.set(PANEL_BUTTON_NAME, this.panelButton);
    this.raycastTargets.push(this.panelButtonHitArea);

    const label = createLabelMesh("Глубина", 0.12, 0.032, 22);
    label.position.set(0, 0, 0.003);
    this.panelButton.add(label);

    this.panelResetButton = new THREE.Group();
    this.panelResetButton.renderOrder = 41;
    this.panelResetButton.position.set(-0.095, 0, 0.002);
    this.panelRoot.add(this.panelResetButton);

    this.panelResetButtonHitArea = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 40),
      new THREE.MeshBasicMaterial({
        color: 0x4f1f25,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false
      })
    );
    this.panelResetButtonHitArea.renderOrder = 41;
    this.panelResetButton.add(this.panelResetButtonHitArea);
    this.controls.set(PANEL_RESET_BUTTON_NAME, this.panelResetButton);
    this.raycastTargets.push(this.panelResetButtonHitArea);

    const resetLabel = createLabelMesh("Сброс", 0.095, 0.03, 22);
    resetLabel.position.set(0, 0, 0.003);
    this.panelResetButton.add(resetLabel);

    this.panelOpacityButton = new THREE.Group();
    this.panelOpacityButton.renderOrder = 41;
    this.panelOpacityButton.position.set(0.095, 0, 0.002);
    this.panelRoot.add(this.panelOpacityButton);

    this.panelOpacityButtonHitArea = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 40),
      new THREE.MeshBasicMaterial({
        color: 0x2f7f74,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false
      })
    );
    this.panelOpacityButtonHitArea.renderOrder = 41;
    this.panelOpacityButton.add(this.panelOpacityButtonHitArea);
    this.controls.set(PANEL_TRANSPARENCY_BUTTON_NAME, this.panelOpacityButton);
    this.raycastTargets.push(this.panelOpacityButtonHitArea);

    const opacityLabel = createLabelMesh("Прозрачность", 0.14, 0.03, 16);
    opacityLabel.position.set(0, 0, 0.003);
    this.panelOpacityButton.add(opacityLabel);

    this.panelExitButton = new THREE.Group();
    this.panelExitButton.renderOrder = 41;
    this.panelExitButton.position.set(0.285, 0, 0.002);
    this.panelRoot.add(this.panelExitButton);

    this.panelExitButtonHitArea = new THREE.Mesh(
      new THREE.CircleGeometry(0.042, 40),
      new THREE.MeshBasicMaterial({
        color: 0x7a3d1f,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false
      })
    );
    this.panelExitButtonHitArea.renderOrder = 41;
    this.panelExitButton.add(this.panelExitButtonHitArea);
    this.controls.set(PANEL_EXIT_BUTTON_NAME, this.panelExitButton);
    this.raycastTargets.push(this.panelExitButtonHitArea);

    const exitLabel = createLabelMesh("Выход", 0.09, 0.03, 20);
    exitLabel.position.set(0, 0, 0.003);
    this.panelExitButton.add(exitLabel);

    this.createHandles();
    this.applyPosition(options.position ?? new THREE.Vector3(0, 1.35, -1));
    this.root.quaternion.copy(options.quaternion ?? new THREE.Quaternion());

    if (options.texture) {
      this.setTexture(options.texture);
    } else {
      this.applyPlaceholderLook();
    }

    this.applySize(DEFAULT_MAX_SIDE);
    this.initialRootPosition.copy(this.root.position);
    this.initialRootQuaternion.copy(this.root.quaternion);
    this.initialContentQuaternion.copy(this.content.quaternion);
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
      this.controls.set(name, object);
      this.raycastTargets.push(...raycastObjects);
    };

    this.raycastTargets.push(this.mesh, this.glassMesh);
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

    this.update();
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

  update(): void {
    const objectHalfX = this.content.scale.x * 0.5;
    const objectHalfY = this.content.scale.y * 0.5;
    const gizmoHalfX = Math.max(this.content.scale.x, MIN_GIZMO_SIZE) * 0.5;
    const gizmoHalfY = Math.max(this.content.scale.y, MIN_GIZMO_SIZE) * 0.5;
    const handleZ = 0.002;
    const innerOffsetX = Math.min(gizmoHalfX * 0.45, 0.11);
    const innerOffsetY = Math.min(gizmoHalfY * 0.45, 0.11);

    this.boxLine.scale.set(gizmoHalfX * 2, gizmoHalfY * 2, 1);
    this.selectionRoot.quaternion.copy(this.content.quaternion);
    this.panelRoot.position.set(0, -gizmoHalfY - 0.11, 0.004);
    this.panelBackground.scale.set(1, 1, 1);
    this.panelButton.position.set(-0.285, 0, 0.002);
    this.panelResetButton.position.set(-0.095, 0, 0.002);
    this.panelOpacityButton.position.set(0.095, 0, 0.002);
    this.panelExitButton.position.set(0.285, 0, 0.002);
    this.glassMesh.scale.set(gizmoHalfX * 2, gizmoHalfY * 2, 1);
    this.glassMesh.position.set(0, 0, 0.001);
    this.glassMesh.visible = this.content.scale.x < MIN_GIZMO_SIZE || this.content.scale.y < MIN_GIZMO_SIZE;

    this.handles.get(HANDLE_NAMES.edgeXPos)?.position.set(gizmoHalfX, 0, handleZ);
    this.handles.get(HANDLE_NAMES.edgeXNeg)?.position.set(-gizmoHalfX, 0, handleZ);
    this.handles.get(HANDLE_NAMES.edgeYPos)?.position.set(0, gizmoHalfY, handleZ);
    this.handles.get(HANDLE_NAMES.edgeYNeg)?.position.set(0, -gizmoHalfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerPP)?.position.set(gizmoHalfX, gizmoHalfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerPN)?.position.set(gizmoHalfX, -gizmoHalfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerNP)?.position.set(-gizmoHalfX, gizmoHalfY, handleZ);
    this.handles.get(HANDLE_NAMES.cornerNN)?.position.set(-gizmoHalfX, -gizmoHalfY, handleZ);
    this.handles.get(HANDLE_NAMES.twistPP)?.position.set(gizmoHalfX - innerOffsetX, gizmoHalfY - innerOffsetY, handleZ);
    this.handles.get(HANDLE_NAMES.twistPN)?.position.set(gizmoHalfX - innerOffsetX, -gizmoHalfY + innerOffsetY, handleZ);
    this.handles.get(HANDLE_NAMES.twistNP)?.position.set(-gizmoHalfX + innerOffsetX, gizmoHalfY - innerOffsetY, handleZ);
    this.handles.get(HANDLE_NAMES.twistNN)?.position.set(-gizmoHalfX + innerOffsetX, -gizmoHalfY + innerOffsetY, handleZ);

    const projectionVertices = new Float32Array([
      gizmoHalfX, gizmoHalfY, 0.0005, objectHalfX, objectHalfY, 0.0005,
      gizmoHalfX, -gizmoHalfY, 0.0005, objectHalfX, -objectHalfY, 0.0005,
      -gizmoHalfX, gizmoHalfY, 0.0005, -objectHalfX, objectHalfY, 0.0005,
      -gizmoHalfX, -gizmoHalfY, 0.0005, -objectHalfX, -objectHalfY, 0.0005
    ]);
    this.projectionLines.geometry.dispose();
    this.projectionLines.geometry = new THREE.BufferGeometry();
    this.projectionLines.geometry.setAttribute("position", new THREE.BufferAttribute(projectionVertices, 3));
    this.projectionLines.computeLineDistances();
    this.projectionLines.visible = this.glassMesh.visible;
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

    this.update();
  }

  scaleLocal(deltaWidth: number, deltaHeight: number): void {
    const nextWidth = THREE.MathUtils.clamp(this.width + deltaWidth, MIN_SIDE, MAX_SIDE);
    const nextHeight = THREE.MathUtils.clamp(this.height + deltaHeight, MIN_SIDE, MAX_SIDE);
    this.content.scale.set(nextWidth, nextHeight, 1);
    this.update();
  }

  scaleUniform(factor: number): void {
    const nextWidth = THREE.MathUtils.clamp(this.width * factor, MIN_SIDE, MAX_SIDE);
    const nextHeight = THREE.MathUtils.clamp(this.height * factor, MIN_SIDE, MAX_SIDE);
    this.content.scale.set(nextWidth, nextHeight, 1);
    this.update();
  }

  setLocalSize(width: number, height: number): void {
    this.content.scale.set(
      THREE.MathUtils.clamp(width, MIN_SIDE, MAX_SIDE),
      THREE.MathUtils.clamp(height, MIN_SIDE, MAX_SIDE),
      1
    );
    this.update();
  }

  rotateOnSurface(radians: number): void {
    const axis = new THREE.Vector3(0, 0, 1);
    this.content.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, radians));
    this.update();
  }

  setContentQuaternion(quaternion: THREE.Quaternion): void {
    this.content.quaternion.copy(quaternion);
    this.update();
  }

  resetTransform(): void {
    this.root.position.copy(this.initialRootPosition);
    this.root.quaternion.copy(this.initialRootQuaternion);
    this.content.quaternion.copy(this.initialContentQuaternion);
    this.update();
  }

  setDisplayOpacity(opacity: number): void {
    this.baseOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
    this.updateOpacity();
  }

  getDisplayOpacity(): number {
    return this.baseOpacity;
  }

  setOpacityMultiplier(multiplier: number): void {
    this.opacityMultiplier = THREE.MathUtils.clamp(multiplier, 0, 1);
    this.updateOpacity();
  }

  private updateOpacity(): void {
    this.mesh.material.opacity = THREE.MathUtils.clamp(this.baseOpacity * this.opacityMultiplier, 0, 1);
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

  setHoveredHandle(handle: InteractionName | null): void {
    for (const [name, object] of this.controls) {
      const scale = name === handle ? 1.1 : 1;
      object.scale.setScalar(scale);
    }
  }

  matchesTarget(target: THREE.Object3D): InteractionName | null {
    if (target === this.mesh || target === this.glassMesh) {
      return HANDLE_NAMES.body;
    }

    if (target === this.panelButtonHitArea) {
      return PANEL_BUTTON_NAME;
    }

    if (target === this.panelResetButtonHitArea) {
      return PANEL_RESET_BUTTON_NAME;
    }

    if (target === this.panelOpacityButtonHitArea) {
      return PANEL_TRANSPARENCY_BUTTON_NAME;
    }

    if (target === this.panelExitButtonHitArea) {
      return PANEL_EXIT_BUTTON_NAME;
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
    this.glassMesh.material.dispose();
    this.glassMesh.geometry.dispose();
    this.projectionLines.geometry.dispose();
    (this.projectionLines.material as THREE.Material).dispose();
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

  clearAll(): void {
    const objects = [...this.objects];
    for (const artwork of objects) {
      this.scene.remove(artwork.root);
    }
    this.objects.length = 0;
    this.selected = null;
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

  setHoveredHandle(handle: InteractionName | null): void {
    for (const artwork of this.objects) {
      artwork.setHoveredHandle(artwork === this.selected ? handle : null);
    }
  }

  setGlobalOpacity(opacity: number): void {
    for (const artwork of this.objects) {
      artwork.setDisplayOpacity(opacity);
    }
  }

  setGlobalOpacityMultiplier(multiplier: number): void {
    for (const artwork of this.objects) {
      artwork.setOpacityMultiplier(multiplier);
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
