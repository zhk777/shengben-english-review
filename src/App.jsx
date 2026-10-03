import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import './grammar-overrides.css';
import {
  AlertTriangle, BarChart3, BookOpen, BrainCircuit, CalendarDays, Check, CheckCircle2,
  ChevronLeft, ChevronRight, CircleHelp, Clock3, Headphones, Home, Languages,
  Download, ListChecks, LockKeyhole, Menu, Pause, Play, RefreshCw, Search, Sparkles, TimerReset, Upload, Volume2, XCircle,
} from 'lucide-react';
import { fallbackQuestions, grammarByDay, phrasesForDay, reviewDays, translationFallback, vocabularyByDay } from './data.js';
import { matchesChineseMeaning, matchesEnglishPhrase, normalizeAnswer } from './answer-match.js';
import { snapshotReviewItems } from './review-session.js';

const STORAGE_KEY = 'shengben-review-state-v1';
const USERS_KEY = 'shengben-review-local-users-v1';
const AUTH_KEY = 'shengben-review-local-auth-v1';
const MIGRATION_KEY = 'shengben-review-local-migrated-v1';
const DEVICE_KEY = 'shengben-review-device-id-v1';
const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
const initialState = {
  day: 1,
  wordProgress: {},
  wordPositions: {},
  wordReviewPositions: {},
  phraseProgress: {},
  phraseAttempts: [],
  wordAttempts: [],
  grammarAttempts: [],
  grammarRuleProgress: {},
  translationDone: {},
  translationReview: {},
  wordWrongBook: {},
  phraseWrongBook: {},
  grammarWrongBook: {},
  minutesByDay: {},
  timerRemainderByDay: {},
};

const activeWrongItems = (book) => Object.values(book || {}).filter((item) => item.status !== '已掌握');

function stableWeight(item, day, index) {
  const identity = item.word || item.phraseId || item.questionId || String(index);
  const seed = [...`${identity}-${day}`].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 997, 0) / 997;
  const ageHours = Math.max(0, (Date.now() - new Date(item.lastWrongAt || 0).getTime()) / 3600000);
  return (item.wrongCount || 1) * 100 + Math.min(ageHours, 72) + seed;
}

function weightedWrongItems(book, day, count) {
  return activeWrongItems(book).map((item, index) => ({ item, score: stableWeight(item, day, index) }))
    .sort((a, b) => b.score - a.score).slice(0, count).map(({ item }) => item);
}

function getDeviceId(userId = 'guest') {
  const deviceKey = `${DEVICE_KEY}:${userId}`;
  let id = localStorage.getItem(deviceKey);
  if (!id) {
    id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(deviceKey, id);
  }
  return id;
}

function migrateLegacyState(userId) {
  if (localStorage.getItem(MIGRATION_KEY) || localStorage.getItem(`${STORAGE_KEY}:${userId}`)) return;
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (legacy) localStorage.setItem(`${STORAGE_KEY}:${userId}`, legacy);
  localStorage.setItem(MIGRATION_KEY, '1');
}

