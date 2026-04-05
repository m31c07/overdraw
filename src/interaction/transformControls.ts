import * as THREE from "three";
import type { ControllerState } from "../xr/controllerInput";
import { buildControllerRay } from "../xr/session";
import type { StencilPlane } from "../rendering/plane";

const DEAD_ZONE = 0.18;
const SCALE_SPEED = 0.9;
const ROTATE_SPEED = 1.4;

export class SurfaceTransformController {
  private readonly plane: StencilPlane;
  private dragging = false;
  private dragOffset = new THREE.Vector3();
  private activeController: ControllerState | null = null;
  private readonly movementPlane = new THREE.Plane();
  private readonly hitPoint = new THREE.Vector3();

  constructor(plane: StencilPlane) {
    this.plane = plane;
  }

  startDrag(controller: ControllerState): boolean {
    const normal = this.plane.normal;
    this.movementPlane.setFromNormalAndCoplanarPoint(normal, this.plane.position);

    const ray = buildControllerRay(controller.controller);
    const hit = ray.intersectPlane(this.movementPlane, this.hitPoint);
    if (!hit) {
      return false;
    }

    this.dragOffset.copy(this.plane.position).sub(hit);
    this.activeController = controller;
    this.dragging = true;
    return true;
  }

  endDrag(controller: ControllerState): void {
    if (this.activeController !== controller) {
      return;
    }

    this.dragging = false;
    this.activeController = null;
  }

  update(deltaSeconds: number, controller: ControllerState | null): void {
    if (controller && this.dragging && this.activeController === controller) {
      const ray = buildControllerRay(controller.controller);
      const hit = ray.intersectPlane(this.movementPlane, this.hitPoint);
      if (hit) {
        this.plane.position.copy(hit.add(this.dragOffset));
      }
    }

    if (!controller) {
      return;
    }

    const [xAxis, yAxis] = controller.axes;

    if (Math.abs(yAxis) > DEAD_ZONE) {
      const factor = Math.exp(-yAxis * SCALE_SPEED * deltaSeconds);
      this.plane.multiplyScale(factor);
    }

    if (Math.abs(xAxis) > DEAD_ZONE) {
      this.plane.rotateOnSurface(-xAxis * ROTATE_SPEED * deltaSeconds);
    }
  }
}
