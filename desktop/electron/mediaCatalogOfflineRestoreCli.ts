import process from 'node:process';
import { restoreMediaCatalogOffline } from './mediaCatalogOfflineRestore.js';

type Args = { sqlitePath?: string; sourcePath?: string; expectedSha256?: string; backupPath?: string; leasePath?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = argv[i + 1];
    if (value === '--sqlite' && next) { args.sqlitePath = next; i += 1; continue; }
    if ((value === '--from' || value === '--source') && next) { args.sourcePath = next; i += 1; continue; }
    if (value === '--sha256' && next) { args.expectedSha256 = next; i += 1; continue; }
    if (value === '--backup' && next) { args.backupPath = next; i += 1; continue; }
    if (value === '--lease' && next) { args.leasePath = next; i += 1; continue; }
    if (value === '--help' || value === '-h') {
      console.log('Usage: npm --workspace @photosync/desktop run catalog:restore -- --sqlite <media-catalog.sqlite> --from <verified-export.json> --sha256 <export-sha256> [--backup <pre-restore.json>] [--lease <lockfile>]');
      process.exit(0);
    }
    throw new Error(`MEDIA_CATALOG_RESTORE_ARGUMENT_INVALID:${value}`);
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sqlitePath || !args.sourcePath || !args.expectedSha256) throw new Error('MEDIA_CATALOG_RESTORE_USAGE_REQUIRED');
  const result = restoreMediaCatalogOffline({
    sqlitePath: args.sqlitePath,
    sourcePath: args.sourcePath,
    expectedSha256: args.expectedSha256,
    backupPath: args.backupPath,
    leasePath: args.leasePath,
  });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
}
