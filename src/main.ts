import * as THREE from "three";
import "./styles.css";
import { createAppScene } from "./rendering/scene";
import {
  ArtworkStore,
  ArtworkObject,
  PANEL_BUTTON_NAME,
  PANEL_EXIT_BUTTON_NAME,
  PANEL_RESET_BUTTON_NAME,
  PANEL_TRANSPARENCY_BUTTON_NAME,
  createLabelMesh,
  type HandleName
} from "./rendering/artwork";
import { createOverlay, type LibraryItem } from "./ui/overlay";
import { createXRSessionController, buildControllerRay } from "./xr/session";
import { XRHitTestManager } from "./xr/hitTest";
import { createControllerManager, type ControllerState } from "./xr/controllerInput";
import type { SurfaceHit } from "./xr/hitTest";
import { APP_CONFIG } from "./config/app";

type AppMode = "drawing" | "editing";
type DragMode = "move" | "scale-corner" | "rotate-axis" | "depth" | "opacity";

interface DragSession {
  mode: DragMode;
  artwork: ArtworkObject;
  controller: ControllerState;
  plane: THREE.Plane;
  rotationAxisLocal: THREE.Vector3 | null;
  rotationAxisWorld: THREE.Vector3 | null;
  lastControllerWorldPosition: THREE.Vector3;
  startWorldPoint: THREE.Vector3;
  startHitLocal: THREE.Vector3;
  startVector: THREE.Vector3;
  startContentQuaternion: THREE.Quaternion;
  startGripPosition: THREE.Vector3;
  startPosition: THREE.Vector3;
  startWidth: number;
  startHeight: number;
  startOpacity: number;
  signX: number;
  signY: number;
}

type ResetConfirmChoice = "yes" | "no";

interface ResetConfirmPanel {
  root: THREE.Group;
  yesButton: THREE.Group;
  noButton: THREE.Group;
  yesHitArea: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  noHitArea: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
}

const DRAWING_HOLD_OPACITY_MULTIPLIER = 0.18;
const JOYSTICK_DEAD_ZONE = 0.2;
const ROTATE_SPEED = 1.5;
const SCALE_SPEED = 0.95;

class AnchorBinding {
  private anchor: XRAnchor | null = null;
  private anchorSpace: XRSpace | null = null;

  apply(frame: XRFrame, referenceSpace: XRReferenceSpace, object: THREE.Object3D): void {
    if (!this.anchorSpace) {
      return;
    }

    const pose = frame.getPose(this.anchorSpace, referenceSpace);
    if (!pose) {
      return;
    }

    object.matrix.fromArray(pose.transform.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
  }

  async createFromFrame(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    session: XRSession,
    object: THREE.Object3D
  ): Promise<boolean> {
    const createAnchor = (frame as XRFrame & {
      createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor>;
    }).createAnchor;

    if (!createAnchor) {
      return false;
    }

    this.clear();

    try {
      const anchor = await createAnchor.call(
        frame,
        new XRRigidTransform(
          {
            x: object.position.x,
            y: object.position.y,
            z: object.position.z
          },
          {
            x: object.quaternion.x,
            y: object.quaternion.y,
            z: object.quaternion.z,
            w: object.quaternion.w
          }
        ),
        referenceSpace
      );
      this.anchor = anchor;
      this.anchorSpace = anchor.anchorSpace;
      session.addEventListener(
        "end",
        () => {
          this.clear();
        },
        { once: true }
      );
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  clear(): void {
    this.anchor?.delete();
    this.anchor = null;
    this.anchorSpace = null;
  }
}

interface AnchorState {
  binding: AnchorBinding;
  dirty: boolean;
  creating: boolean;
}

function createPresetDataUrl(
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable.");
  }

  draw(ctx, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Failed to read file as data URL."));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file."));
    };
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = dataUrl;
  });
}

function createTextureFromImage(image: HTMLImageElement): THREE.Texture {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function mapOutlineColor(control: number): { r: number; g: number; b: number } {
  const clamped = THREE.MathUtils.clamp(control, 0, 255);
  if (clamped === 0) {
    return { r: 0, g: 0, b: 0 };
  }
  if (clamped === 255) {
    return { r: 255, g: 255, b: 255 };
  }

  const hue = ((clamped - 1) / 253) * 360;
  const color = new THREE.Color().setHSL(hue / 360, 0.82, 0.5);
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255)
  };
}

function createOutlineImageDataUrl(image: HTMLImageElement, thresholdControl: number, colorControl: number): string {
  const canvas = document.createElement("canvas");
  const width = Math.max(1, image.naturalWidth || image.width || 1);
  const height = Math.max(1, image.naturalHeight || image.height || 1);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2D canvas context is unavailable.");
  }

  ctx.drawImage(image, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const threshold = THREE.MathUtils.lerp(0.55, 0.98, THREE.MathUtils.clamp(thresholdControl / 100, 0, 1));
  const feather = 0.015;
  const tint = mapOutlineColor(colorControl);

  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i] / 255;
    const g = imageData.data[i + 1] / 255;
    const b = imageData.data[i + 2] / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    let alpha = 1;
    if (luminance >= threshold + feather) {
      alpha = 0;
    } else if (luminance > threshold - feather) {
      alpha = 1 - (luminance - (threshold - feather)) / (feather * 2);
    }

    imageData.data[i] = tint.r;
    imageData.data[i + 1] = tint.g;
    imageData.data[i + 2] = tint.b;
    imageData.data[i + 3] = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function createLibrary(): LibraryItem[] {
  return [
    {
      id: "grid",
      label: "Grid",
      url: createPresetDataUrl((ctx, width, height) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 10;
        for (let x = 128; x < width; x += 128) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
        for (let y = 128; y < height; y += 128) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
      })
    },
    {
      id: "circle",
      label: "Target",
      url: createPresetDataUrl((ctx, width, height) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "#0f1720";
        ctx.lineWidth = 14;
        for (let r = 360; r >= 80; r -= 70) {
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(width / 2, 80);
        ctx.lineTo(width / 2, height - 80);
        ctx.moveTo(80, height / 2);
        ctx.lineTo(width - 80, height / 2);
        ctx.stroke();
      })
    },
    {
      id: "figure",
      label: "Figure",
      url: createPresetDataUrl((ctx, width, height) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = "#111111";
        ctx.lineWidth = 18;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(240, 820);
        ctx.lineTo(420, 500);
        ctx.lineTo(360, 260);
        ctx.lineTo(520, 150);
        ctx.lineTo(660, 260);
        ctx.lineTo(604, 508);
        ctx.lineTo(782, 820);
        ctx.stroke();
      })
    }
  ];
}

