import { AdjustmentEngine } from './engines/AdjustmentEngine';
import { CropEngine } from './engines/CropEngine';
import { ExportEngine } from './engines/ExportEngine';
import { PresetEngine, BUILTIN_PRESETS } from './engines/PresetEngine';
import { RetouchEngine } from './engines/RetouchEngine';
import { SmartPresetEngine, type SceneAnalyzer } from './engines/SmartPresetEngine';
import { EditSession } from './EditSession';
import type { EditSource, RendererAdapter } from './types';
export interface PhotoEditorSDKOptions{renderer:RendererAdapter;sceneAnalyzer?:SceneAnalyzer}
export class PhotoEditorSDK{
 readonly presets=new PresetEngine(); readonly adjustments=new AdjustmentEngine(); readonly crop=new CropEngine(); readonly retouch=new RetouchEngine(); readonly export:ExportEngine; readonly smartPresets?:SmartPresetEngine;
 constructor(options:PhotoEditorSDKOptions){this.export=new ExportEngine(options.renderer);if(options.sceneAnalyzer)this.smartPresets=new SmartPresetEngine(options.sceneAnalyzer,BUILTIN_PRESETS)}
 createSession(source:EditSource){return new EditSession(source)}
}
