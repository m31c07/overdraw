import * as THREE from "three";
import type { AppScene } from "../rendering/scene";

export interface XRSessionStartInfo {
  session: XRSession;
  referenceSpace: XRReferenceSpace;
  referenceSpaceType: XRReferenceSpaceType;
}

export interface XRSessionController {
  isSupported: () => Promise<boolean>;
  enter: () => Promise<void>;
  end: () => Promise<void>;
  onSessionStarted: (callback: (info: XRSessionStartInfo) => void) => void;
  onSessionEnded: (callback: () => void) => void;
}

export function createXRSessionController(appScene: AppScene, overlayRoot: HTMLElement): XRSessionController {
  let sessionStartedCallback: ((info: XRSessionStartInfo) => void) | null = null;
  let sessionEndedCallback: (() => void) | null = null;

  const resolveReferenceSpace = async (
    session: XRSession
  ): Promise<{ space: XRReferenceSpace; type: XRReferenceSpaceType }> => {
    const type: XRReferenceSpaceType = "local-floor";
    const space = await session.requestReferenceSpace(type);
    return { space, type };
  };

  const isSupported = async (): Promise<boolean> => {
    if (!navigator.xr) {
      return false;
    }

    return navigator.xr.isSessionSupported("immersive-ar");
  };

  const enter = async (): Promise<void> => {
    if (!navigator.xr) {
      throw new Error("WebXR is not available in this browser.");
    }

    appScene.renderer.xr.setReferenceSpaceType("local-floor");
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "anchors", "local-floor"],
      domOverlay: { root: overlayRoot }
    } as XRSessionInit);

    await appScene.renderer.xr.setSession(session);
    const resolvedReferenceSpace = await resolveReferenceSpace(session);
    appScene.renderer.xr.setReferenceSpace(resolvedReferenceSpace.space);

    session.addEventListener("end", () => {
      sessionEndedCallback?.();
    });
    sessionStartedCallback?.({
      session,
      referenceSpace: resolvedReferenceSpace.space,
      referenceSpaceType: resolvedReferenceSpace.type
    });
  };

  const end = async (): Promise<void> => {
    const session = appScene.renderer.xr.getSession();
    if (session) {
      await session.end();
    }
  };

  return {
    isSupported,
    enter,
    end,
    onSessionStarted(callback) {
      sessionStartedCallback = callback;
    },
    onSessionEnded(callback) {
      sessionEndedCallback = callback;
    }
  };
}

export function buildControllerRay(controller: THREE.Object3D): THREE.Ray {
  const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
  const direction = new THREE.Vector3(0, 0, -1)
    .transformDirection(controller.matrixWorld)
    .normalize();
  return new THREE.Ray(origin, direction);
}
