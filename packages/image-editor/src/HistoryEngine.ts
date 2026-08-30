import type { EditOperation, EditRecipe } from './types';
export interface HistoryEntry{index:number;label:string;operation?:EditOperation;recipe:EditRecipe}
export class HistoryEngine{
 timeline(recipe:EditRecipe):HistoryEntry[]{const base:{index:number;label:string;recipe:EditRecipe}={index:0,label:'Original',recipe:{...recipe,operations:[]}};const entries:HistoryEntry[]=[base];recipe.operations.forEach((operation,index)=>{entries.push({index:index+1,label:this.label(operation),operation,recipe:{...recipe,operations:recipe.operations.slice(0,index+1)}})});return entries}
 stateAt(recipe:EditRecipe,index:number):EditRecipe{const i=Math.max(0,Math.min(recipe.operations.length,index));return {...recipe,operations:recipe.operations.slice(0,i)}}
 private label(op:EditOperation):string{if(op.type==='adjust')return `${(op as any).name} ${(op as any).value>=0?'+':''}${(op as any).value}`;if(op.type==='filter')return `Filter ${(op as any).filterId}`;if(op.type==='crop')return `Crop ${(op as any).rect?.aspect??''}`.trim();if(op.type==='custom')return (op as any).pluginId;return op.type}
}
