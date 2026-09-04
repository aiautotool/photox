import assert from 'node:assert/strict';
import test from 'node:test';
import { DriveAllocationWebTransport, driveAllocationActorFromWebPrincipal } from './driveAllocationWebTransport.js';

function service(overrides: Partial<{list:(actor:any)=>Promise<any[]>;update:(actor:any,accountId:string,body:unknown)=>Promise<any>}> = {}) {
  return {
    list: overrides.list ?? (async actor => [{ id: 'drive-a', email: 'a@example.com', status: 'ready', maxUsageRatio: 2 / 3, safetyReserveBytes: 104857600, totalBytes: 1000, usedBytes: 100, freeBytes: 900, allocationLimitBytes: 666, photoXUsedBytes: 10, writableBytes: 656 }]),
    update: overrides.update ?? (async (actor, accountId, body) => ({ id: accountId, email: 'a@example.com', status: 'ready', maxUsageRatio: (body as any).maxUsageRatio ?? 2 / 3, safetyReserveBytes: (body as any).safetyReserveBytes ?? 104857600, totalBytes: 1000, usedBytes: 100, freeBytes: 900, allocationLimitBytes: 500, photoXUsedBytes: 10, writableBytes: 490 })),
  } as any;
}

test('web principal becomes server-derived Drive allocation actor', () => {
  assert.deepEqual(driveAllocationActorFromWebPrincipal({subject:'user-a',workspaceId:'ws-a',workspaceRole:'admin',deviceId:'web-a',sessionId:'session-a'}), {
    workspaceId:'ws-a',userId:'user-a',deviceId:'web-a',role:'admin',
  });
});

test('missing web role fails closed as viewer', () => {
  assert.equal(driveAllocationActorFromWebPrincipal({subject:'user-a',workspaceId:'ws-a'}).role, 'viewer');
});

test('list passes only server-derived workspace identity to service', async () => {
  let seen:any;
  const transport=new DriveAllocationWebTransport(service({list:async actor=>{seen=actor;return [];}}));
  const result=await transport.list({subject:'user-a',workspaceId:'ws-a',workspaceRole:'member',deviceId:'web-a'});
  assert.equal(result.ok,true);
  assert.deepEqual(seen,{workspaceId:'ws-a',userId:'user-a',deviceId:'web-a',role:'member'});
});

test('owner/admin update passes account id and strict body to service', async () => {
  let seen:any;
  const transport=new DriveAllocationWebTransport(service({update:async(actor,accountId,body)=>{seen={actor,accountId,body};return {id:accountId};}}));
  const body={maxUsageRatio:.72,safetyReserveBytes:134217728};
  const result=await transport.update({subject:'owner-a',workspaceId:'ws-a',workspaceRole:'owner',deviceId:'web-a'},'drive-a',body);
  assert.equal(result.ok,true);
  assert.deepEqual(seen,{actor:{workspaceId:'ws-a',userId:'owner-a',deviceId:'web-a',role:'owner'},accountId:'drive-a',body});
});

test('role denial and tenant account miss preserve stable HTTP status without leaking internals', async () => {
  const forbidden=new DriveAllocationWebTransport(service({update:async()=>{throw new Error('DRIVE_ALLOCATION_ROLE_FORBIDDEN');}}));
  assert.deepEqual(await forbidden.update({subject:'viewer',workspaceId:'ws-a',workspaceRole:'viewer'},'drive-a',{maxUsageRatio:.5}),{ok:false,status:403,error:'DRIVE_ALLOCATION_ROLE_FORBIDDEN'});
  const missing=new DriveAllocationWebTransport(service({update:async()=>{throw new Error('DRIVE_ACCOUNT_NOT_FOUND');}}));
  assert.deepEqual(await missing.update({subject:'admin',workspaceId:'ws-a',workspaceRole:'admin'},'drive-other',{maxUsageRatio:.5}),{ok:false,status:404,error:'DRIVE_ACCOUNT_NOT_FOUND'});
});

test('validation errors remain 400 while unexpected provider details are redacted', async () => {
  const invalid=new DriveAllocationWebTransport(service({update:async()=>{throw new Error('DRIVE_ALLOCATION_RATIO_OUT_OF_RANGE');}}));
  assert.deepEqual(await invalid.update({subject:'admin',workspaceId:'ws-a',workspaceRole:'admin'},'drive-a',{maxUsageRatio:2}),{ok:false,status:400,error:'DRIVE_ALLOCATION_RATIO_OUT_OF_RANGE'});
  const secret=new DriveAllocationWebTransport(service({update:async()=>{throw new Error('refresh_token=secret-provider-value');}}));
  assert.deepEqual(await secret.update({subject:'admin',workspaceId:'ws-a',workspaceRole:'admin'},'drive-a',{maxUsageRatio:.5}),{ok:false,status:500,error:'DRIVE_ALLOCATION_INTERNAL_ERROR'});
});
