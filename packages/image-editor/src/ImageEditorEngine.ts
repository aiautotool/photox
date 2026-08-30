import type { EditOperation, EditPlugin, ExportOptions, ImageEditRecipe, ImageRendererAdapter, RenderResult } from './types';
import { validateExportOptions, validateOperation, validateRecipe } from './EditValidator';

export class ImageEditorEngine {
  private readonly plugins = new Map<string, EditPlugin>();

  constructor(private readonly renderer: ImageRendererAdapter) {}

  registerPlugin(plugin: EditPlugin): this {
    if (this.plugins.has(plugin.id)) throw new Error(`Edit plugin already registered: ${plugin.id}`);
    this.plugins.set(plugin.id, plugin);
    return this;
  }

  validate(recipe: ImageEditRecipe): void {
    validateRecipe(recipe);
    for (const operation of recipe.operations) {
      if (operation.type === 'custom') {
        const plugin = this.plugins.get(operation.pluginId);
        if (!plugin) throw new Error(`Missing edit plugin: ${operation.pluginId}`);
        plugin.validate(operation);
      } else {
        validateOperation(operation);
      }
      if (this.renderer.supports && !this.renderer.supports(operation)) {
        throw new Error(`Renderer ${this.renderer.id} does not support operation: ${operation.type}`);
      }
    }
  }

  normalize(recipe: ImageEditRecipe): ImageEditRecipe {
    const operations = recipe.operations.map(operation => {
      if (operation.type !== 'custom') return operation;
      const plugin = this.plugins.get(operation.pluginId);
      return plugin?.normalize ? plugin.normalize(operation) : operation;
    });
    return { ...recipe, operations, updatedAt: new Date().toISOString() };
  }

  async export(recipe: ImageEditRecipe, options: ExportOptions): Promise<RenderResult> {
    validateExportOptions(options);
    const normalized = this.normalize(recipe);
    this.validate(normalized);
    return this.renderer.render(normalized, options);
  }

  async preview(recipe: ImageEditRecipe, maxSize = 1600): Promise<RenderResult> {
    const normalized = this.normalize(recipe);
    this.validate(normalized);
    if (this.renderer.preview) return this.renderer.preview(normalized, maxSize);
    return this.renderer.render(normalized, { format: 'jpeg', quality: 0.85, maxWidth: maxSize, maxHeight: maxSize });
  }

  supports(operation: EditOperation): boolean {
    if (operation.type === 'custom' && !this.plugins.has(operation.pluginId)) return false;
    return this.renderer.supports ? this.renderer.supports(operation) : true;
  }
}
