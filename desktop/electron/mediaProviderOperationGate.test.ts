import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaProviderOperationGate } from './mediaProviderOperationGate.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('serializes operations for the same workspace and media key', async () => {
  const gate = createMediaProviderOperationGate();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>(resolve => { releaseFirst = resolve; });

  const first = gate.run('ws-a', 'media-1', async () => {
    events.push('first:start');
    await firstBlocked;
    events.push('first:end');
  });
  await delay(5);
  const second = gate.run('ws-a', 'media-1', async () => {
    events.push('second:start');
    events.push('second:end');
  });

  await delay(5);
  assert.deepEqual(events, ['first:start']);
  assert.equal(gate.pending('ws-a', 'media-1'), 2);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  assert.equal(gate.pending('ws-a', 'media-1'), 0);
});

test('does not serialize different media identities', async () => {
  const gate = createMediaProviderOperationGate();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];

  const first = gate.run('ws-a', 'media-1', async () => {
    events.push('a:start');
    await blocked;
    events.push('a:end');
  });
  const second = gate.run('ws-a', 'media-2', async () => {
    events.push('b:start');
    events.push('b:end');
  });

  await second;
  assert.deepEqual(events, ['a:start', 'b:start', 'b:end']);
  release();
  await first;
});

test('workspace is part of the provider-operation identity', async () => {
  const gate = createMediaProviderOperationGate();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let otherWorkspaceRan = false;

  const first = gate.run('ws-a', 'same-key', async () => { await blocked; });
  await gate.run('ws-b', 'same-key', async () => { otherWorkspaceRan = true; });
  assert.equal(otherWorkspaceRan, true);
  release();
  await first;
});

test('a failed operation releases the next waiter', async () => {
  const gate = createMediaProviderOperationGate();
  const first = gate.run('ws-a', 'media-1', async () => { throw new Error('boom'); });
  const second = gate.run('ws-a', 'media-1', async () => 'recovered');
  await assert.rejects(first, /boom/);
  assert.equal(await second, 'recovered');
  assert.equal(gate.pending('ws-a', 'media-1'), 0);
});
