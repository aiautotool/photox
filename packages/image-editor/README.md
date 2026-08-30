# @photox/image-editor

Professional, reusable image-editing core for PhotoX. This package is UI-agnostic and renderer-agnostic: the app can later connect IMG.LY, a native editor, GPU pipeline, server renderer, or another engine without changing the edit recipe used by the app.

## Design goals

- Non-destructive edits: the original image is never mutated by the core.
- Versioned edit recipes that can be persisted and restored.
- Undo/redo history independent from UI.
- Stable operations for crop, rotate, straighten, flip, resize, tonal/color adjustments, filters, text, drawing, stickers, blur and redaction.
- Extensible custom-operation plugins.
- Renderer capability checks so unsupported operations fail before export.
- Export presets for original/high-quality/social/thumbnail/lossless workflows.
- Privacy-aware export options such as GPS stripping.

## Basic usage

```ts
import {
  CallbackRendererAdapter,
  EditSession,
  ImageEditorEngine,
  resolveExportPreset,
} from '@photox/image-editor';

const renderer = new CallbackRendererAdapter('imgly', {
  async render(recipe, options) {
    // Translate PhotoX recipe -> IMG.LY/native renderer here.
    return { uri: 'file:///edited.jpg' };
  },
});

const engine = new ImageEditorEngine(renderer);
const session = new EditSession({ uri: 'file:///IMG_001.jpg' });

session
  .apply({ id: 'crop', type: 'crop', rect: { x: 0, y: 0, width: 2000, height: 2000, aspect: '1:1' } })
  .apply({ id: 'exposure', type: 'adjust', name: 'exposure', value: 0.15 })
  .apply({ id: 'vibrance', type: 'adjust', name: 'vibrance', value: 0.2 });

session.undo();
session.redo();

const result = await engine.export(session.recipe(), resolveExportPreset('highQuality'));
```

## Persistence

Store `session.serialize()` beside PhotoX media metadata. The stored recipe references the original asset and contains only edit operations. A future renderer can re-render from the same recipe without repeatedly recompressing the previously edited file.

## Adapter strategy

`CallbackRendererAdapter` is the migration bridge. Later PhotoX mobile can inject an IMG.LY implementation; desktop can inject a native/Sharp/Canvas/GPU implementation. The app/UI should depend on `@photox/image-editor`, not directly on the renderer library.
