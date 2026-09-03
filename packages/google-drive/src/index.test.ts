import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryResumableUploadSession, uploadResumableChunk } from './index.js';
afterEach(() => vi.restoreAllMocks());
describe('Drive resumable protocol', () => {
  it('recovers the committed byte offset from a session status query', async () => {
    const request=vi.fn(async(_url:string,_init?:RequestInit)=>new Response(null,{status:308,headers:{Range:'bytes=0-524287'}}));
    await expect(queryResumableUploadSession('https://upload/session',1048576,request as any)).resolves.toEqual({state:'active',committedBytes:524288});
    expect(new Headers(request.mock.calls[0][1]?.headers).get('content-range')).toBe('bytes */1048576');
  });
  it('sends an exact chunk range and returns completed Drive metadata', async () => {
    const request=vi.fn(async(_url:string,init?:RequestInit)=>{expect(new Headers(init?.headers).get('content-range')).toBe('bytes 524288-524291/524292');return new Response(JSON.stringify({id:'drive-file',name:'v.mp4',mimeType:'video/mp4',size:'524292'}),{status:200,headers:{'content-type':'application/json'}})});
    await expect(uploadResumableChunk('https://upload/session',{bytes:new Uint8Array([1,2,3,4]),startByte:524288,totalBytes:524292,mimeType:'video/mp4'},request as any)).resolves.toEqual(expect.objectContaining({state:'completed',file:expect.objectContaining({id:'drive-file'})}));
  });
});
