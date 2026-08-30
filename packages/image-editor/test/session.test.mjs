import test from 'node:test';
import assert from 'node:assert/strict';
import { EditSession, ImageEditorEngine, CallbackRendererAdapter, resolveExportPreset } from '../dist/index.js';

test('EditSession supports non-destructive undo/redo', () => {
  const session = new EditSession({ uri: 'file:///photo.jpg', width: 4000, height: 3000 });
  session.apply({ id: 'crop-1', type: 'crop', rect: { x: 0, y: 0, width: 3000, height: 3000, aspect: '1:1' } });
  session.apply({ id: 'exp-1', type: 'adjust', name: 'exposure', value: 0.2 });
  assert.equal(session.length, 2);
  session.undo();
  assert.equal(session.length, 1);
  session.redo();
  assert.equal(session.length, 2);
  assert.equal(session.recipe().source.uri, 'file:///photo.jpg');
});

test('renderer adapter receives validated recipe and export options', async () => {
  let received;
  const renderer = new CallbackRendererAdapter('test', {
    async render(recipe, options) {
      received = { recipe, options };
      return { uri: 'file:///edited.jpg', width: 2048, height: 1536 };
    },
  });
  const engine = new ImageEditorEngine(renderer);
  const session = new EditSession({ uri: 'file:///photo.jpg' });
  session.apply({ id: 'sat-1', type: 'adjust', name: 'saturation', value: 0.3 });
  const result = await engine.export(session.recipe(), resolveExportPreset('social'));
  assert.equal(result.uri, 'file:///edited.jpg');
  assert.equal(received.recipe.operations[0].type, 'adjust');
  assert.equal(received.options.maxWidth, 2048);
});
