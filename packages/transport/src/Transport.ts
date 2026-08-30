export interface TransportRequest { path:string; method?:'GET'|'POST'|'PUT'|'DELETE'|'PATCH'; headers?:Record<string,string>; body?:BodyInit|null; signal?:AbortSignal; }
export interface TransportResponse<T=unknown> { status:number; headers:Record<string,string>; data:T; }
export interface Transport { readonly id:string; request<T=unknown>(request:TransportRequest):Promise<TransportResponse<T>>; healthCheck?():Promise<boolean>; }
