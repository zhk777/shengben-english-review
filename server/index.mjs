import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { deleteState, getDailyContent, getKnownDays, getState, getWordExplanation, saveDailyContent, saveState, saveWordExplanation } from './storage.mjs';
import { generateDailyContent, generateWordExplanation, hasClearGrammarQuestion } from './qwen.mjs';
import { authenticateUser, createSession, createUser, databaseConfigured, deleteSession, deleteUserState, getKnownUserDays, getUserBySession, getUserState, initDatabase, renewSession, saveUserState, sessionDurationMs } from './db.mjs';

const app = express();
const port = Number(process.env.PORT || 8787);
app.set('trust proxy', process.env.TRUST_PROXY === '1');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
const cookieSecret = process.env.COOKIE_SECRET || undefined;
const cookieSecure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
const requestedSameSite = (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
const cookieSameSite = ['lax', 'strict', 'none'].includes(requestedSameSite) ? requestedSameSite : 'lax';
let databaseReady = false;
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: '请求过于频繁，请稍后再试。' } });
const wordExplainLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: '查询过于频繁，请稍后再试。' } });

process.on('uncaughtException', (error) => { console.error('[fatal] uncaught exception', error); process.exit(1); });
process.on('unhandledRejection', (error) => { console.error('[fatal] unhandled rejection', error); process.exit(1); });

app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on('finish', () => console.log(JSON.stringify({ at: new Date().toISOString(), method: request.method, path: request.originalUrl, status: response.statusCode, ms: Date.now() - startedAt })));
  next();
});

app.use((request, response, next) => {
  const origin = request.headers.origin;
  const originAllowed = !origin || allowedOrigins.includes(origin);
  if (origin && !originAllowed) return response.status(403).json({ error: '该来源未被允许访问。' });
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  if (origin && allowedOrigins.includes(origin)) response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-Id');
  response.setHeader('Access-Control-Allow-Methods', 'DELETE, GET, POST, PUT, OPTIONS');
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  return next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(cookieSecret));
app.use((request, response, next) => {
  if (allowedOrigins.includes(request.headers.origin)) response.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

function deviceId(request) {
  const value = request.get('X-Device-Id') || '';
  return /^[a-zA-Z0-9-]{16,128}$/.test(value) ? value : null;
}

function sessionToken(request) {
  return request.signedCookies?.study_session || request.cookies?.study_session;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    signed: Boolean(cookieSecret),
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: sessionDurationMs(),
    path: '/',
    priority: 'high',
  };
}

function setSessionCookie(response, token) {
  response.cookie('study_session', token, sessionCookieOptions());
}

async function attachIdentity(request, response, next) {
  try {
    if (databaseConfigured) {
      const token = sessionToken(request);
      const user = await getUserBySession(token);
      if (!user) return response.status(401).json({ error: '请先登录。' });
      request.user = user;
      // 每次成功访问学习数据都续期登录 Cookie，切换到后台再返回不会导致会话失效。
      if (await renewSession(token)) setSessionCookie(response, token);
    } else {
      const id = deviceId(request);
      if (!id) return response.status(400).json({ error: 'A valid X-Device-Id header is required.' });
      request.deviceId = id;
    }
    return next();
  } catch (error) { return next(error); }
}

function validCredentials(username, password) {
  return typeof username === 'string' && /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/.test(username) && typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function requestDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 30 ? day : null;
}

function beijingDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function beijingClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, hour: Number(map.hour) };
}

function needsMissedEightOClockRefresh(existing, date) {
  if (!existing?.createdAt) return false;
  const now = beijingClock();
  // 即使服务恰好在 08:00 后重启，用户第一次请求也会补齐当天的更新。
  if (now.date !== date || now.hour < 8) return false;
  const created = beijingClock(new Date(existing.createdAt));
  return created.date !== date || created.hour < 8;
}

async function ensureDailyContent(date, day, { refresh = false } = {}) {
  const existing = await getDailyContent(date, day);
  const existingIsClear = existing?.grammarQuestions?.every(hasClearGrammarQuestion);
  if (existing && existingIsClear && !refresh && !needsMissedEightOClockRefresh(existing, date)) return existing;
  const generated = await generateDailyContent({ date, day });
  return generated ? saveDailyContent(date, day, generated) : (existingIsClear ? existing : null);
}

app.get('/health', (_request, response) => response.json({ ok: true, service: 'shengben-review-api', uptimeSeconds: Math.floor(process.uptime()), qwenConfigured: Boolean(process.env.DASHSCOPE_API_KEY), databaseConfigured, databaseReady, storage: databaseConfigured ? 'postgresql' : 'file-fallback', authMode: databaseConfigured ? 'session-cookie' : 'device-fallback' }));

app.get('/api/auth/me', async (request, response, next) => {
  try {
    if (!databaseConfigured) return response.status(503).json({ error: '正式账号系统需要配置 DATABASE_URL。' });
    const token = sessionToken(request);
    const user = await getUserBySession(token);
    if (!user) return response.status(401).json({ error: '未登录。' });
    await renewSession(token);
    setSessionCookie(response, token);
    return response.json({ user });
  } catch (error) { return next(error); }
});

