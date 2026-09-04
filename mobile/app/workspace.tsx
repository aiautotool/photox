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
  const storage=overview?.quota.managedStorage;
  return <SafeAreaView style={s.root}>
    <View style={s.header}><Pressable style={s.headerButton} onPress={()=>router.back()}><Text style={s.back}>‹</Text></Pressable><Text style={s.title}>Workspace</Text><Pressable style={s.headerButton} onPress={()=>void refresh()}><Text style={s.refresh}>↻</Text></Pressable></View>
    {loading&&!overview?<View style={s.center}><ActivityIndicator color={BLUE}/><Text style={s.muted}>Đang tải trạng thái workspace…</Text></View>:error?<View style={s.center}><Text style={s.errorTitle}>Không tải được workspace</Text><Text style={s.muted}>{error}</Text><Pressable style={s.primary} onPress={()=>void refresh()}><Text style={s.primaryText}>Thử lại</Text></Pressable></View>:overview?<ScrollView contentContainerStyle={s.content}>
      <View style={s.hero}>
        <View style={s.avatar}><Text style={s.avatarText}>{overview.workspace.name.slice(0,1).toUpperCase()}</Text></View>
        <View style={s.heroBody}><Text style={s.workspace}>{overview.workspace.name}</Text><Text style={s.role}>{overview.membership.role} • {overview.workspace.status}</Text></View>
        <View style={s.planBadge}><Text style={s.planBadgeText}>{overview.workspace.plan.toUpperCase()}</Text></View>
      </View>

      {storage?<View style={s.summaryGrid}>
        <View style={s.summaryCard}><Text style={s.summaryLabel}>Tổng dung lượng</Text><Text style={s.summaryValue}>{storage.limit===null?'∞':bytes(storage.limit)}</Text><Text style={s.summaryMeta}>Workspace</Text></View>
        <View style={s.summaryCard}><Text style={s.summaryLabel}>Đã sử dụng</Text><Text style={s.summaryValue}>{bytes(storage.current)}</Text><Text style={s.summaryMeta}>{storage.percent===null?'Không giới hạn':`${Math.round(storage.percent)}%`}</Text></View>
        <View style={s.summaryCard}><Text style={s.summaryLabel}>Còn lại</Text><Text style={s.summaryValue}>{storage.remaining===null?'∞':bytes(Math.max(0,storage.remaining))}</Text><Text style={s.summaryMeta}>Khả dụng</Text></View>
      </View>:null}

      <View style={s.tabBar}><View style={s.tabActive}><Text style={s.tabActiveText}>Tổng quan</Text></View><Text style={s.tabText}>Dung lượng</Text><Text style={s.tabText}>Thiết bị</Text></View>

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
      ].map(([label,enabled])=><View key={String(label)} style={s.featureRow}><Text style={s.feature}>{String(label)}</Text><View style={[s.statusPill,enabled?s.statusOn:s.statusOff]}><Text style={enabled?s.enabled:s.disabled}>{enabled?'Đã bật':'Chưa bật'}</Text></View></View>)}<Text style={s.meta}>Replica original mục tiêu: {overview.entitlements.targetOriginalReplicas}</Text></View>

      <Text style={s.section}>Thiết bị đã đăng ký</Text>
      {snapshot.devicesError?<Text style={s.notice}>Không có quyền hoặc endpoint thiết bị chưa khả dụng: {snapshot.devicesError}</Text>:snapshot.devices.length?snapshot.devices.map(device=><View key={device.id} style={s.device}><View style={s.deviceIcon}><Text style={s.deviceGlyph}>▣</Text></View><View style={s.deviceBody}><Text style={s.deviceName}>{device.name||device.id}</Text><Text style={s.meta}>{device.kind} • {device.platform} • {device.userId}</Text><Text style={s.meta}>{device.lastSeenAt?`Hoạt động ${new Date(device.lastSeenAt).toLocaleString('vi-VN')}`:'Chưa có last seen'}</Text></View><View style={s.liveDot}/></View>):<Text style={s.notice}>Chưa có thiết bị active được trả về.</Text>}
      <Text style={s.foot}>Dữ liệu lấy từ workspace session đã xác thực. PhotoX Mobile không tự suy diễn quota và không hiển thị thao tác quản trị chưa có mutation contract an toàn.</Text>
    </ScrollView>:null}
  </SafeAreaView>;
}

