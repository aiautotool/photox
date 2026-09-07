import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planMobileUpload,
  shouldFallbackMobileUpload,
} from '../../mobile-sdk/dist/index.js';

test('public upload is resumable and fails closed without legacy fallback', () => {
  const plan = planMobileUpload('public');
  assert.deepEqual(plan, {
    primary: { transport: 'public', resumable: true },
  });
  assert.equal(shouldFallbackMobileUpload(plan, { aborted: false }), false);
});

test('LAN upload prefers resumable and may use relay only for non-abort failures', () => {
  const plan = planMobileUpload('local');
  assert.deepEqual(plan, {
    primary: { transport: 'local', resumable: true },
    fallback: { transport: 'relay', resumable: false },
  });
  assert.equal(shouldFallbackMobileUpload(plan, { aborted: false }), true);
  assert.equal(shouldFallbackMobileUpload(plan, { aborted: true }), false);
});

test('relay connection remains legacy whole-file with no recursive fallback', () => {
  const plan = planMobileUpload('relay');
  assert.deepEqual(plan, {
    primary: { transport: 'relay', resumable: false },
  });
  assert.equal(shouldFallbackMobileUpload(plan, { aborted: false }), false);
});
