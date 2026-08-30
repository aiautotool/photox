import type { EditRecipe } from './types';
export interface EditRecord{originalAssetId:string;editedAssetId?:string;recipe:EditRecipe;presetId?:string;updatedAt:string;createdAt:string}
export interface EditRepository{get(originalAssetId:string):Promise<EditRecord|null>;save(record:EditRecord):Promise<void>;remove(originalAssetId:string):Promise<void>}
export class MemoryEditRepository implements EditRepository{private readonly records=new Map<string,EditRecord>();async get(id:string){return this.records.get(id)??null}async save(record:EditRecord){this.records.set(record.originalAssetId,record)}async remove(id:string){this.records.delete(id)}}