function useLocalAuth() {
  const serverMode = Boolean(API_BASE);
  const [currentUser, setCurrentUser] = useState(() => {
    if (serverMode) return null;
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(serverMode);
  const [authError, setAuthError] = useState('');

  const refreshServerSession = useCallback(async ({ signal } = {}) => {
    const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include', signal });
    if (response.status === 401) {
      setCurrentUser(null);
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    setCurrentUser(payload.user || null);
    setAuthError('');
    return payload.user || null;
  }, []);

  useEffect(() => {
    if (!serverMode) return undefined;
    const controller = new AbortController();
    refreshServerSession({ signal: controller.signal })
      .catch((error) => { if (error.name !== 'AbortError') setAuthError(error.message || '认证服务暂不可用。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshServerSession, serverMode]);

  const demoUser = { id: 'local-demo-user', username: 'demo', password: '123456', createdAt: 0 };
  const getUsers = () => {
    try {
      const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
      return users.length ? users : [demoUser];
    } catch { return [demoUser]; }
  };
  const localLogin = (username, password) => {
    const user = getUsers().find((item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.password === password);
    if (!user) return { ok: false, message: '账号或密码不正确。' };
    migrateLegacyState(user.id); localStorage.setItem(AUTH_KEY, JSON.stringify(user)); setCurrentUser(user); return { ok: true };
  };
  const localRegister = (username, password) => {
    const name = username.trim(); const users = getUsers();
    if (name.length < 2) return { ok: false, message: '账号至少需要 2 个字符。' };
    if (password.length < 6) return { ok: false, message: '密码至少需要 6 位。' };
    if (users.some((item) => item.username.toLowerCase() === name.toLowerCase())) return { ok: false, message: '这个账号已经存在。' };
    const user = { id: crypto.randomUUID(), username: name, password, createdAt: Date.now() };
    localStorage.setItem(USERS_KEY, JSON.stringify([...users, user])); migrateLegacyState(user.id); localStorage.setItem(AUTH_KEY, JSON.stringify(user)); setCurrentUser(user); return { ok: true };
  };
  const serverRequest = async (path, body) => {
    const response = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: payload.error || `请求失败（${response.status}）` };
    setCurrentUser(payload.user || null); setAuthError(''); return { ok: true };
  };
  const login = (username, password) => serverMode ? serverRequest('/api/auth/login', { username, password }) : localLogin(username, password);
  const register = (username, password) => serverMode ? serverRequest('/api/auth/register', { username, password }) : localRegister(username, password);
  const logout = async () => {
    if (serverMode) await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    else localStorage.removeItem(AUTH_KEY);
    setCurrentUser(null);
  };
  return { currentUser, login, register, logout, loading, authError, serverMode };
}

function readInitialState(storageKey, userId) {
  try {
    const namespaced = localStorage.getItem(storageKey);
    return { ...initialState, ...JSON.parse(namespaced || '{}') };
  } catch { return initialState; }
}

function usePersistentState(userId = 'guest') {
  const storageKey = userId === 'guest' ? STORAGE_KEY : `${STORAGE_KEY}:${userId}`;
  const [state, setState] = useState(() => {
    return readInitialState(storageKey, userId);
  });
  const [syncStatus, setSyncStatus] = useState(API_BASE && userId !== 'guest' ? 'connecting' : 'local');
  const serverReady = useRef(!API_BASE);
  const deviceId = useRef(null);
  const hydrating = useRef(false);
  useEffect(() => { hydrating.current = true; setState(readInitialState(storageKey, userId)); }, [storageKey, userId]);
  useEffect(() => {
    if (hydrating.current) { hydrating.current = false; return; }
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);
  useEffect(() => {
    serverReady.current = !API_BASE || userId === 'guest';
    if (!API_BASE || userId === 'guest') { setSyncStatus('local'); return undefined; }
    const controller = new AbortController();
    deviceId.current = getDeviceId(userId);
    fetch(`${API_BASE}/api/state`, { credentials: 'include', headers: { 'X-Device-Id': deviceId.current }, signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => {
        if (payload.state) setState({ ...initialState, ...payload.state });
        else setState((previous) => ({ ...previous }));
        serverReady.current = true;
        setSyncStatus('synced');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          serverReady.current = true;
          setSyncStatus('offline');
        }
      });
    return () => controller.abort();
  }, [userId]);
  useEffect(() => {
    if (!API_BASE || !serverReady.current) return undefined;
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE}/api/state`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId.current || getDeviceId(userId) },
        body: JSON.stringify({ state }),
      }).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setSyncStatus('synced');
      }).catch(() => setSyncStatus('offline'));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state, userId]);
  return [state, setState, syncStatus];
}

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shanghaiRefreshMarker() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}:${Number(value.hour) >= 8 ? 'after-eight' : 'before-eight'}`;
}

function useDailyDynamicContent(day) {
  const [content, setContent] = useState(null);
  const [status, setStatus] = useState('local');
  const [refreshMarker, setRefreshMarker] = useState(shanghaiRefreshMarker);
  const [retryVersion, setRetryVersion] = useState(0);
  const retryTimer = useRef(null);
  useEffect(() => {
    const checkRefreshTime = () => {
      const nextMarker = shanghaiRefreshMarker();
      setRefreshMarker((previousMarker) => {
        if (previousMarker === nextMarker) return previousMarker;
        if (nextMarker.endsWith('after-eight')) {
          window.clearTimeout(retryTimer.current);
          // 等待后端 08:00 定时任务写入完毕后再取一次，避免正好撞上生成时刻。
          retryTimer.current = window.setTimeout(() => setRetryVersion((value) => value + 1), 45000);
        }
        return nextMarker;
      });
    };
    const interval = window.setInterval(checkRefreshTime, 30000);
    return () => { window.clearInterval(interval); window.clearTimeout(retryTimer.current); };
  }, []);
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
    if (!apiBase) { setContent(null); setStatus('local'); return undefined; }
    const controller = new AbortController();
    setStatus('loading');
    fetch(`${apiBase}/api/daily-content?date=${shanghaiDate()}&day=${day}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => { setContent(payload); setStatus('remote'); })
      .catch((error) => { if (error.name !== 'AbortError') { setContent(null); setStatus('fallback'); } });
    return () => controller.abort();
  }, [day, refreshMarker, retryVersion]);
  return { content, status };
}

let activeSpeechRequest = 0;

function notifySpeechUnavailable(message) {
  window.dispatchEvent(new CustomEvent('study:speech-unavailable', { detail: { message } }));
}

function getEnglishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => /^en[-_]us$/i.test(voice.lang) && voice.localService)
    || voices.find((voice) => /^en[-_]gb$/i.test(voice.lang) && voice.localService)
    || voices.find((voice) => /^en([-_]|$)/i.test(voice.lang))
    || null;
}

function playSpeech(text) {
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
    notifySpeechUnavailable('此浏览器不支持网页发音。请换用 Chrome、Safari 或开启系统“英语文字转语音”服务。');
    return;
  }
  const speechText = text.replace(/\bsth\.?/g, '').replace(/\bsb\.?/g, 'somebody').trim();
  if (!speechText) return;
  const requestId = ++activeSpeechRequest;
  const synthesis = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(speechText);
  utterance.lang = 'en-US';
  utterance.rate = 0.83;
  utterance.voice = getEnglishVoice();
  let started = false;
  let startTimer;
  const clearStartTimer = () => window.clearTimeout(startTimer);
  utterance.onstart = () => { started = true; clearStartTimer(); };
  utterance.onend = clearStartTimer;
  utterance.onerror = (event) => {
    clearStartTimer();
    if (requestId !== activeSpeechRequest || event.error === 'interrupted' || event.error === 'canceled') return;
    notifySpeechUnavailable('浏览器没有成功播放发音。请检查媒体音量和系统英语语音服务，或改用兼容音频。');
  };
  try {
    synthesis.cancel();
    synthesis.resume();
    synthesis.speak(utterance);
    startTimer = window.setTimeout(() => {
      if (requestId !== activeSpeechRequest || started) return;
      synthesis.cancel();
      notifySpeechUnavailable('浏览器未启动发音。部分安卓浏览器会限制网页语音，建议改用兼容音频或系统浏览器。');
    }, 2500);
  } catch {
    notifySpeechUnavailable('浏览器语音服务暂时不可用，请稍后重试或改用兼容音频。');
  }
}

const normalize = normalizeAnswer;
const formatMinutes = (minutes) => `${Math.floor(minutes / 60)}小时${String(minutes % 60).padStart(2, '0')}分`;

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function choiceOptions(question) {
  if (!Array.isArray(question?.options)) return [];
  return question.options
    .filter((option) => typeof option === 'string')
    .map((option) => option.trim())
    .filter(Boolean);
}

function isTypedGrammarQuestion(question) {
  const type = String(question?.type || '').trim().toLowerCase();
  return ['fill', 'fill-blank', 'fillblank', 'input', 'short-answer', 'word-form', 'wordform', 'error-correction', 'errorcorrection', 'sentence-translation', 'sentencetranslation'].includes(type)
    || choiceOptions(question).length < 2;
}

function grammarInstruction(question) {
  const savedInstruction = question?.instruction?.trim();
  // 历史动态题有时会保存空选项，却仍带着“从选项中选择”的旧提示。
  // 此时页面改为填空，提示也必须同步，不能让学生无从作答。
  if (savedInstruction && !(isTypedGrammarQuestion(question) && /选项|选择/.test(savedInstruction))) return savedInstruction;
  const prompt = String(question?.question || '').toLowerCase();
  const action = isTypedGrammarQuestion(question) ? '请在下方输入框填写答案。' : '再从下方选项中选择。';
  if (prompt.includes('verb')) return `答题要求：找出句子的谓语动词，也就是表示“主语做什么”的词，${action}`;
  if (prompt.includes('subject')) return `答题要求：找出句子的主语，也就是“谁/什么”发出动作或处于某种状态，${action}`;
  if (prompt.includes('object')) return `答题要求：找出句子的宾语，也就是动作所涉及的对象，${action}`;
  return `答题要求：根据“${question?.testedRule || '今日语法点'}”判断，${isTypedGrammarQuestion(question) ? '在下方填写正确答案。' : '选择唯一正确的一项。'}`;
}

function ModuleCompleteNotice({ title, detail, onRestart, restartLabel = '从头再练一轮' }) {
  return <div className="module-complete" role="status"><CheckCircle2 size={24} /><div><strong>{title}</strong><p>{detail}</p></div>{onRestart && <button type="button" className="secondary-button" onClick={onRestart}>{restartLabel}</button>}</div>;
}

function IconButton({ label, onClick, children }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function ProgressRing({ value }) {
  return <div className="progress-ring" style={{ '--progress': `${Math.min(100, value)}%` }}><strong>{value}%</strong></div>;
}

function MiniLineChart({ values }) {
  const path = (series) => series.map((value, index) => `${index === 0 ? 'M' : 'L'} ${12 + index * 66} ${158 - value * 1.18}`).join(' ');
  const dots = (series, color) => series.map((value, index) => <circle key={`${color}-${index}`} cx={12 + index * 66} cy={158 - value * 1.18} r="4" fill={color} />);
  return <svg className="trend-svg" viewBox="0 0 420 180" role="img" aria-label="最近 7 天学习趋势">
    {[38, 78, 118, 158].map((y) => <line key={y} x1="12" x2="408" y1={y} y2={y} stroke="var(--line)" />)}
    <path d={path(values.complete)} fill="none" stroke="var(--green)" strokeWidth="2.6" />
    <path d={path(values.word)} fill="none" stroke="var(--blue)" strokeWidth="2.6" />
    <path d={path(values.grammar)} fill="none" stroke="var(--purple)" strokeWidth="2.6" />
    {dots(values.complete, 'var(--green)')}{dots(values.word, 'var(--blue)')}{dots(values.grammar, 'var(--purple)')}
  </svg>;
}

function StatCard({ icon: Icon, tone, label, value, helper, progress }) {
  return <section className={`stat-card ${tone}`}>
    <div className="stat-label"><Icon size={22} />{label}</div>
    <strong className="stat-value">{value}</strong>
    {helper && <span className="stat-helper">{helper}</span>}
    {typeof progress === 'number' && <div className="mini-progress"><span style={{ width: `${progress}%` }} /></div>}
  </section>;
}

function App() {
  const auth = useLocalAuth();
  const userId = auth.currentUser?.id || 'guest';
  const [state, setState, syncStatus] = usePersistentState(userId);
  const [screen, setScreen] = useState('home');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [errorPractice, setErrorPractice] = useState(null);
  const [studyIntent, setStudyIntent] = useState(null);
  const [speechNotice, setSpeechNotice] = useState('');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [wordExplain, setWordExplain] = useState(null);
  const timerStartedAt = useRef(null);
  const stateRef = useRef(state);
  const pageContentRef = useRef(null);
  const day = state.day;
  const words = vocabularyByDay.get(day) || [];
  const phrases = phrasesForDay.get(day) || [];
  const grammar = grammarByDay.get(day);
  const dynamicContent = useDailyDynamicContent(day);

  const clearWordExplain = useCallback(() => {
    window.getSelection?.()?.removeAllRanges();
    setWordExplain(null);
  }, []);

  const handleTextSelection = useCallback((event) => {
    if (event.target.closest('input, textarea, select, button, [data-no-word-explain]')) return;
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      const text = selection?.toString().replace(/\s+/g, ' ').trim() || '';
      const wordsInSelection = text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)?/g) || [];
      if (!text || text.length > 160 || wordsInSelection.length === 0 || wordsInSelection.length > 8) { setWordExplain(null); return; }
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) return;
      setWordExplain({ text, left: Math.min(Math.max(12, rect.left), window.innerWidth - 270), top: Math.min(rect.bottom + 10, window.innerHeight - 80), status: 'ready' });
    });
  }, []);

  const queryWordExplanation = useCallback(async () => {
    if (!wordExplain?.text || wordExplain.status === 'loading') return;
    if (!API_BASE) { setWordExplain((previous) => previous ? { ...previous, status: 'error', error: '词汇助手需要连接服务器后使用。' } : previous); return; }
    const text = wordExplain.text;
    setWordExplain((previous) => previous ? { ...previous, status: 'loading', error: '' } : previous);
    try {
      const response = await fetch(`${API_BASE}/api/word-explain`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
      setWordExplain((previous) => previous?.text === text ? { ...previous, status: 'done', data: payload } : previous);
    } catch (error) {
      setWordExplain((previous) => previous?.text === text ? { ...previous, status: 'error', error: error.message || '查询失败，请稍后重试。' } : previous);
    }
  }, [wordExplain]);

  const wordAccuracy = useMemo(() => {
    const attempts = state.wordAttempts.filter((item) => item.day === day);
    if (!attempts.length) return 0;
    return Math.round((attempts.filter((item) => item.correct).length / attempts.length) * 100);
  }, [state.wordAttempts, day]);
  const grammarAccuracy = useMemo(() => {
    const attempts = state.grammarAttempts.filter((item) => item.day === day);
    if (!attempts.length) return 0;
    return Math.round((attempts.filter((item) => item.correct).length / attempts.length) * 100);
  }, [state.grammarAttempts, day]);
  const learnedWordCount = words.filter((word) => state.wordProgress[`${day}:${word.term}`]).length;
  const learnedPhraseCount = phrases.filter((phrase) => state.phraseProgress[`${day}:${phrase.id}`]).length;
  const dailyGrammarQuestions = useMemo(() => {
    const remote = dynamicContent.content?.grammarQuestions?.filter((item) => item.moduleId === grammar?.id) || [];
    const local = grammar ? fallbackQuestions.filter((item) => item.moduleId === grammar.id) : [];
    return (remote.length ? remote : local).slice(0, 15);
  }, [dynamicContent.content?.grammarQuestions, grammar]);
  const dailyGrammarIds = useMemo(() => new Set(dailyGrammarQuestions.map((item) => item.id)), [dailyGrammarQuestions]);
  const allGrammarDoneCount = useMemo(() => new Set(state.grammarAttempts
    .filter((item) => item.day === day).map((item) => item.questionId)).size, [day, state.grammarAttempts]);
  const grammarDoneCount = useMemo(() => dailyGrammarIds.size
    ? new Set(state.grammarAttempts.filter((item) => item.day === day && dailyGrammarIds.has(item.questionId)).map((item) => item.questionId)).size
    : allGrammarDoneCount, [allGrammarDoneCount, day, dailyGrammarIds, state.grammarAttempts]);
  const grammarGoalCount = dailyGrammarQuestions.length || (reviewDays.has(day) ? 5 : 15);
  const grammarRuleDone = Boolean(state.grammarRuleProgress?.[`${day}:${grammar?.id}`] || grammarDoneCount > 0);
  const translationItems = dynamicContent.content?.translationItems?.length ? dynamicContent.content.translationItems : translationFallback;
  const translationDoneCount = translationItems.filter((item) => state.translationDone[`${day}:${item.id}`]).length;
  const phraseAttemptCount = state.phraseAttempts.filter((item) => item.day === day).length;
  const wordWrongCount = activeWrongItems(state.wordWrongBook).length;
  const phraseWrongCount = activeWrongItems(state.phraseWrongBook).length;
  const grammarWrongCount = activeWrongItems(state.grammarWrongBook).length;
  const todayMinutes = (state.minutesByDay?.[day] || 0) + Math.floor((state.timerRemainderByDay?.[day] || 0) / 60);
  const isReviewDay = reviewDays.has(day);
  const wordReviewQueue = useMemo(() => weightedWrongItems(state.wordWrongBook, day, 10), [state.wordWrongBook, day]);
  const phraseReviewQueue = useMemo(() => weightedWrongItems(state.phraseWrongBook, day, 10), [state.phraseWrongBook, day]);
  const grammarReviewQueue = useMemo(() => weightedWrongItems(state.grammarWrongBook, day, 4), [state.grammarWrongBook, day]);
  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
    const showNotice = (event) => {
      setSpeechNotice(event.detail?.message || '当前设备没有可用的浏览器语音，请检查系统语音服务或使用带声音的设备。');
      window.setTimeout(() => setSpeechNotice(''), 6000);
    };
    window.addEventListener('study:speech-unavailable', showNotice);
    return () => window.removeEventListener('study:speech-unavailable', showNotice);
  }, []);
  useEffect(() => {
    const online = () => setIsOnline(true); const offline = () => setIsOnline(false);
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    if (!auth.currentUser || !pageContentRef.current) return undefined;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(pageContentRef.current,
        { autoAlpha: .94, y: 8 },
        { autoAlpha: 1, y: 0, duration: .38, ease: 'power3.out', clearProps: 'opacity,visibility,transform' });
    });
    return () => media.revert();
  }, [auth.currentUser, screen]);
  useEffect(() => {
    if (!timerRunning || document.hidden) return undefined;
    timerStartedAt.current = Date.now();
    const flushTimer = () => {
      if (!timerStartedAt.current) return;
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timerStartedAt.current) / 1000));
      const previous = stateRef.current;
      const oldRemainder = previous.timerRemainderByDay?.[day] || 0;
      const totalSeconds = oldRemainder + elapsedSeconds;
      const minutes = Math.floor(totalSeconds / 60);
      const remainder = totalSeconds % 60;
      const next = { ...previous, minutesByDay: { ...previous.minutesByDay, [day]: (previous.minutesByDay?.[day] || 0) + minutes }, timerRemainderByDay: { ...previous.timerRemainderByDay, [day]: remainder } };
      stateRef.current = next;
      setState(next);
      const key = userId === 'guest' ? STORAGE_KEY : `${STORAGE_KEY}:${userId}`;
      localStorage.setItem(key, JSON.stringify(next));
      timerStartedAt.current = null;
    };
    const timer = window.setInterval(() => {
      if (document.hidden || !timerStartedAt.current) return;
      const elapsedMinutes = Math.floor((Date.now() - timerStartedAt.current) / 60000);
      if (elapsedMinutes > 0) {
        setState((previous) => ({ ...previous, minutesByDay: { ...previous.minutesByDay, [day]: (previous.minutesByDay?.[day] || 0) + elapsedMinutes } }));
        timerStartedAt.current += elapsedMinutes * 60000;
      }
    }, 1000);
    window.addEventListener('beforeunload', flushTimer);
    return () => { window.removeEventListener('beforeunload', flushTimer); flushTimer(); window.clearInterval(timer); };
  }, [day, setState, timerRunning, userId]);
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setTimerRunning(false); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  const tasks = useMemo(() => {
    if (isReviewDay) {
      return {
        morning: [
          { label: '词汇回收（当天错词优先）', detail: `${learnedWordCount}/${words.length || 50}`, done: learnedWordCount >= (words.length || 50), target: 'word-learn' },
          { label: '短语与固定搭配回收', detail: `${learnedPhraseCount}/${phrases.length || 5}`, done: learnedPhraseCount >= (phrases.length || 5), target: 'phrase-learn' },
          { label: '语法综合小测', detail: `${grammarDoneCount}/${Math.min(grammarGoalCount, 5)} 题`, done: grammarDoneCount >= Math.min(grammarGoalCount, 5), target: 'grammar' },
          { label: '翻译理解', detail: `${translationDoneCount}/${translationItems.length}`, done: translationItems.length > 0 && translationDoneCount === translationItems.length, target: 'translation' },
        ],
        evening: [
          { label: '错词再练', detail: `${wordWrongCount} 项待复习`, done: wordWrongCount === 0, target: 'word-errors' },
          { label: '短语错题再练', detail: `${phraseWrongCount} 项待复习`, done: phraseWrongCount === 0, target: 'phrase-errors' },
          { label: '语法错题再练', detail: `${grammarWrongCount} 项待复习`, done: grammarWrongCount === 0, target: 'grammar-errors' },
        ],
      };
    }
    return {
      morning: [
        { label: '当日新词与发音', detail: `${learnedWordCount}/${words.length}`, done: words.length > 0 && learnedWordCount === words.length, target: 'word-learn' },
        { label: '短语搭配', detail: `${learnedPhraseCount}/${phrases.length}`, done: phrases.length > 0 && learnedPhraseCount === phrases.length, target: 'phrase-learn' },
        { label: grammar ? `语法学习：${grammar.title}` : '语法综合回收', detail: grammar ? (grammarRuleDone ? '已完成规则与例句学习' : '阅读规则与例句后点“完成学习”') : '按错题薄弱点复习', done: grammarRuleDone, target: 'grammar' },
        { label: '动态语法巩固', detail: `${grammarDoneCount}/${grammarGoalCount} 题`, done: grammarGoalCount > 0 && grammarDoneCount >= grammarGoalCount, target: 'grammar' },
        { label: '每日翻译理解', detail: `${translationDoneCount}/${translationItems.length} 句`, done: translationItems.length > 0 && translationDoneCount === translationItems.length, target: 'translation' },
      ],
      evening: [
        { label: '单词主动回忆', detail: `${state.wordAttempts.filter((item) => item.day === day).length} 次作答`, done: state.wordAttempts.filter((item) => item.day === day).length >= 5, target: 'word-review' },
        { label: '短语主动回忆', detail: `${phraseAttemptCount}/${phrases.length || 5} 组`, done: phraseAttemptCount >= (phrases.length || 5), target: 'phrase-review' },
        { label: '错题巩固', detail: `${wordWrongCount + phraseWrongCount + grammarWrongCount} 项待复习`, done: wordWrongCount + phraseWrongCount + grammarWrongCount === 0, target: 'word-errors' },
      ],
    };
  }, [day, isReviewDay, learnedWordCount, words.length, learnedPhraseCount, phrases.length, grammar, grammarDoneCount, grammarGoalCount, grammarRuleDone, translationDoneCount, translationItems.length, state.wordAttempts, phraseAttemptCount, wordWrongCount, phraseWrongCount, grammarWrongCount]);

  const morningDone = tasks.morning.filter((task) => task.done).length;
  const eveningDone = tasks.evening.filter((task) => task.done).length;
  const completion = Math.round(((morningDone * 240 / Math.max(tasks.morning.length, 1)) + (eveningDone * 40 / Math.max(tasks.evening.length, 1))) / 280 * 100);

  const markWordLearned = useCallback((word) => {
    setState((previous) => ({
      ...previous,
      wordProgress: { ...previous.wordProgress, [`${day}:${word.term}`]: true },
    }));
  }, [day, setState]);

  const setWordPosition = useCallback((position) => {
    setState((previous) => ({
      ...previous,
      wordPositions: { ...previous.wordPositions, [day]: position },
    }));
  }, [day, setState]);

  const setWordReviewPosition = useCallback((position) => {
    setState((previous) => ({
      ...previous,
      wordReviewPositions: { ...previous.wordReviewPositions, [day]: position },
    }));
  }, [day, setState]);

  const recordWordAttempt = useCallback((word, correct, direction, answer = '') => {
    setState((previous) => {
      const id = `${word.term}:${direction}`;
      const wrongBook = { ...previous.wordWrongBook };
      if (correct) {
        // 单词错题答对一次即回收，避免已经掌握的词继续占用晚间复习。
        delete wrongBook[id];
      } else {
        wrongBook[id] = { word: word.term, meaning: word.meaning, direction, answer, wrongCount: (wrongBook[id]?.wrongCount || 0) + 1, lastWrongAt: new Date().toISOString(), streak: 0, status: '待复习' };
      }
      return {
        ...previous,
        wordAttempts: [...previous.wordAttempts, { day, term: word.term, correct, direction, at: Date.now() }],
        wordWrongBook: wrongBook,
      };
    });
  }, [day, setState]);

  const recordGrammarAttempt = useCallback((question, correct, answer) => {
    setState((previous) => {
      const wrongBook = { ...previous.grammarWrongBook };
      if (!correct) {
        wrongBook[question.id] = {
          questionId: question.id, moduleId: question.moduleId, topic: question.testedRule, instruction: question.instruction, question: question.question, type: question.type || (question.options?.length ? 'choice' : 'fill'), options: question.options || [],
          answer: question.answer, userAnswer: answer, correctAnswer: question.answer, explanation: question.explanation,
          wrongCount: (wrongBook[question.id]?.wrongCount || 0) + 1, lastWrongAt: new Date().toISOString(), status: '待复习',
        };
      } else if (wrongBook[question.id]) {
        const streak = (wrongBook[question.id].streak || 0) + 1;
        wrongBook[question.id] = { ...wrongBook[question.id], streak, status: streak >= 2 ? '已掌握' : '复习中', lastReviewedAt: new Date().toISOString() };
      }
      return {
        ...previous,
        grammarAttempts: [...previous.grammarAttempts, { day, questionId: question.id, correct, at: Date.now() }],
        grammarWrongBook: wrongBook,
      };
    });
  }, [day, setState]);

  const markPhrase = useCallback((phrase) => {
    setState((previous) => ({ ...previous, phraseProgress: { ...previous.phraseProgress, [`${day}:${phrase.id}`]: true } }));
  }, [day, setState]);

  const markGrammarRuleLearned = useCallback(() => {
    if (!grammar) return;
    setState((previous) => ({
      ...previous,
      grammarRuleProgress: { ...previous.grammarRuleProgress, [`${day}:${grammar.id}`]: true },
    }));
  }, [day, grammar, setState]);

  const recordPhraseAttempt = useCallback((phrase, correct, answer = '') => {
    setState((previous) => {
      const wrongBook = { ...previous.phraseWrongBook };
      if (correct) {
        if (wrongBook[phrase.id]) {
          const streak = (wrongBook[phrase.id].streak || 0) + 1;
          wrongBook[phrase.id] = { ...wrongBook[phrase.id], streak, status: streak >= 2 ? '已掌握' : '复习中', lastReviewedAt: new Date().toISOString() };
        }
      } else {
        wrongBook[phrase.id] = {
          phraseId: phrase.id, phrase: phrase.phrase, meaning: phrase.meaning, pattern: phrase.pattern, userAnswer: answer,
          wrongCount: (wrongBook[phrase.id]?.wrongCount || 0) + 1, lastWrongAt: new Date().toISOString(), streak: 0, status: '待复习',
        };
      }
      return { ...previous, phraseAttempts: [...previous.phraseAttempts, { day, phraseId: phrase.id, correct, at: Date.now() }], phraseWrongBook: wrongBook };
    });
  }, [day, setState]);

  const markTranslation = useCallback((item, needsReview = false) => {
    setState((previous) => ({ ...previous, translationDone: { ...previous.translationDone, [`${day}:${item.id}`]: true }, translationReview: { ...previous.translationReview, [`${day}:${item.id}`]: needsReview } }));
  }, [day, setState]);

  const removeWrongItem = useCallback((type, item) => {
    const field = type === 'word' ? 'wordWrongBook' : type === 'phrase' ? 'phraseWrongBook' : 'grammarWrongBook';
    const key = type === 'word' ? `${item.word}:${item.direction}` : type === 'phrase' ? item.phraseId : item.questionId;
    setState((previous) => {
      const wrongBook = { ...previous[field] };
      delete wrongBook[key];
      return { ...previous, [field]: wrongBook };
    });
  }, [setState]);

  const trend = useMemo(() => {
    const priorDays = Array.from({ length: 7 }, (_, index) => Math.max(1, day - 6 + index));
    const dailyStats = priorDays.map((targetDay) => {
      const wordAttempts = state.wordAttempts.filter((item) => item.day === targetDay);
      const grammarAttempts = state.grammarAttempts.filter((item) => item.day === targetDay);
      const word = wordAttempts.length ? Math.round(wordAttempts.filter((item) => item.correct).length / wordAttempts.length * 100) : 0;
      const grammarValue = grammarAttempts.length ? Math.round(grammarAttempts.filter((item) => item.correct).length / grammarAttempts.length * 100) : 0;
      return { word, grammar: grammarValue, complete: targetDay === day ? completion : 0 };
    });
    return { complete: dailyStats.map((item) => item.complete), word: dailyStats.map((item) => item.word), grammar: dailyStats.map((item) => item.grammar) };
  }, [completion, day, state.grammarAttempts, state.wordAttempts]);

  const navItems = [
    { id: 'home', label: '今日学习', icon: Home },
    { id: 'words', label: '单词复习', icon: BookOpen },
    { id: 'phrases', label: '短语搭配', icon: ListChecks },
    { id: 'grammar', label: '语法复习', icon: BrainCircuit },
    { id: 'translation', label: '每日翻译', icon: Languages },
    { id: 'word-errors', label: '单词错题集', icon: XCircle },
    { id: 'phrase-errors', label: '短语错题集', icon: ListChecks },
    { id: 'grammar-errors', label: '语法错题集', icon: AlertTriangle },
    { id: 'report', label: '学习报告', icon: BarChart3 },
  ];

  const openTask = useCallback((target) => {
    const routes = {
      'word-learn': { screen: 'words', mode: 'learn' },
      'word-review': { screen: 'words', mode: 'review' },
      'phrase-learn': { screen: 'phrases', mode: 'learn' },
      'phrase-review': { screen: 'phrases', mode: 'review' },
      grammar: { screen: 'grammar' },
      translation: { screen: 'translation' },
      'word-errors': { screen: 'word-errors' },
      'phrase-errors': { screen: 'phrase-errors' },
      'grammar-errors': { screen: 'grammar-errors' },
    };
    const route = routes[target];
    if (!route) return;
    setErrorPractice(null);
    setStudyIntent({ ...route, id: Date.now() });
    setScreen(route.screen);
    setMobileNavOpen(false);
  }, []);

  const renderScreen = () => {
    if (screen === 'words') return <WordStudy words={words} learned={state.wordProgress} day={day} index={state.wordPositions?.[day] || 0} reviewIndex={state.wordReviewPositions?.[day] || 0} onIndexChange={setWordPosition} onReviewIndexChange={setWordReviewPosition} onLearn={markWordLearned} onAttempt={recordWordAttempt} reviewQueue={wordReviewQueue} intent={studyIntent} errorOnly={errorPractice === 'word'} onExitErrorPractice={() => setErrorPractice(null)} />;
    if (screen === 'phrases') return <PhraseStudy phrases={phrases} progress={state.phraseProgress} day={day} onComplete={markPhrase} onAttempt={recordPhraseAttempt} reviewQueue={phraseReviewQueue} intent={studyIntent} errorOnly={errorPractice === 'phrase'} onExitErrorPractice={() => setErrorPractice(null)} />;
    if (screen === 'grammar') return <GrammarStudy grammar={grammar} day={day} attempts={state.grammarAttempts} onAttempt={recordGrammarAttempt} dynamicQuestions={dailyGrammarQuestions} dynamicStatus={dynamicContent.status} wrongQueue={grammarReviewQueue} ruleLearned={grammarRuleDone} onRuleLearned={markGrammarRuleLearned} errorOnly={errorPractice === 'grammar'} onExitErrorPractice={() => setErrorPractice(null)} />;
    if (screen === 'translation') return <TranslationStudy day={day} done={state.translationDone} review={state.translationReview} onComplete={markTranslation} remoteItems={dynamicContent.content?.translationItems} dynamicStatus={dynamicContent.status} />;
    if (screen === 'word-errors') return <WrongBook type="word" items={Object.values(state.wordWrongBook)} onRemove={(item) => removeWrongItem('word', item)} onNavigate={() => { setErrorPractice('word'); setScreen('words'); }} />;
    if (screen === 'phrase-errors') return <WrongBook type="phrase" items={Object.values(state.phraseWrongBook)} onRemove={(item) => removeWrongItem('phrase', item)} onNavigate={() => { setErrorPractice('phrase'); setScreen('phrases'); }} />;
    if (screen === 'grammar-errors') return <WrongBook type="grammar" items={Object.values(state.grammarWrongBook)} onRemove={(item) => removeWrongItem('grammar', item)} onNavigate={() => { setErrorPractice('grammar'); setScreen('grammar'); }} />;
    if (screen === 'report') return <Report state={state} completion={completion} wordAccuracy={wordAccuracy} grammarAccuracy={grammarAccuracy} serverMode={auth.serverMode} onRestore={setState} onDeleteData={() => { const key = userId === 'guest' ? STORAGE_KEY : `${STORAGE_KEY}:${userId}`; localStorage.removeItem(key); setState({ ...initialState }); if (API_BASE && userId !== 'guest') fetch(`${API_BASE}/api/state`, { method: 'DELETE', credentials: 'include' }).catch(() => {}); }} />;
    return <Dashboard completion={completion} minutes={todayMinutes} wordAccuracy={wordAccuracy} grammarAccuracy={grammarAccuracy} wordWrongCount={wordWrongCount} phraseWrongCount={phraseWrongCount} grammarWrongCount={grammarWrongCount} tasks={tasks} morningDone={morningDone} eveningDone={eveningDone} trend={trend} day={day} onNavigate={openTask} />;
  };

  if (auth.loading) return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><i /><b /></span><span>升本英语</span></div><h1>正在连接账号服务</h1><p className="auth-subtitle">正在检查登录状态，请稍候。</p></section></main>;
  if (!auth.currentUser) return <LoginScreen onLogin={auth.login} onRegister={auth.register} serverMode={auth.serverMode} authError={auth.authError} />;
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? 'is-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><i /><b /></span><span>升本英语</span></div>
      <div className="user-chip"><span className="avatar">{auth.currentUser.username.slice(0, 1).toUpperCase()}</span><div><strong>{auth.currentUser.username}</strong><small>{auth.serverMode ? '服务器账号' : '本地测试账号'}</small></div><button type="button" onClick={auth.logout} title="退出登录">退出</button></div>
      <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={screen === id ? 'nav-item active' : 'nav-item'} onClick={() => { setErrorPractice(null); setScreen(id); setMobileNavOpen(false); }}><Icon size={22} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-footer"><span>{syncStatus === 'synced' ? '服务器已同步' : syncStatus === 'connecting' ? '正在连接服务器' : syncStatus === 'offline' ? '服务器离线 · 本地保存' : '本地优先保存'}</span><LockKeyhole size={14} /></div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="title-row"><IconButton label="打开菜单" onClick={() => setMobileNavOpen((value) => !value)}><Menu size={22} /></IconButton><h1>好困30天专升本英语复习 干！</h1></div>
        <div className="topbar-actions">
          <button className={timerRunning ? 'timer-control active' : 'timer-control'} type="button" onClick={() => setTimerRunning((value) => !value)}>{timerRunning ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}{timerRunning ? '计时中' : '开始计时'}</button>
          <label className="day-select">第 <select value={day} onChange={(event) => setState((previous) => ({ ...previous, day: Number(event.target.value) }))}>{Array.from({ length: 30 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> 天</label>
          <span className="date-label">每日计划 · 上午 4 小时 / 晚间 40 分钟</span>
          <IconButton label="搜索"><Search size={22} /></IconButton>
        </div>
      </header>
      {!isOnline && <div className="offline-banner"><AlertTriangle size={17} />当前处于离线状态，学习记录会先保存在本机，联网后再同步。</div>}
      {speechNotice && <div className="app-toast" role="status"><AlertTriangle size={17} />{speechNotice}</div>}
      <div ref={pageContentRef} className="page-content" onMouseUp={handleTextSelection} onTouchEnd={handleTextSelection}>{renderScreen()}</div>
      {wordExplain && <WordExplainPopover popup={wordExplain} onClose={clearWordExplain} onQuery={queryWordExplanation} onAddToWrongBook={(item) => recordWordAttempt({ term: item.term, meaning: item.meaning }, false, 'en-zh', '来自划词助手')} />}
    </main>
  </div>;
}

function Dashboard({ completion, minutes, wordAccuracy, grammarAccuracy, wordWrongCount, phraseWrongCount, grammarWrongCount, tasks, morningDone, eveningDone, trend, day, onNavigate }) {
  const calendarDays = Array.from({ length: 30 }, (_, index) => index + 1);
  return <>
    <div className="dashboard-heading"><div><h2>第 {day} 天学习概览</h2><p>早间先完成当天全部新知识，晚间按到期内容复习与纠错。</p></div><button className="primary-button" type="button" onClick={() => onNavigate('word-learn')}><Play size={17} fill="currentColor" />开始今日学习</button></div>
    <section className="stats-grid">
      <section className="completion-card"><h3>今日完成率</h3><ProgressRing value={completion} /><span>按 4 小时 + 40 分钟计划计算</span></section>
      <StatCard icon={Clock3} tone="green" label="今日学习时长" value={formatMinutes(minutes)} helper="/ 4小时40分" progress={Math.min(100, minutes / 280 * 100)} />
      <StatCard icon={BookOpen} tone="blue" label="单词正确率" value={wordAccuracy ? `${wordAccuracy}%` : '—'} helper="晚间回忆后更新" progress={wordAccuracy} />
      <StatCard icon={BrainCircuit} tone="purple" label="语法正确率" value={grammarAccuracy ? `${grammarAccuracy}%` : '—'} helper="提交练习后更新" progress={grammarAccuracy} />
      <StatCard icon={XCircle} tone="orange" label="待复习错词" value={wordWrongCount} helper="错词会混入后续练习" />
      <StatCard icon={AlertTriangle} tone="orange" label="待复习语法错题" value={grammarWrongCount} helper="按遗忘优先级抽取" />
    </section>
    <section className="insight-grid">
      <section className="panel trend-panel"><div className="panel-header"><h3>近7天学习情况</h3><div className="legend"><span className="green-dot">完成率</span><span className="blue-dot">单词正确率</span><span className="purple-dot">语法正确率</span></div></div><MiniLineChart values={trend} /><div className="chart-labels"><span>前6天</span><span>前5天</span><span>前4天</span><span>前3天</span><span>前2天</span><span>前1天</span><span>今天</span></div></section>
      <section className="panel calendar-panel"><div className="panel-header"><h3>30天学习日历</h3><CalendarDays size={20} /></div><div className="calendar-week">一 二 三 四 五 六 日</div><div className="calendar-grid">{calendarDays.map((item) => <span key={item} className={item === day ? 'today' : item < day ? 'past' : ''}>{item}</span>)}</div><div className="calendar-key"><i /> 已完成天数会显示为绿色</div></section>
    </section>
    <section className="bottom-grid">
      <TaskPanel tasks={tasks} morningDone={morningDone} eveningDone={eveningDone} onTaskSelect={onNavigate} />
      <WrongPreview title="单词错题集" icon={BookOpen} count={wordWrongCount} color="blue" button="去复习单词错题" onClick={() => onNavigate('word-errors')} empty="完成单词回忆后，错词会自动出现在这里。" reviewRule="答对一次后自动移出错题集" />
      <WrongPreview title="短语错题集" icon={ListChecks} count={phraseWrongCount} color="blue" button="去复习短语错题" onClick={() => onNavigate('phrase-errors')} empty="短语小测出错后，会自动加入这里。" />
      <WrongPreview title="语法错题集" icon={BrainCircuit} count={grammarWrongCount} color="purple" button="去复习语法错题" onClick={() => onNavigate('grammar-errors')} empty="提交语法练习后，错误题目会自动出现在这里。" />
    </section>
  </>;
}

function TaskPanel({ tasks, morningDone, eveningDone, onTaskSelect }) {
  const panelRef = useRef(null);
  const selectTask = (event, target) => {
    if (!target) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onTaskSelect(target); return; }
    let context;
    context = gsap.context(() => {
      gsap.to(event.currentTarget, {
        scale: 0.985, duration: 0.12, ease: 'power2.out', repeat: 1, yoyo: true, clearProps: 'transform',
        onComplete: () => { context.revert(); onTaskSelect(target); },
      });
    }, panelRef);
  };
  const TaskRows = ({ title, time, list, done, tone }) => <div className="task-block"><div className="task-block-header"><div><span className={`daypart-icon ${tone}`}>{tone === 'morning' ? '☀' : '☾'}</span><strong>{title}</strong><small>{time}</small></div><b>{done} / {list.length} 已完成</b></div><div className="task-progress"><span style={{ width: `${list.length ? done / list.length * 100 : 0}%` }} /></div><ul>{list.map((task) => <li key={task.label} className={task.done ? 'done' : ''}>{task.done ? <><CheckCircle2 size={18} /><span>{task.label}<em>{task.detail}</em></span></> : <button className="task-action" type="button" onClick={(event) => selectTask(event, task.target)} aria-label={`继续：${task.label}`}><span className="task-circle" /><span>{task.label}<em>{task.detail}</em></span><ChevronRight size={16} /></button>}</li>)}</ul></div>;
  return <section ref={panelRef} className="panel task-panel"><div className="panel-header"><h3>今日学习任务</h3><span className="muted">点击未完成任务即可继续</span></div><TaskRows title="上午：学习本日全部知识" time="08:00 - 12:00" list={tasks.morning} done={morningDone} tone="morning" /><TaskRows title="晚上：复习与巩固" time="建议 30 - 40 分钟" list={tasks.evening} done={eveningDone} tone="night" /></section>;
}

function WrongPreview({ title, icon: Icon, count, color, button, onClick, empty, reviewRule = '正确两次后标记为已纠正' }) {
  return <section className={`panel wrong-preview ${color}`}><div className="panel-header"><div className="title-with-icon"><Icon size={25} /><h3>{title}</h3></div><span className="wrong-count">{count}</span></div>{count ? <div className="mini-error-list"><span>按错误次数与到期时间排序</span><span>{reviewRule}</span></div> : <p className="empty-copy">{empty}</p>}<button type="button" className={`wide-button ${color}`} onClick={onClick}>{button}</button></section>;
}

function WordStudy({ words, learned, day, index, reviewIndex, onIndexChange, onReviewIndexChange, onLearn, onAttempt, reviewQueue, intent, errorOnly, onExitErrorPractice }) {
  const [mode, setMode] = useState('learn');
  const [direction, setDirection] = useState('en-zh');
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [errorIndex, setErrorIndex] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);
  const autoAdvanceTimer = useRef(null);
  const errorWords = reviewQueue.map((item) => ({ term: item.word, meaning: item.meaning, wrong: item }));
  const [errorSnapshot, setErrorSnapshot] = useState(() => snapshotReviewItems(errorWords));
  const [reviewSnapshot, setReviewSnapshot] = useState(() => [...errorWords, ...words]);
  const isReview = errorOnly || mode === 'review';
  const activeWords = errorOnly ? errorSnapshot : isReview ? reviewSnapshot : words;
  const rawIndex = errorOnly ? errorIndex : isReview ? reviewIndex : index;
  const currentIndex = Math.min(rawIndex, Math.max(activeWords.length - 1, 0));
  const clearAutoAdvance = () => window.clearTimeout(autoAdvanceTimer.current);

  useEffect(() => {
    clearAutoAdvance(); setAnswer(''); setRevealed(false); setErrorIndex(0); setSessionComplete(false);
    setErrorSnapshot(snapshotReviewItems(errorWords));
    setReviewSnapshot([...errorWords, ...words]);
  }, [day, errorOnly]);
  useEffect(() => { clearAutoAdvance(); setAnswer(''); setRevealed(false); setSessionComplete(false); }, [mode, direction]);
  useEffect(() => {
    if (errorOnly || intent?.screen !== 'words') return;
    clearAutoAdvance();
    if (intent.mode === 'review') { setReviewSnapshot([...errorWords, ...words]); setMode('review'); }
    if (intent.mode === 'learn') setMode('learn');
  }, [intent?.id, errorOnly]);
  useEffect(() => () => window.clearTimeout(autoAdvanceTimer.current), []);
  useEffect(() => {
    const lastIndex = Math.max(activeWords.length - 1, 0);
    if (rawIndex <= lastIndex) return;
    if (errorOnly) setErrorIndex(lastIndex);
    else if (isReview) onReviewIndexChange(lastIndex);
    else onIndexChange(lastIndex);
  }, [activeWords.length, errorOnly, index, isReview, rawIndex, reviewIndex]);

  const word = activeWords[currentIndex];
  if (!word) return <EmptyState icon={BookOpen} title={errorOnly ? '暂时没有待复习错词' : '今天是复习日'} description={errorOnly ? '本轮错词已完成；请返回日常练习。' : '本计划不增加新词。请进入错题集，或切换到有新词的日期。'} />;
  const completed = words.filter((item) => learned[`${day}:${item.term}`]).length;
  const effectiveDirection = errorOnly && word.wrong?.direction ? word.wrong.direction : direction;
  const isHearing = effectiveDirection === 'hearing';
  const prompt = effectiveDirection === 'zh-en' ? word.meaning : isHearing ? '请听发音后拼写英文单词' : '请写出中文释义';
  const reference = effectiveDirection === 'zh-en' || isHearing ? word.term : word.meaning;
  const answerMatches = effectiveDirection === 'en-zh' ? matchesChineseMeaning(answer, reference) : normalize(answer) === normalize(reference);
  const setPosition = (value) => {
    const next = Math.max(0, Math.min(Number(value), activeWords.length - 1));
    if (errorOnly) setErrorIndex(next);
    else if (isReview) onReviewIndexChange(next);
    else onIndexChange(next);
  };
  const goNext = () => {
    clearAutoAdvance(); setAnswer(''); setRevealed(false);
    if (currentIndex >= activeWords.length - 1) { setSessionComplete(true); return; }
    setPosition(currentIndex + 1);
  };
  const goPrevious = () => { clearAutoAdvance(); setAnswer(''); setRevealed(false); setPosition(currentIndex - 1); };
  const submitReview = () => {
    if (!answer.trim() || revealed) return;
    onAttempt(word, answerMatches, effectiveDirection, answer);
    setRevealed(true);
    clearAutoAdvance();
    autoAdvanceTimer.current = window.setTimeout(goNext, 1400);
  };
  const switchMode = (nextMode) => {
    clearAutoAdvance();
    if (nextMode === 'review') setReviewSnapshot([...errorWords, ...words]);
    setMode(nextMode);
  };
  return <section className="study-page"><PageTitle icon={BookOpen} title="单词学习与复习" description={`第 ${day} 天 · ${words.length} 个新词；早间与晚间页码独立保存。`} />
    <div className="study-tabs"><button className={mode === 'learn' ? 'active' : ''} onClick={() => switchMode('learn')} disabled={errorOnly}>早间学习</button><button className={isReview ? 'active' : ''} onClick={() => switchMode('review')}>晚间复习</button><span>{errorOnly ? `错词专练 ${activeWords.length} 项` : `已学习 ${completed}/${words.length}`}</span></div>
    {errorOnly && <div className="practice-banner"><TimerReset size={18} />正在进行错词专练：单词答对一次就会移出错题集。<button type="button" onClick={onExitErrorPractice}>返回日常练习</button></div>}
    <div className="study-layout"><section className="learning-card word-card"><div className="card-topline"><span>{mode === 'learn' && !errorOnly ? '学习新词' : word.wrong ? '错词优先' : '主动回忆'}</span><b>{currentIndex + 1} / {activeWords.length}</b></div>{mode === 'learn' && !errorOnly ? <><div className="word-term">{word.term}</div><button className="audio-button" type="button" onClick={() => playSpeech(word.term)}><Volume2 size={18} />播放标准发音</button><div className="word-meaning">{word.meaning}</div><p>先听发音，再读 2—3 遍；掌握常见中文意思即可。</p><button className="primary-button" type="button" onClick={() => { onLearn(word); goNext(); }}><Check size={17} />我已学习，下一词</button></> : <><div className="review-prompt">{prompt}</div>{effectiveDirection === 'en-zh' && <div className="word-term">{word.term}</div>}{effectiveDirection === 'zh-en' && <div className="word-meaning question">{word.meaning}</div>}{isHearing && <button className="hearing-button" type="button" onClick={() => playSpeech(word.term)}><Headphones size={38} /><span>点击播放单词发音</span></button>}{!isHearing && <button className="audio-button" type="button" onClick={() => playSpeech(word.term)}><Volume2 size={18} />播放发音</button>}<input value={answer} disabled={revealed} onChange={(event) => setAnswer(event.target.value)} placeholder={effectiveDirection === 'en-zh' ? '输入中文释义' : '输入英文拼写'} onKeyDown={(event) => event.key === 'Enter' && submitReview()} />{!revealed ? <button className="primary-button" disabled={!answer.trim()} type="button" onClick={submitReview}>提交答案</button> : <div className={`answer-box ${answerMatches ? '' : 'needs-review'}`}><span>参考答案</span><strong>{reference}</strong><p>{answerMatches ? '回答正确，已记录。' : '已加入错题集，稍后会再次出现。'}</p><small>答案已锁定，正在进入下一词…</small></div>}</>}<div className="word-pagination"><button type="button" disabled={revealed || currentIndex <= 0} onClick={goPrevious}><ChevronLeft size={18} />上一词</button><label>跳转到 <select value={currentIndex} disabled={revealed} onChange={(event) => { setAnswer(''); setRevealed(false); setPosition(event.target.value); }}>{Array.from({ length: activeWords.length }, (_, itemIndex) => <option key={itemIndex} value={itemIndex}>第 {itemIndex + 1} 词</option>)}</select> / {activeWords.length}</label><button type="button" disabled={revealed || currentIndex >= activeWords.length - 1} onClick={goNext}>下一词<ChevronRight size={18} /></button></div></section>
      {sessionComplete && <ModuleCompleteNotice title={mode === 'learn' && !errorOnly ? '已完成当前单词学习' : '已完成当前单词练习'} detail={mode === 'learn' && !errorOnly ? `本轮已学 ${completed}/${words.length} 个新词，学习数据已保存到账号。` : '本轮题目已经练完；不会自动跳回第一词。'} onRestart={() => { setSessionComplete(false); setPosition(0); }} />}
      <details className="study-side"><summary>复习设置</summary><div className="study-side-body"><h3>复习方向</h3>{[['en-zh', '英文 → 中文'], ['zh-en', '中文 → 英文'], ['hearing', '听音拼写']].map(([id, label]) => <button key={id} type="button" disabled={errorOnly} className={effectiveDirection === id ? 'direction active' : 'direction'} onClick={() => setDirection(id)}>{label}</button>)}<div className="side-note"><Sparkles size={18} />晚间页码独立于早间学习；本轮错词会在下一轮优先出现。</div></div></details></div></section>;
}

function PhraseStudy({ phrases, progress, day, onComplete, onAttempt, reviewQueue, intent, errorOnly, onExitErrorPractice }) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState('learn');
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const autoAdvanceTimer = useRef(null);
  const errorPhrases = reviewQueue.map((item) => ({ id: item.phraseId, phrase: item.phrase, meaning: item.meaning, pattern: item.pattern, wrong: item }));
  const [errorSnapshot, setErrorSnapshot] = useState(() => snapshotReviewItems(errorPhrases));
  // 像单词一样：每次晚间小测开始时先固定本轮题单，把当日错题放到前面。
  // 这样提交后写入的新错题不会让当前题号跳动，下一轮才会优先出现。
  const [reviewSnapshot, setReviewSnapshot] = useState(() => [...errorPhrases, ...phrases]);
  const isReview = errorOnly || mode === 'review';
  const activePhrases = errorOnly ? errorSnapshot : isReview ? reviewSnapshot : phrases;
  const phrase = activePhrases[Math.min(index, Math.max(activePhrases.length - 1, 0))];
  useEffect(() => {
    setIndex(0); setAnswer(''); setRevealed(false); setSessionComplete(false);
    if (errorOnly) setErrorSnapshot(snapshotReviewItems(errorPhrases));
    if (mode !== 'review') setReviewSnapshot([...errorPhrases, ...phrases]);
  }, [day, mode, errorOnly]);
  useEffect(() => {
    if (errorOnly || intent?.screen !== 'phrases') return;
    if (intent.mode === 'review') { setReviewSnapshot([...errorPhrases, ...phrases]); setMode('review'); }
    if (intent.mode === 'learn') setMode('learn');
  }, [intent?.id, errorOnly]);
  useEffect(() => () => window.clearTimeout(autoAdvanceTimer.current), []);
  if (!phrase) return <EmptyState icon={ListChecks} title={errorOnly ? '暂时没有待复习短语' : '今天没有新增短语'} description={errorOnly ? '本轮短语错题已完成；请返回日常练习。' : '请切换到有短语内容的学习日。'} />;
  const completed = phrases.filter((item) => progress[`${day}:${item.id}`]).length;
  const isCorrect = matchesEnglishPhrase(answer, phrase.phrase);
  const next = () => {
    window.clearTimeout(autoAdvanceTimer.current); setAnswer(''); setRevealed(false);
    if (index >= activePhrases.length - 1) { setSessionComplete(true); return; }
    setIndex((value) => value + 1);
  };
  const submitReview = () => {
    if (!answer.trim() || revealed) return;
    onAttempt(phrase, isCorrect, answer);
    setRevealed(true);
    window.clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = window.setTimeout(next, 1400);
  };
  const startReview = () => {
    window.clearTimeout(autoAdvanceTimer.current);
    setReviewSnapshot([...errorPhrases, ...phrases]);
    setMode('review');
  };
  return <section className="study-page">
    <PageTitle icon={ListChecks} title={errorOnly ? '短语错题专练' : '短语搭配'} description={errorOnly ? '连续答对两次后，短语会退出重点练习。' : '早间学习搭配，晚间用中文提示主动写出英文。'} />
    <div className="study-tabs"><button className={mode === 'learn' ? 'active' : ''} onClick={() => setMode('learn')} disabled={errorOnly}>早间学习</button><button className={isReview ? 'active' : ''} onClick={startReview}>晚间小测</button><span>{errorOnly ? `错题 ${activePhrases.length} 组` : isReview ? `本轮 ${activePhrases.length} 组（含错题优先）` : `已学习 ${completed}/${phrases.length}`}</span></div>
    {errorOnly && <div className="practice-banner"><TimerReset size={18} />正在进行短语错题专练。<button type="button" onClick={onExitErrorPractice}>返回日常练习</button></div>}
    <div className="study-layout"><section className="learning-card phrase-card"><div className="card-topline"><span>{phrase.wrong ? '错题优先' : '短语搭配'}</span><b>{index + 1} / {activePhrases.length}</b></div>{!isReview ? <><div className="phrase-term">{phrase.phrase}</div><button className="audio-button" type="button" onClick={() => playSpeech(phrase.phrase)}><Volume2 size={18} />播放短语发音</button><div className="phrase-meaning">{phrase.meaning}</div><div className="pattern-box"><span>结构提示</span><strong>{phrase.pattern}</strong></div><button className="primary-button" type="button" onClick={() => { onComplete(phrase); next(); }}><Check size={17} />已掌握，下一组</button></> : <><div className="review-prompt">请根据中文提示写出英文短语</div><div className="phrase-meaning">{phrase.meaning}</div><input value={answer} disabled={revealed} onChange={(event) => setAnswer(event.target.value)} placeholder="输入英文短语" onKeyDown={(event) => event.key === 'Enter' && submitReview()} />{revealed ? <div className={`answer-box ${isCorrect ? '' : 'needs-review'}`}><span>参考答案</span><strong>{phrase.phrase}</strong><p>{isCorrect ? '回答正确，已记录。' : '已加入短语错题集。'}</p><small>答案已锁定，正在进入下一组…</small></div> : <button className="primary-button" disabled={!answer.trim()} type="button" onClick={submitReview}>提交答案</button>}</>}</section><details className="study-side"><summary>学习进度</summary><div className="study-side-body"><h3>短语进度</h3><div className="big-side-number">{completed}<small> / {phrases.length}</small></div><p>小测错误会立即进入短语错题集。</p></div></details></div>
    {sessionComplete && <ModuleCompleteNotice title={!isReview ? '已完成当前短语学习' : '已完成当前短语小测'} detail={!isReview ? `本轮已学 ${completed}/${phrases.length} 组搭配，数据已保存。` : '本轮小测已结束；不会自动跳回第一组。'} onRestart={() => { setSessionComplete(false); setIndex(0); }} />}
  </section>;
}

function GrammarStudy({ grammar, day, attempts, onAttempt, dynamicQuestions, dynamicStatus, wrongQueue, ruleLearned, onRuleLearned, errorOnly, onExitErrorPractice }) {
  const [selected, setSelected] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const autoAdvanceTimer = useRef(null);
  const [wrongSnapshot, setWrongSnapshot] = useState(() => snapshotReviewItems(wrongQueue.filter(Boolean).map((item) => ({ ...item, id: item.questionId }))));
  const questions = useMemo(() => {
    const wrong = wrongQueue.filter(Boolean).map((item) => ({ ...item, id: item.questionId }));
    if (errorOnly) return wrongSnapshot;
    return uniqueById([...wrong, ...(dynamicQuestions || [])]);
  }, [dynamicQuestions, errorOnly, wrongQueue, wrongSnapshot]);
  useEffect(() => {
    setSelected(''); setRevealed(false); setQuestionIndex(0);
    if (errorOnly) setWrongSnapshot(snapshotReviewItems(wrongQueue.filter(Boolean).map((item) => ({ ...item, id: item.questionId }))));
  }, [day, grammar?.id, errorOnly]);
  useEffect(() => () => window.clearTimeout(autoAdvanceTimer.current), []);
  if (!grammar && !errorOnly) return <EmptyState icon={BrainCircuit} title="今天以复习和试卷训练为主" description="切换到错题集进行薄弱专题练习，或在上方选择一个含语法新知识的日期。" />;
  const answeredIds = new Set(attempts.filter((item) => item.day === day).map((item) => item.questionId));
  const pendingQuestions = errorOnly ? questions : questions.filter((item) => !answeredIds.has(item.id));
  const activeQuestionIndex = Math.min(questionIndex, Math.max(pendingQuestions.length - 1, 0));
  const question = pendingQuestions[activeQuestionIndex];
  const completedCount = questions.length - pendingQuestions.length;
  const changeQuestion = (nextIndex) => {
    window.clearTimeout(autoAdvanceTimer.current);
    const lastIndex = Math.max(pendingQuestions.length - 1, 0);
    setQuestionIndex(Math.max(0, Math.min(nextIndex, lastIndex)));
    setSelected('');
    setRevealed(false);
  };
  const finishQuestion = () => {
    const correct = isTypedGrammarQuestion(question) ? normalize(selected) === normalize(question.answer) : selected === question.answer;
    onAttempt(question, correct, selected);
    setSelected('');
    setRevealed(false);
    if (errorOnly) {
      setQuestionIndex((value) => Math.min(value + 1, Math.max(pendingQuestions.length - 1, 0)));
      return;
    }
    // 当前题提交后会从待完成列表移除：保留当前位置，正好显示下一道未做题，不会跳回第一题。
    setQuestionIndex((value) => Math.min(value, Math.max(pendingQuestions.length - 2, 0)));
  };
  const submitQuestion = () => {
    if (!selected || revealed) return;
    setRevealed(true);
    window.clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = window.setTimeout(finishQuestion, 1400);
  };
  const restart = () => { setSelected(''); setRevealed(false); setQuestionIndex(0); };
  return <section className="study-page">
    <PageTitle icon={BrainCircuit} title={errorOnly ? '语法错题专练' : '语法学习与动态巩固'} description={errorOnly ? '连续答对两次后，错题会退出重点练习。' : `固定学习内容：${grammar.title}；错误题会优先混入每日练习。`} />
    {errorOnly ? <div className="practice-banner"><TimerReset size={18} />正在进行语法错题专练。<button type="button" onClick={onExitErrorPractice}>返回日常练习</button></div> : <div className="grammar-rule-card"><div><span>今日固定知识点</span><h2>{grammar.title}</h2><p>{grammar.coreRule}</p><button type="button" className={ruleLearned ? 'rule-complete-button complete' : 'rule-complete-button'} onClick={onRuleLearned}>{ruleLearned ? <><CheckCircle2 size={17} />已完成规则学习</> : <><Check size={17} />我已完成规则与例句学习</>}</button></div><div className="structure-card"><span>核心结构</span><strong>{grammar.structure}</strong><small>{grammar.memoryTip || '先找标志词，再判断结构。'}</small></div></div>}
    {!errorOnly && <div className="practice-banner"><RefreshCw size={18} />{dynamicStatus === 'remote' ? '今日动态巩固已从服务器读取；每天 08:00 会自动刷新。' : dynamicStatus === 'loading' ? '正在读取今天的动态巩固内容…' : '当前使用本地备用题；服务器内容将在每天 08:00 更新。'}</div>}
    {!question ? <ModuleCompleteNotice title={errorOnly ? '已完成当前语法错题练习' : '已完成当前动态语法巩固'} detail={errorOnly ? '本轮错题已经练完；不会自动回到第一题。' : `已完成 ${completedCount}/${questions.length} 道题，结果已更新到学习任务总览。`} onRestart={errorOnly ? restart : undefined} restartLabel="再练一轮" /> : <GrammarQuestionCard question={question} selected={selected} revealed={revealed} questionNumber={activeQuestionIndex + 1} questionTotal={pendingQuestions.length} completedCount={completedCount} allQuestionCount={questions.length} onSelect={setSelected} onReveal={submitQuestion} onPrevious={() => changeQuestion(activeQuestionIndex - 1)} onNext={() => changeQuestion(activeQuestionIndex + 1)} onJump={changeQuestion} />}
  </section>;
}

function GrammarQuestionCard({ question, selected, revealed, questionNumber, questionTotal, completedCount, allQuestionCount, onSelect, onReveal, onPrevious, onNext, onJump }) {
  if (!question) return <section className="panel practice-panel"><h3>今日动态巩固</h3><p className="empty-copy">暂无可用题目。完成日常语法练习后，错题会自动进入这里。</p></section>;
  const typedAnswer = isTypedGrammarQuestion(question);
  const options = choiceOptions(question);
  const isCorrect = typedAnswer ? normalize(selected) === normalize(question.answer) : selected === question.answer;
  const result = <div className={`grammar-result ${isCorrect ? 'correct' : 'incorrect'}`}><strong>{isCorrect ? '回答正确，已记录' : '已加入语法错题集'}</strong>{typedAnswer && <p>你的答案：{selected || '未填写'}</p>}<p>正确答案：{question.answer}</p><p>{question.explanation}</p><small>答案已锁定，正在进入下一题…</small></div>;
  const submit = <button className="primary-button" disabled={!selected} type="button" onClick={onReveal}>提交答案</button>;
  return <section className="panel practice-panel"><div className="panel-header"><h3>今日动态巩固</h3><span className="muted">待完成第 {questionNumber} / {questionTotal} 题 · 已完成 {completedCount}/{allQuestionCount}</span></div><p className="task-instruction">{grammarInstruction(question)}</p><div className="grammar-stem"><span>题干</span><p className="question-text">{question.question}</p></div>{typedAnswer ? <div className="grammar-answer-field"><label htmlFor={`grammar-answer-${question.id}`}>填写你的答案</label><input id={`grammar-answer-${question.id}`} value={selected} disabled={revealed} autoComplete="off" onChange={(event) => onSelect(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && selected.trim() && onReveal()} placeholder="请输入英文答案" /></div> : <div className="option-list">{options.map((option, optionIndex) => <button key={`${option}-${optionIndex}`} type="button" className={selected === option ? 'selected' : ''} disabled={revealed} onClick={() => onSelect(option)}>{option}</button>)}</div>}{revealed ? result : submit}<div className="grammar-pagination"><button type="button" disabled={revealed || questionNumber <= 1} onClick={onPrevious}><ChevronLeft size={18} />上一题</button><label>跳转到 <select aria-label="跳转到语法题目" value={questionNumber - 1} disabled={revealed} onChange={(event) => onJump(Number(event.target.value))}>{Array.from({ length: questionTotal }, (_, index) => <option key={index} value={index}>第 {index + 1} 题</option>)}</select> / {questionTotal}</label><button type="button" disabled={revealed || questionNumber >= questionTotal} onClick={onNext}>下一题<ChevronRight size={18} /></button></div></section>;
}

function TranslationStudy({ day, done, review, onComplete, remoteItems, dynamicStatus }) {
  const [index, setIndex] = useState(0);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  useEffect(() => { setIndex(0); setReferenceOpen(false); setReviewOnly(false); setSessionComplete(false); }, [day]);
  const items = remoteItems?.length ? remoteItems : translationFallback;
  const reviewItems = items.filter((entry) => review?.[`${day}:${entry.id}`]);
  const activeItems = reviewOnly ? reviewItems : items;
  const item = activeItems[Math.min(index, Math.max(activeItems.length - 1, 0))];
  const pendingReview = Object.values(review || {}).filter(Boolean).length;
  const dailyComplete = items.length > 0 && items.every((entry) => done[`${day}:${entry.id}`]);
  const completeCurrent = (needsReview) => {
    const completingDailyRound = !reviewOnly && items.every((entry) => entry.id === item.id || done[`${day}:${entry.id}`]);
    const finishingCurrentRound = index >= activeItems.length - 1;
    onComplete(item, needsReview);
    setReferenceOpen(false);
    if (completingDailyRound || finishingCurrentRound) { setSessionComplete(true); return; }
    setIndex((value) => value + 1);
  };
  if (!item) return <section className="study-page"><PageTitle icon={Languages} title="每日翻译" description="当前没有标记为待复习的句子。" /><div className="empty-state"><CheckCircle2 size={42} /><h2>待复习列表为空</h2><p>在每日翻译中点击“加入待复习”，句子就会出现在这里。</p><button className="primary-button" type="button" onClick={() => setReviewOnly(false)}>返回今日翻译</button></div></section>;
  const finishLabel = index >= activeItems.length - 1 ? '完成本轮翻译' : '理解了，下一句';
  return <section className="study-page">
    <PageTitle icon={Languages} title="每日翻译" description="先口头翻译，再查看一条基础参考译文；不自动判对错。" />
    <div className="study-tabs"><button className={!reviewOnly ? 'active' : ''} onClick={() => { setReviewOnly(false); setIndex(0); setSessionComplete(false); }}>今日内容</button><button className={reviewOnly ? 'active' : ''} disabled={!reviewItems.length} onClick={() => { setReviewOnly(true); setIndex(0); setSessionComplete(false); }}>待复习句（{reviewItems.length}）</button></div>
    {!reviewOnly && <div className="practice-banner"><RefreshCw size={18} />{dynamicStatus === 'remote' ? '今日翻译内容已从服务器读取；每天 08:00 自动刷新。' : dynamicStatus === 'loading' ? '正在读取今天的翻译内容…' : '当前使用本地备用内容；服务器内容将在每天 08:00 更新。'}</div>}
    <div className="translation-layout"><section className="learning-card translation-card"><div className="card-topline"><span>{item.category}</span><b>{index + 1} / {activeItems.length}</b></div><p className="translation-en">{item.english}</p><button className="audio-button" type="button" onClick={() => playSpeech(item.english)}><Volume2 size={18} />播放整句发音</button><p className="speak-prompt">请先自行口头翻译，再点击下方按钮。</p>{!referenceOpen ? <button className="primary-button" type="button" onClick={() => setReferenceOpen(true)}>我已口译，查看参考</button> : <div className="answer-box"><span>参考译文</span><strong>{item.chinese || item.referenceChinese}</strong><p>语法提示：{item.grammar || item.grammarPoint}</p><div><button className="success-button" type="button" onClick={() => completeCurrent(false)}>{finishLabel}</button><button className="wrong-button" type="button" onClick={() => completeCurrent(true)}>{index >= activeItems.length - 1 ? '完成并加入待复习' : '加入待复习'}</button></div></div>}</section><details className="study-side"><summary>翻译进度</summary><div className="study-side-body"><h3>{reviewOnly ? '待复习翻译' : '今日翻译'}</h3><div className="big-side-number">{items.filter((entry) => done[`${day}:${entry.id}`]).length}<small> / {items.length}</small></div><p>待复习 {pendingReview} 句；可通过上方入口再次练习。</p><div className="side-note"><RefreshCw size={18} />{dynamicStatus === 'remote' ? '已读取今日千问翻译内容。' : '当前使用本地备用内容。'}</div></div></details></div>
    {(sessionComplete || (!reviewOnly && dailyComplete)) && <ModuleCompleteNotice title={reviewOnly ? '已完成当前翻译复习' : '已完成今日翻译理解'} detail={reviewOnly ? '本轮待复习句已练完；不会自动跳回第一句。' : `已完成 ${items.length}/${items.length} 句，任务总览会同步更新。`} onRestart={() => { setSessionComplete(false); setIndex(0); setReferenceOpen(false); }} />}
  </section>;
}

function WrongBook({ type, items, onNavigate, onRemove }) {
  const isWord = type === 'word';
  const isPhrase = type === 'phrase';
  const Icon = isWord ? BookOpen : isPhrase ? ListChecks : BrainCircuit;
  const title = isWord ? '单词错题集' : isPhrase ? '短语错题集' : '语法错题集';
  const startLabel = isWord ? '开始单词再练' : isPhrase ? '开始短语再练' : '开始语法再练';
  const activeItems = items.filter((item) => item.status !== '已掌握').sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0));
  const description = isWord ? '按错误次数与最近错误时间加权；单词答对一次会移出错题集。' : '按错误次数与最近错误时间加权；连续答对两次后退出重点练习。';
  return <section className="study-page"><PageTitle icon={Icon} title={title} description={description} /><section className="panel wrong-book"><div className="panel-header"><h3>待复习内容</h3><span className="wrong-count">{activeItems.length}</span></div>{activeItems.length ? <div className="wrong-table">{activeItems.map((item) => <article key={isWord ? `${item.word}-${item.direction}` : isPhrase ? item.phraseId : item.questionId}><div><b>{isWord ? item.word : isPhrase ? item.phrase : item.topic}</b><p>{isWord ? `${item.meaning} · ${item.direction === 'hearing' ? '听音拼写' : item.direction === 'zh-en' ? '中译英' : '英译中'}` : isPhrase ? `${item.meaning} · ${item.pattern || '短语搭配'}` : item.question}</p></div><div><span>{isWord ? `错误 ${item.wrongCount} 次 · 答对后移出` : `错误 ${item.wrongCount} 次 · 连对 ${item.streak || 0} 次`}</span><em>{item.status}</em><button className="danger-button" type="button" onClick={() => window.confirm('确定从错题集移除这道题吗？') && onRemove(item)}>移出错题集</button></div></article>)}</div> : <div className="empty-state-inline"><CheckCircle2 size={34} /><p>目前没有待复习的错题。完成练习时，错误内容会自动加入。</p></div>}<button className="primary-button" disabled={!activeItems.length} type="button" onClick={onNavigate}>{startLabel}</button></section></section>;
}

function Report({ state, completion, wordAccuracy, grammarAccuracy, serverMode = false, onRestore, onDeleteData }) {
  const totalMinutes = Object.values(state.minutesByDay || {}).reduce((sum, value) => sum + value, 0);
  const fileInput = useRef(null);
  const phraseAttempts = state.phraseAttempts || [];
  const phraseAccuracy = phraseAttempts.length ? Math.round(phraseAttempts.filter((item) => item.correct).length / phraseAttempts.length * 100) : 0;
  const translationPending = Object.values(state.translationReview || {}).filter(Boolean).length;
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ app: 'shengben-review', exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `升本英语学习备份-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const importData = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        if (!payload?.state || typeof payload.state !== 'object') throw new Error('invalid');
        onRestore({ ...initialState, ...payload.state });
        window.alert('学习数据已恢复。');
      } catch { window.alert('这不是有效的学习备份文件。'); }
    };
    reader.readAsText(file); event.target.value = '';
  };
  const clearData = () => { if (window.confirm('确定清除当前账号的全部学习记录吗？此操作不可撤销，请先导出备份。')) onDeleteData(); };
  return <section className="study-page"><PageTitle icon={BarChart3} title="学习报告" description={serverMode ? '进度按账号同步到服务器；建议每周导出一份个人备份。' : '所有进度保存在本机浏览器；建议每周导出一次备份。'} /><section className="report-grid"><StatCard icon={Clock3} tone="green" label="累计学习时长" value={formatMinutes(totalMinutes)} /><StatCard icon={CheckCircle2} tone="green" label="今日完成率" value={`${completion}%`} /><StatCard icon={BookOpen} tone="blue" label="单词正确率" value={wordAccuracy ? `${wordAccuracy}%` : '—'} /><StatCard icon={BrainCircuit} tone="purple" label="语法正确率" value={grammarAccuracy ? `${grammarAccuracy}%` : '—'} /></section><section className="report-grid compact-report"><StatCard icon={ListChecks} tone="blue" label="短语小测正确率" value={phraseAccuracy ? `${phraseAccuracy}%` : '—'} helper={`${phraseAttempts.length} 次作答`} /><StatCard icon={Languages} tone="orange" label="翻译待复习" value={`${translationPending} 句`} helper="标记后可在后续回顾" /></section><section className="panel report-note"><h3>备份与恢复</h3><p>导出文件可保存到电脑或网盘；更换浏览器、清理缓存前，先导出一份即可恢复目前的学习记录。</p><div className="backup-actions"><button className="primary-button" type="button" onClick={exportData}><Download size={17} />导出学习数据</button><button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}><Upload size={17} />导入备份恢复</button><button className="danger-button" type="button" onClick={clearData}>清除本账号数据</button><input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={importData} /></div><details className="privacy-details"><summary><LockKeyhole size={16} />隐私与数据说明</summary><p>{serverMode ? '当前账号的学习进度保存在服务器数据库，浏览器只保留必要的本地缓存和导出文件。清除数据会同时请求删除服务器端进度。' : '本地测试模式下，账号、学习进度和错题只保存在当前浏览器的本地存储中，不会自动上传。你可以使用上方导出按钮备份，也可以使用“清除本账号数据”删除当前账号的学习记录。'}</p><p>正式环境仍应公开隐私政策、数据保存期限、账号注销和数据删除方式。</p></details></section></section>;
}

function WordExplainPopover({ popup, onClose, onQuery, onAddToWrongBook }) {
  const data = popup.data;
  return <aside className="word-explain-popover" data-no-word-explain style={{ left: popup.left, top: popup.top }} role="dialog" aria-label="千问划词释义">
    <div className="word-explain-header"><strong>{popup.text}</strong><button type="button" onClick={onClose} aria-label="关闭划词释义"><XCircle size={18} /></button></div>
    {popup.status === 'done' ? <div className="word-explain-result"><div><span>中文释义</span><b>{data.meaning}</b></div>{data.pronunciation && <p>音标：{data.pronunciation}</p>}{data.partOfSpeech && <p>词性：{data.partOfSpeech}</p>}{data.usage && <p>用法：{data.usage}</p>}{data.collocation && <p>搭配：{data.collocation}</p>}{data.example && <p>例句：{data.example}</p>}<div className="word-explain-actions"><button type="button" className="audio-button" onClick={() => playSpeech(data.term)}><Volume2 size={16} />播放读音</button><button type="button" className="secondary-button" onClick={() => { onAddToWrongBook(data); onClose(); }}>加入单词错题集</button></div></div> : <div className="word-explain-query"><p>{popup.status === 'loading' ? '正在询问千问…' : popup.status === 'error' ? popup.error : '选中后可查看释义、音标和常见用法。'}</p><button className="primary-button" type="button" disabled={popup.status === 'loading'} onClick={onQuery}><Sparkles size={16} />{popup.status === 'error' ? '重新查询' : '问千问'}</button></div>}
  </aside>;
}

function PageTitle({ icon: Icon, title, description }) { return <header className="page-title"><div className="page-icon"><Icon size={26} /></div><div><h2>{title}</h2><p>{description}</p></div></header>; }
function EmptyState({ icon: Icon, title, description }) { return <section className="empty-state"><Icon size={42} /><h2>{title}</h2><p>{description}</p></section>; }

function LoginScreen({ onLogin, onRegister, serverMode = false, authError = '' }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('demo');
  const [password, setPassword] = useState(serverMode ? '' : '123456');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = (event) => {
    event.preventDefault();
    setSubmitting(true); setMessage('');
    Promise.resolve(mode === 'login' ? onLogin(username, password) : onRegister(username, password))
      .then((result) => { if (!result?.ok) setMessage(result?.message || '操作失败，请稍后重试。'); })
      .catch(() => setMessage('网络暂不可用，请检查服务器或稍后重试。'))
      .finally(() => setSubmitting(false));
  };
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><i /><b /></span><span>升本英语</span></div><h1>{mode === 'login' ? '欢迎回来' : '创建账号'}</h1><p className="auth-subtitle">30 天专升本英语复习 · {serverMode ? '服务器安全账号' : '本地测试模式'}</p><form onSubmit={submit}><label>账号<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="2-32 位中英文、数字或下划线" /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={serverMode ? '至少 8 位' : '至少 6 位'} /></label>{(message || authError) && <p className="auth-message">{message || authError}</p>}<button className="primary-button auth-submit" type="submit" disabled={submitting}>{submitting ? '处理中…' : mode === 'login' ? '登录并继续学习' : '注册并开始学习'}</button></form>{!serverMode && mode === 'login' && <p className="demo-hint">测试账号：demo　密码：123456</p>}{serverMode && mode === 'login' && <p className="demo-hint">提示：服务器账号启用前，仅保存在旧浏览器内的本地账号无法登录；请注册新的服务器账号（密码至少 8 位）。</p>}<button className="auth-switch" type="button" onClick={() => { setMode((value) => value === 'login' ? 'register' : 'login'); setMessage(''); }}>{mode === 'login' ? '还没有账号？立即注册' : '已有账号？返回登录'}</button><small className="local-only-note"><LockKeyhole size={13} />{serverMode ? '密码经过加密后保存在服务器，学习数据按账号隔离' : '当前仅保存在本浏览器，未上传服务器'}</small></section></main>;
}

export default App;
