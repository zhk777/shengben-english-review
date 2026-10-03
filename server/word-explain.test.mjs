import assert from 'node:assert/strict';
import { normalizeWordExplanation } from './qwen.mjs';

const explanation = normalizeWordExplanation({ term: 'look up', meaning: '查阅；向上看', pronunciation: '/lʊk ʌp/', usage: '可作动词短语' }, 'look up');
assert.equal(explanation.term, 'look up');
assert.equal(explanation.meaning, '查阅；向上看');
assert.equal(normalizeWordExplanation({ term: 'word' }, 'word'), null);
console.log('word explanation validation checks passed');
