from pathlib import Path
p=Path('desktop/electron/main.ts')
s=p.read_text()
imp="import { PhotoXWebEdgeServer, webEdgeConfigFromEnv } from './webEdgeServer.js';"
while s.count(imp)>1:s=s.replace(imp+'\n'+imp,imp)
decl="let webEdgeServer:PhotoXWebEdgeServer|null=null;"
while s.count(decl)>1:s=s.replace(decl+'\n'+decl,decl)
old="""function notifyRenderer(channel:string,payload:unknown){
  const win=mainWindow;
  if(!win||win.isDestroyed()||win.webContents.isDestroyed())return;
  win.webContents.send(channel,payload);
  const event=channel==='photosync:migration-updated'?'migration-updated':channel==='photosync:file-received'?'file-received':channel==='photosync:storage-updated'?'storage-updated':channel==='photosync:tunnel-state'?'tunnel-state':null;
  if(event)webEdgeServer?.publish(event,payload);
}"""
new="""function notifyRenderer(channel:string,payload:unknown){
  const event=channel==='photosync:migration-updated'?'migration-updated':channel==='photosync:file-received'?'file-received':channel==='photosync:storage-updated'?'storage-updated':channel==='photosync:tunnel-state'?'tunnel-state':null;
  if(event)webEdgeServer?.publish(event,payload);
  const win=mainWindow;
  if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channel,payload);
}"""
s=s.replace(old,new)
p.write_text(s)
