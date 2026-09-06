import { readFile, writeFile } from 'node:fs/promises';
const file='desktop/electron/main.ts';
let source=await readFile(file,'utf8');
source=source.replace('migrateLegacyWorkspaceRows, replaceWorkspaceRows, rowsForWorkspace','migrateLegacyWorkspaceRows, rowsForWorkspace');
const block=`async function writeIndex(rows:MediaIndexRow[],workspaceId=LEGACY_WORKSPACE_ID){
  const normalized=rows.map(row=>({...row,workspaceId}));
  const all=await readAllIndex();const merged=replaceWorkspaceRows(all,workspaceId,normalized);
  await fs.mkdir(stateDir(),{recursive:true});await fs.writeFile(indexFile(),JSON.stringify(merged,null,2),'utf8');
}
async function updateIndexRow(key:string,patch:Partial<MediaIndexRow>,workspaceId=LEGACY_WORKSPACE_ID){const rows=await readIndex(workspaceId);const index=rows.findIndex(row=>row.key===key);if(index<0)return null;rows[index]={...rows[index],...patch,workspaceId};await writeIndex(rows,workspaceId);return rows[index]}
`;
if(!source.includes(block))throw new Error('legacy writer block not found');
source=source.replace(block,'');
if(source.includes('replaceWorkspaceRows'))throw new Error('replaceWorkspaceRows still referenced');
if(source.includes('writeIndex(')||source.includes('updateIndexRow('))throw new Error('legacy writer reference still present');
await writeFile(file,source,'utf8');
console.log('removed dead whole-workspace media index writers');
