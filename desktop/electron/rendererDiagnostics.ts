import { app, BrowserWindow } from 'electron';

function escapeHtml(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]||char));}

function failurePage(title:string,detail:string){
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>PhotoX startup error</title><style>body{margin:0;background:#081019;color:#eef5fb;font-family:system-ui,sans-serif}.card{max-width:760px;margin:10vh auto;padding:28px;border:1px solid #26384a;border-radius:18px;background:#0d1721}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border-radius:12px;background:#071018;color:#ffb4ab}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>PhotoX không tải được giao diện Desktop. Thông tin bên dưới giúp xác định lỗi build/runtime thay vì để cửa sổ trắng.</p><pre>${escapeHtml(detail)}</pre></main></body></html>`)}`;
}

app.on('browser-window-created',(_event,window:BrowserWindow)=>{
  const contents=window.webContents;
  contents.on('did-fail-load',(_event,errorCode,errorDescription,validatedURL,isMainFrame)=>{
    console.error('PhotoX renderer did-fail-load',{errorCode,errorDescription,validatedURL,isMainFrame});
    if(isMainFrame&&!contents.isDestroyed())void contents.loadURL(failurePage('Không thể tải giao diện PhotoX',`${errorCode}: ${errorDescription}\n${validatedURL}`));
  });
  contents.on('render-process-gone',(_event,details)=>{
    console.error('PhotoX renderer process gone',details);
  });
  contents.on('preload-error',(_event,preloadPath,error)=>{
    console.error('PhotoX preload failed',{preloadPath,error});
  });
  contents.on('console-message',(_event,level,message,line,sourceId)=>{
    if(level>=2)console.error('PhotoX renderer console',{level,message,line,sourceId});
  });
});
