import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qMulti, q } from './pool.js';
import { config, validateConfig } from '../config/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

/** รัน migration ทั้งหมดที่ยังไม่เคย apply (record ลงตาราง schema_migrations) */
export async function migrate() {
  validateConfig();
  await qMulti(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(191) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);

  const applied = new Set((await q('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const results = [];
  for (const file of files) {
    if (applied.has(file)) {
      results.push({ file, skipped: true });
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[migrate] applying ${file} ...`);
    await qMulti(sql);
    await q('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    results.push({ file, skipped: false });
    console.log(`[migrate] ✓ ${file}`);
  }
  return results;
}

// รันตรงๆ: npm run migrate -w server
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then((r) => {
      console.log(
        `[migrate] done (db=${config.db.database}) :`,
        r.map((x) => `${x.file}${x.skipped ? ' (skip)' : ''}`).join(', ')
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] FAILED:', err.message);
      process.exit(1);
    });
}