function getPointerObject(controller: ControllerState): THREE.Object3D {
  return controller.controller;
}

function getMotionObject(controller: ControllerState): THREE.Object3D {
  return controller.inputSource?.gripSpace ? controller.grip : controller.controller;
}

function makeQuaternionKeepingUpright(normalInput: THREE.Vector3): THREE.Quaternion {
  const normal = normalInput.clone().normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let upProjected = worldUp.clone().sub(normal.clone().multiplyScalar(worldUp.dot(normal)));

  if (upProjected.lengthSq() < 1e-6) {
    upProjected = new THREE.Vector3(1, 0, 0).projectOnPlane(normal);
  }

  upProjected.normalize();
  const right = new THREE.Vector3().crossVectors(upProjected, normal).normalize();
  const planeUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  const matrix = new THREE.Matrix4().makeBasis(right, planeUp, normal);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function makeQuaternionFromSurfaceAndRay(
  normalInput: THREE.Vector3,
  rayDirectionInput: THREE.Vector3
): THREE.Quaternion {
  const normal = normalInput.clone().normalize();
  const rayDirection = rayDirectionInput.clone().normalize();

  let inPlaneUp = rayDirection.clone().multiplyScalar(-1).projectOnPlane(normal);
  if (inPlaneUp.lengthSq() < 1e-6) {
    inPlaneUp = new THREE.Vector3(0, 1, 0).projectOnPlane(normal);
  }
  if (inPlaneUp.lengthSq() < 1e-6) {
    inPlaneUp = new THREE.Vector3(1, 0, 0).projectOnPlane(normal);
  }

  inPlaneUp.normalize();
  const right = new THREE.Vector3().crossVectors(inPlaneUp, normal).normalize();
  const planeUp = new THREE.Vector3().crossVectors(normal, right).normalize();
  const matrix = new THREE.Matrix4().makeBasis(right, planeUp, normal);
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

function makePreviewQuaternion(
  normalInput: THREE.Vector3,
  rayDirectionInput: THREE.Vector3
): THREE.Quaternion {
  const normal = normalInput.clone().normalize();
  const verticality = Math.abs(normal.dot(new THREE.Vector3(0, 1, 0)));

  if (verticality < 0.35) {
    return makeQuaternionKeepingUpright(normal);
  }

  return makeQuaternionFromSurfaceAndRay(normal, rayDirectionInput);
}

function handleToDragMode(
  handle: HandleName
): { mode: DragMode; signX: number; signY: number; axisLocal: THREE.Vector3 | null } | null {
  switch (handle) {
    case "body":
      return { mode: "move", signX: 0, signY: 0, axisLocal: null };
    case "edge-x-pos":
      return { mode: "rotate-axis", signX: 0, signY: 0, axisLocal: new THREE.Vector3(0, 1, 0) };
    case "edge-x-neg":
      return { mode: "rotate-axis", signX: 0, signY: 0, axisLocal: new THREE.Vector3(0, 1, 0) };
    case "edge-y-pos":
      return { mode: "rotate-axis", signX: 0, signY: 0, axisLocal: new THREE.Vector3(1, 0, 0) };
    case "edge-y-neg":
      return { mode: "rotate-axis", signX: 0, signY: 0, axisLocal: new THREE.Vector3(1, 0, 0) };
    case "corner-pp":
      return { mode: "scale-corner", signX: 1, signY: 1, axisLocal: null };
    case "corner-pn":
      return { mode: "scale-corner", signX: 1, signY: -1, axisLocal: null };
    case "corner-np":
      return { mode: "scale-corner", signX: -1, signY: 1, axisLocal: null };
    case "corner-nn":
      return { mode: "scale-corner", signX: -1, signY: -1, axisLocal: null };
    case "twist-pp":
    case "twist-pn":
    case "twist-np":
    case "twist-nn":
      return { mode: "rotate-axis", signX: 0, signY: 0, axisLocal: new THREE.Vector3(0, 0, 1) };
    default:
      return null;
  }
}

function worldPointToArtworkLocal(
  artwork: ArtworkObject,
  worldPoint: THREE.Vector3,
  contentQuaternion: THREE.Quaternion
): THREE.Vector3 {
  const pointInRoot = worldPoint.clone().sub(artwork.position);
  pointInRoot.applyQuaternion(artwork.quaternion.clone().invert());
  pointInRoot.applyQuaternion(contentQuaternion.clone().invert());
  return pointInRoot;
}

function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable.");
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(5, 11, 16, 0.82)";
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 32);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eef5ff";
  ctx.font = "32px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
  );
  sprite.scale.set(0.18, 0.045, 1);
  sprite.renderOrder = 50;
  texture.needsUpdate = true;
  return sprite;
}

