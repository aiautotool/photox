import type { EditOperation } from '../types';
export type CropRatio='free'|'original'|'1:1'|'4:3'|'3:4'|'16:9'|'9:16';
export type CropGrid='thirds'|'golden-ratio'|'center';
export class CropEngine {
 crop(x:number,y:number,width:number,height:number,aspect:CropRatio='free'):EditOperation{return {id:'crop',type:'crop',rect:{x,y,width,height,aspect}} as EditOperation}
 rotate(degrees:90|180|270):EditOperation{return {id:'rotate',type:'rotate',degrees} as EditOperation}
 flip(axis:'horizontal'|'vertical'):EditOperation{return {id:`flip:${axis}`,type:'flip',axis} as EditOperation}
 straighten(degrees:number):EditOperation{return {id:'straighten',type:'straighten',degrees} as EditOperation}
 perspective(vertical:number,horizontal:number):EditOperation{return {id:'geometry:perspective',type:'custom',pluginId:'photox.geometry',payload:{vertical,horizontal}} as EditOperation}
}