const s=StyleSheet.create({
  root:{flex:1,backgroundColor:'#f5f7fb'},header:{height:58,paddingHorizontal:14,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#e3e8ef'},headerButton:{width:38,height:38,borderRadius:19,alignItems:'center',justifyContent:'center'},back:{fontSize:34,color:'#202124',lineHeight:36},title:{fontSize:17,fontWeight:'800',color:'#172033'},refresh:{color:BLUE,fontWeight:'800',fontSize:22},content:{padding:16,paddingBottom:48},hero:{padding:16,borderRadius:18,backgroundColor:'#fff',marginBottom:12,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:'#e6eaf0'},avatar:{width:46,height:46,borderRadius:15,backgroundColor:'#eef4ff',alignItems:'center',justifyContent:'center'},avatarText:{fontSize:18,fontWeight:'900',color:BLUE},heroBody:{flex:1,marginLeft:12},workspace:{fontSize:18,fontWeight:'900',color:'#172033'},role:{marginTop:4,fontSize:11,fontWeight:'600',color:'#7a8392'},planBadge:{paddingHorizontal:10,paddingVertical:6,borderRadius:999,backgroundColor:'#eef4ff'},planBadgeText:{fontSize:10,fontWeight:'900',color:BLUE},summaryGrid:{flexDirection:'row',gap:8,marginBottom:12},summaryCard:{flex:1,minHeight:92,padding:11,borderRadius:14,backgroundColor:'#fff',borderWidth:1,borderColor:'#e6eaf0'},summaryLabel:{fontSize:10,color:'#7a8392'},summaryValue:{marginTop:8,fontSize:17,fontWeight:'900',color:'#172033'},summaryMeta:{marginTop:4,fontSize:9,color:'#8a919c'},tabBar:{height:42,backgroundColor:'#fff',borderRadius:13,padding:4,flexDirection:'row',alignItems:'center',marginBottom:18,borderWidth:1,borderColor:'#e6eaf0'},tabActive:{flex:1,height:32,borderRadius:10,backgroundColor:'#eaf2ff',alignItems:'center',justifyContent:'center'},tabActiveText:{color:BLUE,fontWeight:'800',fontSize:11},tabText:{flex:1,textAlign:'center',color:'#7a8392',fontWeight:'700',fontSize:11},section:{fontSize:17,fontWeight:'900',color:'#25272b',marginTop:4,marginBottom:10},quota:{backgroundColor:'#fff',borderRadius:15,padding:14,marginBottom:10,borderWidth:1,borderColor:'#e6eaf0'},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},quotaLabel:{flex:1,fontSize:13,fontWeight:'800',color:'#30343b'},quotaValue:{fontSize:11,fontWeight:'800',color:'#495057'},track:{height:7,backgroundColor:'#e7ebf1',borderRadius:5,overflow:'hidden',marginTop:11},fill:{height:7,backgroundColor:BLUE,borderRadius:5},warningFill:{backgroundColor:'#e07b00'},criticalFill:{backgroundColor:'#c62828'},warning:{color:'#b86600'},critical:{color:'#b3261e'},meta:{fontSize:10,color:'#7a808a',marginTop:6,lineHeight:15},card:{backgroundColor:'#fff',borderRadius:15,paddingHorizontal:14,paddingVertical:6,marginBottom:12,borderWidth:1,borderColor:'#e6eaf0'},featureRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'#edf0f3'},feature:{fontSize:13,color:'#30343b',fontWeight:'600'},statusPill:{borderRadius:999,paddingHorizontal:8,paddingVertical:5},statusOn:{backgroundColor:'#eaf7ef'},statusOff:{backgroundColor:'#f1f3f5'},enabled:{color:'#267352',fontWeight:'800',fontSize:10},disabled:{color:'#8a8f96',fontWeight:'700',fontSize:10},device:{backgroundColor:'#fff',borderRadius:15,padding:13,marginBottom:10,flexDirection:'row',gap:12,alignItems:'center',borderWidth:1,borderColor:'#e6eaf0'},deviceIcon:{width:40,height:40,borderRadius:12,backgroundColor:'#eef4ff',alignItems:'center',justifyContent:'center'},deviceGlyph:{color:BLUE,fontWeight:'800'},deviceBody:{flex:1},deviceName:{fontSize:13,fontWeight:'900',color:'#25272b'},liveDot:{width:9,height:9,borderRadius:5,backgroundColor:'#2ca36c'},notice:{backgroundColor:'#fff7e8',borderRadius:14,padding:14,color:'#72510d',fontSize:12,lineHeight:18},foot:{fontSize:10,lineHeight:16,color:'#80868b',marginTop:18},center:{flex:1,padding:28,alignItems:'center',justifyContent:'center'},muted:{color:'#6f747b',fontSize:13,textAlign:'center',marginTop:10,lineHeight:19},errorTitle:{fontSize:19,fontWeight:'800',color:'#202124'},primary:{backgroundColor:BLUE,borderRadius:12,paddingHorizontal:24,paddingVertical:12,marginTop:18},primaryText:{color:'#fff',fontWeight:'800'}
});