app.post('/api/auth/register', authLimiter, async (request, response, next) => {
  try {
    if (!databaseConfigured) return response.status(503).json({ error: '正式账号系统需要配置 DATABASE_URL。' });
    const username = request.body?.username?.trim(); const password = request.body?.password;
    if (!validCredentials(username, password)) return response.status(400).json({ error: '账号需为 2-32 位中英文、数字或下划线，密码需为 8-128 位。' });
    const user = await createUser(username, password);
    const token = await createSession(user.id);
    setSessionCookie(response, token);
    return response.status(201).json({ user });
  } catch (error) { if (error.code === '23505') return response.status(409).json({ error: '账号已经存在。' }); return next(error); }
});

app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  try {
    if (!databaseConfigured) return response.status(503).json({ error: '正式账号系统需要配置 DATABASE_URL。' });
    const username = request.body?.username?.trim(); const password = request.body?.password;
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) return response.status(400).json({ error: '账号或密码格式不正确。' });
    const user = await authenticateUser(username, password);
    if (!user) return response.status(401).json({ error: '账号或密码不正确。' });
    const token = await createSession(user.id);
    setSessionCookie(response, token);
    return response.json({ user });
  } catch (error) { return next(error); }
});

app.post('/api/auth/logout', async (request, response, next) => {
  try { await deleteSession(sessionToken(request)); response.clearCookie('study_session', { httpOnly: true, sameSite: cookieSameSite, secure: cookieSecure, path: '/' }); return response.status(204).end(); } catch (error) { return next(error); }
});

app.get('/api/state', attachIdentity, async (request, response, next) => {
  try {
    const saved = request.user ? await getUserState(request.user.id) : await getState(request.deviceId);
    return response.json({ state: saved?.state || null, updatedAt: saved?.updatedAt || null });
  } catch (error) { return next(error); }
});

app.put('/api/state', attachIdentity, async (request, response, next) => {
  try {
    if (!request.body?.state || typeof request.body.state !== 'object' || Array.isArray(request.body.state)) return response.status(400).json({ error: 'state must be an object.' });
    const saved = request.user ? await saveUserState(request.user.id, request.body.state) : await saveState(request.deviceId, request.body.state);
    return response.json({ updatedAt: saved.updatedAt });
  } catch (error) { return next(error); }
});

app.delete('/api/state', attachIdentity, async (request, response, next) => {
  try {
    if (request.user) return response.json(await deleteUserState(request.user.id));
    return response.json(await deleteState(request.deviceId));
  } catch (error) { return next(error); }
});

app.get('/api/daily-content', async (request, response, next) => {
  try {
    const day = requestDay(request.query.day);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(request.query.date || '') ? request.query.date : beijingDate();
    if (!day) return response.status(400).json({ error: 'day must be an integer from 1 to 30.' });
    const content = await ensureDailyContent(date, day);
    if (!content) return response.status(204).end();
    return response.json(content);
  } catch (error) { return next(error); }
});

app.post('/api/word-explain', attachIdentity, wordExplainLimiter, async (request, response, next) => {
  try {
    const text = typeof request.body?.text === 'string' ? request.body.text.replace(/\s+/g, ' ').trim() : '';
    if (!text || text.length > 160 || !/[A-Za-z]/.test(text)) return response.status(400).json({ error: '请选择不超过 8 个英文单词或短语。' });
    const cached = await getWordExplanation(text);
    if (cached) return response.json({ ...cached, source: 'cache' });
    const explanation = await generateWordExplanation({ text });
    if (!explanation) return response.status(503).json({ error: '千问服务尚未配置。' });
    const saved = await saveWordExplanation(text, explanation);
    return response.json({ ...saved, source: 'qwen' });
  } catch (error) { return next(error); }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Server operation failed. The frontend will use local fallback content.' });
});

cron.schedule('0 8 * * *', async () => {
  if (!process.env.DASHSCOPE_API_KEY) return;
  const date = beijingDate();
  // 正式账号进度存于 PostgreSQL；文件存储仅作为本地降级模式。
  const [fileDays, userDays] = await Promise.all([getKnownDays(), getKnownUserDays()]);
  const days = [...new Set([...fileDays, ...userDays])];
  // 每天 08:00 即使当天已缓存过内容也重新生成，保证内容真正更新。
  await Promise.allSettled(days.map((day) => ensureDailyContent(date, day, { refresh: true })));
}, { timezone: 'Asia/Shanghai' });

async function start() {
  if (process.env.NODE_ENV === 'production' && databaseConfigured && !cookieSecret) throw new Error('COOKIE_SECRET must be configured in production.');
  if (process.env.NODE_ENV === 'production' && databaseConfigured && allowedOrigins.length === 0) throw new Error('ALLOWED_ORIGINS must be configured in production.');
  if (cookieSameSite === 'none' && !cookieSecure) throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true and HTTPS.');
  databaseReady = await initDatabase();
  if (!databaseConfigured) console.warn('DATABASE_URL is not configured; running device/file fallback. Formal account routes are disabled.');
  app.listen(port, () => console.log(`Study API listening on http://127.0.0.1:${port}`));
}

start().catch((error) => { console.error('[startup] failed', error); process.exit(1); });
