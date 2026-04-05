import type { SurfaceHit } from "../xr/hitTest";
import { makeQuaternionFromNormal, type ArtworkPlane } from "../rendering/plane";

export type PlacementStatus = "idle" | "aim at surface" | "placed" | "locked";

export interface PlacementState {
  status: PlacementStatus;
  locked: boolean;
  placed: boolean;
  lastHit: SurfaceHit | null;
}

export class PlacementController {
  private readonly plane: ArtworkPlane;
  readonly state: PlacementState = {
    status: "idle",
    locked: false,
    placed: false,
    lastHit: null
  };

  constructor(plane: ArtworkPlane) {
    this.plane = plane;
  }

  updateHit(hit: SurfaceHit | null): void {
    this.state.lastHit = hit;
    if (this.state.locked) {
      this.state.status = "locked";
      return;
    }

    if (this.state.placed) {
      this.state.status = "placed";
      return;
    }

    this.state.status = "aim at surface";
  }

  placeFromHit(hit: SurfaceHit): void {
    const quaternion = makeQuaternionFromNormal(hit.normal);
    this.plane.applyPoseWithQuaternion(hit.position, quaternion);
    this.state.placed = true;
    this.state.locked = false;
    this.state.status = "placed";
  }

  lock(): void {
    if (!this.state.placed) {
      return;
    }

    this.state.locked = true;
    this.state.status = "locked";
  }

  unlock(): void {
    if (!this.state.placed) {
      return;
    }

    this.state.locked = false;
    this.state.status = "placed";
  }

  reset(): void {
    this.plane.reset();
    this.state.placed = false;
    this.state.locked = false;
    this.state.status = "aim at surface";
  }
}
