import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DesktopBridge, WorkspaceDevice, WorkspaceOverviewSnapshot, WorkspaceQuotaDimension, WorkspaceSessionSummary, WorkspaceSubscriptionSnapshot } from './bridge';
import './DevicesPage.css';

type Props={bridge:DesktopBridge|undefined;pairingCard:ReactNode;connectionReady:boolean;lastRunAt?:string};

const platformLabel:Record<WorkspaceDevice['platform'],string>={ios:'iPhone / iPad',android:'Android',windows:'Windows',macos:'macOS',linux:'Linux',web:'Web',unknown:'Không rõ'};
const kindLabel:Record<WorkspaceDevice['kind'],string>={desktop:'Desktop',mobile:'Mobile',web:'Web',service:'Service'};
const roleLabel:Record<WorkspaceOverviewSnapshot['membership']['role'],string>={owner:'Chủ sở hữu',admin:'Quản trị viên',member:'Thành viên',viewer:'Chỉ xem'};
const subscriptionStatusLabel:Record<WorkspaceSubscriptionSnapshot['status'],string>={unmanaged:'Chưa quản lý qua billing',trialing:'Đang dùng thử',active:'Đang hoạt động',past_due:'Thanh toán quá hạn',paused:'Đang tạm dừng',canceled:'Đã hủy',incomplete:'Chưa hoàn tất'};

function formatTime(value?:number|string){
  if(value==null)return 'Chưa có dữ liệu';
  const date=new Date(typeof value==='number'&&value<10_000_000_000?value*1000:value);
  return Number.isNaN(date.getTime())?'Chưa có dữ liệu':date.toLocaleString('vi-VN');
}

