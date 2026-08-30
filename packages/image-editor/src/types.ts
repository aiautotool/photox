export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic';

export type CropAspect = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | `${number}:${number}`;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  aspect?: CropAspect;
}

export interface Point { x: number; y: number; }

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | number;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  align?: 'left' | 'center' | 'right';
}

export type AdjustmentName =
  | 'exposure' | 'brightness' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks'
  | 'saturation' | 'vibrance' | 'temperature' | 'tint'
  | 'clarity' | 'sharpness' | 'texture' | 'dehaze' | 'noiseReduction' | 'colorNoiseReduction'
  | 'vignette' | 'grain' | 'fade' | 'bloom' | 'glow';

export type EditOperation =
  | { id: string; type: 'crop'; rect: CropRect }
  | { id: string; type: 'rotate'; degrees: 90 | 180 | 270 }
  | { id: string; type: 'straighten'; degrees: number }
  | { id: string; type: 'flip'; axis: 'horizontal' | 'vertical' }
  | { id: string; type: 'resize'; width?: number; height?: number; fit?: 'contain' | 'cover' | 'fill'; preventUpscale?: boolean }
  | { id: string; type: 'adjust'; name: AdjustmentName; value: number }
  | { id: string; type: 'filter'; filterId: string; intensity: number }
  | { id: string; type: 'text'; text: string; position: Point; rotation?: number; style?: TextStyle }
  | { id: string; type: 'draw'; points: Point[]; color: string; width: number; opacity?: number }
  | { id: string; type: 'sticker'; stickerId: string; position: Point; scale?: number; rotation?: number }
  | { id: string; type: 'blur'; center: Point; radius: number; strength: number }
  | { id: string; type: 'redact'; rect: CropRect; mode: 'blur' | 'pixelate' | 'solid'; color?: string }
  | { id: string; type: 'custom'; pluginId: string; payload: Record<string, unknown> };

export interface ImageSource {
  uri: string;
  width?: number;
  height?: number;
  mimeType?: string;
  checksum?: string;
}

export interface ImageEditRecipe {
  schemaVersion: 1;
  source: ImageSource;
  operations: EditOperation[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExportOptions {
  format: ImageFormat;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  preserveMetadata?: boolean;
  colorSpace?: 'srgb' | 'display-p3';
  stripGps?: boolean;
  filename?: string;
}

export interface RenderProgress {
  stage: 'prepare' | 'render' | 'encode' | 'write';
  progress: number;
}

export interface RenderResult {
  uri: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  mimeType?: string;
  checksum?: string;
}

export interface ImageRendererAdapter {
  readonly id: string;
  render(recipe: ImageEditRecipe, options: ExportOptions, onProgress?: (progress: RenderProgress) => void): Promise<RenderResult>;
  preview?(recipe: ImageEditRecipe, maxSize?: number): Promise<RenderResult>;
  supports?(operation: EditOperation): boolean;
}

export interface EditPlugin {
  readonly id: string;
  validate(operation: EditOperation): void;
  normalize?(operation: EditOperation): EditOperation;
}

export type EditRecipe = ImageEditRecipe;
export type EditSource = ImageSource;
export type RendererAdapter = ImageRendererAdapter;
