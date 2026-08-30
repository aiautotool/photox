export type EventHandler<T=unknown>=(payload:T)=>void|Promise<void>;

export class EventBus {
  private readonly listeners=new Map<string,Set<EventHandler>>();
  on<T>(event:string,handler:EventHandler<T>):()=>void { const set=this.listeners.get(event)??new Set<EventHandler>(); set.add(handler as EventHandler); this.listeners.set(event,set); return ()=>set.delete(handler as EventHandler); }
  async emit<T>(event:string,payload:T):Promise<void> { for(const handler of this.listeners.get(event)??[]) await handler(payload); }
  clear(event?:string):void { event?this.listeners.delete(event):this.listeners.clear(); }
}
