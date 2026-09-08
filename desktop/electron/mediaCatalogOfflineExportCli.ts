import process from 'node:process';
import { exportMediaCatalogOffline } from './mediaCatalogOfflineExport.js';

type Args = { sqlitePath?: string; targetPath?: string; leasePath?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = argv[i + 1];
    if (value === '--sqlite' && next) { args.sqlitePath = next; i += 1; continue; }
    if ((value === '--out' || value === '--target') && next) { args.targetPath = next; i += 1; continue; }
    if (value === '--lease' && next) { args.leasePath = next; i += 1; continue; }
    if (value === '--help' || value === '-h') {
      console.log('Usage: npm --workspace @photosync/desktop run catalog:export -- --sqlite <media-catalog.sqlite> --out <rollback.json> [--lease <lockfile>]');
      process.exit(0);
    }
    throw new Error(`MEDIA_CATALOG_EXPORT_ARGUMENT_INVALID:${value}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sqlitePath || !args.targetPath) {
    throw new Error('MEDIA_CATALOG_EXPORT_USAGE_REQUIRED');
  }
  const result = exportMediaCatalogOffline({
    sqlitePath: args.sqlitePath,
    targetPath: args.targetPath,
    leasePath: args.leasePath,
  });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
}
