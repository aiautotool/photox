import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { loadPairedDesktop } from '../src/sync/pairing';
import { loadMobileWorkspaceSnapshot, quotaSeverity, type MobileWorkspaceSnapshot, type WorkspaceQuotaDimension } from '../src/workspace/workspaceClient';

const BLUE='#1769e0';

function bytes(value:number){
  if(value>=1024**4)return `${(value/1024**4).toFixed(1)} TB`;
  if(value>=1024**3)return `${(value/1024**3).toFixed(1)} GB`;
  return `${Math.round(value/1024**2)} MB`;
}
function count(value:number){return new Intl.NumberFormat('vi-VN').format(value);}
function quotaText(value:WorkspaceQuotaDimension,format:(n:number)=>string){return value.limit===null?`${format(value.current)} / Không giới hạn`:`${format(value.current)} / ${format(value.limit)}`;}
function Quota({label,value,format=count}:{label:string;value:WorkspaceQuotaDimension;format?:(n:number)=>string}){
  const severity=quotaSeverity(value);
  const percent=value.percent===null?null:Math.max(0,Math.min(100,value.percent));
  return <View style={s.quota}>
    <View style={s.row}><Text style={s.quotaLabel}>{label}</Text><Text style={[s.quotaValue,severity==='critical'&&s.critical,severity==='warning'&&s.warning]}>{quotaText(value,format)}</Text></View>
    {percent!==null?<View style={s.track}><View style={[s.fill,{width:`${percent}%`},severity==='warning'&&s.warningFill,severity==='critical'&&s.criticalFill]}/></View>:null}
    <Text style={s.meta}>{value.remaining===null?'Không có giới hạn kỹ thuật':`Còn ${format(Math.max(0,value.remaining))} • ${Math.round(percent||0)}% đã dùng`}</Text>
  </View>;
}

