import { useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import type { DisplayAsset } from '../sync/mobileSync';

type Row={key:string;items:DisplayAsset[]};
type Section={title:string;key:string;data:Row[]};

function dayKey(timestamp:number){
  const d=new Date(timestamp);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function labelForDay(timestamp:number){
  const d=new Date(timestamp);const today=new Date();
  const startToday=new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
  const start=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
  const diff=Math.round((startToday-start)/86400000);
  if(diff===0)return 'Hôm nay';if(diff===1)return 'Hôm qua';
  if(d.getFullYear()===today.getFullYear())return d.toLocaleDateString('vi-VN',{day:'numeric',month:'long'});
  return d.toLocaleDateString('vi-VN',{day:'numeric',month:'long',year:'numeric'});
}

export function PhotoTimeline({items,columns,renderTile}:{items:DisplayAsset[];columns:number;renderTile:(asset:DisplayAsset,index:number)=>React.ReactNode}){
  const sections=useMemo<Section[]>(()=>{
    const sorted=[...items].sort((a,b)=>(b.creationTime||0)-(a.creationTime||0));
    const groups=new Map<string,{timestamp:number;items:DisplayAsset[]}>();
    for(const asset of sorted){const timestamp=asset.creationTime||Date.now();const key=dayKey(timestamp);const group=groups.get(key);if(group)group.items.push(asset);else groups.set(key,{timestamp,items:[asset]});}
    let global=0;
    return Array.from(groups.entries()).map(([key,group])=>{
      const rows:Row[]=[];
      for(let i=0;i<group.items.length;i+=columns){rows.push({key:`${key}:${i}`,items:group.items.slice(i,i+columns)});}
      global+=group.items.length;
      return {key,title:labelForDay(group.timestamp),data:rows};
    });
  },[items,columns]);

  const indexMap=useMemo(()=>new Map(items.map((x,i)=>[x.id,i])),[items]);

  return <SectionList
    sections={sections}
    keyExtractor={row=>row.key}
    renderSectionHeader={({section})=><View style={s.header}><Text style={s.headerText}>{section.title}</Text></View>}
    renderItem={({item})=><View style={s.row}>{item.items.map(asset=><View key={asset.id}>{renderTile(asset,indexMap.get(asset.id)||0)}</View>)}</View>}
    stickySectionHeadersEnabled
    initialNumToRender={8}
    maxToRenderPerBatch={8}
    updateCellsBatchingPeriod={40}
    windowSize={9}
    removeClippedSubviews
    contentContainerStyle={s.content}
    showsVerticalScrollIndicator={false}
  />;
}

const s=StyleSheet.create({
  content:{paddingBottom:110},
  header:{height:34,justifyContent:'center',paddingHorizontal:12,backgroundColor:'#fff'},
  headerText:{fontSize:14,fontWeight:'700',color:'#303238'},
  row:{flexDirection:'row'},
});
