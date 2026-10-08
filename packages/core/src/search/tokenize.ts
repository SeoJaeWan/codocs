/**
 * 검색 색인과 검색어가 함께 쓰는 토큰화다.
 * 출처: COD-65 프로토타입(text.mjs)의 한국어 글자 n-gram + 영문 식별자 분리 방식을 이 저장소 컨벤션에 맞춰 다시 구현했다.
 */

/** 영문 불용어다. 식별자를 나눈 조각 하나가 통째로 일치할 때만 제외한다. */
const englishStopWords: ReadonlySet<string> = new Set(
  (
    'a an the of to in on at for and or but is are was were be been it its this that these those ' +
    'do does did can could should would will with from by as if then so not no i you we me my our ' +
    'your please how what why when where which who whom there here about into over under also just only'
  ).split(' '),
);
/** 질문에만 반복되는 한국어 요청·의문 어절이다. 한글 연속 구간 전체가 일치할 때만 제외한다. */
const koreanStopWords: ReadonlySet<string> = new Set([
  '해줘',
  '해주세요',
  '해',
  '알려줘',
  '알려',
  '알려주세요',
  '보여줘',
  '보여',
  '보여주세요',
  '찾아줘',
  '찾아',
  '만들어줘',
  '만들어',
  '고쳐줘',
  '고쳐',
  '뭐야',
  '뭐지',
  '뭐였지',
  '뭔지',
  '뭐',
  '어떻게',
  '어떤',
  '어디',
  '언제',
  '왜',
  '무엇',
  '있어',
  '있나',
  '돼',
  '되나',
  '되지',
  '이',
  '그',
  '저',
  '좀',
  '줘',
  '주세요',
  '대해',
  '대해서',
  '관련',
  '문서',
  '내용',
  '설명',
  '설명해줘',
  '설명해',
  '알고',
  '싶어',
  '싶어요',
  '궁금해',
  '확인해줘',
  '확인해',
  '정리해줘',
  '요약해줘',
]);
/** 한글 연속 구간(1번째 그룹)과 영문·숫자 식별자(2번째 그룹)를 찾는다. */
const wordPattern = /([가-힣]+)|([A-Za-z0-9][A-Za-z0-9_-]*)/gu;

/**
 * 영문 단어의 복수형·ing·ed·끝 e를 가볍게 떼어 어간으로 만든다.
 * 4글자 미만이거나 숫자가 있으면 그대로 둔다.
 */
function stem(word: string): string {
  if (word.length < 4 || /\d/u.test(word)) return word;
  let result = word;
  if (/ies$/u.test(result)) result = result.replace(/ies$/u, 'y');
  else if (/sses$/u.test(result)) result = result.slice(0, -2);
  else if (/s$/u.test(result) && !/(ss|us|is)$/u.test(result))
    result = result.slice(0, -1);
  if (result.length > 5 && /ing$/u.test(result)) result = result.slice(0, -3);
  else if (result.length > 4 && /ed$/u.test(result))
    result = result.slice(0, -2);
  if (result.length > 4 && result.endsWith('e')) result = result.slice(0, -1);
  return result;
}

/** camelCase 경계에서 식별자 조각을 나눈다. */
function splitCamelCase(part: string): string[] {
  return part
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .split(' ');
}

/** 한글 연속 구간을 글자 2-gram·3-gram으로 나눈다. 한 글자 구간은 그대로 둔다. */
function koreanTokens(run: string): string[] {
  if (koreanStopWords.has(run)) return [];
  if (run.length === 1) return [run];
  const tokens: string[] = [];
  for (let index = 0; index + 2 <= run.length; index++)
    tokens.push(run.slice(index, index + 2));
  for (let index = 0; index + 3 <= run.length; index++)
    tokens.push(run.slice(index, index + 3));
  return tokens;
}

/**
 * 영문·숫자 식별자를 소문자 어간 조각으로 나눈다.
 * 조각이 둘 이상이면 소문자 전체 식별자도 함께 낸다.
 */
function identifierTokens(chunk: string): string[] {
  const parts = chunk
    .split(/[_-]/u)
    .flatMap(splitCamelCase)
    .map((part) => part.toLowerCase())
    .filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    if (englishStopWords.has(part) || (part.length < 2 && !/\d/u.test(part)))
      continue;
    tokens.push(stem(part));
  }
  if (parts.length > 1) tokens.push(chunk.toLowerCase());
  return tokens;
}

/**
 * 텍스트를 검색 용어 배열로 바꾼다. 같은 용어가 반복되면 반복 횟수를 유지한다.
 * @param text 문서 이름·섹션 이름·본문 또는 검색어 원문이다.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.normalize('NFC').matchAll(wordPattern)) {
    const [, korean, identifier] = match;
    if (korean !== undefined) tokens.push(...koreanTokens(korean));
    else if (identifier !== undefined)
      tokens.push(...identifierTokens(identifier));
  }
  return tokens;
}
