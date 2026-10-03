import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const stateDirectory = path.join(baseDirectory, 'states');
const contentDirectory = path.join(baseDirectory, 'daily-content');
const explanationDirectory = path.join(baseDirectory, 'word-explanations');

async function ensureDirectories() {
  await Promise.all([mkdir(stateDirectory, { recursive: true }), mkdir(contentDirectory, { recursive: true }), mkdir(explanationDirectory, { recursive: true })]);
}

function stateFile(deviceId) {
  const hash = createHash('sha256').update(deviceId).digest('hex');
  return path.join(stateDirectory, `${hash}.json`);
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const temporaryFile = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporaryFile, filePath);
}

export async function getState(deviceId) {
  await ensureDirectories();
  return readJson(stateFile(deviceId), null);
}

export async function saveState(deviceId, state) {
  await ensureDirectories();
  const envelope = { deviceIdHash: createHash('sha256').update(deviceId).digest('hex'), updatedAt: new Date().toISOString(), state };
  await writeJson(stateFile(deviceId), envelope);
  return envelope;
}

export async function deleteState(deviceId) {
  await ensureDirectories();
  try { await unlink(stateFile(deviceId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { deletedAt: new Date().toISOString() };
}

export async function getKnownDays() {
  await ensureDirectories();
  const files = await readdir(stateDirectory);
  const envelopes = await Promise.all(files.filter((file) => file.endsWith('.json')).map((file) => readJson(path.join(stateDirectory, file))));
  return [...new Set(envelopes.map((item) => item?.state?.day).filter((day) => Number.isInteger(day) && day >= 1 && day <= 30))];
}

function contentFile(date, day) {
  return path.join(contentDirectory, `${date}-day-${day}.json`);
}

export async function getDailyContent(date, day) {
  await ensureDirectories();
  return readJson(contentFile(date, day), null);
}

export async function saveDailyContent(date, day, content) {
  await ensureDirectories();
  const envelope = { date, day, createdAt: new Date().toISOString(), ...content };
  await writeJson(contentFile(date, day), envelope);
  return envelope;
}

function explanationFile(text) {
  const hash = createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  return path.join(explanationDirectory, `${hash}.json`);
}

export async function getWordExplanation(text) {
  await ensureDirectories();
  return readJson(explanationFile(text), null);
}

export async function saveWordExplanation(text, explanation) {
  await ensureDirectories();
  const envelope = { text, createdAt: new Date().toISOString(), ...explanation };
  await writeJson(explanationFile(text), envelope);
  return envelope;
}
