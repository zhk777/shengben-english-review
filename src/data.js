import vocabularySource from '../worldSQL/daily-vocabulary-30day.json';
import phraseSource from '../worldSQL/phrase-bank.json';
import grammarSource from '../worldSQL/grammar-bank.json';

const parseToken = (token) => {
  const [term, ...meaningParts] = token.split('|');
  return { term: term.trim(), meaning: meaningParts.join('|').trim() };
};

export const vocabularyByDay = new Map(
  vocabularySource.days.map((item) => [
    item.day,
    [...(item.coreWords || []), ...(item.extendedWords || [])].map(parseToken),
  ]),
);

export const phrasesById = new Map(phraseSource.phrases.map((item) => [item.id, item]));
export const phrasesForDay = new Map(
  phraseSource.dailyNewPhraseSchedule.map((item) => [
    item.day,
    item.phraseIds.map((id) => phraseSource.phrases.find((phrase) => phrase.id === id)),
  ]),
);

export const grammarByDay = new Map(grammarSource.modules.map((item) => [item.scheduledDay, item]));

export const translationFallback = [
  { id: 'T01', english: 'Reading every day can help you improve your English.', chinese: '每天阅读能够帮助你提高英语水平。', category: '专升本高频', grammar: '动名词作主语；help sb. do sth.' },
  { id: 'T02', english: 'Please tell me when the meeting will begin.', chinese: '请告诉我会议什么时候开始。', category: '日常表达', grammar: '宾语从句；将来时间' },
  { id: 'T03', english: 'The library is open from Monday to Friday.', chinese: '图书馆从周一到周五开放。', category: '日常表达', grammar: 'be 动词；from ... to ...' },
  { id: 'T04', english: 'The work will be finished before next Friday.', chinese: '这项工作将在下周五前完成。', category: '专升本高频', grammar: '一般将来时的被动语态' },
  { id: 'T05', english: 'If you have any questions, please ask your teacher.', chinese: '如果你有任何问题，请询问你的老师。', category: '专升本高频', grammar: 'if 条件句；祈使句' },
  { id: 'T06', english: 'She has studied in this school for three years.', chinese: '她已经在这所学校学习三年了。', category: '专升本高频', grammar: '现在完成时；for + 一段时间' },
  { id: 'T07', english: 'I am looking forward to hearing from you.', chinese: '我期待收到你的来信。', category: '专升本高频', grammar: 'look forward to + doing' },
  { id: 'T08', english: 'Taking a short walk is good for your health.', chinese: '进行短暂散步对你的健康有好处。', category: '日常表达', grammar: '动名词作主语；be good for' },
];

const baseFallbackQuestions = [
  {
    id: 'F01', moduleId: 'G01', type: 'choice', question: '找出句子 “Students learn English.” 中的谓语动词。',
    options: ['Students', 'learn', 'English', '句号'], answer: 'learn', explanation: 'learn 表示主语 Students 发出的动作，是谓语动词。', testedRule: '主语 + 谓语 + 宾语', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F02', moduleId: 'G02', type: 'choice', question: 'She ___ ready for the test.',
    options: ['am', 'is', 'are', 'be'], answer: 'is', explanation: '主语 she 对应 be 动词 is。', testedRule: 'he/she/it + is', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F03', moduleId: 'G03', type: 'choice', question: 'I have ___ English book.',
    options: ['a', 'an', 'the', 'two'], answer: 'an', explanation: 'English 以元音音素开头，单数可数名词前用 an。', testedRule: 'a/an', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F04', moduleId: 'G04', type: 'choice', question: 'He often ___ books in the library.',
    options: ['read', 'reads', 'reading', 'readed'], answer: 'reads', explanation: 'often 提示一般现在时，he 是第三人称单数，动词加 -s。', testedRule: '一般现在时三单', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F05', moduleId: 'G05', type: 'choice', question: 'Look! They ___ English now.',
    options: ['study', 'studies', 'are studying', 'studied'], answer: 'are studying', explanation: 'Look! 和 now 提示现在进行时：are + studying。', testedRule: '现在进行时', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F06', moduleId: 'G06', type: 'choice', question: 'They ___ to Beijing last year.',
    options: ['go', 'goes', 'went', 'will go'], answer: 'went', explanation: 'last year 提示一般过去时，go 的过去式是 went。', testedRule: '一般过去时', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F07', moduleId: 'G07', type: 'choice', question: 'We ___ a picnic next Sunday.',
    options: ['have', 'had', 'will have', 'having'], answer: 'will have', explanation: 'next Sunday 提示一般将来时：will + 动词原形。', testedRule: '一般将来时', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F08', moduleId: 'G09', type: 'choice', question: 'You should ___ the new words tonight.',
    options: ['review', 'reviews', 'reviewed', 'to review'], answer: 'review', explanation: 'should 是情态动词，后接动词原形。', testedRule: '情态动词', difficulty: 1, source: 'local-fallback',
  },
  {
    id: 'F09', moduleId: 'G12', type: 'choice', question: 'He ___ in this school for five years.',
    options: ['works', 'worked', 'has worked', 'will work'], answer: 'has worked', explanation: 'for five years 表示持续到现在，he 用 has + 过去分词。', testedRule: '现在完成时', difficulty: 2, source: 'local-fallback',
  },
  {
    id: 'F10', moduleId: 'G14', type: 'choice', question: 'She enjoys ___ English stories.',
    options: ['read', 'to read', 'reading', 'reads'], answer: 'reading', explanation: 'enjoy 后固定接 doing。', testedRule: 'enjoy doing', difficulty: 1, source: 'local-fallback',
  },
];

// 每个模块提供 15 道离线保底题。题干采用基础识别、结构判断和例句回忆三种变体，
// 千问不可用时仍能完成完整的一组练习；真实动态题接入后会优先替换这些题目。
const questionPrompts = [
  '下面哪一项最符合本日知识点？',
  '复习本节时，首先应该记住哪一个结构？',
  '看到本节例句时，应该选择哪种判断？',
  '基础题中，本模块的核心形式是？',
  '哪一项可以帮助你快速识别本语法点？',
  '本节最容易混淆的判断依据是？',
  '如果只保留一个口诀，本节应记住？',
  '下列提示与本节最匹配的是？',
  '本节做题的第一步应该看什么？',
  '哪一种表达属于本节的标准结构？',
  '本模块在专升本单选中主要考查？',
  '想避免本节常见错误，应优先检查？',
  '本节例句体现的语法重点是？',
  '基础薄弱阶段，本节应先掌握？',
  '下面哪项是本节的正确复习方向？',
];
const genericDistractors = ['主语 + 谓语 + 宾语', 'am/is/are + doing', 'have/has + done', 'will + 动词原形', 'to do / doing'];
const generatedFallbackQuestions = grammarSource.modules.flatMap((module) => questionPrompts.map((prompt, index) => {
  const correct = module.structure || module.title;
  const options = [`${correct}`, ...genericDistractors.filter((item) => item !== correct).slice(0, 3)];
  return {
    id: `L-${module.id}-${String(index + 1).padStart(2, '0')}`,
    moduleId: module.id,
    type: 'choice',
    question: `${prompt}（${module.title}）`,
    options,
    answer: correct,
    explanation: `${module.coreRule} 先结合“${module.example}”理解，再记住结构：${correct}。`,
    testedRule: module.title,
    difficulty: index < 10 ? 1 : 2,
    source: 'local-generated',
  };
}));
export const fallbackQuestions = [...baseFallbackQuestions, ...generatedFallbackQuestions];

export const reviewDays = new Set(vocabularySource.reviewDays);
