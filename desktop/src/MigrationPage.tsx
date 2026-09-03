import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopBridge, DriveAccount, GooglePhotosAccount, MigrationJob, MigrationSnapshot } from './bridge';

type Props={bridge:DesktopBridge|undefined};
const formatBytes=(bytes:number)=>bytes>=1024**3?`${(bytes/1024**3).toFixed(1)} GB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KB`:`${Math.round(bytes)} B`;
const formatEta=(seconds:number)=>{const total=Math.max(0,Math.round(seconds));if(total<60)return`${total} giây`;const minutes=Math.floor(total/60);if(minutes<60)return`${minutes} phút`;const hours=Math.floor(minutes/60);const rest=minutes%60;return rest?`${hours} giờ ${rest} phút`:`${hours} giờ`};
const stateLabel:Record<string,string>={draft:'Nháp',selecting:'Đang chọn',queued:'Sẵn sàng',running:'Đang chuyển',paused:'Đã tạm dừng',completed:'Hoàn tất',completed_with_errors:'Hoàn tất có lỗi',cancelled:'Đã hủy',failed:'Lỗi'};

export function MigrationPage({bridge}:Props){
  const [photos,setPhotos]=useState<GooglePhotosAccount[]>([]);
  const [drives,setDrives]=useState<DriveAccount[]>([]);
  const [jobs,setJobs]=useState<MigrationJob[]>([]);
  const [snapshot,setSnapshot]=useState<MigrationSnapshot|null>(null);
  const [sourceId,setSourceId]=useState('');
  const [target,setTarget]=useState<'google_photos'|'google_drive'>('google_drive');
  const [targetId,setTargetId]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [transferRate,setTransferRate]=useState(0);
  const transferSample=useRef<{jobId:string;bytes:number;at:number}|null>(null);

  async function refresh(){if(!bridge)return;const [p,d,j]=await Promise.all([bridge.listGooglePhotosAccounts(),bridge.listGoogleAccounts(),bridge.listMigrations()]);setPhotos(p);setDrives(d);setJobs(j);if(snapshot){try{setSnapshot(await bridge.getMigration(snapshot.job.id))}catch{}}}
  useEffect(()=>{void refresh();if(!bridge)return;return bridge.onMigrationUpdated(next=>{setSnapshot(next);void refresh()})},[bridge]);
  useEffect(()=>{if(!bridge||!snapshot||snapshot.job.state!=='running')return;const id=snapshot.job.id;const timer=setInterval(()=>{void bridge.getMigration(id).then(setSnapshot).catch(()=>undefined)},1500);return()=>clearInterval(timer)},[bridge,snapshot?.job.id,snapshot?.job.state]);
  const sources=useMemo(()=>photos.filter(account=>account.capabilities.includes('picker')&&account.status==='ready'),[photos]);
  const photoTargets=useMemo(()=>photos.filter(account=>account.capabilities.includes('append')&&account.status==='ready'),[photos]);
  const destinations=target==='google_photos'?photoTargets:drives.filter(account=>account.status==='ready');
  useEffect(()=>{if(!sourceId&&sources[0])setSourceId(sources[0].id)},[sources,sourceId]);
  useEffect(()=>{if(!destinations.some(item=>item.id===targetId))setTargetId(destinations[0]?.id||'')},[target,destinations,targetId]);

  async function action(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await refresh()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function connect(capability:'picker'|'append'){await action(async()=>{await bridge?.connectGooglePhotosAccount(capability)})}
  async function create(){if(!bridge||!sourceId||!targetId)return;await action(async()=>{const created=await bridge.createMigration({sourceAccountId:sourceId,target,targetAccountId:targetId,maxItemCount:2000});setSnapshot({job:created.job,items:[]})})}
  async function materialize(){if(!bridge||!snapshot)return;await action(async()=>setSnapshot(await bridge.materializeMigration(snapshot.job.id)))}
  async function run(){if(!bridge||!snapshot)return;await action(async()=>{await bridge.runMigration(snapshot.job.id);setSnapshot(await bridge.getMigration(snapshot.job.id))})}
  async function pause(){if(!bridge||!snapshot)return;await action(async()=>setSnapshot(await bridge.pauseMigration(snapshot.job.id)))}
  async function resume(){if(!bridge||!snapshot)return;await action(async()=>{await bridge.resumeMigration(snapshot.job.id);setSnapshot(await bridge.getMigration(snapshot.job.id))})}
  async function retry(){if(!bridge||!snapshot)return;await action(async()=>{await bridge.retryMigration(snapshot.job.id);setSnapshot(await bridge.getMigration(snapshot.job.id))})}
  async function cancel(){if(!bridge||!snapshot)return;await action(async()=>setSnapshot(await bridge.cancelMigration(snapshot.job.id)))}
  async function openJob(job:MigrationJob){if(!bridge)return;await action(async()=>setSnapshot(await bridge.getMigration(job.id)))}

  const job=snapshot?.job;
  const completedCount=snapshot?.items.filter(item=>item.state==='completed').length??job?.completedItems??0;
  const failedCount=snapshot?.items.filter(item=>item.state==='failed').length??job?.failedItems??0;
  const transferredBytes=snapshot?.items.reduce((sum,item)=>sum+item.transferredBytes,0)??job?.transferredBytes??0;
  const percent=job?.totalItems?Math.round(completedCount/job.totalItems*100):0;
  useEffect(()=>{
    if(!job){transferSample.current=null;setTransferRate(0);return}
    const now=Date.now();
    const previous=transferSample.current;
    if(job.state!=='running'){
      transferSample.current={jobId:job.id,bytes:transferredBytes,at:now};
      setTransferRate(0);
      return;
    }
    if(!previous||previous.jobId!==job.id||transferredBytes<previous.bytes){
      transferSample.current={jobId:job.id,bytes:transferredBytes,at:now};
      setTransferRate(0);
      return;
    }
    const elapsedSeconds=(now-previous.at)/1000;
    const deltaBytes=transferredBytes-previous.bytes;
    if(elapsedSeconds>=0.25){
      if(deltaBytes>0){
        const instantRate=deltaBytes/elapsedSeconds;
        setTransferRate(current=>current>0?current*0.6+instantRate*0.4:instantRate);
      }
      transferSample.current={jobId:job.id,bytes:transferredBytes,at:now};
    }
  },[job?.id,job?.state,transferredBytes]);
  const remainingBytes=job?.totalBytes!=null?Math.max(0,job.totalBytes-transferredBytes):null;
  const etaSeconds=job?.state==='running'&&remainingBytes!=null&&transferRate>0?remainingBytes/transferRate:null;
  return <section className="page-section migration-page">
    <div className="section-title"><div><h2>Chuyển dữ liệu</h2><p>Google Photos Picker → Google Photos hoặc Google Drive. Không xóa dữ liệu nguồn.</p></div><button onClick={()=>void refresh()} disabled={busy}>↻ Làm mới</button></div>
    {error&&<div className="migration-error">{error}</div>}
    <div className="two-column migration-config">
      <div className="panel details-panel"><h3>1. Nguồn Google Photos</h3><p>Google yêu cầu bạn tự chọn ảnh/video trong Picker.</p>
        <div className="migration-row"><select value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">Chọn tài khoản nguồn</option>{sources.map(a=><option key={a.id} value={a.id}>{a.email}</option>)}</select><button onClick={()=>void connect('picker')} disabled={busy}>+ Kết nối nguồn</button></div>
      </div>
      <div className="panel details-panel"><h3>2. Đích</h3><div className="tabs"><button className={target==='google_drive'?'selected':''} onClick={()=>setTarget('google_drive')}>Google Drive</button><button className={target==='google_photos'?'selected':''} onClick={()=>setTarget('google_photos')}>Google Photos</button></div>
        <div className="migration-row"><select value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">Chọn tài khoản đích</option>{destinations.map(a=><option key={a.id} value={a.id}>{a.email}</option>)}</select>{target==='google_photos'&&<button onClick={()=>void connect('append')} disabled={busy}>+ Kết nối đích</button>}</div>
      </div>
    </div>
    {!job&&<div className="panel migration-start"><h3>3. Chọn media</h3><p>PhotoX mở Google Photos Picker. Sau khi chọn xong quay lại đây và xác nhận.</p><button className="primary-button" disabled={busy||!sourceId||!targetId} onClick={()=>void create()}>Mở Google Photos Picker</button></div>}
    {job&&<div className="panel migration-progress"><div className="panel-head"><div><h3>{job.target==='google_drive'?'Google Photos → Google Drive':'Google Photos → Google Photos'}</h3><p>{stateLabel[job.state]||job.state}</p></div><b>{percent}%</b></div>
      <div className="progress-track"><span style={{width:`${percent}%`}}/></div><div className="migration-stats"><span>{completedCount}/{job.totalItems} hoàn tất</span><span>{failedCount} lỗi</span><span>{formatBytes(transferredBytes)} đã chuyển</span>{job.state==='running'&&transferRate>0&&<span>{formatBytes(transferRate)}/s</span>}{etaSeconds!=null&&Number.isFinite(etaSeconds)&&<span>Còn khoảng {formatEta(etaSeconds)}</span>}</div>
      <div className="migration-actions">{job.state==='selecting'&&<button onClick={()=>void materialize()} disabled={busy}>Tôi đã chọn xong</button>}{job.state==='queued'&&<button className="primary-button" onClick={()=>void run()} disabled={busy||job.totalItems===0}>Bắt đầu chuyển</button>}{job.state==='running'&&<button onClick={()=>void pause()} disabled={busy}>Tạm dừng</button>}{job.state==='paused'&&<button className="primary-button" onClick={()=>void resume()} disabled={busy}>Tiếp tục</button>}{failedCount>0&&<button onClick={()=>void retry()} disabled={busy}>Thử lại file lỗi</button>}{!['completed','cancelled'].includes(job.state)&&<button onClick={()=>void cancel()} disabled={busy}>Hủy</button>}<button onClick={()=>setSnapshot(null)} disabled={busy}>Đóng</button></div>
      {snapshot.items.length>0&&<div className="migration-items">{snapshot.items.slice(0,100).map(item=><div key={item.id}><span title={item.filename}>{item.filename}</span><small>{item.state}{item.error?` · ${item.error}`:''}</small><b>{item.transferredBytes?formatBytes(item.transferredBytes):''}</b></div>)}</div>}
    </div>}
    <div className="panel"><div className="panel-head"><div><h3>Lịch sử chuyển dữ liệu</h3><p>{jobs.length} job</p></div></div>{jobs.length===0?<p>Chưa có lịch sử.</p>:<div className="migration-history">{jobs.map(item=><button key={item.id} onClick={()=>void openJob(item)}><span>{item.target==='google_drive'?'Google Drive':'Google Photos'}</span><b>{stateLabel[item.state]||item.state}</b><small>{item.completedItems}/{item.totalItems} · {new Date(item.updatedAt).toLocaleString('vi-VN')}</small></button>)}</div>}</div>
  </section>;
}