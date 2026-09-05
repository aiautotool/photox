import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const enabled=process.env.PHOTOX_DESKTOP_SMOKE==='1';
const __dirname=path.dirname(fileURLToPath(import.meta.url));

if(enabled){
  app.whenReady().then(async()=>{
    const window=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
    const timeout=setTimeout(()=>{console.error('PHOTOX_DESKTOP_SMOKE_TIMEOUT');app.exit(1);},20_000);
    try{
      await window.loadFile(path.join(__dirname,'../dist/index.html'),{query:{smoke:'1'}});
      const result=await window.webContents.executeJavaScript(`(() => ({
        hasRoot: Boolean(document.querySelector('#root')),
        hasShell: Boolean(document.querySelector('.app-shell')),
        hasVisibleText: Boolean((document.body?.innerText || '').trim()),
        hasBridge: Boolean(window.photoSyncDesktop)
      }))()`);
      if(!result?.hasRoot||!result?.hasShell||!result?.hasVisibleText||!result?.hasBridge){
        console.error('PHOTOX_DESKTOP_SMOKE_FAILED',result);
        app.exit(1);
        return;
      }
      console.log('PHOTOX_DESKTOP_SMOKE_OK',result);
      app.exit(0);
    }catch(error){
      console.error('PHOTOX_DESKTOP_SMOKE_ERROR',error);
      app.exit(1);
    }finally{
      clearTimeout(timeout);
    }
  });
}
