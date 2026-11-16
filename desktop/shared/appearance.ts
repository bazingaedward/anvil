export const appearanceFields = {
  uiFontSize: { label: "界面字号", min: 13, max: 18, step: 1, default: 15 },
  chatFontSize: { label: "聊天字号", min: 14, max: 24, step: 1, default: 16 },
  codeFontSize: { label: "代码字号", min: 12, max: 22, step: 1, default: 14 },
  terminalFontSize: {
    label: "终端字号",
    min: 12,
    max: 22,
    step: 1,
    default: 14,
  },
  chatLineHeight: {
    label: "聊天行高",
    min: 1.4,
    max: 2.2,
    step: 0.05,
    default: 1.75,
  },
} as const;
export type AppearanceKey = keyof typeof appearanceFields;
export type Appearance = Record<AppearanceKey, number>;
export function normalizeAppearance(input: unknown): Appearance {
  const values =
    input && typeof input === "object" ? (input as Partial<Appearance>) : {};
  return Object.fromEntries(
    Object.entries(appearanceFields).map(([key, field]) => {
      const value = values[key as AppearanceKey];
      return [
        key,
        typeof value === "number" && Number.isFinite(value)
          ? Number(
              (
                Math.round(
                  Math.max(field.min, Math.min(field.max, value)) / field.step,
                ) * field.step
              ).toFixed(2),
            )
          : field.default,
      ];
    }),
  ) as Appearance;
}
