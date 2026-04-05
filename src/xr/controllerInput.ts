import * as THREE from "three";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import type { AppScene } from "../rendering/scene";

export interface ButtonSnapshot {
  pressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  value: number;
}

export interface ControllerState {
  index: number;
  controller: THREE.Group;
  grip: THREE.Group;
  ray: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  axes: [number, number];
  trigger: ButtonSnapshot;
  gripButton: ButtonSnapshot;
  buttonA: ButtonSnapshot;
  buttonB: ButtonSnapshot;
  handedness: XRHandedness | "none";
  inputSource: XRInputSource | null;
}

export interface XRControllerManager {
  primary: ControllerState;
  secondary: ControllerState;
  update: () => void;
  getPreferred: () => ControllerState | null;
  setEditingVisible: (visible: boolean) => void;
  setRayLength: (controller: ControllerState, length: number) => void;
}

function createButton(): ButtonSnapshot {
  return {
    pressed: false,
    justPressed: false,
    justReleased: false,
    value: 0
  };
}

function createState(index: number): ControllerState {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1.4)
  ]);
  const material = new THREE.LineBasicMaterial({
    color: 0xf2f7ff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false
  });
  const ray = new THREE.Line(geometry, material);
  ray.visible = false;

  return {
    index,
    controller: new THREE.Group(),
    grip: new THREE.Group(),
    ray,
    axes: [0, 0],
    trigger: createButton(),
    gripButton: createButton(),
    buttonA: createButton(),
    buttonB: createButton(),
    handedness: "none",
    inputSource: null
  };
}

function sampleButton(button: ButtonSnapshot, gamepadButton: GamepadButton | undefined): void {
  const nextPressed = Boolean(gamepadButton?.pressed);
  button.justPressed = !button.pressed && nextPressed;
  button.justReleased = button.pressed && !nextPressed;
  button.pressed = nextPressed;
  button.value = gamepadButton?.value ?? 0;
}

export function createControllerManager(appScene: AppScene): XRControllerManager {
  const modelFactory = new XRControllerModelFactory();
  const primary = createState(0);
  const secondary = createState(1);

  const attachController = (state: ControllerState) => {
    const controller = appScene.renderer.xr.getController(state.index);
    controller.addEventListener("connected", (event) => {
      const data = event.data as XRInputSource;
      state.inputSource = data;
      state.handedness = data.handedness;
    });
    controller.addEventListener("disconnected", () => {
      state.inputSource = null;
      state.handedness = "none";
    });

    const grip = appScene.renderer.xr.getControllerGrip(state.index);
    grip.add(modelFactory.createControllerModel(grip));
    controller.add(state.ray);

    state.controller = controller;
    state.grip = grip;

    appScene.scene.add(controller);
    appScene.scene.add(grip);
  };

  attachController(primary);
  attachController(secondary);

  const updateState = (state: ControllerState) => {
    const gamepad = state.inputSource?.gamepad;
    if (!gamepad) {
      state.axes = [0, 0];
      sampleButton(state.trigger, undefined);
      sampleButton(state.gripButton, undefined);
      sampleButton(state.buttonA, undefined);
      sampleButton(state.buttonB, undefined);
      return;
    }

    state.axes = [gamepad.axes[2] ?? gamepad.axes[0] ?? 0, gamepad.axes[3] ?? gamepad.axes[1] ?? 0];
    sampleButton(state.trigger, gamepad.buttons[0]);
    sampleButton(state.gripButton, gamepad.buttons[1]);
    sampleButton(state.buttonA, gamepad.buttons[4]);
    sampleButton(state.buttonB, gamepad.buttons[5]);
  };

  const getPreferred = (): ControllerState | null => {
    const states = [primary, secondary];
    return (
      states.find((state) => state.inputSource && state.handedness === "right") ??
      states.find((state) => state.inputSource) ??
      null
    );
  };

  return {
    primary,
    secondary,
    update: () => {
      updateState(primary);
      updateState(secondary);
    },
    getPreferred,
    setEditingVisible: (visible: boolean) => {
      for (const state of [primary, secondary]) {
        state.controller.visible = visible;
        state.grip.visible = visible;
        state.ray.visible = visible;
      }
    },
    setRayLength: (controller: ControllerState, length: number) => {
      const positions = controller.ray.geometry.attributes.position;
      positions.setXYZ(0, 0, 0, 0);
      positions.setXYZ(1, 0, 0, -Math.max(0.02, length));
      positions.needsUpdate = true;
    }
  };
}
