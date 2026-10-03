import 'dotenv/config';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for a database backup.');
  process.exit(1);
}

const backupDir = process.env.BACKUP_DIR || './backups';
await mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(backupDir, `shengben-review-${stamp}.dump`);
const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--file', output, databaseUrl], { stdio: 'inherit', shell: false });
child.on('error', (error) => { console.error(`无法执行 pg_dump：${error.message}`); process.exit(1); });
child.on('exit', (code) => { if (code === 0) console.log(`数据库备份已写入 ${output}`); process.exit(code ?? 1); });
