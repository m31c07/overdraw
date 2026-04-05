export interface LibraryItem {
  id: string;
  label: string;
  url: string;
}

export interface OverlayState {
  mode: "drawing" | "editing";
  status: string;
  arSupported: boolean;
  inSession: boolean;
  hasSceneObjects: boolean;
  hasSelection: boolean;
  selectionLocked: boolean;
  prompt: string;
  hasStartImage: boolean;
  startImagePreviewUrl: string;
  returnToArReady: boolean;
  imageEditorOpen: boolean;
  imageEditorPreviewUrl: string;
  outlineThreshold: number;
  outlineColor: number;
  previewBackgroundHue: number;
}

export interface OverlayController {
  root: HTMLElement;
  canvasHost: HTMLElement;
  onEnterAr: (callback: () => void) => void;
  onChooseStartImage: (callback: (file: File) => void) => void;
  onToggleImageEditor: (callback: (open: boolean) => void) => void;
  onOutlineThresholdChange: (callback: (value: number) => void) => void;
  onOutlineColorChange: (callback: (value: number) => void) => void;
  onReset: (callback: () => void) => void;
  onLock: (callback: () => void) => void;
  onDelete: (callback: () => void) => void;
  onReplaceSelectedFile: (callback: (file: File) => void) => void;
  onPresetSelected: (callback: (presetId: string) => void) => void;
  openReplacePicker: () => void;
  setState: (patch: Partial<OverlayState>) => void;
}

