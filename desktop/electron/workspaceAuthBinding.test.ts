import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBearerRequestBinding } from './workspaceAuth.js';

function request(headers: Record<string, string | undefined>) {
  return { headers } as any;
}

test('bearer request accepts headers bound to the authenticated workspace and device', () => {
  assert.doesNotThrow(() => assertBearerRequestBinding(
    request({ 'x-photosync-workspace-id': 'workspace-a', 'x-photosync-device-id': 'device-a' }),
    { workspaceId: 'workspace-a', deviceId: 'device-a' },
  ));
});

test('bearer request rejects a spoofed workspace header', () => {
  assert.throws(
    () => assertBearerRequestBinding(
      request({ 'x-photosync-workspace-id': 'workspace-b', 'x-photosync-device-id': 'device-a' }),
      { workspaceId: 'workspace-a', deviceId: 'device-a' },
    ),
    /WORKSPACE_SCOPE_MISMATCH/,
  );
});

test('bearer request rejects a spoofed device header', () => {
  assert.throws(
    () => assertBearerRequestBinding(
      request({ 'x-photosync-workspace-id': 'workspace-a', 'x-photosync-device-id': 'device-b' }),
      { workspaceId: 'workspace-a', deviceId: 'device-a' },
    ),
    /DEVICE_SCOPE_MISMATCH/,
  );
});

test('bearer request does not require legacy headers when the endpoint carries binding elsewhere', () => {
  assert.doesNotThrow(() => assertBearerRequestBinding(request({}), { workspaceId: 'workspace-a', deviceId: 'device-a' }));
});
