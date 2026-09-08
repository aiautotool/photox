import { useEffect, useMemo, useState } from 'react';
import { resolveDesktopBridge, type MediaCatalogDiagnostics } from './bridge';
import { buildMediaCatalogOperationsView, isMediaCatalogRoleDenied } from './mediaCatalogOperationsUi';
import {
  buildLegacyWholeFileOperationsView,
  type LegacyWholeFileCompatibilityDiagnostics,
} from './legacyWholeFileOperationsUi';

type OperationsDiagnostics = MediaCatalogDiagnostics & {
  legacyWholeFileCompatibility?: LegacyWholeFileCompatibilityDiagnostics;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; diagnostics: OperationsDiagnostics }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

const buttonStyle: React.CSSProperties = {
  position: 'fixed', right: 20, bottom: 20, zIndex: 80, border: '1px solid #31475b',
  borderRadius: 999, padding: '10px 14px', background: '#0d1721', color: '#eef5fb',
  boxShadow: '0 12px 32px rgba(0,0,0,.28)', cursor: 'pointer', fontWeight: 700,
};

const panelStyle: React.CSSProperties = {
  position: 'fixed', right: 20, bottom: 72, width: 'min(430px, calc(100vw - 40px))', maxHeight: 'min(760px, calc(100vh - 100px))', overflowY: 'auto', zIndex: 80,
  border: '1px solid #31475b', borderRadius: 18, padding: 18, background: '#0d1721', color: '#eef5fb',
  boxShadow: '0 18px 48px rgba(0,0,0,.36)', fontFamily: 'system-ui, sans-serif',
};

const sectionStyle: React.CSSProperties = {
  marginTop: 18, paddingTop: 16, borderTop: '1px solid #26384a',
};

function formatTimestamp(value?: string) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatCommit(value?: string) {
  if (!value) return 'Chưa xác định';
  return value.length > 12 ? value.slice(0, 12) : value;
}

