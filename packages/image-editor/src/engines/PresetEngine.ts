import type { EditOperation } from '../types';

export type PresetCategory='recommended'|'portrait'|'landscape'|'food'|'night'|'film'|'bw'|'vintage'|'clean'|'cinematic'|'social';
export interface PhotoPreset { id:string; name:string; category:PresetCategory; intensity:number; operations:EditOperation[]; tags?:string[] }
const a=(name:string,value:number):EditOperation=>({id:`adjust:${name}`,type:'adjust',name,value} as EditOperation);
export const BUILTIN_PRESETS:PhotoPreset[]=[
 {id:'auto-enhance',name:'Auto Enhance',category:'recommended',intensity:0.8,operations:[a('exposure',0.08),a('contrast',0.08),a('highlights',-0.12),a('shadows',0.16),a('vibrance',0.08)]},
 {id:'clean',name:'Clean',category:'clean',intensity:0.7,operations:[a('brightness',0.08),a('contrast',0.04),a('vibrance',0.06)]},
 {id:'vivid',name:'Vivid',category:'landscape',intensity:0.65,operations:[a('contrast',0.12),a('vibrance',0.2),a('saturation',0.08)]},
 {id:'portrait-soft',name:'Portrait Soft',category:'portrait',intensity:0.55,operations:[a('highlights',-0.12),a('temperature',0.08),a('clarity',-0.08)]},
 {id:'portrait-clear',name:'Portrait Clear',category:'portrait',intensity:0.55,operations:[a('clarity',0.08),a('sharpness',0.1),a('highlights',-0.05)]},
 {id:'film-01',name:'Film 01',category:'film',intensity:0.7,operations:[a('contrast',0.08),a('fade',0.08),a('grain',0.14),{id:'filter:film01',type:'filter',filterId:'film-01',intensity:0.7} as EditOperation]},
 {id:'cinematic',name:'Cinematic',category:'cinematic',intensity:0.7,operations:[a('contrast',0.18),a('highlights',-0.08),{id:'filter:cinematic',type:'filter',filterId:'cinematic',intensity:0.7} as EditOperation]},
 {id:'golden-hour',name:'Golden Hour',category:'landscape',intensity:0.6,operations:[a('temperature',0.18),a('highlights',0.08),a('vibrance',0.08)]},
 {id:'night-clean',name:'Night Clean',category:'night',intensity:0.65,operations:[a('shadows',0.22),a('highlights',-0.25),a('noiseReduction',0.2),a('clarity',0.06)]},
 {id:'food-pop',name:'Food Pop',category:'food',intensity:0.65,operations:[a('vibrance',0.16),a('clarity',0.12),a('saturation',0.08)]},
 {id:'bw-classic',name:'B&W Classic',category:'bw',intensity:0.75,operations:[{id:'filter:bw-classic',type:'filter',filterId:'bw-classic',intensity:0.75} as EditOperation,a('contrast',0.1)]}
];
export class PresetEngine {
 constructor(private readonly presets:PhotoPreset[]=BUILTIN_PRESETS){}
 list(category?:PresetCategory){return category?this.presets.filter(p=>p.category===category):[...this.presets]}
 get(id:string){return this.presets.find(p=>p.id===id)}
 apply(id:string,intensity?:number):EditOperation[]{const preset=this.get(id);if(!preset)throw new Error(`Unknown preset: ${id}`);const amount=Math.max(0,Math.min(1,intensity??preset.intensity));return preset.operations.map((op,i)=>({ ...op,id:`preset:${id}:${i}`, ...(op.type==='adjust'?{value:(op as any).value*amount}:{}), ...(op.type==='filter'?{intensity:((op as any).intensity??1)*amount}:{}) })) as EditOperation[];}
}