export function createOverlay(library: LibraryItem[]): OverlayController {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("App root not found.");
  }

  const libraryMarkup = library
    .map((item) => `<button class="preset-btn" data-preset-id="${item.id}" type="button">${item.label}</button>`)
    .join("");

  app.innerHTML = `
    <div class="shell">
      <div class="canvas-host" id="canvas-host"></div>
      <input class="hidden-file-input" id="replace-file-input" type="file" accept="image/png,image/jpeg" />
      <input class="hidden-file-input" id="start-file-input" type="file" accept="image/png,image/jpeg" />
      <section class="panel" id="home-panel">
        <h1>Overdraw</h1>
        <p>Выберите картинку, при желании подготовьте контур, затем входите в AR.</p>
        <div class="stack">
          <div class="start-preview" id="start-preview-wrap">
            <img class="start-preview-image" id="start-preview-image" alt="Selected image preview" />
          </div>
          <button class="btn" id="choose-start-image" type="button">Выбрать картинку</button>
          <button class="btn" id="toggle-image-editor" type="button">Подготовить контур</button>
          <section class="image-editor" id="image-editor">
            <div class="image-editor-preview">
              <img class="start-preview-image" id="image-editor-preview-image" alt="Outline preview" />
            </div>
            <div class="slider-row">
              <label for="outline-threshold">Прозрачность фона</label>
              <input id="outline-threshold" type="range" min="0" max="100" step="1" value="72" />
              <span class="hint" id="outline-threshold-value">72%</span>
            </div>
            <div class="slider-row">
              <label for="outline-color">Цвет контура</label>
              <input id="outline-color" type="range" min="0" max="255" step="1" value="0" />
              <span class="hint" id="outline-color-value">0</span>
            </div>
            <div class="slider-row">
              <label for="preview-background-hue">Цвет тестового фона</label>
              <input id="preview-background-hue" type="range" min="0" max="255" step="1" value="3" />
              <span class="hint" id="preview-background-hue-value">3</span>
            </div>
          </section>
          <div class="overlay-actions overlay-actions-two">
            <button class="btn btn-primary" id="enter-ar">Enter AR</button>
            <button class="btn" id="reset-home">Reset scene</button>
          </div>
          <button class="btn btn-primary return-ar-btn" id="return-ar">Вернуться в AR</button>
          <p class="hint" id="support-label"></p>
        </div>
      </section>
      <div class="prompt-overlay" id="prompt-overlay"></div>
      <section class="overlay" id="xr-overlay">
        <div class="overlay-top">
          <span class="status-chip" id="status-label">drawing</span>
          <div class="overlay-actions overlay-actions-three">
            <button class="btn" id="lock-btn" type="button">Lock</button>
            <button class="btn danger-btn" id="delete-btn" type="button">Delete</button>
          </div>
        </div>
        <div class="preset-grid" id="preset-grid">${libraryMarkup}</div>
        <p class="hint">B creates a new image. Trigger click selects. Drag handles move, scale, and rotate. Grip hold moves in depth.</p>
      </section>
    </div>
  `;

  const shell = document.querySelector<HTMLElement>(".shell");
  const canvasHost = document.querySelector<HTMLElement>("#canvas-host");
  const homePanel = document.querySelector<HTMLElement>("#home-panel");
  const overlay = document.querySelector<HTMLElement>("#xr-overlay");
  const promptOverlay = document.querySelector<HTMLElement>("#prompt-overlay");
  const supportLabel = document.querySelector<HTMLElement>("#support-label");
  const enterArButton = document.querySelector<HTMLButtonElement>("#enter-ar");
  const chooseStartImageButton = document.querySelector<HTMLButtonElement>("#choose-start-image");
  const toggleImageEditorButton = document.querySelector<HTMLButtonElement>("#toggle-image-editor");
  const returnArButton = document.querySelector<HTMLButtonElement>("#return-ar");
  const startPreviewWrap = document.querySelector<HTMLElement>("#start-preview-wrap");
  const startPreviewImage = document.querySelector<HTMLImageElement>("#start-preview-image");
  const imageEditor = document.querySelector<HTMLElement>("#image-editor");
  const imageEditorPreviewImage = document.querySelector<HTMLImageElement>("#image-editor-preview-image");
  const outlineThresholdInput = document.querySelector<HTMLInputElement>("#outline-threshold");
  const outlineThresholdValue = document.querySelector<HTMLElement>("#outline-threshold-value");
  const outlineColorInput = document.querySelector<HTMLInputElement>("#outline-color");
  const outlineColorValue = document.querySelector<HTMLElement>("#outline-color-value");
  const previewBackgroundHueInput = document.querySelector<HTMLInputElement>("#preview-background-hue");
  const previewBackgroundHueValue = document.querySelector<HTMLElement>("#preview-background-hue-value");
  const statusLabel = document.querySelector<HTMLElement>("#status-label");
  const lockButton = document.querySelector<HTMLButtonElement>("#lock-btn");
  const deleteButton = document.querySelector<HTMLButtonElement>("#delete-btn");
  const resetHomeButton = document.querySelector<HTMLButtonElement>("#reset-home");
  const replaceFileInput = document.querySelector<HTMLInputElement>("#replace-file-input");
  const startFileInput = document.querySelector<HTMLInputElement>("#start-file-input");
  const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-preset-id]"));

  if (
    !shell ||
    !canvasHost ||
    !homePanel ||
    !overlay ||
    !promptOverlay ||
    !supportLabel ||
    !enterArButton ||
    !chooseStartImageButton ||
    !toggleImageEditorButton ||
    !returnArButton ||
    !startPreviewWrap ||
    !startPreviewImage ||
    !imageEditor ||
    !imageEditorPreviewImage ||
    !outlineThresholdInput ||
    !outlineThresholdValue ||
    !outlineColorInput ||
    !outlineColorValue ||
    !previewBackgroundHueInput ||
    !previewBackgroundHueValue ||
    !statusLabel ||
    !lockButton ||
    !deleteButton ||
    !resetHomeButton ||
    !replaceFileInput ||
    !startFileInput
  ) {
    throw new Error("Overlay UI elements are missing.");
  }

  const state: OverlayState = {
    mode: "drawing",
    status: "drawing",
    arSupported: false,
    inSession: false,
    hasSceneObjects: false,
    hasSelection: false,
    selectionLocked: false,
    prompt: "",
    hasStartImage: false,
    startImagePreviewUrl: "",
    returnToArReady: false,
    imageEditorOpen: false,
    imageEditorPreviewUrl: "",
    outlineThreshold: 72,
    outlineColor: 0,
    previewBackgroundHue: 3
  };

  const sync = () => {
    const showReturnToAr = !state.inSession && state.hasSceneObjects;
    statusLabel.textContent = state.status;
    promptOverlay.textContent = state.prompt;
    promptOverlay.classList.toggle("active", state.inSession && state.prompt.length > 0);
    supportLabel.textContent = state.arSupported
      ? "Quest Browser with HTTPS should support immersive-ar hit test."
      : "immersive-ar is not reported as supported in this browser.";
    enterArButton.disabled = !state.arSupported;
    chooseStartImageButton.textContent = state.hasStartImage ? "Картинка выбрана" : "Выбрать картинку";
    toggleImageEditorButton.disabled = !state.hasStartImage;
    toggleImageEditorButton.style.display = state.hasStartImage ? "block" : "none";
    toggleImageEditorButton.textContent = state.imageEditorOpen ? "Скрыть редактор" : "Подготовить контур";
    startPreviewWrap.style.display = state.startImagePreviewUrl ? "block" : "none";
    startPreviewImage.src = state.startImagePreviewUrl;
    imageEditor.style.display = state.hasStartImage && state.imageEditorOpen ? "grid" : "none";
    imageEditorPreviewImage.src = state.imageEditorPreviewUrl || state.startImagePreviewUrl;
    imageEditorPreviewImage.style.background = `hsl(${Math.round((state.previewBackgroundHue / 255) * 360)}deg 70% 55%)`;
    outlineThresholdInput.value = String(state.outlineThreshold);
    outlineThresholdValue.textContent = `${state.outlineThreshold}%`;
    outlineColorInput.value = String(state.outlineColor);
    outlineColorValue.textContent = String(state.outlineColor);
    previewBackgroundHueInput.value = String(state.previewBackgroundHue);
    previewBackgroundHueValue.textContent = String(state.previewBackgroundHue);
    returnArButton.disabled = !state.arSupported;
    enterArButton.style.display = showReturnToAr ? "none" : "block";
    returnArButton.style.display = showReturnToAr ? "block" : "none";
    lockButton.disabled = !state.inSession || !state.hasSelection;
    lockButton.textContent = state.selectionLocked ? "Unlock" : "Lock";
    deleteButton.disabled = !state.inSession || !state.hasSelection;
    replaceFileInput.disabled = !state.hasSelection;
    for (const button of presetButtons) {
      button.disabled = !state.inSession || !state.hasSelection;
    }
    homePanel.style.display = state.inSession ? "none" : "block";
    overlay.classList.remove("active");
  };

  previewBackgroundHueInput.addEventListener("input", () => {
    state.previewBackgroundHue = Number(previewBackgroundHueInput.value);
    sync();
  });

  sync();

  return {
    root: shell,
    canvasHost,
    onEnterAr(callback) {
      enterArButton.addEventListener("click", callback);
      returnArButton.addEventListener("click", callback);
    },
    onChooseStartImage(callback) {
      chooseStartImageButton.addEventListener("click", () => {
        startFileInput.click();
      });
      startFileInput.addEventListener("change", () => {
        const file = startFileInput.files?.[0];
        if (file) {
          callback(file);
          startFileInput.value = "";
        }
      });
    },
    onToggleImageEditor(callback) {
      toggleImageEditorButton.addEventListener("click", () => {
        callback(!state.imageEditorOpen);
      });
    },
    onOutlineThresholdChange(callback) {
      outlineThresholdInput.addEventListener("input", () => {
        callback(Number(outlineThresholdInput.value));
      });
    },
    onOutlineColorChange(callback) {
      outlineColorInput.addEventListener("input", () => {
        callback(Number(outlineColorInput.value));
      });
    },
    onReset(callback) {
      resetHomeButton.addEventListener("click", callback);
    },
    onLock(callback) {
      lockButton.addEventListener("click", callback);
    },
    onDelete(callback) {
      deleteButton.addEventListener("click", callback);
    },
    onReplaceSelectedFile(callback) {
      replaceFileInput.addEventListener("change", () => {
        const file = replaceFileInput.files?.[0];
        if (file) {
          callback(file);
          replaceFileInput.value = "";
        }
      });
    },
    onPresetSelected(callback) {
      for (const button of presetButtons) {
        button.addEventListener("click", () => {
          const presetId = button.dataset.presetId;
          if (presetId) {
            callback(presetId);
          }
        });
      }
    },
    openReplacePicker() {
      if (!replaceFileInput.disabled) {
        replaceFileInput.click();
      }
    },
    setState(patch) {
      Object.assign(state, patch);
      sync();
    }
  };
}