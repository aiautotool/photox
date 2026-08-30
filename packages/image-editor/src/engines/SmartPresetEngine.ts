import type { PhotoPreset } from './PresetEngine';
export type SceneLabel='portrait'|'sky'|'food'|'night'|'indoor'|'document'|'landscape'|'unknown';
export interface SceneAnalysis{labels:Array<{label:SceneLabel;confidence:number}>;brightness?:number;faces?:number}
export interface SceneAnalyzer{analyze(uri:string):Promise<SceneAnalysis>}
export class SmartPresetEngine {
 constructor(private readonly analyzer:SceneAnalyzer,private readonly presets:PhotoPreset[]){}
 async recommend(uri:string,limit=3):Promise<PhotoPreset[]>{const analysis=await this.analyzer.analyze(uri);const labels=analysis.labels.sort((a,b)=>b.confidence-a.confidence).map(x=>x.label);const score=(p:PhotoPreset)=>{let s=p.category==='recommended'?2:0;for(const l of labels){if(p.category===l)s+=3;if(p.tags?.includes(l))s+=2;}return s};return [...this.presets].sort((a,b)=>score(b)-score(a)).slice(0,limit)}
}
