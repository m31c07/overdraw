import * as THREE from "three";

export interface SurfaceHit {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  quaternion: THREE.Quaternion;
  distance: number;
  poseTransform: XRRigidTransform;
  result: XRHitTestResult;
}

export class XRHitTestManager {
  private session: XRSession | null = null;
  private referenceSpace: XRReferenceSpace | null = null;
  private viewerSpace: XRReferenceSpace | null = null;
  private source: XRHitTestSource | null = null;
  private sourceSpace: XRSpace | null = null;
  private latestHit: SurfaceHit | null = null;
  private stableHit: SurfaceHit | null = null;
  private stableHitTimestamp = 0;
  private candidateHit: SurfaceHit | null = null;
  private candidateHitFrames = 0;

  private acceptHit(hit: SurfaceHit): void {
    this.stableHit = hit;
    this.stableHitTimestamp = performance.now();
    this.candidateHit = null;
    this.candidateHitFrames = 0;
  }

  async initialize(session: XRSession, referenceSpace: XRReferenceSpace): Promise<void> {
    this.session = session;
    this.referenceSpace = referenceSpace;
    this.viewerSpace = await session.requestReferenceSpace("viewer");
    await this.setSpace(this.viewerSpace);
    session.addEventListener("end", () => {
      this.source?.cancel();
      this.source = null;
      this.sourceSpace = null;
      this.referenceSpace = null;
      this.viewerSpace = null;
      this.latestHit = null;
      this.stableHit = null;
      this.stableHitTimestamp = 0;
      this.candidateHit = null;
      this.candidateHitFrames = 0;
      this.session = null;
    });
  }

  async setTargetRaySpace(space: XRSpace | null): Promise<void> {
    await this.setSpace(space ?? this.viewerSpace);
  }

  private async setSpace(space: XRSpace | null): Promise<void> {
    if (!this.session || !space || this.sourceSpace === space) {
      return;
    }

    const requestHitTestSource = this.session.requestHitTestSource?.bind(this.session);
    if (!requestHitTestSource) {
      throw new Error("Hit test is not available in this WebXR runtime.");
    }

    this.source?.cancel();
    this.source =
      (await requestHitTestSource({
        space
      })) ?? null;
    this.sourceSpace = space;
  }

  update(frame: XRFrame): SurfaceHit | null {
    if (!this.referenceSpace || !this.source) {
      this.latestHit = null;
      return null;
    }

    const results = frame.getHitTestResults(this.source);
    const hit = results[0];
    if (!hit) {
      this.latestHit = null;
      return null;
    }

    const pose = hit.getPose(this.referenceSpace);
    if (!pose) {
      this.latestHit = null;
      return null;
    }

    const inputPose = this.sourceSpace ? frame.getPose(this.sourceSpace, this.referenceSpace) : null;
    const sourcePosition = inputPose
      ? new THREE.Vector3(
          inputPose.transform.position.x,
          inputPose.transform.position.y,
          inputPose.transform.position.z
        )
      : null;

    const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();

    this.latestHit = {
      position,
      normal,
      quaternion,
      distance: sourcePosition ? sourcePosition.distanceTo(position) : Infinity,
      poseTransform: pose.transform,
      result: hit
    };

    if (!this.stableHit) {
      this.acceptHit(this.latestHit);
      return this.latestHit;
    }

    const positionDelta = this.latestHit.position.distanceTo(this.stableHit.position);
    const normalDelta = 1 - Math.abs(this.latestHit.normal.dot(this.stableHit.normal));
    const distanceDelta = Math.abs(this.latestHit.distance - this.stableHit.distance);
    const isNearStable =
      positionDelta <= 0.06 &&
      normalDelta <= 0.18 &&
      distanceDelta <= 0.12;

    if (isNearStable) {
      this.acceptHit(this.latestHit);
      return this.latestHit;
    }

    const sameAsCandidate =
      this.candidateHit &&
      this.latestHit.position.distanceTo(this.candidateHit.position) <= 0.04 &&
      1 - Math.abs(this.latestHit.normal.dot(this.candidateHit.normal)) <= 0.12;

    if (sameAsCandidate) {
      this.candidateHitFrames += 1;
    } else {
      this.candidateHit = this.latestHit;
      this.candidateHitFrames = 1;
    }

    if (this.candidateHitFrames >= 3 && this.candidateHit) {
      this.acceptHit(this.candidateHit);
    }

    return this.latestHit;
  }

  getLatestHit(): SurfaceHit | null {
    return this.latestHit;
  }

  getStableHit(maxAgeMs = 180): SurfaceHit | null {
    if (!this.stableHit) {
      return null;
    }

    return performance.now() - this.stableHitTimestamp <= maxAgeMs ? this.stableHit : null;
  }
}
