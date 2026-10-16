// Design Ref: DESIGN §3.1(A) 1)~3) — 가져오기(언론사 RSS + 구글 RSS) → 거르기 → 중복 합치기를 순서대로 잇는다.
import { attachBodies } from "./article-body";
import { DEFAULT_PERIOD_HOURS, PRESS } from "./config";
import { dedupeArticles } from "./dedupe";
import { keepDesignatedPress, keepRecent } from "./filter";
import { fetchGoogleArticles, fetchPressFeeds, type SearchOptions } from "./rss";
import type { CollectResult, DesignatedArticle } from "./types";

// 언론사 RSS가 없는 언론사. 고정 검색어는 이 언론사의 기사만 구글 뉴스 RSS에서 가져온다.
const FEEDLESS_PRESS = new Set(PRESS.filter((press) => !press.feeds?.length).map((press) => press.name));

const DEFAULT_SEARCH: SearchOptions = { customKeywords: [], includeFixed: true };

/**
 * hours: 최근 몇 시간 이내 기사만 모을지 (기본 24시간)
 * search: 인턴이 직접 입력한 검색어와 고정 검색어 사용 여부
 */
export async function collectBriefingArticles(
  hours: number = DEFAULT_PERIOD_HOURS,
  search: SearchOptions = DEFAULT_SEARCH,
): Promise<CollectResult> {
  // 두 가지 출처를 동시에 가져온다
  const [pressFeeds, google] = await Promise.all([fetchPressFeeds(search), fetchGoogleArticles(hours, search)]);

  // 구글 기사는 지정 언론사 기사만 쓴다.
  // 고정 검색어는 언론사 RSS가 없는 곳만 구글로 채우고(RSS가 있는 곳은 RSS가 우선),
  // 인턴이 직접 입력한 검색어는 구글 검색의 장점을 살려 모든 지정 언론사의 기사를 가져온다.
  const googleDesignated: DesignatedArticle[] = keepDesignatedPress(google.articles).filter(
    (article) => article.custom === true || FEEDLESS_PRESS.has(article.press),
  );

  // 현재 시각은 기사를 가져온 뒤에 읽는다 (요청 시점의 시각을 쓰기 위해)
  const now = Date.now();

  const designated = [...pressFeeds.articles, ...googleDesignated];
  const recent = keepRecent(designated, now, hours);
  const { articles: deduped } = dedupeArticles(recent);

  // 최대 20건의 본문을 읽고, 나머지는 제목만 남긴다
  const articles = await attachBodies(deduped);

  return {
    articles,
    failedQueries: [...pressFeeds.failed, ...google.failed],
    counts: {
      fetched: pressFeeds.fetchedCount + google.articles.length,
      designated: designated.length,
      recent: recent.length,
      final: articles.length,
      bodyOk: articles.filter((a) => a.bodyStatus === "ok").length,
      bodyFailed: articles.filter((a) => a.bodyStatus === "failed").length,
      titleOnly: articles.filter((a) => a.bodyStatus === "not-selected").length,
    },
  };
}