export default function WorkspaceScreen(){
  const [snapshot,setSnapshot]=useState<MobileWorkspaceSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const target=await loadPairedDesktop();
      if(!target||target.v!==2)throw new Error('Hãy ghép nối lại với PhotoX Desktop để tạo phiên workspace an toàn.');
      setSnapshot(await loadMobileWorkspaceSnapshot(target));
    }catch(e){setSnapshot(null);setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);

  const overview=snapshot?.overview;
  return <SafeAreaView style={s.root}>
    <View style={s.header}><Pressable onPress={()=>router.back()}><Text style={s.back}>‹</Text></Pressable><Text style={s.title}>Workspace & dung lượng</Text><Pressable onPress={()=>void refresh()}><Text style={s.refresh}>Làm mới</Text></Pressable></View>
    {loading&&!overview?<View style={s.center}><ActivityIndicator/><Text style={s.muted}>Đang tải trạng thái workspace…</Text></View>:error?<View style={s.center}><Text style={s.errorTitle}>Không tải được workspace</Text><Text style={s.muted}>{error}</Text><Pressable style={s.primary} onPress={()=>void refresh()}><Text style={s.primaryText}>Thử lại</Text></Pressable></View>:overview?<ScrollView contentContainerStyle={s.content}>
      <View style={s.hero}><Text style={s.workspace}>{overview.workspace.name}</Text><Text style={s.plan}>{overview.workspace.plan.toUpperCase()} • {overview.membership.role} • {overview.workspace.status}</Text><Text style={s.workspaceId}>{overview.workspace.id}</Text></View>
      <Text style={s.section}>Dung lượng & quota</Text>
      <Quota label="Bộ nhớ được quản lý" value={overview.quota.managedStorage} format={bytes}/>
      <Quota label="Dữ liệu tải lên tháng này" value={overview.quota.monthlyIngress} format={bytes}/>
      <Quota label="Thành viên" value={overview.quota.members}/>
      <Quota label="Thiết bị" value={overview.quota.devices}/>
      <Quota label="Nhà cung cấp lưu trữ" value={overview.quota.storageProviders}/>
      <Quota label="Chia sẻ công khai" value={overview.quota.publicShares}/>
      <Text style={s.section}>Tính năng gói</Text>
      <View style={s.card}>{[
        ['Truy cập từ xa',overview.entitlements.remoteAccess],
        ['Chia sẻ công khai',overview.entitlements.publicSharing],
        ['Tìm kiếm ngữ nghĩa',overview.entitlements.semanticSearch],
        ['Xử lý video ưu tiên',overview.entitlements.priorityVideoProcessing],
      ].map(([label,enabled])=><View key={String(label)} style={s.featureRow}><Text style={s.feature}>{String(label)}</Text><Text style={enabled?s.enabled:s.disabled}>{enabled?'Có':'Không'}</Text></View>)}<Text style={s.meta}>Replica original mục tiêu: {overview.entitlements.targetOriginalReplicas}</Text></View>
      <Text style={s.section}>Thiết bị đã đăng ký</Text>
      {snapshot.devicesError?<Text style={s.notice}>Không có quyền hoặc endpoint thiết bị chưa khả dụng: {snapshot.devicesError}</Text>:snapshot.devices.length?snapshot.devices.map(device=><View key={device.id} style={s.device}><View style={s.deviceIcon}><Text>▣</Text></View><View style={s.deviceBody}><Text style={s.deviceName}>{device.name||device.id}</Text><Text style={s.meta}>{device.kind} • {device.platform} • {device.userId}</Text><Text style={s.meta}>{device.lastSeenAt?`Hoạt động ${new Date(device.lastSeenAt).toLocaleString('vi-VN')}`:'Chưa có last seen'}</Text></View></View>):<Text style={s.notice}>Chưa có thiết bị active được trả về.</Text>}
      <Text style={s.foot}>Dữ liệu trên màn hình này lấy từ workspace session đã xác thực. PhotoX Mobile không tự suy diễn quota và không cung cấp nút quản trị khi chưa có mutation contract an toàn.</Text>
    </ScrollView>:null}
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#f7f9fc'},header:{height:58,paddingHorizontal:16,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#dfe3e8'},back:{fontSize:34,color:'#222',lineHeight:38},title:{fontSize:17,fontWeight:'800',color:'#202124'},refresh:{color:BLUE,fontWeight:'700'},content:{padding:16,paddingBottom:48},hero:{padding:18,borderRadius:20,backgroundColor:'#fff',marginBottom:20},workspace:{fontSize:24,fontWeight:'800',color:'#202124'},plan:{marginTop:6,fontSize:13,fontWeight:'700',color:BLUE},workspaceId:{marginTop:8,fontSize:11,color:'#80868b'},section:{fontSize:18,fontWeight:'800',color:'#25272b',marginTop:8,marginBottom:10},quota:{backgroundColor:'#fff',borderRadius:16,padding:14,marginBottom:10},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},quotaLabel:{flex:1,fontSize:14,fontWeight:'700',color:'#30343b'},quotaValue:{fontSize:12,fontWeight:'700',color:'#495057'},track:{height:7,backgroundColor:'#e5e9f0',borderRadius:5,overflow:'hidden',marginTop:11},fill:{height:7,backgroundColor:BLUE,borderRadius:5},warningFill:{backgroundColor:'#e07b00'},criticalFill:{backgroundColor:'#c62828'},warning:{color:'#b86600'},critical:{color:'#b3261e'},meta:{fontSize:11,color:'#747980',marginTop:7},card:{backgroundColor:'#fff',borderRadius:16,padding:14,marginBottom:12},featureRow:{height:38,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#edf0f3'},feature:{fontSize:14,color:'#30343b'},enabled:{color:'#267352',fontWeight:'800'},disabled:{color:'#8a8f96',fontWeight:'700'},device:{backgroundColor:'#fff',borderRadius:16,padding:14,marginBottom:10,flexDirection:'row',gap:12},deviceIcon:{width:38,height:38,borderRadius:12,backgroundColor:'#eef4ff',alignItems:'center',justifyContent:'center'},deviceBody:{flex:1},deviceName:{fontSize:14,fontWeight:'800',color:'#25272b'},notice:{backgroundColor:'#fff7e8',borderRadius:14,padding:14,color:'#72510d',fontSize:12,lineHeight:18},foot:{fontSize:11,lineHeight:17,color:'#80868b',marginTop:18},center:{flex:1,padding:28,alignItems:'center',justifyContent:'center'},muted:{color:'#6f747b',fontSize:13,textAlign:'center',marginTop:10,lineHeight:19},errorTitle:{fontSize:19,fontWeight:'800',color:'#202124'},error:{color:'#b3261e'},primary:{backgroundColor:BLUE,borderRadius:24,paddingHorizontal:24,paddingVertical:12,marginTop:18},primaryText:{color:'#fff',fontWeight:'800'}
});
