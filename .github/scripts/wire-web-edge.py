from pathlib import Path
p=Path('desktop/electron/main.ts')
s=p.read_text()
s=s.replace("import { DesktopGooglePhotosMigrationService } from './googlePhotosMigration.js';", "import { DesktopGooglePhotosMigrationService } from './googlePhotosMigration.js';\nimport { PhotoXWebEdgeServer, webEdgeConfigFromEnv } from './webEdgeServer.js';")
s=s.replace("let migrationService:DesktopGooglePhotosMigrationService|null=null;", "let migrationService:DesktopGooglePhotosMigrationService|null=null;\nlet webEdgeServer:PhotoXWebEdgeServer|null=null;")
s=s.replace("  win.webContents.send(channel,payload);\n}", "  win.webContents.send(channel,payload);\n  const event=channel==='photosync:migration-updated'?'migration-updated':channel==='photosync:file-received'?'file-received':channel==='photosync:storage-updated'?'storage-updated':channel==='photosync:tunnel-state'?'tunnel-state':null;\n  if(event)webEdgeServer?.publish(event,payload);\n}")
marker="function createWindow(){"
helper=r'''async function streamWebMedia(req:IncomingMessage,res:ServerResponse,key:string,variant:'original'|'playback'|'thumbnail'){
  const row=(await readIndex()).find(item=>item.key===key);if(!row){res.writeHead(404);res.end('Not found');return;}
  if(variant==='thumbnail'){
    if(!row.thumbnailPath){res.writeHead(404);res.end('Thumbnail unavailable');return;}
    try{await streamNodeFile(req,res,row.thumbnailPath,'image/jpeg');return}catch{res.writeHead(404);res.end('Thumbnail unavailable');return;}
  }
  if(variant==='playback'&&row.playbackPath){try{await streamNodeFile(req,res,row.playbackPath,'video/mp4');return}catch{}}
  try{await streamNodeFile(req,res,row.path,row.mimeType||mimeTypeForFilename(row.filename));return}catch{}
  const requestHeaders=req.headers.range?{range:req.headers.range}:{};
  const response=await fetchCloudMedia(row,new Request(`${PUBLIC_TUNNEL_URL}/api/v1/media/${encodeURIComponent(key)}`,{headers:requestHeaders}));
  const headers=Object.fromEntries([...response.headers].filter(([name])=>['content-type','content-length','content-range','accept-ranges'].includes(name.toLowerCase())));
  if(!headers['content-type'])headers['content-type']=row.mimeType||mimeTypeForFilename(row.filename);
  res.writeHead(response.status,headers);if(response.body)Readable.fromWeb(response.body as any).pipe(res);else res.end();
}

async function startWebEdge(){
  const config=webEdgeConfigFromEnv(path.join(__dirname,'../dist'));
  if(!config.enabled)return;
  const migrations=()=>requireMigrationService();
  webEdgeServer=new PhotoXWebEdgeServer(config,{
    getStatus:desktopStatus,getTunnelStatus:async()=>({connected:Boolean(lastStatus.tunnelHealthy),relayUrl:PUBLIC_TUNNEL_URL,desktopId:os.hostname(),pairingPayload:'',lastError:lastStatus.tunnelHealthy?undefined:lastStatus.message}),
    listLocalMedia,listCloudUploads,getBackupHealth:backupHealthSnapshot,openLibrary:()=>shell.openPath(libraryDir()),addGoogleAccount:connectGoogle,listGoogleAccounts:listDriveAccounts,removeGoogleAccount:removeDriveAccount,
    retryCloud:async()=>{await retryQueuedCloud();return desktopStatus();},listGooglePhotosAccounts:()=>migrations().listAccounts(),connectGooglePhotosAccount:capability=>migrations().connectAccount(capability),removeGooglePhotosAccount:accountId=>migrations().removeAccount(accountId),
    listMigrations:()=>migrations().listJobs(),getMigration:jobId=>migrations().getSnapshot(jobId),createMigration:input=>migrations().createSelection(input),materializeMigration:jobId=>migrations().materializeSelection(jobId),
    runMigration:async jobId=>{void migrations().run(jobId).catch(error=>console.error('Web migration run failed',jobId,error));return (await migrations().getSnapshot(jobId)).job;},
    pauseMigration:async jobId=>{migrations().pause(jobId);return migrations().getSnapshot(jobId);},resumeMigration:async jobId=>{void migrations().resume(jobId).catch(error=>console.error('Web migration resume failed',jobId,error));return (await migrations().getSnapshot(jobId)).job;},
    cancelMigration:async jobId=>{migrations().cancel(jobId);return migrations().getSnapshot(jobId);},retryMigration:async jobId=>{void migrations().retryFailed(jobId).catch(error=>console.error('Web migration retry failed',jobId,error));return (await migrations().getSnapshot(jobId)).job;},
    streamMedia:streamWebMedia,
  });
  await webEdgeServer.start();
  console.log(`PhotoX Web enabled on http://${config.host}:${config.port}`);
}

'''
if helper not in s:s=s.replace(marker,helper+marker)
s=s.replace("await startReceiver();startCloudflareTunnelSupervisor();protocol.handle", "await startReceiver();await startWebEdge();startCloudflareTunnelSupervisor();protocol.handle")
s=s.replace("stopCloudflareTunnelSupervisor();migrationStore?.close();", "stopCloudflareTunnelSupervisor();void webEdgeServer?.stop();webEdgeServer=null;migrationStore?.close();")
p.write_text(s)
