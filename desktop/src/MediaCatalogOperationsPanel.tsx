import { useEffect, useMemo, useState } from 'react';
import { resolveDesktopBridge, type MediaCatalogDiagnostics } from './bridge';
import { buildMediaCatalogOperationsView, isMediaCatalogRoleDenied } from './mediaCatalogOperationsUi';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; diagnostics: MediaCatalogDiagnostics }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

const buttonStyle: React.CSSProperties = {
  position: 'fixed', right: 20, bottom: 20, zIndex: 80, border: '1px solid #31475b',
  borderRadius: 999, padding: '10px 14px', background: '#0d1721', color: '#eef5fb',
  boxShadow: '0 12px 32px rgba(0,0,0,.28)', cursor: 'pointer', fontWeight: 700,
};

const panelStyle: React.CSSProperties = {
  position: 'fixed', right: 20, bottom: 72, width: 'min(390px, calc(100vw - 40px))', zIndex: 80,
  border: '1px solid #31475b', borderRadius: 18, padding: 18, background: '#0d1721', color: '#eef5fb',
  boxShadow: '0 18px 48px rgba(0,0,0,.36)', fontFamily: 'system-ui, sans-serif',
};

export function MediaCatalogOperationsPanel() {
  const bridge = useMemo(() => resolveDesktopBridge(), []);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const load = async () => {
      try {
        const diagnostics = await bridge.getMediaCatalogDiagnostics();
        if (active) setState({ kind: 'ready', diagnostics });
      } catch (error) {
        if (!active) return;
        if (bridge.platform === 'web' && isMediaCatalogRoleDenied(error)) {
          setState({ kind: 'denied' });
          return;
        }
        setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bridge]);

  if (!bridge || state.kind === 'denied') return null;

  return <>
    <button style={buttonStyle} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="photox-media-catalog-operations">
      ◉ Hệ thống
    </button>
    {open && <section id="photox-media-catalog-operations" style={panelStyle} aria-label="Media catalog operations">
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start'}}>
        <div><small style={{letterSpacing:'.08em',opacity:.65}}>OPERATIONS</small><h3 style={{margin:'4px 0 2px'}}>Media catalog</h3></div>
        <button onClick={() => setOpen(false)} aria-label="Đóng" style={{background:'transparent',border:0,color:'inherit',fontSize:20,cursor:'pointer'}}>×</button>
      </div>
      {state.kind === 'loading' && <p style={{opacity:.7}}>Đang đọc trạng thái catalog…</p>}
      {state.kind === 'error' && <div><b>Không đọc được diagnostics</b><p style={{opacity:.7,overflowWrap:'anywhere'}}>{state.message}</p></div>}
      {state.kind === 'ready' && (() => {
        const view = buildMediaCatalogOperationsView(state.diagnostics, bridge.platform);
        const row = (label:string,value:React.ReactNode) => <div style={{display:'flex',justifyContent:'space-between',gap:16,padding:'8px 0',borderBottom:'1px solid #213244'}}><span style={{opacity:.7}}>{label}</span><b style={{textAlign:'right'}}>{value}</b></div>;
        return <>
          <div style={{display:'flex',alignItems:'center',gap:8,margin:'8px 0 10px'}}><span style={{width:9,height:9,borderRadius:99,background:view.status==='healthy'?'#55d68b':'#ffb45f'}}/><b>{view.status==='healthy'?'SQLite đang hoạt động':'Catalog cần kiểm tra'}</b></div>
          {row('Backend', view.backend)}
          {row('Schema', `v${view.schemaVersion}`)}
          {row('Migration', view.migrationStatus)}
          {row('Media rows', view.rowCount.toLocaleString())}
          {row('Legacy imported', view.importedRowCount.toLocaleString())}
          {row('Rollback backup', view.backupAvailable ? 'Có' : 'Không')}
          {view.recovery && <details style={{marginTop:12}}><summary style={{cursor:'pointer',fontWeight:700}}>Recovery metadata (local operator)</summary><div style={{marginTop:10,fontSize:12,overflowWrap:'anywhere'}}><div><b>Backup path</b><br/>{view.recovery.backupPath}</div><div style={{marginTop:8}}><b>Source SHA-256</b><br/>{view.recovery.sourceSha256}</div></div></details>}
          {bridge.platform === 'web' && <p style={{fontSize:12,opacity:.65,marginBottom:0}}>Web chỉ hiển thị diagnostics đã redacted; filesystem path và source fingerprint không được đưa vào giao diện.</p>}
        </>;
      })()}
    </section>}
  </>;
}
