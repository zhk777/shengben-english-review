import assert from 'node:assert/strict';
import { hasClearGrammarQuestion, hasClearGrammarStem, normalizeGrammarQuestion } from './qwen.mjs';

assert.equal(hasClearGrammarStem('She ___ ready for the test.', 'is'), true);
assert.equal(hasClearGrammarStem('is', 'is'), false);
assert.equal(hasClearGrammarQuestion({ type: 'choice', question: 'She runs quickly.', instruction: '', options: ['名词', '动词', '形容词', '副词'], answer: '动词' }), false);
assert.equal(hasClearGrammarQuestion({ type: 'choice', question: 'She runs quickly. What is the part of speech?', instruction: '', options: ['名词', '动词', '形容词', '副词'], answer: '动词' }), false);
assert.equal(hasClearGrammarQuestion({ type: 'choice', question: 'She runs quickly.', instruction: '判断句中 runs 的词性。', options: ['名词', '动词', '形容词', '副词'], answer: '动词' }), true);
assert.equal(hasClearGrammarQuestion({ type: 'fill', question: 'She ___ ready for the test.', instruction: '填写正确的 be 动词。', options: [], answer: 'is' }), true);
assert.equal(normalizeGrammarQuestion({ moduleId: 'G02', type: 'choice', question: 'She ___ ready for the test.', options: ['am', 'is', 'are', 'be'], answer: 'is', explanation: 'she 用 is。' }, 'G02', 0, 'test')?.answer, 'is');
assert.equal(normalizeGrammarQuestion({ moduleId: 'G01', type: 'choice', question: 'She runs quickly.', options: ['名词', '动词', '形容词', '副词'], answer: '动词', explanation: 'runs 是动词。' }, 'G01', 0, 'test'), null);
console.log('grammar question quality checks passed');
