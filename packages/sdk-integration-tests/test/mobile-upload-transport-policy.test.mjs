import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeMobileUploadPlan,
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

test('runtime executor keeps public resumable failures fail-closed', async () => {
  const attempts = [];
  await assert.rejects(
    executeMobileUploadPlan(planMobileUpload('public'), async (attempt) => {
      attempts.push(attempt);
      throw new Error('public failed');
    }),
    /public failed/,
  );
  assert.deepEqual(attempts, [{ transport: 'public', resumable: true }]);
});

test('runtime executor falls back from LAN resumable to relay whole-file once', async () => {
  const attempts = [];
  const result = await executeMobileUploadPlan(planMobileUpload('local'), async (attempt) => {
    attempts.push(attempt);
    if (attempt.transport === 'local') throw new Error('LAN unavailable');
    return 'relay-ok';
  });
  assert.equal(result, 'relay-ok');
  assert.deepEqual(attempts, [
    { transport: 'local', resumable: true },
    { transport: 'relay', resumable: false },
  ]);
});

test('runtime executor never starts fallback after cancellation', async () => {
  const attempts = [];
  let aborted = false;
  await assert.rejects(
    executeMobileUploadPlan(
      planMobileUpload('local'),
      async (attempt) => {
        attempts.push(attempt);
        aborted = true;
        throw new Error('aborted');
      },
      { isAborted: () => aborted },
    ),
    /aborted/,
  );
  assert.deepEqual(attempts, [{ transport: 'local', resumable: true }]);
});
