import type { Transport, TransportRequest, TransportResponse } from './Transport';
export class HttpTransport implements Transport {
  readonly id='http';
  constructor(private readonly baseUrl:string,private readonly defaultHeaders:Record<string,string>={},private readonly fetcher:typeof fetch=fetch) {}
  async request<T>(req:TransportRequest):Promise<TransportResponse<T>> { const response=await this.fetcher(new URL(req.path,this.baseUrl),{method:req.method??'GET',headers:{...this.defaultHeaders,...req.headers},body:req.body,signal:req.signal}); const type=response.headers.get('content-type')??''; const data=(type.includes('application/json')?await response.json():await response.arrayBuffer()) as T; const headers:Record<string,string>={}; response.headers.forEach((v,k)=>headers[k]=v); return {status:response.status,headers,data}; }
  async healthCheck():Promise<boolean>{try{return (await this.request({path:'/api/v1/status'})).status<500;}catch{return false;}}
}
