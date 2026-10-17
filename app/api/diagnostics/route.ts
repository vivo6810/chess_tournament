import { NextResponse } from 'next/server';
import path from 'node:path';

/* TEMPORARY. Reports what the deployed runtime can and cannot do with SQLite,
   so the production 500s can be attributed instead of guessed at. Removed in
   the same change that fixes the data layer. */

export const dynamic = 'force-dynamic';

const message = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export async function GET() {
  const report: Record<string, string> = {
    node: process.version,
    cwd: process.cwd(),
    region: process.env.VERCEL_REGION ?? 'unknown',
    vercel: process.env.VERCEL ? 'yes' : 'no',
    databasePath: process.env.DATABASE_PATH ?? '(unset)',
  };

  let DatabaseSync: typeof import('node:sqlite').DatabaseSync | null = null;
  try {
    DatabaseSync = (await import('node:sqlite')).DatabaseSync;
    report.sqliteModule = 'available';
  } catch (error) {
    report.sqliteModule = message(error);
  }

  if (DatabaseSync) {
    try {
      const memory = new DatabaseSync(':memory:');
      memory.exec('CREATE TABLE probe (a INTEGER)');
      report.memory = 'ok';
      memory.close();
    } catch (error) {
      report.memory = message(error);
    }

    try {
      const temp = new DatabaseSync(path.join('/tmp', 'arbiter-probe.db'));
      temp.exec('PRAGMA journal_mode = WAL;');
      temp.exec('CREATE TABLE IF NOT EXISTS probe (a INTEGER);');
      report.tmp = 'ok';
      temp.close();
    } catch (error) {
      report.tmp = message(error);
    }

    try {
      const bundled = new DatabaseSync(path.join(process.cwd(), 'data', 'arbiter.db'));
      bundled.exec('PRAGMA journal_mode = WAL;');
      report.bundledDataFile = 'writable';
      bundled.close();
    } catch (error) {
      report.bundledDataFile = message(error);
    }
  }

  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
