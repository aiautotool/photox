import type { ExportOptions } from './types';

export const ExportPresets = {
  original: { format: 'jpeg', quality: 0.95, preserveMetadata: true, colorSpace: 'srgb', stripGps: false } satisfies ExportOptions,
  highQuality: { format: 'jpeg', quality: 0.92, preserveMetadata: true, colorSpace: 'srgb', stripGps: true } satisfies ExportOptions,
  social: { format: 'jpeg', quality: 0.88, maxWidth: 2048, maxHeight: 2048, preserveMetadata: false, colorSpace: 'srgb', stripGps: true } satisfies ExportOptions,
  thumbnail: { format: 'jpeg', quality: 0.8, maxWidth: 512, maxHeight: 512, preserveMetadata: false, colorSpace: 'srgb', stripGps: true } satisfies ExportOptions,
  lossless: { format: 'png', preserveMetadata: false, colorSpace: 'srgb', stripGps: true } satisfies ExportOptions,
} as const;

export type ExportPresetName = keyof typeof ExportPresets;

export function resolveExportPreset(name: ExportPresetName, overrides: Partial<ExportOptions> = {}): ExportOptions {
  return { ...ExportPresets[name], ...overrides } as ExportOptions;
}
