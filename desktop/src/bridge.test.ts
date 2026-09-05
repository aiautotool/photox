import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpDesktopBridge } from './bridge.js';

async function waitFor(predicate:()=>boolean,message:string){
  for(let attempt=0;attempt<50;attempt+=1){
    if(predicate())return;
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  assert.fail(message);
}

test('ticket-only Web bridge bootstraps the session before calling protected APIs', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ url, method, authorization: headers.get('authorization') || undefined });
    if (url.endsWith('/api/web/v1/auth/ticket')) {
      assert.equal(method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { ticket: 'ticket-1' });
      return new Response(JSON.stringify({ accessToken: 'access-1', csrfToken: 'csrf-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/web/v1/status')) {
      assert.equal(headers.get('authorization'), 'Bearer access-1');
      return new Response(JSON.stringify({ state: 'idle', received: 0, duplicates: 0, cloudUploaded: 0, cloudBlocked: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/web/v1/auth/refresh')) {
      throw new Error('refresh must not run before redeeming a supplied login ticket');
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;

  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', loginTicket: 'ticket-1' });
    const status = await bridge.getStatus();
    assert.equal(status.state, 'idle');
    assert.deepEqual(calls.map(call => [call.method, call.url]), [
      ['POST', 'https://photox.example/api/web/v1/auth/ticket'],
      ['GET', 'https://photox.example/api/web/v1/status'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Web bridge refreshes once after a 401 and retries with the new access token', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization?: string }> = [];
  let statusCalls = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get('authorization') || undefined });
    if (url.endsWith('/api/web/v1/status')) {
      statusCalls += 1;
      if (statusCalls === 1) {
        assert.equal(headers.get('authorization'), 'Bearer access-expired');
        return new Response('expired', { status: 401 });
      }
      assert.equal(headers.get('authorization'), 'Bearer access-refreshed');
      return new Response(JSON.stringify({ state: 'idle', received: 0, duplicates: 0, cloudUploaded: 0, cloudBlocked: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/api/web/v1/auth/refresh')) {
      return new Response(JSON.stringify({ accessToken: 'access-refreshed', csrfToken: 'csrf-refreshed' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', accessToken: 'access-expired' });
    const status = await bridge.getStatus();
    assert.equal(status.state, 'idle');
    assert.deepEqual(calls.map(call => call.url), [
      'https://photox.example/api/web/v1/status',
      'https://photox.example/api/web/v1/auth/refresh',
      'https://photox.example/api/web/v1/status',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Web bridge maps workspace device/session APIs and sends CSRF on revokes', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const calls: Array<{url:string;method:string;csrf:string|null}> = [];
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:{cookie:'photox_csrf=csrf-admin'}});
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);const method=String(init?.method||'GET').toUpperCase();const headers=new Headers(init?.headers);
    calls.push({url,method,csrf:headers.get('x-csrf-token')});
    assert.equal(headers.get('authorization'),'Bearer admin-access');
    if(url.endsWith('/api/web/v1/devices'))return new Response(JSON.stringify([{id:'device-a',workspaceId:'workspace-a',userId:'user-a',name:'Phone',platform:'ios',kind:'mobile',createdAt:1}]),{status:200,headers:{'content-type':'application/json'}});
    if(url.endsWith('/api/web/v1/sessions'))return new Response(JSON.stringify([{sessionId:'session-a',subject:'user-a',scopes:['media:read'],expiresAt:2,createdAt:1}]),{status:200,headers:{'content-type':'application/json'}});
    if(url.endsWith('/api/web/v1/sessions/session-a'))return new Response(JSON.stringify({sessionId:'session-a',revoked:true}),{status:200,headers:{'content-type':'application/json'}});
    if(url.endsWith('/api/web/v1/devices/device-a'))return new Response(JSON.stringify({deviceId:'device-a',sessionsRevoked:1,activeDevices:0}),{status:200,headers:{'content-type':'application/json'}});
    throw new Error(`unexpected fetch ${method} ${url}`);
  }) as typeof fetch;
  try{
    const bridge=createHttpDesktopBridge({baseUrl:'https://photox.example',accessToken:'admin-access'});
    assert.deepEqual((await bridge.listWorkspaceDevices()).map(item=>item.id),['device-a']);
    assert.deepEqual((await bridge.listWorkspaceSessions()).map(item=>item.sessionId),['session-a']);
    assert.deepEqual(await bridge.revokeWorkspaceSession('session-a'),{sessionId:'session-a',revoked:true});
    assert.deepEqual(await bridge.revokeWorkspaceDevice('device-a'),{deviceId:'device-a',sessionsRevoked:1,activeDevices:0});
    assert.deepEqual(calls.map(call=>[call.method,call.url,call.csrf]),[
      ['GET','https://photox.example/api/web/v1/devices',null],
      ['GET','https://photox.example/api/web/v1/sessions',null],
      ['DELETE','https://photox.example/api/web/v1/sessions/session-a','csrf-admin'],
      ['DELETE','https://photox.example/api/web/v1/devices/device-a','csrf-admin'],
    ]);
  }finally{
    globalThis.fetch=originalFetch;
    Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:originalDocument});
  }
});

test('Web bridge maps exact media repair to POST with CSRF and URL-safe key', async () => {
  const originalFetch=globalThis.fetch;
  const originalDocument=globalThis.document;
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:{cookie:'photox_csrf=csrf-repair'}});
  let received:{url:string;method:string;csrf:string|null;authorization:string|null}|undefined;
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const headers=new Headers(init?.headers);
    received={url:String(input),method:String(init?.method||'GET').toUpperCase(),csrf:headers.get('x-csrf-token'),authorization:headers.get('authorization')};
    return new Response(JSON.stringify({workspaceId:'workspace-a',key:'folder/a b.jpg',status:'queued',verifiedReplicas:0,targetReplicas:2}),{status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  try{
    const bridge=createHttpDesktopBridge({baseUrl:'https://photox.example',accessToken:'member-access'});
    const result=await bridge.repairMedia('folder/a b.jpg');
    assert.deepEqual(result,{workspaceId:'workspace-a',key:'folder/a b.jpg',status:'queued',verifiedReplicas:0,targetReplicas:2});
    assert.deepEqual(received,{
      url:'https://photox.example/api/web/v1/media/folder%2Fa%20b.jpg/repair',
      method:'POST',
      csrf:'csrf-repair',
      authorization:'Bearer member-access',
    });
  }finally{
    globalThis.fetch=originalFetch;
    Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:originalDocument});
  }
});

test('Web bridge refreshes and reconnects WebSocket with the rotated access token', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const sockets: FakeWebSocket[] = [];
  let refreshCalls = 0;

  class FakeWebSocket {
    listeners = new Map<string, Array<(event: Event) => void>>();
    constructor(public readonly url: string | URL, public readonly protocols?: string | string[]) {
      sockets.push(this);
    }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const callback = typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
      this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
    }
    emit(type: string) {
      for (const listener of this.listeners.get(type) || []) listener(new Event(type));
    }
    close() {}
  }

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/web/v1/auth/refresh')) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ accessToken: 'access-2', csrfToken: 'csrf-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      setTimeout: (callback: () => void) => { callback(); return 1; },
      clearTimeout: () => undefined,
    },
  });

  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', accessToken: 'access-1' });
    const unsubscribe = bridge.onMigrationUpdated(() => undefined);
    await waitFor(()=>sockets.length===1,'initial WebSocket was not created');
    assert.deepEqual(sockets[0]?.protocols, ['photox-v2', 'access-1']);

    sockets[0]?.emit('close');
    await waitFor(()=>refreshCalls===1,'WebSocket close did not refresh the access token');
    await waitFor(()=>sockets.length===2,'WebSocket did not reconnect after refreshing');

    assert.deepEqual(sockets[1]?.protocols, ['photox-v2', 'access-2']);
    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: originalWebSocket });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
  }
});

