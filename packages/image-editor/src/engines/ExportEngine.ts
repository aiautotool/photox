import type { EditRecipe, ExportOptions, RenderResult, RendererAdapter } from '../types';
export type ResolutionPreset='original'|'4k'|'2k'|'custom';
export type MetadataPolicy='keep-exif'|'remove-location'|'remove-all';
export interface ProfessionalExportOptions extends ExportOptions{resolution?:ResolutionPreset;metadataPolicy?:MetadataPolicy;replaceEditedVersion?:boolean;saveCopy?:boolean}
export class ExportEngine {
 constructor(private readonly renderer:RendererAdapter){}
 export(recipe:EditRecipe,options:ProfessionalExportOptions):Promise<RenderResult>{return this.renderer.render(recipe,options)}
}