function createConfirmPanel(
  questionText: string,
  yesText: string,
  noText: string
): ResetConfirmPanel {
  const root = new THREE.Group();
  root.visible = false;
  root.renderOrder = 80;

  const background = new THREE.Mesh(
    new THREE.ShapeGeometry(
      (() => {
        const shape = new THREE.Shape();
        const width = 0.78;
        const height = 0.28;
        const radius = 0.06;
        const halfWidth = width * 0.5;
        const halfHeight = height * 0.5;
        shape.moveTo(-halfWidth + radius, -halfHeight);
        shape.lineTo(halfWidth - radius, -halfHeight);
        shape.absarc(halfWidth - radius, -halfHeight + radius, radius, -Math.PI * 0.5, 0, false);
        shape.lineTo(halfWidth, halfHeight - radius);
        shape.absarc(halfWidth - radius, halfHeight - radius, radius, 0, Math.PI * 0.5, false);
        shape.lineTo(-halfWidth + radius, halfHeight);
        shape.absarc(-halfWidth + radius, halfHeight - radius, radius, Math.PI * 0.5, Math.PI, false);
        shape.lineTo(-halfWidth, -halfHeight + radius);
        shape.absarc(-halfWidth + radius, -halfHeight + radius, radius, Math.PI, Math.PI * 1.5, false);
        return shape;
      })()
    ),
    new THREE.MeshBasicMaterial({
      color: 0x0b1118,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false
    })
  );
  background.renderOrder = 80;
  root.add(background);

  const question = createLabelMesh(questionText, 0.68, 0.12, 28);
  question.position.set(0, 0.08, 0.002);
  root.add(question);

  const createChoiceButton = (
    choice: ResetConfirmChoice,
    color: number,
    label: string,
    x: number
  ): { button: THREE.Group; hitArea: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> } => {
    const button = new THREE.Group();
    button.position.set(x, -0.055, 0.003);
    button.renderOrder = 81;

    const hitArea = new THREE.Mesh(
      new THREE.ShapeGeometry(
        (() => {
          const shape = new THREE.Shape();
          const width = 0.17;
          const height = 0.08;
          const radius = 0.04;
          const halfWidth = width * 0.5;
          const halfHeight = height * 0.5;
          shape.moveTo(-halfWidth + radius, -halfHeight);
          shape.lineTo(halfWidth - radius, -halfHeight);
          shape.absarc(halfWidth - radius, -halfHeight + radius, radius, -Math.PI * 0.5, 0, false);
          shape.lineTo(halfWidth, halfHeight - radius);
          shape.absarc(halfWidth - radius, halfHeight - radius, radius, 0, Math.PI * 0.5, false);
          shape.lineTo(-halfWidth + radius, halfHeight);
          shape.absarc(-halfWidth + radius, halfHeight - radius, radius, Math.PI * 0.5, Math.PI, false);
          shape.lineTo(-halfWidth, -halfHeight + radius);
          shape.absarc(-halfWidth + radius, -halfHeight + radius, radius, Math.PI, Math.PI * 1.5, false);
          return shape;
        })()
      ),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.94,
        depthTest: false,
        depthWrite: false
      })
    );
    hitArea.renderOrder = 81;
    hitArea.userData.confirmChoice = choice;
    button.add(hitArea);

    const labelMesh = createLabelMesh(label, 0.09, 0.026, 34);
    labelMesh.position.set(0, 0, 0.004);
    button.add(labelMesh);

    return { button, hitArea };
  };

  const yes = createChoiceButton("yes", 0x2a8cff, yesText, -0.13);
  const no = createChoiceButton("no", 0x4f1f25, noText, 0.13);
  root.add(yes.button);
  root.add(no.button);

  return {
    root,
    yesButton: yes.button,
    noButton: no.button,
    yesHitArea: yes.hitArea,
    noHitArea: no.hitArea
  };
}

