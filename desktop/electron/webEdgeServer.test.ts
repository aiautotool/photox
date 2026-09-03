import assert from 'node:assert/strict';
import http, { type IncomingHttpHeaders } from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocket } from 'ws';
import { PhotoXWebEdgeServer, type WebEdgeHandlers, type WebPrincipal } from './webEdgeServer.js';

async function freePort(): Promise<number> {
  const server=net.createServer();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('NO_TEST_PORT');
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return address.port;
}

type HttpResult={status:number;headers:IncomingHttpHeaders;body:Buffer;json?:any};
function request(port:number,path:string,input:{method?:string;headers?:Record<string,string>;body?:unknown}={}):Promise<HttpResult>{
  return new Promise((resolve,reject)=>{
    const body=input.body===undefined?undefined:Buffer.from(JSON.stringify(input.body));
    const req=http.request({host:'127.0.0.1',port,path,method:input.method||'GET',headers:{...(body?{'content-type':'application/json','content-length':String(body.length)}:{}),...(input.headers||{})}},res=>{
      const chunks:Buffer[]=[];
      res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
      res.on('end',()=>{
        const value=Buffer.concat(chunks);let json:any;
        try{json=value.length?JSON.parse(value.toString('utf8')):undefined;}catch{}
        resolve({status:res.statusCode||0,headers:res.headers,body:value,json});
      });
    });
    req.once('error',reject);if(body)req.write(body);req.end();
  });
}

function cookieHeader(setCookie:string[]|undefined){
  return (setCookie||[]).map(value=>value.split(';',1)[0]).join('; ');
}

function waitForOpen(socket:WebSocket){
  return new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});
}

function waitForMessage(socket:WebSocket){
  return new Promise<any>((resolve,reject)=>{socket.once('message',data=>{try{resolve(JSON.parse(data.toString()));}catch(error){reject(error);}});socket.once('error',reject);});
}

const principal:WebPrincipal={subject:'user-a',workspaceId:'workspace-a',workspaceRole:'owner',deviceId:'web-device',sessionId:'session-one',scopes:['media:read','media:download','media:write','media:delete']};

