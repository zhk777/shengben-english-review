import crypto from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const databaseUrl = process.env.DATABASE_URL || '';
export const databaseConfigured = Boolean(databaseUrl);
export const sessionDurationMs = () => {
  const configuredDays = Number(process.env.SESSION_DAYS || 180);
  const days = Number.isFinite(configuredDays) ? Math.min(Math.max(configuredDays, 1), 365) : 180;
  return days * 86400000;
};
const pool = databaseConfigured ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  max: Number(process.env.DATABASE_POOL_MAX || 5),
}) : null;

function requireDatabase() {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  return pool;
}

export async function initDatabase() {
  if (!pool) return false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS study_states (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
  `);
  return true;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const safeUser = (row) => row ? ({ id: row.id, username: row.username, createdAt: row.created_at }) : null;

export async function createUser(username, password) {
  const db = requireDatabase();
  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db.query('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) RETURNING id, username, created_at', [userId, username, passwordHash]);
  return safeUser(result.rows[0]);
}

export async function authenticateUser(username, password) {
  const db = requireDatabase();
  const result = await db.query('SELECT id, username, password_hash, created_at FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  const row = result.rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;
  return safeUser(row);
}

export async function createSession(userId) {
  const db = requireDatabase();
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationMs());
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expiresAt]);
  return token;
}

export async function getUserBySession(token) {
  if (!token || !pool) return null;
  const result = await pool.query('SELECT u.id, u.username, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()', [hashToken(token)]);
  return safeUser(result.rows[0]);
}

// Keep an actively used login alive without creating a new token on every page load.
export async function renewSession(token) {
  if (!token || !pool) return false;
  const expiresAt = new Date(Date.now() + sessionDurationMs());
  const result = await pool.query(
    'UPDATE sessions SET expires_at = $2 WHERE token_hash = $1 AND expires_at > NOW() RETURNING token_hash',
    [hashToken(token), expiresAt],
  );
  return result.rowCount > 0;
}

export async function deleteSession(token) {
  if (!token || !pool) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function getUserState(userId) {
  const db = requireDatabase();
  const result = await db.query('SELECT state, updated_at FROM study_states WHERE user_id = $1', [userId]);
  return result.rows[0] ? { state: result.rows[0].state, updatedAt: result.rows[0].updated_at } : null;
}

export async function saveUserState(userId, state) {
  const db = requireDatabase();
  const result = await db.query(`INSERT INTO study_states (user_id, state) VALUES ($1, $2::jsonb) ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW() RETURNING updated_at`, [userId, JSON.stringify(state)]);
  return { updatedAt: result.rows[0].updated_at };
}

export async function deleteUserState(userId) {
  const db = requireDatabase();
  await db.query('DELETE FROM study_states WHERE user_id = $1', [userId]);
  return { deletedAt: new Date().toISOString() };
}

export async function getKnownUserDays() {
  if (!pool) return [];
  const result = await pool.query(`
    SELECT DISTINCT (state ->> 'day')::int AS day
    FROM study_states
    WHERE (state ->> 'day') ~ '^(?:[1-9]|[12][0-9]|30)$'
  `);
  return result.rows.map((row) => row.day).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30);
}

export async function closeDatabase() {
  if (pool) await pool.end();
}
