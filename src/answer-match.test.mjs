import assert from 'node:assert/strict';
import { matchesChineseMeaning, matchesEnglishPhrase, normalizeAnswer } from './answer-match.js';

assert.equal(normalizeAnswer(' 她，She! '), '她she');
assert.equal(matchesChineseMeaning(' 开始。 ', '开始；着手'), true);
assert.equal(matchesEnglishPhrase('want to do something!', 'want to do sth.'), true);
assert.equal(matchesEnglishPhrase('look forward to doing', 'look forward to doing sth.'), true);
console.log('answer matching checks passed');
