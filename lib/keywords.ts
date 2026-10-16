// 인턴이 직접 입력하는 검색어를 검사하고 해석한다. 화면과 서버가 같은 규칙을 쓰도록 한 곳에 둔다.
// 서버는 화면에서 온 값을 믿지 않고 여기서 한 번 더 검사한다.
//
// 입력 방법: 쉼표로 구분하고, 단어 앞에 "-"를 붙이면 그 단어가 들어간 기사는 뺀다.
//   예) "유가 -유가족, 쌀값"  →  "유가"를 찾되 "유가족"만 있는 기사는 제외, 그리고 "쌀값"

/** 한 번에 입력할 수 있는 검색어 수 */
export const CUSTOM_KEYWORD_MAX_COUNT = 3;
/** 검색어 하나에 붙일 수 있는 제외 단어 수 */
const MAX_EXCLUDES = 5;
const MIN_LENGTH = 2;
const MAX_LENGTH = 20;
/** 글자·숫자·공백·가운데점·하이픈만 허용한다 (주소나 특수 기호는 막는다) */
const ALLOWED = /^[\p{L}\p{N} ·\-]+$/u;

/**
 * 헷갈리기 쉬운 단어는 따로 입력하지 않아도 미리 빼 둔다.
 * (예: "유가"를 찾는데 "유가족", "유가증권"이 들어오는 것을 막는다)
 */
export const DEFAULT_EXCLUDES: Record<string, string[]> = {
  유가: ["유가족", "유가증권", "이유가"],
  경유: ["경유지"],
};

export interface CustomKeyword {
  /** 찾을 말 */
  word: string;
  /** 이 말이 들어 있어도 이 단어들 안에서만 나온 기사는 뺀다 */
  excludes: string[];
}

export type KeywordParse =
  | { ok: true; keywords: CustomKeyword[]; normalized: string }
  | { ok: false; message: string };

function checkWord(word: string): string | undefined {
  if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) {
    return `검색어는 ${MIN_LENGTH}~${MAX_LENGTH}글자로 입력해 주세요: "${word.slice(0, 24)}"`;
  }
  if (!ALLOWED.test(word)) {
    return `검색어에는 글자, 숫자, 공백만 쓸 수 있습니다: "${word.slice(0, 24)}"`;
  }
  return undefined;
}

/** 쉼표로 나눈 입력을 검사해 검색어 목록으로 만든다. 비어 있으면 빈 목록(검색어 없음)이다 */
export function parseCustomKeywords(raw: string): KeywordParse {
  const parts = [...new Set(raw.split(",").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean))];

  if (parts.length > CUSTOM_KEYWORD_MAX_COUNT) {
    return { ok: false, message: `검색어는 쉼표로 구분해 최대 ${CUSTOM_KEYWORD_MAX_COUNT}개까지 입력할 수 있습니다.` };
  }

  const keywords: CustomKeyword[] = [];
  for (const part of parts) {
    // 띄어쓰기로 나눠 "-"로 시작하는 단어는 제외 단어, 나머지는 이어 붙여 검색어로 쓴다 (예: "휘발유 가격")
    const tokens = part.split(" ");
    const excludes = tokens.filter((token) => token.startsWith("-")).map((token) => token.slice(1));
    const word = tokens.filter((token) => !token.startsWith("-")).join(" ");

    if (!word) return { ok: false, message: `찾을 검색어가 없습니다: "${part.slice(0, 24)}"` };
    if (excludes.length > MAX_EXCLUDES) return { ok: false, message: `제외 단어는 검색어마다 최대 ${MAX_EXCLUDES}개까지 쓸 수 있습니다.` };

    for (const text of [word, ...excludes]) {
      const problem = checkWord(text);
      if (problem) return { ok: false, message: problem };
    }
    keywords.push({ word, excludes: [...new Set([...excludes, ...(DEFAULT_EXCLUDES[word] ?? [])])] });
  }

  // 서버에 보낼 글: 사용자가 쓴 그대로(기본 제외 단어는 서버가 알아서 붙인다)
  return { ok: true, keywords, normalized: parts.join(", ") };
}

/**
 * 제목이 검색어와 맞는지 본다.
 * 제외 단어를 먼저 지우고 나서도 검색어가 남아 있어야 맞는 것이다
 * (예: "유가족과 합의"는 "유가족"을 지우면 "유가"가 없어 제외, "국제유가, 유가족…"은 "국제유가"가 남아 포함).
 */
export function titleMatches(title: string, keyword: CustomKeyword): boolean {
  let text = title.toLowerCase();
  for (const exclude of keyword.excludes) text = text.split(exclude.toLowerCase()).join(" ");
  return text.includes(keyword.word.toLowerCase());
}

/**
 * 구글 검색 결과처럼 제목에 검색어가 없어도 될 때 쓴다.
 * 제목에 제외 단어가 있고, 그것을 지우면 검색어가 사라지는 기사만 뺀다.
 */
export function isExcludedOnly(title: string, keyword: CustomKeyword): boolean {
  const lower = title.toLowerCase();
  const hasExcluded = keyword.excludes.some((exclude) => lower.includes(exclude.toLowerCase()));
  return hasExcluded && !titleMatches(title, keyword);
}
