import type { EditOperation, ImageEditRecipe, ImageSource } from './types';

function now(): string { return new Date().toISOString(); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export class EditSession {
  private past: EditOperation[][] = [];
  private future: EditOperation[][] = [];
  private operations: EditOperation[];

  constructor(private readonly source: ImageSource, initial: EditOperation[] = []) {
    this.operations = clone(initial);
  }

  static fromRecipe(recipe: ImageEditRecipe): EditSession {
    return new EditSession(recipe.source, recipe.operations);
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get length(): number { return this.operations.length; }

  list(): readonly EditOperation[] { return clone(this.operations); }

  apply(operation: EditOperation): this {
    this.snapshot();
    const idx = this.operations.findIndex(op => op.id === operation.id);
    if (idx >= 0) this.operations[idx] = clone(operation);
    else this.operations.push(clone(operation));
    this.future = [];
    return this;
  }

  remove(operationId: string): this {
    if (!this.operations.some(op => op.id === operationId)) return this;
    this.snapshot();
    this.operations = this.operations.filter(op => op.id !== operationId);
    this.future = [];
    return this;
  }

  replaceAll(operations: EditOperation[]): this {
    this.snapshot();
    this.operations = clone(operations);
    this.future = [];
    return this;
  }

  reset(): this {
    if (this.operations.length === 0) return this;
    this.snapshot();
    this.operations = [];
    this.future = [];
    return this;
  }

  undo(): this {
    const previous = this.past.pop();
    if (!previous) return this;
    this.future.push(clone(this.operations));
    this.operations = clone(previous);
    return this;
  }

  redo(): this {
    const next = this.future.pop();
    if (!next) return this;
    this.past.push(clone(this.operations));
    this.operations = clone(next);
    return this;
  }

  recipe(metadata?: Record<string, unknown>): ImageEditRecipe {
    const timestamp = now();
    return {
      schemaVersion: 1,
      source: clone(this.source),
      operations: clone(this.operations),
      createdAt: timestamp,
      updatedAt: timestamp,
      metadata,
    };
  }

  serialize(metadata?: Record<string, unknown>): string {
    return JSON.stringify(this.recipe(metadata));
  }

  private snapshot(): void {
    this.past.push(clone(this.operations));
    if (this.past.length > 100) this.past.shift();
  }
}