function handlers():WebEdgeHandlers{
  return {
    async authorizeAccessToken(token,required){assert.ok(['access-one','access-two'].includes(token));for(const scope of required)assert.ok(principal.scopes.includes(scope));return principal;},
    async createWebSession(){return {accessToken:'access-one',refreshToken:'refresh-one',accessExpiresAt:Date.now()+60_000,sessionId:'session-one'};},
    async refreshSession(refreshToken){assert.equal(refreshToken,'refresh-one');return {accessToken:'access-two',accessExpiresAt:Date.now()+60_000,sessionId:'session-one'};},
    async revokeSession(){},
    async appendAudit(){},
    async getStatus(){return {ok:true};},
    async getTunnelStatus(){return {connected:true};},
    async listLocalMedia(){return [{key:'clip.mp4',name:'clip.mp4'}];},
    async listCloudUploads(){return [];},
    async getBackupHealth(){return {healthy:true};},
    async openLibrary(){return {opened:true};},
    async addGoogleAccount(){return {};},
    async listGoogleAccounts(){return [];},
    async removeGoogleAccount(){return {};},
    async retryCloud(){return {};},
    async listGooglePhotosAccounts(){return [];},
    async connectGooglePhotosAccount(){return {};},
    async removeGooglePhotosAccount(){return {};},
    async listMigrations(){return [];},
    async getMigration(){return {};},
    async createMigration(){return {};},
    async materializeMigration(){return {};},
    async runMigration(){return {};},
    async pauseMigration(){return {};},
    async resumeMigration(){return {};},
    async cancelMigration(){return {};},
    async retryMigration(){return {};},
    async streamMedia(req,res,key,variant,workspaceId){
      assert.equal(workspaceId,'workspace-a');assert.equal(key,'clip.mp4');assert.equal(variant,'original');
      const data=Buffer.from('abcdef');const range=String(req.headers.range||'');
      if(range==='bytes=1-3'){res.writeHead(206,{'content-type':'video/mp4','accept-ranges':'bytes','content-range':'bytes 1-3/6','content-length':'3'});res.end(data.subarray(1,4));return;}
      res.writeHead(200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':String(data.length)});res.end(data);
    },
  };
}

test('Web edge completes ticket, cookie refresh, CSRF, WebSocket and signed Range flow',async()=>{
  const port=await freePort();
  const server=new PhotoXWebEdgeServer({enabled:true,host:'127.0.0.1',port,allowedOrigins:[],staticDir:'.',rateLimitPerMinute:300},handlers());
  await server.start();
  try{
    const issued=await server.issueLoginTicket();const ticket=new URL(issued.url).hash.replace(/^#ticket=/,'');assert.ok(ticket);
    const login=await request(port,'/api/web/v1/auth/ticket',{method:'POST',body:{ticket:decodeURIComponent(ticket)}});
    assert.equal(login.status,200);assert.equal(login.json.accessToken,'access-one');assert.equal(login.json.sessionId,'session-one');
    const setCookie=login.headers['set-cookie'];assert.ok(setCookie?.some(value=>value.startsWith('photox_refresh=')&&value.includes('HttpOnly')&&value.includes('SameSite=Strict')));assert.ok(setCookie?.some(value=>value.startsWith('photox_csrf=')&&value.includes('Path=/')));
    const cookies=cookieHeader(setCookie);const csrf=String(login.json.csrfToken);

    const replay=await request(port,'/api/web/v1/auth/ticket',{method:'POST',body:{ticket:decodeURIComponent(ticket)}});assert.equal(replay.status,401);
    const refreshWithoutCsrf=await request(port,'/api/web/v1/auth/refresh',{method:'POST',headers:{cookie:cookies}});assert.equal(refreshWithoutCsrf.status,401);assert.equal(refreshWithoutCsrf.json.error,'CSRF_REQUIRED');
    const refresh=await request(port,'/api/web/v1/auth/refresh',{method:'POST',headers:{cookie:cookies,'x-csrf-token':csrf}});assert.equal(refresh.status,200);assert.equal(refresh.json.accessToken,'access-two');

    const rejectedMutation=await request(port,'/api/web/v1/library/open',{method:'POST',headers:{authorization:'Bearer access-two',cookie:cookies}});assert.equal(rejectedMutation.status,403);assert.equal(rejectedMutation.json.error,'CSRF_REQUIRED');
    const mutation=await request(port,'/api/web/v1/library/open',{method:'POST',headers:{authorization:'Bearer access-two',cookie:cookies,'x-csrf-token':csrf}});assert.equal(mutation.status,200);assert.equal(mutation.json.opened,true);

    const socket=new WebSocket(`ws://127.0.0.1:${port}/api/web/v1/events`,['photox-v2','access-two']);await waitForOpen(socket);const messagePromise=waitForMessage(socket);server.publish('storage-updated',{workspaceId:'workspace-a',used:1});const message=await messagePromise;assert.equal(message.event,'storage-updated');assert.equal(message.workspaceId,'workspace-a');socket.close();

    const library=await request(port,'/api/web/v1/library',{headers:{authorization:'Bearer access-two'}});assert.equal(library.status,200);assert.equal(library.json.length,1);const signed=new URL(library.json[0].url,`http://127.0.0.1:${port}`);assert.equal(signed.searchParams.get('wid'),'workspace-a');
    const partial=await request(port,`${signed.pathname}${signed.search}`,{headers:{range:'bytes=1-3'}});assert.equal(partial.status,206);assert.equal(partial.headers['content-range'],'bytes 1-3/6');assert.equal(partial.body.toString(),'bcd');
  }finally{await server.stop();}
});
