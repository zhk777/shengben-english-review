const punctuationOrSpace = /[\s\p{P}\p{S}]/gu;

export const normalizeAnswer = (value) => String(value || '')
  .normalize('NFKC')
  .trim()
  .toLowerCase()
  .replace(punctuationOrSpace, '');

const normalizeEnglishPattern = (value) => String(value || '')
  .toLowerCase()
  .replace(/\b(somebody|someone)\b/g, 'sb')
  .replace(/\bsomething\b/g, 'sth')
  .replace(/\b(place|地点)\b/g, '')
  .replace(/\b(sb|sth)\b/g, '');

export const matchesChineseMeaning = (answer, reference) => {
  const candidate = normalizeAnswer(answer);
  if (!candidate) return false;
  return String(reference || '').split(/[；;，,、/|]/).map(normalizeAnswer).filter(Boolean)
    .some((meaning) => candidate === meaning || candidate.includes(meaning) || meaning.includes(candidate));
};

export const matchesEnglishPhrase = (answer, reference) => {
  const candidate = normalizeAnswer(normalizeEnglishPattern(answer));
  const expected = normalizeAnswer(normalizeEnglishPattern(reference));
  return Boolean(candidate) && (candidate === expected || candidate.includes(expected) || expected.includes(candidate));
};
