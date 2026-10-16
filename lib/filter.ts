// Design Ref: DESIGN §3.1(A)-2 — 지정 언론사 기사만, 실행 시각 기준 24시간 이내 기사만 남긴다.
// Plan SC: PLAN 5번
import { CATEGORIES, DEFAULT_PERIOD_HOURS, PRESS, TITLE_KEYWORDS, type Category } from "./config";
import type { Article, DesignatedArticle } from "./types";

const HOUR_MS = 60 * 60 * 1000;
// 시계가 조금 어긋난 서버의 "미래 시각" 기사를 허용하는 여유
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** 주소에서 호스트 이름만 꺼낸다. 주소가 이상하면 빈 글자를 돌려준다 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 호스트가 허용 도메인과 "정확히 같거나" 그 하위 주소인지 본다.
 * 글자 포함 여부로 비교하면 chosun.com.evil.com 같은 가짜 주소가 통과하므로 쓰지 않는다.
 */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 기사의 출처가 지정 언론사면 정식 이름을, 아니면 undefined를 돌려준다 */
export function findPress(article: Pick<Article, "sourceUrl" | "sourceName">): string | undefined {
  const host = hostnameOf(article.sourceUrl);

  if (host) {
    // 출처 주소가 있으면 주소로만 판단한다 (이름이 같은 다른 매체를 막기 위해)
    return PRESS.find((press) => press.domains.some((d) => hostMatchesDomain(host, d)))?.name;
  }
  // 출처 주소가 없을 때만 RSS에 적힌 이름(별칭)으로 판단한다
  return PRESS.find((press) => press.aliases.includes(article.sourceName))?.name;
}

/** 제목에서 물가 관련 키워드를 찾아 분류와 맞은 키워드를 돌려준다. 하나도 없으면 undefined */
export function classifyTitle(title: string): { category: Category; keyword: string } | undefined {
  for (const category of CATEGORIES) {
    for (const pattern of TITLE_KEYWORDS[category]) {
      const match = pattern.exec(title);
      if (match) return { category, keyword: match[0] };
    }
  }
  return undefined;
}

/** 지정 언론사 기사만 남기고, 정식 이름을 붙인다 */
export function keepDesignatedPress(articles: Article[]): DesignatedArticle[] {
  const kept: DesignatedArticle[] = [];
  for (const article of articles) {
    const press = findPress(article);
    if (press) kept.push({ ...article, press });
  }
  return kept;
}

/** 실행 시각(now) 기준 hours시간 이내(기본 24시간)에 발행된 기사만 남긴다 */
export function keepRecent<T extends Pick<Article, "publishedAt">>(
  articles: T[],
  now: number,
  hours: number = DEFAULT_PERIOD_HOURS,
): T[] {
  const windowMs = hours * HOUR_MS;
  return articles.filter((article) => {
    const published = Date.parse(article.publishedAt);
    return !Number.isNaN(published) && published >= now - windowMs && published <= now + FUTURE_TOLERANCE_MS;
  });
}
