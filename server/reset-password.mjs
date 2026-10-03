import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(directory, '.env') });

const username = process.argv[2]?.trim();
if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/.test(username || '')) {
  console.error('用法：npm run reset-password -- <账号>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('未读取到 DATABASE_URL，请检查 server/.env。');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('请在服务器的交互式终端中执行此命令。');
  process.exit(1);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const previousRawMode = input.isRaw;
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const finish = () => {
      input.off('data', onData);
      input.setRawMode(Boolean(previousRawMode));
      process.stdout.write('\n');
      resolve(value);
    };
    const cancel = () => {
      input.off('data', onData);
      input.setRawMode(Boolean(previousRawMode));
      process.stdout.write('\n');
      reject(new Error('已取消。'));
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return cancel();
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue; }
        if (character >= ' ') value += character;
      }
    };
    input.on('data', onData);
  });
}

const password = await readHidden(`为账号 ${username} 输入新密码（至少 8 位，不会显示）：`);
if (password.length < 8 || password.length > 128) {
  console.error('密码长度需为 8—128 位，未作任何修改。');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  max: 1,
});

try {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE LOWER(username) = LOWER($2) RETURNING username',
    [passwordHash, username],
  );
  if (!result.rowCount) {
    console.error('没有找到该服务器账号，未作任何修改。');
    process.exitCode = 1;
  } else {
    console.log(`账号 ${result.rows[0].username} 的密码已重置。`);
  }
} finally {
  await pool.end();
}
