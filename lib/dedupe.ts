// Design Ref: DESIGN §3.2 — 제목이 매우 비슷한(글자 겹침 60% 이상) 기사를 1건으로 합치고,
// 먼저 발행된 기사를 남긴다. 본문을 읽기 전에 거르므로 제목만 비교한다.
// Plan SC: PLAN 6번

/** 같은 기사로 볼 제목 유사도 기준 (0~1) */
export const DUPLICATE_THRESHOLD = 0.6;

/** 제목을 비교하기 좋게 다듬는다: 공백·기호를 빼고 소문자로 */
function normalize(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** 글자 두 개씩 묶은 조각(예: "물가상승" → 물가, 가상, 상승) 모음 */
function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

/**
 * 두 제목의 글자 겹침 정도(0~1). 조각 모음의 Dice 계수를 쓴다:
 * 2 × (겹치는 조각 수) ÷ (두 제목의 조각 수 합). 같은 제목이면 1이다.
 */
export function titleSimilarity(a: string, b: string): number {
  const setA = bigrams(normalize(a));
  const setB = bigrams(normalize(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const piece of setA) if (setB.has(piece)) overlap++;
  return (2 * overlap) / (setA.size + setB.size);
}

/**
 * 중복 기사를 합친다. 먼저 발행된 기사를 남기고, 결과는 최신순으로 돌려준다.
 * mergedCount는 합쳐져서 없어진 기사 수다.
 */
export function dedupeArticles<T extends { title: string; publishedAt: string; linkKind?: string; custom?: boolean }>(
  articles: T[],
  threshold: number = DUPLICATE_THRESHOLD,
): { articles: T[]; mergedCount: number } {
  const oldestFirst = [...articles].sort(
    (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
  );

  const kept: T[] = [];
  for (const article of oldestFirst) {
    const index = kept.findIndex((k) => titleSimilarity(k.title, article.title) >= threshold);
    if (index === -1) {
      kept.push(article);
      continue;
    }
    // 같은 기사로 보이면 먼저 발행된 기사를 남긴다. 다만 남은 쪽이 구글 중계 주소이고 이쪽이 원문 주소면,
    // 본문을 읽을 수 있도록 원문 주소 쪽을 남긴다. 직접 검색으로 찾은 기사라는 표시는 잃지 않는다.
    const existing = kept[index];
    if (existing.linkKind === "google" && article.linkKind === "direct") {
      kept[index] = { ...article, custom: article.custom || existing.custom ? true : undefined };
    } else if (article.custom && !existing.custom) {
      kept[index] = { ...existing, custom: true };
    }
  }

  kept.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { articles: kept, mergedCount: articles.length - kept.length };
}
