// Design Ref: DESIGN §3.1(B)-3 — AI가 쓴 요약을 코드로 다시 확인한다. (AI의 말만 믿지 않는다)
// Plan SC: PLAN 9번 — 기사에 없는 숫자 0건, 주소·HTML 금지, 3문장 이내.

/** 글에서 숫자를 모두 뽑는다. 쉼표는 뺀다 (예: 1,464 → 1464) */
export function extractNumbers(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => value.replace(/,/g, "").replace(/\.$/, ""));
}

/** 요약에는 있는데 기사 본문에는 없는 숫자 목록 */
export function findUnsupportedNumbers(summary: string, body: string): string[] {
  const inBody = new Set(extractNumbers(body));
  return [...new Set(extractNumbers(summary))].filter((number) => !inBody.has(number));
}

/** 요약에 주소나 HTML 같은 것이 들어 있는지 */
export function containsLinkOrMarkup(summary: string): boolean {
  return /https?:|www\.|[<>]|\]\(|\[[^\]]*\]\(/i.test(summary);
}

/** 문장 수를 대략 센다 (마침표·물음표·느낌표 기준) */
export function countSentences(summary: string): number {
  const marks = summary.match(/[.!?](?=\s|$)/g)?.length ?? 0;
  return Math.max(marks, summary.trim() ? 1 : 0);
}

export interface SummaryCheck {
  unsupportedNumbers: string[];
  hasLinkOrMarkup: boolean;
  sentenceCount: number;
  /** 모두 통과했는지 */
  passed: boolean;
}

export function checkSummary(summary: string, body: string, maxSentences = 3): SummaryCheck {
  const unsupportedNumbers = findUnsupportedNumbers(summary, body);
  const hasLinkOrMarkup = containsLinkOrMarkup(summary);
  const sentenceCount = countSentences(summary);
  return {
    unsupportedNumbers,
    hasLinkOrMarkup,
    sentenceCount,
    passed: unsupportedNumbers.length === 0 && !hasLinkOrMarkup && sentenceCount <= maxSentences,
  };
}