export function MediaCatalogOperationsPanel() {
  const bridge = useMemo(() => resolveDesktopBridge(), []);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const load = async () => {
      try {
        const diagnostics = await bridge.getMediaCatalogDiagnostics() as OperationsDiagnostics;
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
    {open && <section id="photox-media-catalog-operations" style={panelStyle} aria-label="PhotoX operations">
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start'}}>
        <div><small style={{letterSpacing:'.08em',opacity:.65}}>OPERATIONS</small><h3 style={{margin:'4px 0 2px'}}>PhotoX runtime</h3></div>
        <button onClick={() => setOpen(false)} aria-label="Đóng" style={{background:'transparent',border:0,color:'inherit',fontSize:20,cursor:'pointer'}}>×</button>
      </div>
      {state.kind === 'loading' && <p style={{opacity:.7}}>Đang đọc trạng thái hệ thống…</p>}
      {state.kind === 'error' && <div><b>Không đọc được diagnostics</b><p style={{opacity:.7,overflowWrap:'anywhere'}}>{state.message}</p></div>}
      {state.kind === 'ready' && (() => {
        const catalog = buildMediaCatalogOperationsView(state.diagnostics, bridge.platform);
        const compatibility = buildLegacyWholeFileOperationsView(state.diagnostics.legacyWholeFileCompatibility);
        const row = (label:string,value:React.ReactNode) => <div style={{display:'flex',justifyContent:'space-between',gap:16,padding:'8px 0',borderBottom:'1px solid #213244'}}><span style={{opacity:.7}}>{label}</span><b style={{textAlign:'right'}}>{value}</b></div>;
        const statusColor = compatibility.status === 'ready' ? '#55d68b' : compatibility.status === 'attention' ? '#ff7b72' : '#ffb45f';
        return <>
          <div>
            <small style={{letterSpacing:'.08em',opacity:.65}}>MEDIA CATALOG</small>
            <div style={{display:'flex',alignItems:'center',gap:8,margin:'8px 0 10px'}}><span style={{width:9,height:9,borderRadius:99,background:catalog.status==='healthy'?'#55d68b':'#ffb45f'}}/><b>{catalog.status==='healthy'?'SQLite đang hoạt động':'Catalog cần kiểm tra'}</b></div>
            {row('Backend', catalog.backend)}
            {row('Schema', `v${catalog.schemaVersion}`)}
            {row('Migration', catalog.migrationStatus)}
            {row('Media rows', catalog.rowCount.toLocaleString())}
            {row('Legacy imported', catalog.importedRowCount.toLocaleString())}
            {row('Rollback backup', catalog.backupAvailable ? 'Có' : 'Không')}
            {catalog.recovery && <details style={{marginTop:12}}><summary style={{cursor:'pointer',fontWeight:700}}>Recovery metadata (local operator)</summary><div style={{marginTop:10,fontSize:12,overflowWrap:'anywhere'}}><div><b>Backup path</b><br/>{catalog.recovery.backupPath}</div><div style={{marginTop:8}}><b>Source SHA-256</b><br/>{catalog.recovery.sourceSha256}</div></div></details>}
            {bridge.platform === 'web' && <p style={{fontSize:12,opacity:.65,marginBottom:0}}>Web chỉ hiển thị diagnostics đã redacted; filesystem path và source fingerprint không được đưa vào giao diện.</p>}
          </div>

          <div style={sectionStyle}>
            <small style={{letterSpacing:'.08em',opacity:.65}}>LEGACY WHOLE-FILE COMPATIBILITY</small>
            <div style={{display:'flex',alignItems:'center',gap:8,margin:'8px 0 10px'}}><span style={{width:9,height:9,borderRadius:99,background:statusColor}}/><b>{compatibility.statusLabel}</b></div>
            {row('Persistence', compatibility.persistenceLabel)}
            {row('Compatibility requests', compatibility.total.toLocaleString())}
            {row('Bearer', compatibility.bearer.toLocaleString())}
            {row('Pair code', compatibility.pairCode.toLocaleString())}
            {row('Pairing challenge', compatibility.pairingChallenge.toLocaleString())}
            {row('Accepted / duplicate / rejected', `${compatibility.accepted} / ${compatibility.duplicate} / ${compatibility.rejected}`)}
            {row('Observation window', `${compatibility.observationProgressPercent}%`)}
            {row('Physical resumable acceptance', compatibility.physicalDeviceResumableAccepted ? 'Đã xác nhận' : 'CHƯA XÁC NHẬN')}
            <div style={{marginTop:12,padding:'12px 14px',border:'1px solid #31475b',borderRadius:12,background:'#09131d'}}>
              <b>Physical-device evidence</b>
              <div style={{marginTop:8}}>
                {row('Evidence store', compatibility.physicalEvidenceInitialized
                  ? compatibility.physicalEvidencePersistenceHealthy ? 'Healthy' : 'Không healthy'
                  : 'Chưa khởi tạo')}
                {row('Release commit', formatCommit(compatibility.physicalReleaseCommitSha))}
                {row('Evidence records', compatibility.physicalEvidenceCount.toLocaleString())}
                {row('Required platforms', compatibility.physicalRequiredPlatforms.join(', ') || 'Không có')}
                {row('Accepted platforms', compatibility.physicalAcceptedPlatforms.join(', ') || 'Chưa có')}
              </div>
              {compatibility.physicalEvidenceBlockers.length > 0 && <ul style={{margin:'8px 0 0',paddingLeft:18,fontSize:12,opacity:.75}}>
                {compatibility.physicalEvidenceBlockers.map(blocker => <li key={blocker} style={{marginTop:4}}>{blocker}</li>)}
              </ul>}
            </div>
            {compatibility.initialized && <>
              {row('Observed since', formatTimestamp(compatibility.observedSince))}
              {row('Last compatibility request', formatTimestamp(compatibility.lastObservedAt))}
              {row('Last durable write', formatTimestamp(compatibility.lastPersistedAt))}
            </>}
            <div style={{marginTop:12,padding:'12px 14px',border:'1px solid #31475b',borderRadius:12,background:'#09131d'}}>
              <b>Deprecation blockers</b>
              {compatibility.blockerLabels.length === 0
                ? <p style={{margin:'8px 0 0',fontSize:13,opacity:.8}}>Không còn blocker runtime. Việc retire route vẫn phải theo release/deployment review.</p>
                : <ul style={{margin:'8px 0 0',paddingLeft:18,fontSize:13,opacity:.82}}>{compatibility.blockerLabels.map(label => <li key={label} style={{marginTop:4}}>{label}</li>)}</ul>}
            </div>
            <p style={{fontSize:12,opacity:.65,marginBottom:0}}>Đây là diagnostics chỉ đọc. PhotoX không cung cấp nút tự bật physical-device acceptance hoặc tự retire compatibility route từ giao diện này.</p>
          </div>
        </>;
      })()}
    </section>}
  </>;
}