function compactId(value:string){return value.length>18?`${value.slice(0,8)}…${value.slice(-6)}`:value}
function formatBytes(bytes:number){
  if(!Number.isFinite(bytes)||bytes<=0)return '0 B';
  if(bytes>=1024**4)return `${(bytes/1024**4).toFixed(1)} TB`;
  if(bytes>=1024**3)return `${(bytes/1024**3).toFixed(1)} GB`;
  if(bytes>=1024**2)return `${(bytes/1024**2).toFixed(1)} MB`;
  if(bytes>=1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatQuotaValue(quota:WorkspaceQuotaDimension,unit:'bytes'|'count'){
  const current=unit==='bytes'?formatBytes(quota.current):String(quota.current);
  if(quota.limit==null)return `${current} / Không giới hạn`;
  const limit=unit==='bytes'?formatBytes(quota.limit):String(quota.limit);
  return `${current} / ${limit}`;
}

function quotaTone(quota:WorkspaceQuotaDimension){
  if(quota.percent==null)return 'normal';
  if(quota.percent>=90)return 'critical';
  if(quota.percent>=75)return 'warning';
  return 'normal';
}

function subscriptionTone(status:WorkspaceSubscriptionSnapshot['status']){
  if(status==='active'||status==='trialing')return 'healthy';
  if(status==='past_due'||status==='incomplete')return 'warning';
  if(status==='paused'||status==='canceled')return 'muted';
  return 'neutral';
}

export function DevicesPage({bridge,pairingCard,connectionReady,lastRunAt}:Props){
  const [overview,setOverview]=useState<WorkspaceOverviewSnapshot|null>(null);
  const [subscription,setSubscription]=useState<WorkspaceSubscriptionSnapshot|null>(null);
  const [devices,setDevices]=useState<WorkspaceDevice[]>([]);
  const [sessions,setSessions]=useState<WorkspaceSessionSummary[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [subscriptionNotice,setSubscriptionNotice]=useState('');
  const [sessionNotice,setSessionNotice]=useState('');
  const [busy,setBusy]=useState<string|null>(null);

  async function refresh(){
    if(!bridge){setLoading(false);setError('DesktopBridge chưa sẵn sàng.');return}
    setLoading(true);setError('');setSubscriptionNotice('');setSessionNotice('');
    try{
      const [nextOverview,nextDevices]=await Promise.all([bridge.getWorkspaceOverview(),bridge.listWorkspaceDevices()]);
      setOverview(nextOverview);setDevices(nextDevices);
      try{setSubscription(await bridge.getWorkspaceSubscription())}
      catch(err){setSubscription(null);setSubscriptionNotice(err instanceof Error?err.message:'Bạn không có quyền xem trạng thái subscription của workspace này.')}
      try{setSessions(await bridge.listWorkspaceSessions())}
      catch(err){setSessions([]);setSessionNotice(err instanceof Error?err.message:'Bạn không có quyền xem phiên đăng nhập của workspace này.')}
    }catch(err){
      setError(err instanceof Error?err.message:String(err));
    }finally{setLoading(false)}
  }

  useEffect(()=>{void refresh()},[bridge]);

  const activeDevices=useMemo(()=>devices.filter(device=>!device.revokedAt),[devices]);
  const sessionsByDevice=useMemo(()=>{
    const map=new Map<string,WorkspaceSessionSummary[]>();
    for(const session of sessions){
      if(!session.deviceId)continue;
      map.set(session.deviceId,[...(map.get(session.deviceId)||[]),session]);
    }
    return map;
  },[sessions]);
  const quotaCards=useMemo(()=>overview?[
    {key:'managed-storage',label:'Dung lượng quản lý',quota:overview.quota.managedStorage,unit:'bytes' as const},
    {key:'monthly-ingress',label:'Dữ liệu nhận tháng này',quota:overview.quota.monthlyIngress,unit:'bytes' as const},
    {key:'members',label:'Thành viên',quota:overview.quota.members,unit:'count' as const},
    {key:'devices',label:'Thiết bị',quota:overview.quota.devices,unit:'count' as const},
    {key:'providers',label:'Nơi lưu trữ',quota:overview.quota.storageProviders,unit:'count' as const},
    {key:'shares',label:'Chia sẻ công khai',quota:overview.quota.publicShares,unit:'count' as const},
  ]:[],[overview]);

  async function revokeSession(session:WorkspaceSessionSummary){
    if(!bridge||!window.confirm('Đăng xuất phiên này? Thiết bị sẽ cần đăng nhập hoặc ghép lại nếu không còn phiên hợp lệ.'))return;
    setBusy(`session:${session.sessionId}`);setError('');
    try{await bridge.revokeWorkspaceSession(session.sessionId);await refresh()}
    catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setBusy(null)}
  }

  async function revokeDevice(device:WorkspaceDevice){
    if(!bridge||!window.confirm(`Thu hồi thiết bị “${device.name}”? Tất cả refresh session của thiết bị này sẽ bị vô hiệu hóa.`))return;
    setBusy(`device:${device.id}`);setError('');
    try{await bridge.revokeWorkspaceDevice(device.id);await refresh()}
    catch(err){setError(err instanceof Error?err.message:String(err))}
    finally{setBusy(null)}
  }

  return <section className="page-section devices-page">
    {overview&&<div className="panel workspace-overview-panel">
      <div className="workspace-overview-head">
        <div><span className="workspace-kicker">WORKSPACE</span><h2>{overview.workspace.name}</h2><p>{roleLabel[overview.membership.role]} · {overview.workspace.status}</p></div>
        <div className="workspace-plan"><span>Gói hiện tại</span><b>{overview.workspace.plan}</b><small>Quyền hạn được đọc trực tiếp từ entitlement hiện tại.</small></div>
      </div>
      <div className="workspace-quota-grid">{quotaCards.map(item=>{
        const tone=quotaTone(item.quota);const width=item.quota.percent==null?0:Math.max(0,Math.min(100,item.quota.percent));
        return <article className={`workspace-quota quota-${tone}`} key={item.key}>
          <div><span>{item.label}</span><b>{formatQuotaValue(item.quota,item.unit)}</b></div>
          {item.quota.percent==null?<small>Không đặt giới hạn kỹ thuật</small>:<><div className="workspace-quota-track"><i style={{width:`${width}%`}}/></div><small>{Math.round(item.quota.percent)}% đã dùng{item.quota.remaining!=null?` · còn ${item.unit==='bytes'?formatBytes(item.quota.remaining):item.quota.remaining}`:''}</small></>}
        </article>})}</div>
      <div className="workspace-capabilities">
        <span className={overview.entitlements.remoteAccess?'enabled':'disabled'}>Remote access</span>
        <span className={overview.entitlements.publicSharing?'enabled':'disabled'}>Public sharing</span>
        <span className={overview.entitlements.semanticSearch?'enabled':'disabled'}>Semantic search</span>
        <span className={overview.entitlements.priorityVideoProcessing?'enabled':'disabled'}>Priority video</span>
        <span className="enabled">{overview.entitlements.targetOriginalReplicas} original replicas</span>
      </div>
    </div>}

    {subscription&&<div className="panel subscription-panel">
      <div className="subscription-head">
        <div><span className="workspace-kicker">SUBSCRIPTION</span><h3>Trạng thái gói dịch vụ</h3><p>Đọc từ control-plane authoritative; màn hình này không thực hiện thanh toán hoặc đổi gói.</p></div>
        <span className={`subscription-status subscription-${subscriptionTone(subscription.status)}`}>{subscriptionStatusLabel[subscription.status]}</span>
      </div>
      <div className="subscription-grid">
        <div><span>Gói</span><b>{subscription.plan}</b></div>
        <div><span>Nguồn quản lý</span><b>{subscription.source==='billing'?'Billing provider':'Legacy / unmanaged'}</b></div>
        <div><span>Bắt đầu kỳ hiện tại</span><b>{subscription.currentPeriodStart?formatTime(subscription.currentPeriodStart):'—'}</b></div>
        <div><span>Kết thúc kỳ hiện tại</span><b>{subscription.currentPeriodEnd?formatTime(subscription.currentPeriodEnd):'—'}</b></div>
        <div><span>Hủy cuối kỳ</span><b>{subscription.cancelAtPeriodEnd?'Có':'Không'}</b></div>
        <div><span>Cập nhật gần nhất</span><b>{formatTime(subscription.updatedAt)}</b></div>
      </div>
      {subscription.cancelAtPeriodEnd&&<div className="subscription-warning">Gói được đánh dấu hủy cuối kỳ. Entitlement hiện tại vẫn giữ nguyên cho đến khi control-plane áp dụng transition hợp lệ.</div>}
    </div>}
    {!subscription&&subscriptionNotice&&<div className="subscription-notice">Trạng thái subscription chỉ hiển thị cho chủ sở hữu hoặc quản trị viên của workspace. {subscriptionNotice}</div>}

    <div className="device-overview">
      <div>{pairingCard}</div>
      <div className="panel details-panel">
        <div className="panel-head"><div><h3>Workspace devices</h3><p>Dữ liệu thật từ device registry</p></div><button onClick={()=>void refresh()} disabled={loading}>{loading?'Đang tải…':'↻ Làm mới'}</button></div>
        <div className="connection-state"><span className={connectionReady?'live-dot':'status-dot'}/><div><b>{connectionReady?'Edge đang trực tuyến':'Edge đang kết nối lại'}</b><small>{connectionReady?'Thiết bị có thể đồng bộ qua LAN hoặc Internet.':'PhotoX sẽ tự thử lại khi kết nối khả dụng.'}</small></div></div>
        <div className="detail-row"><span>Thiết bị đang hoạt động</span><b>{activeDevices.length}</b></div>
        <div className="detail-row"><span>Phiên đang hoạt động</span><b>{sessions.length}</b></div>
        <div className="detail-row"><span>Lần cập nhật media</span><b>{lastRunAt?formatTime(lastRunAt):'Chưa có dữ liệu'}</b></div>
      </div>
    </div>

    {error&&<div className="device-error">{error}</div>}

    <div className="panel device-registry-panel">
      <div className="panel-head"><div><h3>Thiết bị đã đăng ký</h3><p>{activeDevices.length} thiết bị active trong workspace hiện tại</p></div></div>
      {loading&&devices.length===0?<div className="device-empty">Đang đọc device registry…</div>:activeDevices.length===0?<div className="device-empty">Chưa có thiết bị active. Quét QR ở phía trên để ghép điện thoại.</div>:<div className="device-list">{activeDevices.map(device=>{
        const linkedSessions=sessionsByDevice.get(device.id)||[];
        return <article className="device-card" key={device.id}>
          <div className="device-icon">{device.kind==='mobile'?'▯':device.kind==='web'?'◎':'▣'}</div>
          <div className="device-main">
            <div className="device-title"><div><b>{device.name}</b><small>{kindLabel[device.kind]} · {platformLabel[device.platform]}</small></div><span className="device-active">Active</span></div>
            <div className="device-meta"><span><b>User</b>{compactId(device.userId)}</span><span><b>Device ID</b>{compactId(device.id)}</span><span><b>Lần thấy gần nhất</b>{formatTime(device.lastSeenAt||device.createdAt)}</span><span><b>Phiên</b>{linkedSessions.length}</span></div>
          </div>
          <button className="danger-action" disabled={busy===`device:${device.id}`} onClick={()=>void revokeDevice(device)}>{busy===`device:${device.id}`?'Đang thu hồi…':'Thu hồi thiết bị'}</button>
        </article>})}</div>}
    </div>

    <div className="panel session-panel">
      <div className="panel-head"><div><h3>Phiên đăng nhập</h3><p>Chỉ hiển thị metadata an toàn, không hiển thị refresh token hoặc token hash.</p></div></div>
      {sessionNotice&&<div className="session-notice">Không thể xem danh sách phiên với quyền hiện tại. {sessionNotice}</div>}
      {!sessionNotice&&sessions.length===0&&!loading?<div className="device-empty">Không có phiên active.</div>:!sessionNotice&&<div className="session-table"><div className="session-row session-head"><span>Chủ thể</span><span>Thiết bị</span><span>Scopes</span><span>Hết hạn / dùng gần nhất</span><span/></div>{sessions.map(session=><div className="session-row" key={session.sessionId}><div><b>{compactId(session.subject)}</b><small>{compactId(session.sessionId)}</small></div><div><b>{session.deviceId?devices.find(d=>d.id===session.deviceId)?.name||compactId(session.deviceId):'Không gắn thiết bị'}</b></div><div><span className="scope-list">{session.scopes.length?session.scopes.join(', '):'—'}</span></div><div><b>{formatTime(session.expiresAt)}</b><small>Dùng: {formatTime(session.lastUsedAt||session.createdAt)}</small></div><div><button className="session-revoke" disabled={busy===`session:${session.sessionId}`} onClick={()=>void revokeSession(session)}>{busy===`session:${session.sessionId}`?'…':'Đăng xuất'}</button></div></div>)}</div>}
    </div>
  </section>;
}
