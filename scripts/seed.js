// Fills a fresh database with demo data (see src/demo-seed.js).
//   npm run seed            (uses data/library.db)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/demo-seed.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || path.join(root, 'data', 'library.db');
if (seedDemo(openDb(dbFile))) console.log(`Seeded demo data into ${dbFile}`);
else console.log(`${dbFile} already has data — delete it first to reseed.`);
