import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './sync.css';
import { App } from './App';
import { DriveAllocationManager } from './DriveAllocationManager';
import { MediaCatalogOperationsPanel } from './MediaCatalogOperationsPanel';

type RendererBoundaryState={error?:Error};

class RendererBoundary extends React.Component<React.PropsWithChildren,RendererBoundaryState>{
  state:RendererBoundaryState={};
  static getDerivedStateFromError(error:Error){return {error};}
  componentDidCatch(error:Error,info:React.ErrorInfo){console.error('PhotoX renderer crashed',error,info);}
  render(){
    if(!this.state.error)return this.props.children;
    return <main style={{minHeight:'100vh',padding:32,background:'#081019',color:'#eef5fb',fontFamily:'system-ui,sans-serif'}}>
      <section style={{maxWidth:760,margin:'10vh auto',padding:28,border:'1px solid #26384a',borderRadius:18,background:'#0d1721'}}>
        <h1 style={{marginTop:0}}>PhotoX không thể khởi động giao diện</h1>
        <p>Renderer đã gặp lỗi khi mở ứng dụng. Lỗi này đã được ghi vào console để chẩn đoán; bạn có thể đóng và mở lại ứng dụng sau khi cập nhật bản sửa.</p>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:16,borderRadius:12,background:'#071018',color:'#ffb4ab'}}>{this.state.error.message||String(this.state.error)}</pre>
      </section>
    </main>;
  }
}

const root=document.getElementById('root');
if(!root)throw new Error('PHOTOX_RENDER_ROOT_MISSING');

createRoot(root).render(
  <React.StrictMode>
    <RendererBoundary>
      <App/>
      <DriveAllocationManager/>
      <MediaCatalogOperationsPanel/>
    </RendererBoundary>
  </React.StrictMode>
);