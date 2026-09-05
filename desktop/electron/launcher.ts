import path from 'node:path';
import { pathToFileURL } from 'node:url';

const devArgPrefix='--photox-dev-server=';
const devArg=process.argv.find(arg=>arg.startsWith(devArgPrefix));

if(!process.env.VITE_DEV_SERVER_URL){
  const explicitDevUrl=devArg?.slice(devArgPrefix.length).trim();
  process.env.VITE_DEV_SERVER_URL=explicitDevUrl||pathToFileURL(path.join(__dirname,'../dist/index.html')).toString();
}

await import('./entry.js');
