import type { EditOperation, ExportOptions, ImageEditRecipe } from './types';

const finite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
};

export function validateOperation(operation: EditOperation): void {
  switch (operation.type) {
    case 'crop':
      [operation.rect.x, operation.rect.y, operation.rect.width, operation.rect.height].forEach((v, i) => finite(v, `crop[${i}]`));
      if (operation.rect.width <= 0 || operation.rect.height <= 0) throw new Error('Crop width/height must be positive');
      break;
    case 'straighten':
      finite(operation.degrees, 'straighten.degrees');
      if (operation.degrees < -45 || operation.degrees > 45) throw new Error('Straighten must be between -45 and 45 degrees');
      break;
    case 'resize':
      if (!operation.width && !operation.height) throw new Error('Resize requires width or height');
      if ((operation.width ?? 1) <= 0 || (operation.height ?? 1) <= 0) throw new Error('Resize dimensions must be positive');
      break;
    case 'adjust':
      finite(operation.value, `adjust.${operation.name}`);
      if (operation.value < -1 || operation.value > 1) throw new Error(`${operation.name} must be between -1 and 1`);
      break;
    case 'filter':
      if (operation.intensity < 0 || operation.intensity > 1) throw new Error('Filter intensity must be between 0 and 1');
      break;
    case 'text':
      if (!operation.text.trim()) throw new Error('Text operation cannot be empty');
      break;
    case 'draw':
      if (operation.points.length < 2) throw new Error('Draw operation requires at least two points');
      if (operation.width <= 0) throw new Error('Draw width must be positive');
      break;
    case 'blur':
      if (operation.radius <= 0 || operation.strength < 0 || operation.strength > 1) throw new Error('Invalid blur settings');
      break;
    case 'redact':
      if (operation.rect.width <= 0 || operation.rect.height <= 0) throw new Error('Invalid redact rectangle');
      break;
    default:
      break;
  }
}

export function validateRecipe(recipe: ImageEditRecipe): void {
  if (recipe.schemaVersion !== 1) throw new Error(`Unsupported image edit recipe schema: ${recipe.schemaVersion}`);
  if (!recipe.source.uri) throw new Error('Image source URI is required');
  const ids = new Set<string>();
  for (const operation of recipe.operations) {
    if (!operation.id) throw new Error('Every operation requires an id');
    if (ids.has(operation.id)) throw new Error(`Duplicate operation id: ${operation.id}`);
    ids.add(operation.id);
    validateOperation(operation);
  }
}

export function validateExportOptions(options: ExportOptions): void {
  if (options.quality != null && (options.quality < 0 || options.quality > 1)) throw new Error('Export quality must be between 0 and 1');
  if ((options.maxWidth ?? 1) <= 0 || (options.maxHeight ?? 1) <= 0) throw new Error('Export dimensions must be positive');
}