async function bootstrap(): Promise<void> {
  const library = createLibrary();
  const libraryById = new Map(library.map((item) => [item.id, item]));
  const overlay = createOverlay(library);
  const appScene = createAppScene(overlay.canvasHost);
  const store = new ArtworkStore(appScene.scene);

  const xrSession = createXRSessionController(appScene, overlay.root);
  const hitTest = new XRHitTestManager();
  const controllers = createControllerManager(appScene);
  const resetConfirmRaycaster = new THREE.Raycaster();
  const exitConfirmRaycaster = new THREE.Raycaster();
  const clock = new THREE.Clock();
  const anchorStates = new Map<string, AnchorState>();
  const editHint = createTextSprite(APP_CONFIG.ui.editModeHint);
  const resetConfirmPanel = createConfirmPanel(
    "Вы уверены что хотите всё сбросить и начать сначала?",
    "Да",
    "Нет"
  );
  const exitConfirmPanel = createConfirmPanel(
    "Выйти из режима дополненной реальности?",
    "Да",
    "Нет"
  );
  let previewArtwork: ArtworkObject | null = null;
  let resetConfirmOpen = false;
  let exitConfirmOpen = false;
  let pendingResetToFreshStart = false;
  let pendingExitSessionEnd = false;
  let suppressSelectionClearOnRelease = false;

  let mode: AppMode = "drawing";
  let inSession = false;
  let activeDrag: DragSession | null = null;
  let xrSessionHandle: XRSession | null = null;
  let xrReferenceSpace: XRReferenceSpace | null = null;
  let xrReferenceSpaceResetHandler: ((event: Event) => void) | null = null;
  let sourceStartImageElement: HTMLImageElement | null = null;
  let startImageElement: HTMLImageElement | null = null;
  let startOutlineThreshold = 72;
  let startOutlineColor = 0;
  let sessionStartedAt = 0;
  let previewHitLastUpdateAt = 0;
  let previewPlacementHit: SurfaceHit | null = null;

  controllers.primary.grip.add(editHint);
  editHint.position.set(0.04, 0.045, 0.02);
  controllers.secondary.grip.add(editHint.clone());
  appScene.scene.add(resetConfirmPanel.root);
  appScene.scene.add(exitConfirmPanel.root);

  const getAnchorState = (artwork: ArtworkObject): AnchorState => {
    let state = anchorStates.get(artwork.id);
    if (!state) {
      state = {
        binding: new AnchorBinding(),
        dirty: false,
        creating: false
      };
      anchorStates.set(artwork.id, state);
    }
    return state;
  };

  const markAnchorDirty = (artwork: ArtworkObject) => {
    getAnchorState(artwork).dirty = true;
  };

  const clearAnchor = (artwork: ArtworkObject) => {
    const state = anchorStates.get(artwork.id);
    if (!state) {
      return;
    }

    state.binding.clear();
    anchorStates.delete(artwork.id);
  };

  const ensurePreviewArtwork = () => {
    if (previewArtwork) {
      return;
    }

    previewArtwork = new ArtworkObject();
    previewArtwork.applySize(APP_CONFIG.creation.previewScale);
    previewArtwork.setEditingState(false, false);
    if (startImageElement) {
      previewArtwork.setTexture(createTextureFromImage(startImageElement));
    }
    appScene.scene.add(previewArtwork.root);
  };

  const updatePreviewArtwork = (controller: ControllerState, hit: SurfaceHit | null) => {
    if (!previewArtwork) {
      return;
    }

    const pointerObject = controller.controller;
    const ray = buildControllerRay(pointerObject);

    if (hit && hit.distance >= APP_CONFIG.interaction.minValidHitDistance) {
      previewArtwork.root.position.copy(hit.position);
      previewArtwork.root.quaternion.copy(
        makePreviewQuaternion(hit.normal, ray.direction)
      );
      return;
    }

    previewArtwork.root.position.copy(
      ray.origin.add(
        ray.direction.clone().multiplyScalar(Math.abs(APP_CONFIG.creation.previewOffset.z))
      )
    );
    previewArtwork.root.position.x += APP_CONFIG.creation.previewOffset.x;
    previewArtwork.root.position.y += APP_CONFIG.creation.previewOffset.y;
    previewArtwork.root.quaternion.copy(
      makeQuaternionFromSurfaceAndRay(
        ray.direction.clone().multiplyScalar(-1),
        ray.direction
      )
    );
  };

  const finalizePreviewPlacement = async (hit: SurfaceHit | null) => {
    if (!previewArtwork) {
      return;
    }

    const worldQuaternion = previewArtwork.root.getWorldQuaternion(new THREE.Quaternion());
    previewArtwork.root.removeFromParent();
    if (hit) {
      previewArtwork.root.position.copy(hit.position);
    }
    previewArtwork.root.quaternion.copy(worldQuaternion);
    store.addExisting(previewArtwork);
    store.select(previewArtwork, true);
    markAnchorDirty(previewArtwork);
    previewArtwork = null;
    setMode("editing");
  };

  const applyAnchors = (frame: XRFrame) => {
    if (!xrReferenceSpace) {
      return;
    }

    for (const artwork of store.objects) {
      const state = anchorStates.get(artwork.id);
      const isActive = activeDrag?.artwork === artwork;
      const isDirty = state?.dirty ?? false;
      if (!state || isActive || isDirty) {
        continue;
      }

      state.binding.apply(frame, xrReferenceSpace, artwork.root);
    }
  };

  const rebuildAnchorFromFrame = async (frame: XRFrame, artwork: ArtworkObject): Promise<void> => {
    if (!xrSessionHandle || !xrReferenceSpace) {
      return;
    }

    const state = getAnchorState(artwork);
    if (state.creating) {
      return;
    }

    state.creating = true;
    try {
      const anchored = await state.binding.createFromFrame(frame, xrReferenceSpace, xrSessionHandle, artwork.root);
      state.dirty = !anchored;
    } finally {
      state.creating = false;
    }
  };

  const handleReferenceSpaceReset = (event: Event) => {
    const resetEvent = event as Event & { transform?: XRRigidTransform };
    if (!resetEvent.transform) {
      return;
    }

    endDrag();
    closeResetConfirm();
    previewPlacementHit = null;
    updateVisualState();
  };

  const updateOverlayState = () => {
    const prompt = "";

    let status = "drawing";
    if (mode === "editing") {
      if (!store.selected) {
        status = "editing - no selection";
      } else if (store.selected.locked) {
        status = "editing - locked";
      } else {
        status = "editing - selected";
      }
    }

    overlay.setState({
      mode,
      inSession,
      status,
      hasSceneObjects: store.objects.length > 0,
      hasSelection: Boolean(store.selected),
      selectionLocked: Boolean(store.selected?.locked),
      prompt
    });
  };

  const updateVisualState = () => {
    controllers.setEditingVisible(
      mode === "editing" || Boolean(previewArtwork)
    );
    store.setEditingVisuals(mode === "editing");

    if (mode === "drawing" && !previewArtwork) {
      const controller = controllers.getPreferred();
      const triggerPressed = controller?.trigger.pressed ?? false;
      const gripPressed = controller?.gripButton.pressed ?? false;
      const multiplier = triggerPressed ? (gripPressed ? 0 : DRAWING_HOLD_OPACITY_MULTIPLIER) : 1;
      store.setGlobalOpacityMultiplier(multiplier);
    } else {
      store.setGlobalOpacityMultiplier(1);
    }

    updateOverlayState();
  };
  const setMode = (nextMode: AppMode) => {
    mode = nextMode;
    if (mode === "drawing") {
      activeDrag = null;
    }
    updateVisualState();
  };

  const closeResetConfirm = () => {
    resetConfirmOpen = false;
    setResetConfirmHovered(null);
    resetConfirmPanel.root.visible = false;
  };

  const closeExitConfirm = () => {
    exitConfirmOpen = false;
    setExitConfirmHovered(null);
    exitConfirmPanel.root.visible = false;
  };

  const openResetConfirm = () => {
    resetConfirmOpen = true;
    resetConfirmPanel.root.visible = true;
  };

  const openExitConfirm = () => {
    exitConfirmOpen = true;
    exitConfirmPanel.root.visible = true;
  };

  const resetToInitialArState = () => {
    endDrag();
    closeResetConfirm();

    for (const artwork of [...store.objects]) {
      clearAnchor(artwork);
    }

    store.clearAll();
    previewArtwork?.root.removeFromParent();
    previewArtwork = null;
    previewHitLastUpdateAt = 0;
    previewPlacementHit = null;
    sessionStartedAt = performance.now();
    setMode("drawing");

    if (inSession && startImageElement) {
      ensurePreviewArtwork();
    }
  };

  const queueResetToFreshStart = () => {
    pendingResetToFreshStart = true;
  };

  const queueExitFromAr = () => {
    pendingExitSessionEnd = true;
  };

  const updateResetConfirmPanel = (camera: THREE.PerspectiveCamera) => {
    if (!resetConfirmOpen) {
      return;
    }

    const cameraPosition = new THREE.Vector3();
    const cameraForward = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    camera.getWorldDirection(cameraForward);
    resetConfirmPanel.root.position.copy(cameraPosition).add(cameraForward.multiplyScalar(0.72));
    resetConfirmPanel.root.position.y += 0.045;
    resetConfirmPanel.root.up.set(0, 1, 0);
    resetConfirmPanel.root.lookAt(cameraPosition);
  };

  const updateExitConfirmPanel = (camera: THREE.PerspectiveCamera) => {
    if (!exitConfirmOpen) {
      return;
    }

    const cameraPosition = new THREE.Vector3();
    const cameraForward = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    camera.getWorldDirection(cameraForward);
    exitConfirmPanel.root.position.copy(cameraPosition).add(cameraForward.multiplyScalar(0.72));
    exitConfirmPanel.root.position.y += 0.045;
    exitConfirmPanel.root.up.set(0, 1, 0);
    exitConfirmPanel.root.lookAt(cameraPosition);
  };

  const setResetConfirmHovered = (choice: ResetConfirmChoice | null) => {
    resetConfirmPanel.yesButton.scale.setScalar(choice === "yes" ? 1.08 : 1);
    resetConfirmPanel.noButton.scale.setScalar(choice === "no" ? 1.08 : 1);
  };

  const getResetConfirmChoice = (ray: THREE.Ray): ResetConfirmChoice | null => {
    resetConfirmRaycaster.ray.copy(ray);
    const hits = resetConfirmRaycaster.intersectObjects(
      [resetConfirmPanel.yesHitArea, resetConfirmPanel.noHitArea],
      false
    );
    for (const hit of hits) {
      const choice = hit.object.userData.confirmChoice as ResetConfirmChoice | undefined;
      if (choice) {
        return choice;
      }
    }
    return null;
  };

  const setExitConfirmHovered = (choice: ResetConfirmChoice | null) => {
    exitConfirmPanel.yesButton.scale.setScalar(choice === "yes" ? 1.08 : 1);
    exitConfirmPanel.noButton.scale.setScalar(choice === "no" ? 1.08 : 1);
  };

  const getExitConfirmChoice = (ray: THREE.Ray): ResetConfirmChoice | null => {
    exitConfirmRaycaster.ray.copy(ray);
    const hits = exitConfirmRaycaster.intersectObjects(
      [exitConfirmPanel.yesHitArea, exitConfirmPanel.noHitArea],
      false
    );
    for (const hit of hits) {
      const choice = hit.object.userData.confirmChoice as ResetConfirmChoice | undefined;
      if (choice) {
        return choice;
      }
    }
    return null;
  };

  const beginDepthDrag = (controller: ControllerState, artwork: ArtworkObject) => {
    if (activeDrag || artwork.locked) {
      return;
    }

    const gripPosition = new THREE.Vector3().setFromMatrixPosition(getMotionObject(controller).matrixWorld);
    activeDrag = {
      mode: "depth",
      artwork,
      controller,
      plane: new THREE.Plane(),
      rotationAxisLocal: null,
      rotationAxisWorld: null,
      lastControllerWorldPosition: gripPosition.clone(),
      startWorldPoint: new THREE.Vector3(),
      startHitLocal: new THREE.Vector3(),
      startVector: new THREE.Vector3(),
      startContentQuaternion: artwork.content.quaternion.clone(),
      startGripPosition: gripPosition,
      startPosition: artwork.position.clone(),
      startWidth: artwork.width,
      startHeight: artwork.height,
      startOpacity: artwork.getDisplayOpacity(),
      signX: 0,
      signY: 0
    };
  };

  const beginOpacityDrag = (controller: ControllerState, artwork: ArtworkObject) => {
    if (activeDrag || artwork.locked) {
      return;
    }

    const gripPosition = new THREE.Vector3().setFromMatrixPosition(getMotionObject(controller).matrixWorld);
    activeDrag = {
      mode: "opacity",
      artwork,
      controller,
      plane: new THREE.Plane(),
      rotationAxisLocal: null,
      rotationAxisWorld: null,
      lastControllerWorldPosition: gripPosition.clone(),
      startWorldPoint: new THREE.Vector3(),
      startHitLocal: new THREE.Vector3(),
      startVector: new THREE.Vector3(),
      startContentQuaternion: artwork.content.quaternion.clone(),
      startGripPosition: gripPosition,
      startPosition: artwork.position.clone(),
      startWidth: artwork.width,
      startHeight: artwork.height,
      startOpacity: artwork.getDisplayOpacity(),
      signX: 0,
      signY: 0
    };
  };

  const beginDrag = (
    controller: ControllerState,
    artwork: ArtworkObject,
    dragMode: DragMode,
    signX: number,
    signY: number,
    axisLocal: THREE.Vector3 | null
  ) => {
    const startContentQuaternion = artwork.contentQuaternion.clone();
    const rootQuaternion = artwork.quaternion.clone();
    const rotationAxisWorld = axisLocal
      ? axisLocal.clone().applyQuaternion(rootQuaternion).applyQuaternion(startContentQuaternion).normalize()
      : null;
    const planeNormal = rotationAxisWorld ?? artwork.normal;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, artwork.position);
    const pointerObject = getPointerObject(controller);
    const motionObject = getMotionObject(controller);
    const controllerPosition = new THREE.Vector3().setFromMatrixPosition(motionObject.matrixWorld);
    const ray = buildControllerRay(pointerObject);
    const point = new THREE.Vector3();

    if (dragMode === "rotate-axis" && rotationAxisWorld) {
      activeDrag = {
        mode: dragMode,
        artwork,
        controller,
        plane,
        rotationAxisLocal: axisLocal?.clone() ?? null,
        rotationAxisWorld,
        lastControllerWorldPosition: controllerPosition.clone(),
        startWorldPoint: new THREE.Vector3(),
        startHitLocal: new THREE.Vector3(),
        startVector: new THREE.Vector3(),
        startContentQuaternion,
        startGripPosition: controllerPosition,
        startPosition: artwork.position.clone(),
        startWidth: artwork.width,
        startHeight: artwork.height,
        startOpacity: artwork.getDisplayOpacity(),
        signX,
        signY
      };
      return;
    }

    if (!ray.intersectPlane(plane, point)) {
      return;
    }

    const localPoint = worldPointToArtworkLocal(artwork, point, startContentQuaternion);
    activeDrag = {
      mode: dragMode,
      artwork,
      controller,
      plane,
      rotationAxisLocal: axisLocal?.clone() ?? null,
      rotationAxisWorld,
      lastControllerWorldPosition: controllerPosition.clone(),
      startWorldPoint: point.clone(),
      startHitLocal: localPoint,
      startVector: localPoint.clone(),
      startContentQuaternion,
      startGripPosition: new THREE.Vector3().setFromMatrixPosition(motionObject.matrixWorld),
      startPosition: artwork.position.clone(),
      startWidth: artwork.width,
      startHeight: artwork.height,
      startOpacity: artwork.getDisplayOpacity(),
      signX,
      signY
    };
  };

  const updateDrag = () => {
    if (!activeDrag) {
      return;
    }

    const { controller, artwork, plane } = activeDrag;
    const pointerObject = getPointerObject(controller);
    const motionObject = getMotionObject(controller);
    const ray = buildControllerRay(pointerObject);
    const worldPoint = new THREE.Vector3();
    const controllerPosition = new THREE.Vector3().setFromMatrixPosition(motionObject.matrixWorld);

    if (activeDrag.mode === "depth") {
      const current = new THREE.Vector3().setFromMatrixPosition(motionObject.matrixWorld);
      const delta = current.sub(activeDrag.startGripPosition);
      const distance = delta.dot(artwork.normal);
      artwork.position.copy(activeDrag.startPosition).add(artwork.normal.clone().multiplyScalar(distance));
      markAnchorDirty(artwork);
      return;
    }

    if (activeDrag.mode === "opacity") {
      const current = new THREE.Vector3().setFromMatrixPosition(motionObject.matrixWorld);
      const delta = current.sub(activeDrag.startGripPosition);
      const cameraQuaternion = appScene.camera.getWorldQuaternion(new THREE.Quaternion());
      const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraQuaternion).normalize();
      const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion).normalize();
      const horizontal = delta.dot(cameraRight);
      const vertical = delta.dot(cameraUp);
      const deltaOpacity = horizontal + vertical;
      const nextOpacity = THREE.MathUtils.clamp(activeDrag.startOpacity + deltaOpacity * 7.5, 0.05, 1);
      artwork.setDisplayOpacity(nextOpacity);
      return;
    }

    if (activeDrag.mode === "move") {
      if (!ray.intersectPlane(plane, worldPoint)) {
        return;
      }
      const worldDelta = worldPoint.clone().sub(activeDrag.startWorldPoint);
      artwork.position.copy(activeDrag.startPosition).add(worldDelta);
      markAnchorDirty(artwork);
      return;
    }

    if (activeDrag.mode === "rotate-axis" && activeDrag.rotationAxisLocal && activeDrag.rotationAxisWorld) {
      const delta = controllerPosition.clone().sub(activeDrag.lastControllerWorldPosition);
      const cameraRight = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(appScene.camera.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      const angle = delta.dot(cameraRight) * 8;
      if (Math.abs(angle) > 1e-5) {
        const worldRotation = new THREE.Quaternion().setFromAxisAngle(activeDrag.rotationAxisWorld, angle);
        const currentWorldQuaternion = artwork.quaternion
          .clone()
          .multiply(artwork.contentQuaternion.clone());
        const nextWorldQuaternion = worldRotation.multiply(currentWorldQuaternion);
        const nextLocalQuaternion = artwork.quaternion.clone().invert().multiply(nextWorldQuaternion);
        artwork.setContentQuaternion(nextLocalQuaternion);
        markAnchorDirty(artwork);
      }
      activeDrag.lastControllerWorldPosition.copy(controllerPosition);
      return;
    }

    if (!ray.intersectPlane(plane, worldPoint)) {
      return;
    }

    const localPoint = worldPointToArtworkLocal(artwork, worldPoint, activeDrag.startContentQuaternion);

    const deltaX = (localPoint.x - activeDrag.startHitLocal.x) * activeDrag.signX * 2;
    const deltaY = (localPoint.y - activeDrag.startHitLocal.y) * activeDrag.signY * 2;

    switch (activeDrag.mode) {
      case "scale-corner":
        if (controller.gripButton.pressed) {
          artwork.scaleLocal(deltaX, deltaY);
          activeDrag.startHitLocal.copy(localPoint);
        } else {
          const startLength = Math.max(activeDrag.startVector.length(), 1e-5);
          const factor = THREE.MathUtils.clamp(localPoint.length() / startLength, 0.15, 20);
          artwork.setLocalSize(activeDrag.startWidth * factor, activeDrag.startHeight * factor);
        }
        markAnchorDirty(artwork);
        break;
      default:
        break;
    }
  };

  const isTrackingReliable = (frame: XRFrame): boolean => {
    if (!xrReferenceSpace || !xrSessionHandle) {
      return false;
    }

    if (xrSessionHandle.visibilityState !== "visible") {
      return false;
    }

    const viewerPose = frame.getViewerPose(xrReferenceSpace);
    return Boolean(viewerPose && !viewerPose.emulatedPosition);
  };

  const endDrag = () => {
    activeDrag = null;
  };

  const refreshStartImageEditorPreview = async (editorOpen: boolean) => {
    if (!sourceStartImageElement) {
      startImageElement = null;
      overlay.setState({
        hasStartImage: false,
        startImagePreviewUrl: "",
        imageEditorPreviewUrl: "",
        imageEditorOpen: false,
        outlineColor: startOutlineColor
      });
      return;
    }

    if (!editorOpen) {
      startImageElement = sourceStartImageElement;
      overlay.setState({
        imageEditorOpen: false,
        imageEditorPreviewUrl: "",
        startImagePreviewUrl: sourceStartImageElement.src,
        outlineThreshold: startOutlineThreshold,
        outlineColor: startOutlineColor
      });
      return;
    }

    const outlineDataUrl = createOutlineImageDataUrl(sourceStartImageElement, startOutlineThreshold, startOutlineColor);
    startImageElement = await loadImageFromDataUrl(outlineDataUrl);
    overlay.setState({
      imageEditorOpen: true,
      imageEditorPreviewUrl: outlineDataUrl,
      startImagePreviewUrl: outlineDataUrl,
      outlineThreshold: startOutlineThreshold,
      outlineColor: startOutlineColor
    });
  };

  overlay.onChooseStartImage((file) => {
    void readFileAsDataUrl(file)
      .then(async (dataUrl) => {
        const image = await loadImageFromDataUrl(dataUrl);
        sourceStartImageElement = image;
        startImageElement = image;
        startOutlineThreshold = 72;
        startOutlineColor = 0;
        overlay.setState({
          hasStartImage: true,
          startImagePreviewUrl: dataUrl,
          imageEditorOpen: false,
          imageEditorPreviewUrl: "",
          outlineThreshold: startOutlineThreshold,
          outlineColor: startOutlineColor
        });
      })
      .catch((error) => {
        console.error("Failed to prepare start image", error);
      });
  });

  overlay.onToggleImageEditor((open) => {
    void refreshStartImageEditorPreview(open).catch((error) => {
      console.error("Failed to build outline preview", error);
    });
  });

  overlay.onOutlineThresholdChange((value) => {
    startOutlineThreshold = value;
    if (!sourceStartImageElement) {
      return;
    }
    void refreshStartImageEditorPreview(true).catch((error) => {
      console.error("Failed to update outline threshold", error);
    });
  });

  overlay.onOutlineColorChange((value) => {
    startOutlineColor = value;
    if (!sourceStartImageElement) {
      return;
    }
    void refreshStartImageEditorPreview(true).catch((error) => {
      console.error("Failed to update outline color", error);
    });
  });

  overlay.onReplaceSelectedFile(async (file) => {
    if (!store.selected) {
      return;
    }

    await store.applyTextureFromFile(store.selected, file);
    updateVisualState();
  });

  overlay.onPresetSelected(async (presetId) => {
    const preset = libraryById.get(presetId);
    if (!preset || !store.selected) {
      return;
    }

    await store.applyTextureFromUrl(store.selected, preset.url);
    updateVisualState();
  });

  overlay.onLock(() => {
    if (!store.selected) {
      return;
    }

    store.selected.setLocked(!store.selected.locked);
    if (!store.selected.locked) {
      markAnchorDirty(store.selected);
    }
    updateVisualState();
  });

  overlay.onDelete(() => {
    endDrag();
    if (store.selected) {
      clearAnchor(store.selected);
    }
    store.removeSelected();
    updateVisualState();
  });

  overlay.onReset(() => {
    resetToInitialArState();
  });

  overlay.onEnterAr(async () => {
    await xrSession.enter();
  });

  const arSupported = await xrSession.isSupported();
  overlay.setState({
    arSupported,
    inSession,
    mode,
    status: "drawing",
    hasSceneObjects: false,
    hasSelection: false,
    selectionLocked: false,
    prompt: APP_CONFIG.ui.holdPrompt,
    hasStartImage: false,
    startImagePreviewUrl: "",
    imageEditorOpen: false,
    imageEditorPreviewUrl: "",
    outlineThreshold: startOutlineThreshold,
    outlineColor: startOutlineColor,
    previewBackgroundHue: 3
  });

  xrSession.onSessionStarted(async ({ session, referenceSpaceType, referenceSpace }) => {
    await hitTest.initialize(session, referenceSpace);
    xrSessionHandle = session;
    xrReferenceSpace = referenceSpace;
    xrReferenceSpaceResetHandler = handleReferenceSpaceReset;
    xrReferenceSpace.addEventListener("reset", xrReferenceSpaceResetHandler as EventListener);
    inSession = true;
    sessionStartedAt = performance.now();
    previewHitLastUpdateAt = 0;
    previewPlacementHit = null;
    clock.start();
    setMode("drawing");
    if (startImageElement && store.objects.length === 0) {
      ensurePreviewArtwork();
    }
    console.info(`XR reference space: ${referenceSpaceType}`);
  });

  xrSession.onSessionEnded(() => {
    if (xrReferenceSpace && xrReferenceSpaceResetHandler) {
      xrReferenceSpace.removeEventListener("reset", xrReferenceSpaceResetHandler as EventListener);
    }
    xrReferenceSpaceResetHandler = null;
    closeResetConfirm();
    closeExitConfirm();
    previewArtwork?.root.removeFromParent();
    previewArtwork = null;
    xrSessionHandle = null;
    xrReferenceSpace = null;
    for (const state of anchorStates.values()) {
      state.binding.clear();
    }
    anchorStates.clear();
    inSession = false;
    sessionStartedAt = 0;
    previewHitLastUpdateAt = 0;
    previewPlacementHit = null;
    endDrag();
    updateVisualState();
  });

  appScene.renderer.setAnimationLoop((_, frame) => {
    const deltaSeconds = clock.getDelta();
    controllers.update();

    if (pendingResetToFreshStart) {
      pendingResetToFreshStart = false;
      resetToInitialArState();
      updateVisualState();
      appScene.renderer.render(appScene.scene, appScene.camera);
      return;
    }

    if (pendingExitSessionEnd) {
      pendingExitSessionEnd = false;
      closeExitConfirm();
      void xrSession.end();
      updateVisualState();
      appScene.renderer.render(appScene.scene, appScene.camera);
      return;
    }

    const controller = controllers.getPreferred();
    void hitTest.setTargetRaySpace(
      controller?.inputSource?.targetRaySpace ?? controller?.inputSource?.gripSpace ?? null
    );

    if (controller) {
      controllers.setRayLength(controller, 1.4);
    }

    if (frame) {
      applyAnchors(frame);
    }

    if (controller?.buttonA.justPressed && !resetConfirmOpen && !exitConfirmOpen) {
      endDrag();
      setMode(mode === "drawing" ? "editing" : "drawing");
    }

    if (resetConfirmOpen || exitConfirmOpen) {
      updateResetConfirmPanel(appScene.camera);
      updateExitConfirmPanel(appScene.camera);
      if (controller) {
        const confirmRay = buildControllerRay(getPointerObject(controller));
        const resetChoice = resetConfirmOpen ? getResetConfirmChoice(confirmRay) : null;
        const exitChoice = exitConfirmOpen ? getExitConfirmChoice(confirmRay) : null;
        setResetConfirmHovered(resetChoice);
        setExitConfirmHovered(exitChoice);
        if (controller.trigger.justPressed && (resetChoice || exitChoice)) {
          suppressSelectionClearOnRelease = true;
          if (resetChoice === "yes") {
            queueResetToFreshStart();
          } else if (exitChoice === "yes") {
            queueExitFromAr();
          } else {
            if (resetChoice) {
              closeResetConfirm();
            }
            if (exitChoice) {
              closeExitConfirm();
            }
          }
        }
      } else {
        setResetConfirmHovered(null);
        setExitConfirmHovered(null);
      }
      updateVisualState();
      appScene.renderer.render(appScene.scene, appScene.camera);
      return;
    }

    if (!controller) {
      store.setHoveredHandle(null);
      updateVisualState();
      appScene.renderer.render(appScene.scene, appScene.camera);
      return;
    }

    const pointerRay = buildControllerRay(getPointerObject(controller));
    const editingIntersection = mode === "editing" ? store.findIntersection(pointerRay, true) : null;
    controllers.setRayLength(
      controller,
      editingIntersection
        ? Math.max(0.02, editingIntersection.point.distanceTo(pointerRay.origin))
        : 1.4
    );

    if (previewArtwork && mode === "drawing") {
      const now = performance.now();
      if (
        frame &&
        isTrackingReliable(frame) &&
        now - sessionStartedAt > 1200 &&
        now - previewHitLastUpdateAt > 100
      ) {
        previewHitLastUpdateAt = now;
        const nextHit = hitTest.update(frame);
        previewPlacementHit =
          nextHit && nextHit.distance >= APP_CONFIG.interaction.minValidHitDistance
            ? nextHit
            : hitTest.getStableHit(APP_CONFIG.interaction.stableHitMaxAgeMs);
      }

      updatePreviewArtwork(
        controller,
        previewPlacementHit && previewPlacementHit.distance >= APP_CONFIG.interaction.minValidHitDistance
          ? previewPlacementHit
          : null
      );
      if (controller.trigger.justPressed) {
        void finalizePreviewPlacement(previewPlacementHit);
      }
    } else if (mode === "editing") {
      if (!activeDrag) {
        store.setHoveredHandle(
          editingIntersection && editingIntersection.handle !== "body" ? editingIntersection.handle : null
        );
      }

      if (controller.trigger.justPressed) {
        const intersection = editingIntersection;
        if (intersection) {
          const wasSelected = store.selected === intersection.object;
          store.select(intersection.object, true);
          if (wasSelected && intersection.handle === PANEL_RESET_BUTTON_NAME && !intersection.object.locked) {
            openResetConfirm();
          } else if (wasSelected && intersection.handle === PANEL_BUTTON_NAME && !intersection.object.locked) {
            beginDepthDrag(controller, intersection.object);
          } else if (wasSelected && intersection.handle === PANEL_TRANSPARENCY_BUTTON_NAME && !intersection.object.locked) {
            beginOpacityDrag(controller, intersection.object);
          } else if (wasSelected && intersection.handle === PANEL_EXIT_BUTTON_NAME && !intersection.object.locked) {
            openExitConfirm();
          } else {
            const dragInfo = handleToDragMode(intersection.handle as HandleName);
            if (wasSelected && dragInfo && !intersection.object.locked) {
              beginDrag(
                controller,
                intersection.object,
                dragInfo.mode,
                dragInfo.signX,
                dragInfo.signY,
                dragInfo.axisLocal
              );
            }
          }
        }
      }

      if (
        controller.trigger.pressed &&
        editingIntersection?.handle === PANEL_BUTTON_NAME &&
        store.selected === editingIntersection.object &&
        !store.selected.locked &&
        !activeDrag
      ) {
        beginDepthDrag(controller, store.selected);
      }

      if (
        controller.trigger.pressed &&
        editingIntersection?.handle === PANEL_TRANSPARENCY_BUTTON_NAME &&
        store.selected === editingIntersection.object &&
        !store.selected.locked &&
        !activeDrag
      ) {
        beginOpacityDrag(controller, store.selected);
      }

      if (controller.trigger.justReleased) {
        if (suppressSelectionClearOnRelease) {
          suppressSelectionClearOnRelease = false;
          return;
        }
        if (
          activeDrag &&
          activeDrag.controller === controller &&
          (activeDrag.mode === "depth" || activeDrag.mode === "opacity")
        ) {
          endDrag();
          return;
        }
        if (activeDrag && activeDrag.controller === controller && activeDrag.mode !== "depth") {
          endDrag();
        } else {
          const intersection = editingIntersection;
          if (intersection && !intersection.object.locked) {
            store.select(intersection.object, true);
          }
        }
      }

      if (activeDrag?.controller === controller) {
        updateDrag();
      } else if (store.selected && !store.selected.locked) {
        const [xAxis, yAxis] = controller.axes;
        if (Math.abs(xAxis) > JOYSTICK_DEAD_ZONE) {
          store.selected.rotateOnSurface(-xAxis * ROTATE_SPEED * deltaSeconds);
          markAnchorDirty(store.selected);
        }
        if (Math.abs(yAxis) > JOYSTICK_DEAD_ZONE) {
          const factor = Math.exp(-yAxis * SCALE_SPEED * deltaSeconds);
          store.selected.scaleUniform(factor);
          markAnchorDirty(store.selected);
        }
      }
    } else {
      endDrag();
      store.setEditingVisuals(false);
      store.setHoveredHandle(null);
    }

    if (frame && xrSessionHandle && xrReferenceSpace && isTrackingReliable(frame)) {
      const shouldFlushSelectedAnchor =
        !activeDrag &&
        (!store.selected ||
          store.selected.locked ||
          (Math.abs(controller.axes[0]) <= JOYSTICK_DEAD_ZONE &&
            Math.abs(controller.axes[1]) <= JOYSTICK_DEAD_ZONE));

      if (shouldFlushSelectedAnchor) {
        for (const artwork of store.objects) {
          const state = anchorStates.get(artwork.id);
          if (state?.dirty && !state.creating) {
            void rebuildAnchorFromFrame(frame, artwork);
          }
        }
      }
    }

    updateVisualState();
    appScene.renderer.render(appScene.scene, appScene.camera);
  });
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  const app = document.querySelector("#app");
  if (app) {
    app.innerHTML = `<section class="panel"><h1>Startup error</h1><p>${message}</p></section>`;
  }
});
