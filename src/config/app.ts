export const APP_CONFIG = {
  creation: {
    holdDurationMs: 1500,
    timerRadius: 96,
    timerLineWidth: 14,
    previewOffset: { x: 0, y: 0.02, z: -0.24 },
    previewScale: 0.32
  },
  exit: {
    holdDurationMs: 2000
  },
  interaction: {
    minValidHitDistance: 0.18,
    stableHitMaxAgeMs: 180
  },
  ui: {
    holdPrompt: "Зажмите курок",
    editModeHint: "A • Рисование/Редактирование"
  }
} as const;