test('Web bridge keeps retrying WebSocket reconnect when refresh temporarily fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  const sockets: FakeWebSocket[] = [];
  const delays: number[] = [];
  let refreshCalls = 0;

  class FakeWebSocket {
    listeners = new Map<string, Array<(event: Event) => void>>();
    constructor(public readonly url: string | URL, public readonly protocols?: string | string[]) {
      sockets.push(this);
    }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const callback = typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
      this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
    }
    emit(type: string) {
      for (const listener of this.listeners.get(type) || []) listener(new Event(type));
    }
    close() {}
  }

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/api/web/v1/auth/refresh')) {
      refreshCalls += 1;
      if (refreshCalls === 1) return new Response('temporarily unavailable', { status: 503 });
      return new Response(JSON.stringify({ accessToken: 'access-after-retry', csrfToken: 'csrf-after-retry' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      setTimeout: (callback: () => void, delay: number) => { delays.push(delay); queueMicrotask(callback); return delays.length; },
      clearTimeout: () => undefined,
    },
  });

  try {
    const bridge = createHttpDesktopBridge({ baseUrl: 'https://photox.example', accessToken: 'access-1' });
    const unsubscribe = bridge.onMigrationUpdated(() => undefined);
    await waitFor(()=>sockets.length===1,'initial WebSocket was not created');
    sockets[0]?.emit('close');

    await waitFor(()=>refreshCalls===2,'WebSocket reconnect did not retry refresh after a transient failure');
    await waitFor(()=>sockets.length===2,'WebSocket did not reconnect after refresh recovered');
    assert.deepEqual(sockets[1]?.protocols, ['photox-v2', 'access-after-retry']);
    assert.deepEqual(delays.slice(0,2), [1500,3000]);
    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: originalWebSocket });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
  }
});
