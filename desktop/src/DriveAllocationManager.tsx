import { useMemo, useState } from 'react';
import { resolveDesktopBridge, type DriveAccount } from './bridge';
import { allocationPercentFromRatio, buildDriveAllocationMutation, defaultDriveAllocationMutation, reserveMiBFromBytes, type DriveAllocationDraft } from './driveAllocationUi';
import './DriveAllocationManager.css';

type DraftMap=Record<string,DriveAllocationDraft>;

function formatBytes(bytes:number|null|undefined){
  if(bytes==null||!Number.isFinite(bytes))return 'Không khả dụng';
  if(bytes>=1024**4)return `${(bytes/1024**4).toFixed(2)} TB`;
  if(bytes>=1024**3)return `${(bytes/1024**3).toFixed(2)} GB`;
  if(bytes>=1024**2)return `${(bytes/1024**2).toFixed(0)} MB`;
  if(bytes>=1024)return `${(bytes/1024).toFixed(0)} KB`;
  return `${Math.max(0,Math.round(bytes))} B`;
}

function draftFor(account:DriveAccount):DriveAllocationDraft{
  return {allocationPercent:allocationPercentFromRatio(account.allocation.allocationRatio),safetyReserveMiB:reserveMiBFromBytes(account.allocation.safetyReserveBytes)};
}

export function DriveAllocationManager(){
  const bridge=useMemo(()=>resolveDesktopBridge(),[]);
  const [open,setOpen]=useState(false);
  const [accounts,setAccounts]=useState<DriveAccount[]>([]);
  const [drafts,setDrafts]=useState<DraftMap>({});
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  function syncDrafts(next:DriveAccount[]){
    setDrafts(Object.fromEntries(next.map(account=>[account.id,draftFor(account)])));
  }

  async function refresh(){
    if(!bridge)return;
    setLoading(true);setError('');
    try{const next=await bridge.listGoogleAccounts();setAccounts(next);syncDrafts(next)}
    catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setLoading(false)}
  }

  async function show(){setOpen(true);if(!accounts.length)await refresh()}

  async function save(account:DriveAccount,input?:ReturnType<typeof defaultDriveAllocationMutation>){
    if(!bridge)return;
    setBusy(account.id);setError('');setNotice('');
    try{
      const mutation=input??buildDriveAllocationMutation(drafts[account.id]??draftFor(account));
      const authoritative=await bridge.updateGoogleDriveAllocation(account.id,mutation);
      setAccounts(current=>current.map(item=>item.id===authoritative.id?authoritative:item));
      setDrafts(current=>({...current,[authoritative.id]:draftFor(authoritative)}));
      setNotice(`Đã cập nhật phân bổ cho ${authoritative.email}. Dữ liệu hiển thị đã được đọc lại từ policy authoritative.`);
    }catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setBusy(null)}
  }

  return <>
    <button className="drive-allocation-launcher" onClick={()=>void show()} aria-label="Quản lý phân bổ Google Drive">
      <span>◈</span><div><b>Phân bổ Drive</b><small>2/3 mặc định · theo quota thật</small></div>
    </button>
    {open&&<div className="drive-allocation-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
      <section className="drive-allocation-sheet" role="dialog" aria-modal="true" aria-label="Phân bổ Google Drive">
        <header><div><span className="drive-allocation-kicker">GOOGLE DRIVE ALLOCATION</span><h2>Phân bổ dung lượng PhotoX</h2><p>Mỗi tài khoản mặc định dùng tối đa 66,67% quota tổng do Google báo cáo. PhotoX còn tôn trọng dung lượng thực còn lại và safety reserve trước khi ghi file mới.</p></div><button className="drive-allocation-close" onClick={()=>setOpen(false)}>×</button></header>
        <div className="drive-allocation-toolbar"><div><b>{accounts.length} tài khoản</b><span>Không có giới hạn 10 GB cố định.</span></div><button disabled={loading||busy!==null} onClick={()=>void refresh()}>{loading?'Đang tải…':'Làm mới'}</button></div>
        {error&&<div className="drive-allocation-feedback error"><b>Không thể cập nhật</b><span>{error}</span></div>}
        {notice&&<div className="drive-allocation-feedback success">{notice}</div>}
        {loading&&!accounts.length?<div className="drive-allocation-empty">Đang đọc quota và policy từ PhotoX…</div>:!accounts.length?<div className="drive-allocation-empty">Chưa có Google Drive. Hãy thêm tài khoản trong mục Tài khoản lưu trữ trước.</div>:<div className="drive-allocation-list">{accounts.map(account=>{
          const draft=drafts[account.id]??draftFor(account);const allocation=account.allocation;const percent=Math.max(0,Math.min(100,draft.allocationPercent));
          return <article className="drive-allocation-card" key={account.id}>
            <div className="drive-allocation-account"><div className="drive-google-mark">G</div><div><b>{account.email}</b><span className={account.status==='ready'?'ready':'unavailable'}>{account.status==='ready'?'Quota Google đã đồng bộ':'Quota Google chưa khả dụng'}</span></div></div>
            <div className="drive-allocation-metrics">
              <div><span>Quota tổng Google</span><b>{formatBytes(allocation.providerTotalBytes)}</b></div>
              <div><span>Google còn trống</span><b>{formatBytes(allocation.providerFreeBytes)}</b></div>
              <div><span>PhotoX đã dùng</span><b>{formatBytes(allocation.appUsedBytes)}</b></div>
              <div><span>PhotoX còn có thể ghi</span><b>{formatBytes(allocation.availableBytes)}</b></div>
            </div>
            <div className="drive-allocation-editor">
              <label><span><b>Tỷ lệ quota dành cho PhotoX</b><em>{percent.toFixed(2)}%</em></span><input type="range" min="0" max="100" step="0.01" value={percent} disabled={busy===account.id} onChange={event=>setDrafts(current=>({...current,[account.id]:{...draft,allocationPercent:Number(event.target.value)}}))}/><small>Giới hạn theo tỷ lệ hiện tại: {formatBytes(allocation.allocationLimitBytes)}. Giá trị thực có thể thấp hơn nếu Google gần hết dung lượng.</small></label>
              <label className="drive-allocation-number"><span><b>Safety reserve</b><em>MiB</em></span><input type="number" min="0" step="1" value={draft.safetyReserveMiB} disabled={busy===account.id} onChange={event=>setDrafts(current=>({...current,[account.id]:{...draft,safetyReserveMiB:Number(event.target.value)}}))}/><small>PhotoX giữ lại phần dung lượng này, không tính là writable capacity.</small></label>
            </div>
            <div className="drive-allocation-actions"><button className="secondary" disabled={busy!==null} onClick={()=>void save(account,defaultDriveAllocationMutation())}>Khôi phục 66,67% + 100 MiB</button><button className="primary" disabled={busy!==null} onClick={()=>void save(account)}>{busy===account.id?'Đang lưu…':'Lưu policy'}</button></div>
          </article>})}</div>}
      </section>
    </div>}
  </>;
}
