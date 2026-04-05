# Overdraw

Minimal WebXR AR app for Meta Quest 3 + Quest Browser with a drawing-first UX: clean drawing mode by default, explicit editing mode, multi-image support, and low-risk controller input mapping.

## Stack

- Vite
- TypeScript
- Three.js
- WebXR `immersive-ar`

## Features

- Drawing mode by default:
  - no ray
  - no controller model
  - no UI
  - only placed images remain visible
- Trigger hold in drawing mode fades all images to ~12%
- Trigger + grip hold in drawing mode hides all images
- Editing mode toggled only by `A`
- Multi-object scene with single active selection
- `B` creates a new image under the current ray / hit-test pose
- Bounding-box editing with:
  - drag inside to move on surface
  - drag edges to scale one axis
  - drag corners to scale both axes
  - drag rotate handle to rotate
- Grip hold moves the selected image along surface normal
- Thumbstick fallback rotate / scale for the selected image
- `Lock` / `Delete` for the selected image
- Start-page image preparation with outline threshold, outline color, and preview background color controls

## Project Structure

```text
.
+-- index.html
+-- package.json
+-- tsconfig.json
+-- vite.config.ts
L-- src
   +-- main.ts
   +-- styles.css
   +-- interaction
   ¦  +-- placement.ts
   ¦  L-- transformControls.ts
   +-- rendering
   ¦  +-- plane.ts
   ¦  +-- reticle.ts
   ¦  +-- scene.ts
   ¦  L-- artwork.ts
   +-- ui
   ¦  L-- overlay.ts
   L-- xr
      +-- controllerInput.ts
      +-- hitTest.ts
      L-- session.ts
```

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the HTTPS dev server:

   ```bash
   npm run dev
   ```

3. Open the printed HTTPS URL from your Quest 3 in Quest Browser.

## Open On Quest

1. Put your development machine and Quest 3 on the same network.
2. Start the app with `npm run dev`.
3. Find your machine IP, for example `https://192.168.1.10:5173`.
4. Open that HTTPS URL in Quest Browser.
5. Accept the local certificate warning if your browser shows one.
6. Upload a PNG or JPG, optionally prepare the outline version on the start page.
7. Press `Enter AR`.
8. Press `A` to enter editing mode.
9. Press `B` to create a new image.
10. Use trigger click / drag plus grip / thumbstick to edit it.
11. Press `A` again to return to clean drawing mode.

## Requirements

- Meta Quest 3
- Quest Browser with WebXR AR support
- HTTPS / secure context
- A room where Quest can build stable spatial understanding

## Input Mapping

- `A`: toggle `drawing <-> editing`
- `B` in editing: create a new image and auto-select it
- Trigger click in editing:
  - click object: select
  - click empty space: deselect
- Trigger drag in editing:
  - body: move on plane
  - edges: single-axis scale
  - corners: two-axis scale
  - rotate handle: rotate
- Grip hold in editing: move selected image along normal
- Thumbstick in editing: fallback rotate / scale for selected image
- Trigger hold in drawing: reduce opacity for all images
- Trigger + grip hold in drawing: hide all images

## State Machine

- `drawing`
  - default mode after session start
  - no UI, no ray, no controller visuals
  - only visibility modulation is active
- `editing`
  - entered only through `A`
  - enables controller ray, controller model, selection, creation, and transform tools

Selection is always single-object. Locked objects stay visible but do not react to normal scene input.

## Placement Geometry

The image orientation follows the requested surface basis:

1. Get surface normal `N` from the hit pose orientation.
2. `worldUp = (0, 1, 0)`
3. `upProjected = normalize(worldUp - dot(worldUp, N) * N)`
4. `right = normalize(cross(upProjected, N))`
5. Build a rotation basis from `right`, `upProjected`, `N`

This keeps the image upright relative to gravity even when the surface is tilted.

## Architecture

- `xr/session.ts`
  Manages the `immersive-ar` session and controller ray construction.
- `xr/hitTest.ts`
  Requests a hit test source and produces world-space hit data.
- `xr/controllerInput.ts`
  Polls controller buttons, exposes `A/B/trigger/grip` snapshots, thumbstick axes, and controller ray visuals.
- `rendering/scene.ts`
  Creates the Three.js renderer, scene, camera, and lights.
- `rendering/artwork.ts`
  Owns multi-object image rendering, per-object handles, selection visuals, and texture replacement.
- `ui/overlay.ts`
  Builds the start page and the lightweight HTML interface.

## Known Limitations

- Hit test can still be noisy on weakly tracked surfaces.
- Handle drag uses controller ray intersection with the image plane, so precision depends on tracking quality and distance.
- Edge and corner scaling currently scales around the object center, not from a pinned opposite edge.
- `Lock` is app-level interaction lock; it does not persist anchors across sessions.
- Only one controller is actively interpreted at a time, with preference for the right-hand controller.

## Next Steps

- Add smoothing for hit position and normal
- Add snapping to common angles or canvas edges
- Add two-controller scale/rotate gestures
- Save and restore persistent anchors
- Add more image presets and fit modes
