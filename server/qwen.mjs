import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const grammarSource = JSON.parse(await readFile(path.join(currentDirectory, '..', 'worldSQL', 'grammar-bank.json'), 'utf8'));

function extractJson(text) {
  const withoutFence = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(withoutFence);
}

function compactText(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function normalizeWordExplanation(content, selectedText) {
  const meaning = compactText(content?.meaning, 180);
  if (!meaning) return null;
  return {
    term: compactText(content?.term, 80) || selectedText,
    meaning,
    pronunciation: compactText(content?.pronunciation, 80),
    partOfSpeech: compactText(content?.partOfSpeech, 80),
    usage: compactText(content?.usage, 180),
    collocation: compactText(content?.collocation, 120),
    example: compactText(content?.example, 180),
  };
}

const typedQuestionTypes = new Set(['fill', 'fill-blank', 'fillblank', 'input', 'short-answer', 'word-form', 'wordform', 'error-correction', 'errorcorrection', 'sentence-translation', 'sentencetranslation']);

export function hasClearGrammarStem(question, answer = '') {
  const stem = compactText(question, 300);
  const normalizedAnswer = compactText(answer, 120).toLowerCase();
  const englishWords = stem.match(/[A-Za-z]+/g)?.length || 0;
  const chineseCharacters = stem.match(/[\u4e00-\u9fff]/g)?.length || 0;
  return stem.length >= 10 && stem.toLowerCase() !== normalizedAnswer && (englishWords >= 2 || chineseCharacters >= 8);
}

export function hasClearGrammarQuestion(item) {
  if (!hasClearGrammarStem(item?.question, item?.answer)) return false;
  const stem = compactText(item.question, 300);
  const instruction = compactText(item.instruction, 160);
  const hasBlank = /_{2,}|\(\s*\)/.test(stem);
  const stemStatesTask = /[?？]|找出|选择|判断|指出|填入|补全|改正|identify|choose|select|which|what|fill|complete/i.test(stem);
  const stemWordList = (stem.toLowerCase().match(/[a-z]+/g) || []).filter((word) => word.length > 1);
  const stemWords = new Set(stemWordList);
  const instructionNamesTarget = (instruction.toLowerCase().match(/[a-z]+/g) || []).some((word) => stemWords.has(word));
  const instructionStatesTarget = instructionNamesTarget || /空格|划线|加粗|主语|谓语|宾语|哪个词|哪一词|错误处/.test(instruction);
  const partOfSpeechLabels = new Set(['名词', '动词', '形容词', '副词', '代词', '介词', '连词', '冠词', '数词', 'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'article', 'numeral']);
  const options = Array.isArray(item.options) ? item.options.map((option) => compactText(option, 40).toLowerCase()) : [];
  const asksPartOfSpeech = options.length >= 2 && options.every((option) => partOfSpeechLabels.has(option));
  const taskWords = new Set(['what', 'which', 'word', 'part', 'of', 'speech', 'is', 'are', 'the', 'this', 'that', 'sentence', 'in', 'a', 'an', 'she', 'he', 'it', 'they', 'we', 'you']);
  const stemRepeatsTarget = stemWordList.some((word, index) => !taskWords.has(word) && stemWordList.indexOf(word) !== index);
  if (asksPartOfSpeech && !instructionNamesTarget && !stemRepeatsTarget) return false;
  return hasBlank || stemStatesTask || instructionStatesTarget;
}

export function normalizeGrammarQuestion(item, moduleId, index, revision) {
  if (item?.moduleId !== moduleId || typeof item.question !== 'string' || !item.question.trim() || typeof item.answer !== 'string' || !item.answer.trim() || typeof item.explanation !== 'string' || !item.explanation.trim()) return null;
  const type = String(item.type || '').trim().toLowerCase();
  const options = Array.isArray(item.options) ? item.options.filter((option) => typeof option === 'string').map((option) => option.trim()).filter(Boolean) : [];
  const uniqueOptions = [...new Set(options)];
  const isTyped = typedQuestionTypes.has(type);
  if (!hasClearGrammarQuestion({ ...item, type, options: uniqueOptions })) return null;
  if (isTyped && uniqueOptions.length) return null;
  if (!isTyped && (uniqueOptions.length !== 4 || !uniqueOptions.includes(item.answer.trim()))) return null;
  return {
    ...item,
    type: isTyped ? type : 'choice',
    options: isTyped ? [] : uniqueOptions,
    answer: item.answer.trim(),
    instruction: compactText(item.instruction, 160),
    // 08:00 重新出题后必须使用新的题目 ID；否则当天旧作答记录会把新题误判为已完成。
    id: `daily-${revision}-${moduleId}-grammar-${index + 1}`,
    source: 'qwen',
  };
}

function validateContent(content, moduleId, revision) {
  if (!Array.isArray(content?.grammarQuestions) || !Array.isArray(content?.translationItems)) return null;
  const grammarQuestions = content.grammarQuestions.map((item, index) => normalizeGrammarQuestion(item, moduleId, index, revision)).filter(Boolean).slice(0, 15);
  const translationItems = content.translationItems.filter((item) => (
    typeof item?.english === 'string' && typeof item?.referenceChinese === 'string'
  )).slice(0, 10).map((item, index) => ({ ...item, id: `daily-${revision}-${moduleId}-translation-${index + 1}`, source: 'qwen' }));
  if (grammarQuestions.length < 8 || translationItems.length < 8) return null;
  return { grammarQuestions, translationItems, source: 'qwen' };
}

export async function generateDailyContent({ day, date }) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;
  const grammar = grammarSource.modules.find((module) => module.scheduledDay === day);
  if (!grammar) return null;
  const baseUrl = (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const model = process.env.QWEN_MODEL || 'qwen-plus';
  const prompt = `你是专升本英语基础复习命题助手。日期：${date}。学生英语基础薄弱。今天固定语法模块：${grammar.title}。固定规则：${grammar.coreRule}。核心结构：${grammar.structure}。${grammar.cueWords?.length ? `标志词：${grammar.cueWords.join('、')}。` : ''}

固定语法规则不能被改写。请生成严格 JSON 对象，不要 Markdown：
{
  "grammarQuestions":[15 道题],
  "translationItems":[10 个翻译句]
}

grammarQuestions 每题必须有 id、moduleId（固定为 ${grammar.id}）、type、instruction、question、options、answer、explanation、testedRule、difficulty（1-3）。question 必须同时包含完整语境和明确任务，不能只给一个陈述句；如果考查句中某个词，instruction 必须直接写出该词以及要判断的内容，例如“判断句中 quickly 的词性”，不能写“根据今日语法点判断”。选择/填空题必须给出含语境的完整英文句子，填空用 ___ 标出唯一作答位置。15 题中约 9 道 type=choice：options 必须恰好四项、非空、互不重复，且 answer 必须是其中唯一正确项；约 6 道 type=fill：options 必须是空数组，题干留出空格，学生要在输入框填写 answer。题目中 8 道是今日模块、4 道是该模块易错对比、3 道是已学基础回顾；句子以 8-18 个词为主，词汇简单。
translationItems 每项必须有 id、english、referenceChinese、category（专升本高频/日常表达）、grammarPoint、audioText。翻译句适合基础薄弱学生，英文 6-18 词；中文参考译文自然简洁。
不要使用生僻词、超长句、多个正确答案、模糊题或答案预先泄露。`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: '你只输出可解析的 JSON。' }, { role: 'user', content: prompt }], temperature: 0.35 }),
  });
  if (!response.ok) throw new Error(`Qwen request failed: ${response.status}`);
  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string') throw new Error('Qwen returned no text content');
  // 毫秒级版本号用于区分同一天 08:00 前后的两批内容，并保存在缓存内容里。
  const generatedAt = new Date().toISOString();
  const revision = generatedAt.replace(/[^0-9]/g, '');
  const validated = validateContent(extractJson(rawContent), grammar.id, revision);
  if (!validated) throw new Error('Qwen response did not pass question validation');
  return { ...validated, generatedAt };
}

export async function generateWordExplanation({ text }) {
  const selectedText = compactText(text, 160);
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !selectedText) return null;
  const baseUrl = (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const model = process.env.QWEN_MODEL || 'qwen-plus';
  const prompt = `你是面向专升本英语基础薄弱学生的划词释义助手。请解释英文词或短语：${selectedText}。只输出严格 JSON，不要 Markdown：
{"term":"原词或短语","meaning":"简洁中文释义，可用分号列出常见义","pronunciation":"IPA 音标；短语可留空","partOfSpeech":"词性或短语类型","usage":"一句简短用法提示","collocation":"一个高频搭配","example":"一句简单英文例句及中文意思"}
不要编造不确定的音标；无法给出时 pronunciation 为空字符串。`;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: '你只输出可解析的 JSON。' }, { role: 'user', content: prompt }], temperature: 0.2, max_tokens: 450 }),
  });
  if (!response.ok) throw new Error(`Qwen word explanation failed: ${response.status}`);
  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  if (typeof rawContent !== 'string') throw new Error('Qwen returned no explanation');
  const explanation = normalizeWordExplanation(extractJson(rawContent), selectedText);
  if (!explanation) throw new Error('Qwen explanation did not pass validation');
  return explanation;
}
