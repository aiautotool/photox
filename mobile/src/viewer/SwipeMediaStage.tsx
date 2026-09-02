import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { DisplayAsset } from '../sync/mobileSync';

const SCREEN = Dimensions.get('window');
const MIN_SWIPE = 64;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;

function distance(a:{pageX:number;pageY:number},b:{pageX:number;pageY:number}){
  return Math.hypot(a.pageX-b.pageX,a.pageY-b.pageY);
}

function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}

function VideoStage({asset}:{asset:DisplayAsset}){
  const source=useMemo(()=>({uri:asset.uri,headers:asset.requestHeaders}),[asset.uri,asset.requestHeaders]);
  const player=useVideoPlayer(source,p=>{p.loop=false;p.play();});
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" allowsFullscreen allowsPictureInPicture/>;
}

function ZoomablePhoto({asset,onPrevious,onNext}:{asset:DisplayAsset;onPrevious():void;onNext():void}){
  const [scale,setScale]=useState(1);
  const [offset,setOffset]=useState({x:0,y:0});
  const startRef=useRef<{x:number;y:number;offsetX:number;offsetY:number}|null>(null);
  const pinchRef=useRef<{distance:number;scale:number}|null>(null);
  const lastTapRef=useRef(0);

  useEffect(()=>{setScale(1);setOffset({x:0,y:0});startRef.current=null;pinchRef.current=null;},[asset.id]);

  function reset(){setScale(1);setOffset({x:0,y:0});}

  function onStart(e:GestureResponderEvent){
    const touches=e.nativeEvent.touches;
    if(touches.length>=2){pinchRef.current={distance:distance(touches[0],touches[1]),scale};startRef.current=null;return;}
    const t=touches[0];if(!t)return;
    const now=Date.now();
    if(now-lastTapRef.current<DOUBLE_TAP_MS){lastTapRef.current=0;if(scale>1.05)reset();else setScale(2.5);return;}
    lastTapRef.current=now;
    startRef.current={x:t.pageX,y:t.pageY,offsetX:offset.x,offsetY:offset.y};
  }

  function onMove(e:GestureResponderEvent){
    const touches=e.nativeEvent.touches;
    if(touches.length>=2){
      if(!pinchRef.current)pinchRef.current={distance:distance(touches[0],touches[1]),scale};
      const next=clamp(pinchRef.current.scale*(distance(touches[0],touches[1])/Math.max(1,pinchRef.current.distance)),1,MAX_SCALE);
      setScale(next);if(next<=1.01)setOffset({x:0,y:0});return;
    }
    const t=touches[0];const start=startRef.current;if(!t||!start)return;
    if(scale>1.01){
      const maxX=(SCREEN.width*(scale-1))/2;const maxY=(SCREEN.height*(scale-1))/2;
      setOffset({x:clamp(start.offsetX+t.pageX-start.x,-maxX,maxX),y:clamp(start.offsetY+t.pageY-start.y,-maxY,maxY)});
    }
  }

  function onEnd(e:GestureResponderEvent){
    pinchRef.current=null;
    const start=startRef.current;startRef.current=null;
    if(!start||scale>1.01)return;
    const changed=e.nativeEvent.changedTouches?.[0];if(!changed)return;
    const dx=changed.pageX-start.x,dy=changed.pageY-start.y;
    if(Math.abs(dx)>=MIN_SWIPE&&Math.abs(dx)>Math.abs(dy)*1.4){dx<0?onNext():onPrevious();}
  }

  return <View style={StyleSheet.absoluteFill} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={()=>{startRef.current=null;pinchRef.current=null;}}>
    <Image source={{uri:asset.uri,headers:asset.requestHeaders}} contentFit="contain" style={[StyleSheet.absoluteFill,{transform:[{translateX:offset.x},{translateY:offset.y},{scale}]}]}/>
  </View>;
}

export function SwipeMediaStage({assets,current,onChange}:{assets:DisplayAsset[];current:DisplayAsset;onChange(asset:DisplayAsset):void}){
  const index=Math.max(0,assets.findIndex(x=>x.id===current.id));
  const previous=index>0?assets[index-1]:null;
  const next=index<assets.length-1?assets[index+1]:null;

  useEffect(()=>{
    const uris=[previous,next].filter((x):x is DisplayAsset=>Boolean(x&&x.mediaType==='photo')).map(x=>x.thumbnailUri||x.uri);
    if(uris.length)void Image.prefetch(uris).catch(()=>undefined);
  },[previous?.id,next?.id]);

  const goPrevious=()=>{if(previous)onChange(previous);};
  const goNext=()=>{if(next)onChange(next);};

  return <View style={s.root}>
    {current.mediaType==='video'?<View style={StyleSheet.absoluteFill} onTouchEnd={e=>{
      const touches=e.nativeEvent.changedTouches;if(!touches?.length)return;
    }}><VideoStage asset={current}/></View>:<ZoomablePhoto asset={current} onPrevious={goPrevious} onNext={goNext}/>} 
  </View>;
}

const s=StyleSheet.create({root:{flex:1,width:'100%',backgroundColor:'#070707'}});
