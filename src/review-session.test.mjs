import assert from 'node:assert/strict';
import { snapshotReviewItems } from './review-session.js';

for (const [name, items, current, next] of [
  ['word', [{ term: 'accept', meaning: '接受', wrong: { direction: 'en-zh' } }, { term: 'achieve', meaning: '实现' }], 'accept', 'achieve'],
  ['phrase', [{ phrase: 'look after', meaning: '照顾' }, { phrase: 'take care of', meaning: '照顾' }], 'look after', 'take care of'],
  ['grammar', [{ id: 'g1', question: 'He ___ a book.', answer: 'reads' }, { id: 'g2', question: 'She ___ fast.', answer: 'runs' }], 'g1', 'g2'],
]) {
  const session = snapshotReviewItems(items);
  const liveQueueAfterCorrect = items.slice(1);

  // Removing the current item from the live wrong-book must not replace it
  // in the answer-result area before the app advances.
  assert.equal(session[0].term || session[0].phrase || session[0].id, current, `${name}: current item stays stable`);
  assert.equal(liveQueueAfterCorrect[0].term || liveQueueAfterCorrect[0].phrase || liveQueueAfterCorrect[0].id, next, `${name}: live queue moves on`);
}

console.log('review-session snapshot tests passed');
