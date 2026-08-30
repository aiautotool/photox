import type { EditOperation, ExportOptions, ImageEditRecipe, ImageRendererAdapter, RenderProgress, RenderResult } from './types';

export interface CallbackRendererHandlers {
  render(recipe: ImageEditRecipe, options: ExportOptions, onProgress?: (progress: RenderProgress) => void): Promise<RenderResult>;
  preview?(recipe: ImageEditRecipe, maxSize?: number): Promise<RenderResult>;
  supports?(operation: EditOperation): boolean;
}

export class CallbackRendererAdapter implements ImageRendererAdapter {
  constructor(public readonly id: string, private readonly handlers: CallbackRendererHandlers) {}
  render(recipe: ImageEditRecipe, options: ExportOptions, onProgress?: (progress: RenderProgress) => void): Promise<RenderResult> {
    return this.handlers.render(recipe, options, onProgress);
  }
  preview(recipe: ImageEditRecipe, maxSize?: number): Promise<RenderResult> {
    if (!this.handlers.preview) return this.handlers.render(recipe, { format: 'jpeg', quality: 0.85, maxWidth: maxSize, maxHeight: maxSize });
    return this.handlers.preview(recipe, maxSize);
  }
  supports(operation: EditOperation): boolean { return this.handlers.supports?.(operation) ?? true; }
}
