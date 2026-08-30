import type { EditOperation } from '../types';

export type LightAdjustment = 'exposure'|'brightness'|'contrast'|'highlights'|'shadows'|'whites'|'blacks';
export type ColorAdjustment = 'temperature'|'tint'|'vibrance'|'saturation';
export type DetailAdjustment = 'sharpness'|'clarity'|'texture'|'dehaze'|'noiseReduction'|'colorNoiseReduction';
export type EffectAdjustment = 'vignette'|'grain'|'fade'|'bloom'|'glow';
export type AdjustmentName = LightAdjustment|ColorAdjustment|DetailAdjustment|EffectAdjustment;
export type HslColor = 'red'|'orange'|'yellow'|'green'|'aqua'|'blue'|'purple'|'magenta';
export type CurveChannel = 'rgb'|'red'|'green'|'blue';
export interface CurvePoint { x:number; y:number }
export interface HslAdjustment { color:HslColor; hue:number; saturation:number; luminance:number }

export class AdjustmentEngine {
  adjustment(name:AdjustmentName,value:number):EditOperation { return { id:`adjust:${name}`, type:'adjust', name, value } as EditOperation; }
  hsl(value:HslAdjustment):EditOperation { return { id:`hsl:${value.color}`, type:'custom', pluginId:'photox.hsl', payload:value } as EditOperation; }
  curve(channel:CurveChannel,points:CurvePoint[]):EditOperation { return { id:`curve:${channel}`, type:'custom', pluginId:'photox.tone-curve', payload:{channel,points} } as EditOperation; }
}
