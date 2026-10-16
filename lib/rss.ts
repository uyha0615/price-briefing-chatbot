// Design Ref: DESIGN §3.1(A)-1 — 언론사 RSS(원문 주소를 바로 받음)와 구글 뉴스 RSS(RSS가 없는 언론사용)로 기사 목록을 만든다.
// Plan SC: PLAN 4번 — 제목·언론사·링크·발행 시각을 가져온다. (거르기는 5번, 중복 합치기는 6번)
import { XMLParser } from "fast-xml-parser";
import { CATEGORIES, PRESS, SEARCH_QUERIES, type Category, type Press } from "./config";
import { classifyTitle } from "./filter";
import { isExcludedOnly, titleMatches, type CustomKeyword } from "./keywords";
import { cached, MINUTE } from "./memory-cache";
import type { Article, CollectResult, DesignatedArticle } from "./types";

const REQUEST_TIMEOUT_MS = 8000;
// 일부 언론사는 프로그램의 요청을 막아서, 일반 브라우저처럼 보이는 이름을 쓴다
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

type FailedQuery = CollectResult["failedQueries"][number];

/** 무엇으로 기사를 찾을지 */
export interface SearchOptions {
  /** 인턴이 직접 입력한 검색어와 제외 단어 (없으면 빈 목록) */
  customKeywords: CustomKeyword[];
  /** 설정 파일의 고정 검색어도 함께 쓸지 (false면 직접 입력한 검색어로만 찾는다) */
  includeFixed: boolean;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** XML에서 읽은 값이 하나면 배열로 감싸 준다 */
function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** XML 글자 값(문자열 또는 {#text})을 문자열로 꺼낸다 */
function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return String((value as Record<string, unknown>)["#text"] ?? "");
  return String(value);
}

/** 한 번 되돌린다 */
function decodeEntitiesOnce(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * 제목에 남아 있는 &quot; 같은 글자를 원래 글자로 되돌린다.
 * 언론사가 이미 한 번 바꾼 글자를 RSS가 또 바꾸는 경우(&amp;quot;)가 있어, 더 바뀌지 않을 때까지 반복한다.
 */
function decodeEntities(text: string): string {
  let current = text;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntitiesOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * 언론사마다 다른 발행 시각 표기를 읽는다.
 * 시간대가 없는 날짜(예: 2026-10-15 14:00:00)는 한국 시간으로 본다.
 */
export function parseDate(raw: string): Date | undefined {
  const text = raw.trim().replace(/\s+/g, " ").replace(/([+-]\d{2}):(\d{2})$/, "$1$2");
  if (!text) return undefined;

  let date = new Date(text);
  if (Number.isNaN(date.getTime()) && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) {
    date = new Date(`${text.replace(" ", "T")}+09:00`);
  }
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 주소 뒤에 붙은 추적용 값(utm_...)을 뺀다 */
function cleanLink(link: string): string {
  try {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return link;
  }
}

/** 제목 끝의 " - 언론사명"을 뺀다. 언론사가 이미 붙인 것까지 구글이 한 번 더 붙이는 경우가 있어 반복해서 뺀다 */
function cleanTitle(title: string, sourceName: string): string {
  const suffix = ` - ${sourceName}`;
  let cleaned = title;
  while (cleaned.endsWith(suffix)) cleaned = cleaned.slice(0, -suffix.length);
  return cleaned;
}

/** 실패 이유를 사람이 읽을 수 있는 한 줄로 만든다 (오류 원문을 그대로 쓰지 않는다) */
function describeFailure(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `${REQUEST_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다`;
  }
  if (error instanceof Error && error.message.startsWith("HTTP ")) {
    return `오류 코드 ${error.message.slice(5)}로 응답했습니다`;
  }
  return "가져오는 중 오류가 발생했습니다";
}

/** RSS 결과를 서버에 보관하는 시간. 이 안에 다시 만들면 같은 RSS를 다시 요청하지 않는다 */
const FEED_CACHE_MS = 5 * MINUTE;

/** RSS 주소를 열어 XML 글을 가져온다 (같은 주소는 5분 동안 한 번만 요청한다) */
async function fetchXml(url: string): Promise<string> {
  return cached(`rss:${url}`, FEED_CACHE_MS, async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store", // 매번 새로 받되, 위의 보관으로 5분 안의 반복 요청만 줄인다
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  });
}

// ---------------------------------------------------------------------------
// 언론사 RSS
// ---------------------------------------------------------------------------

/**
 * 언론사 RSS 글을 기사 목록으로 바꾼다. 제목에 물가 관련 키워드가 없는 기사는 버린다.
 * fetchedCount는 키워드로 거르기 전에 RSS에 들어 있던 기사 수다.
 */
export function parsePressFeed(
  xml: string,
  press: Press,
  search: SearchOptions = { customKeywords: [], includeFixed: true },
): { articles: DesignatedArticle[]; fetchedCount: number } {
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel ?? parsed?.["rdf:RDF"] ?? {};
  const items = toArray<Record<string, unknown>>(channel.item);
  const articles: DesignatedArticle[] = [];

  for (const item of items) {
    const title = decodeEntities(textOf(item.title)).trim();
    const link = textOf(item.link).trim();
    const published = parseDate(textOf(item.pubDate ?? item["dc:date"]));
    if (!title || !link || !published) continue;

    // 인턴이 직접 입력한 검색어가 제목에 있으면 그 기사를 먼저 고른다 (대소문자 구분 없이, 제외 단어는 먼저 지우고 비교)
    const customKeyword = search.customKeywords.find((keyword) => titleMatches(title, keyword))?.word;
    const fixed = search.includeFixed ? classifyTitle(title) : undefined;
    if (!customKeyword && !fixed) continue;

    articles.push({
      title,
      link: cleanLink(link),
      linkKind: "direct",
      publishedAt: published.toISOString(),
      sourceName: press.name,
      sourceUrl: `https://${press.domains[0]}`,
      category: fixed?.category ?? "기타 물가",
      query: customKeyword ?? fixed?.keyword ?? "",
      custom: customKeyword ? true : undefined,
      press: press.name,
    });
  }
  return { articles, fetchedCount: items.length };
}

/** RSS 주소가 있는 모든 언론사의 기사를 가져온다. 일부가 실패해도 나머지로 계속 진행한다 */
export async function fetchPressFeeds(search: SearchOptions): Promise<{
  articles: DesignatedArticle[];
  fetchedCount: number;
  failed: FailedQuery[];
}> {
  const jobs = PRESS.flatMap((press) => (press.feeds ?? []).map((feed) => ({ press, feed })));
  const settled = await Promise.allSettled(
    jobs.map(async ({ press, feed }) => parsePressFeed(await fetchXml(feed), press, search)),
  );

  const articles: DesignatedArticle[] = [];
  const failed: FailedQuery[] = [];
  const seenLinks = new Set<string>();
  let fetchedCount = 0;

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      failed.push({ query: `${jobs[index].press.name} RSS`, reason: describeFailure(result.reason) });
      return;
    }
    fetchedCount += result.value.fetchedCount;
    // 한 언론사의 여러 분류(경제, 사회, 전체 등)에 같은 기사가 겹치므로 같은 주소는 한 번만 남긴다
    for (const article of result.value.articles) {
      if (seenLinks.has(article.link)) continue;
      seenLinks.add(article.link);
      articles.push(article);
    }
  });
  return { articles, fetchedCount, failed };
}

// ---------------------------------------------------------------------------
// 구글 뉴스 RSS (언론사 RSS가 없는 곳을 채운다)
// ---------------------------------------------------------------------------

/** 검색어 하나에 대한 구글 뉴스 RSS 주소 (한국어·한국 설정, 최근 hours시간) */
function buildGoogleFeedUrl(query: string, hours: number): string {
  const q = encodeURIComponent(`${query} when:${hours}h`);
  return `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
}

/** 구글 뉴스 RSS 글을 기사 목록으로 바꾼다. 필요한 값이 없는 항목은 버린다 */
export function parseGoogleFeed(xml: string, category: Category, query: string, custom = false): Article[] {
  const parsed = parser.parse(xml);
  const items = toArray<Record<string, unknown>>(parsed?.rss?.channel?.item);
  const articles: Article[] = [];

  for (const item of items) {
    const source = item.source as Record<string, unknown> | string | undefined;
    const sourceName = typeof source === "object" ? textOf(source) : "";
    const sourceUrl = typeof source === "object" ? String(source["@_url"] ?? "") : "";
    const published = parseDate(textOf(item.pubDate));

    // 제목·링크·언론사·발행 시각 중 하나라도 없으면 쓸 수 없는 기사다
    if (!item.title || !item.link || !sourceName || !published) continue;

    articles.push({
      title: cleanTitle(decodeEntities(textOf(item.title)).trim(), sourceName),
      link: textOf(item.link),
      linkKind: "google",
      publishedAt: published.toISOString(),
      sourceName,
      sourceUrl,
      category,
      query,
      custom: custom ? true : undefined,
    });
  }
  return articles;
}

/** 설정 파일의 모든 검색어를 구글 뉴스 RSS로 가져온다 (아직 거르지 않은 상태) */
export async function fetchGoogleArticles(
  hours: number,
  search: SearchOptions,
): Promise<{
  articles: Article[];
  failed: FailedQuery[];
}> {
  const fixedJobs = search.includeFixed
    ? CATEGORIES.flatMap((category) =>
        SEARCH_QUERIES[category].map((query) => ({ category, query, custom: false })),
      )
    : [];
  // 인턴이 직접 입력한 검색어는 분류를 정할 수 없으니 일단 "기타 물가"로 두고, 화면에서는 "직접 검색" 구역에 보여 준다
  const customJobs = search.customKeywords.map((keyword) => ({
    category: "기타 물가" as Category,
    query: keyword.word,
    custom: true,
    keyword,
  }));
  const jobs: { category: Category; query: string; custom: boolean; keyword?: CustomKeyword }[] = [...fixedJobs, ...customJobs];

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      // 구글 검색에도 제외 단어를 함께 보낸다 (예: 유가 -유가족). 그래도 섞여 오는 기사는 아래에서 한 번 더 뺀다
      const searchText = job.keyword ? [job.query, ...job.keyword.excludes.map((word) => `-${word}`)].join(" ") : job.query;
      const articles = parseGoogleFeed(await fetchXml(buildGoogleFeedUrl(searchText, hours)), job.category, job.query, job.custom);
      return job.keyword ? articles.filter((article) => !isExcludedOnly(article.title, job.keyword as CustomKeyword)) : articles;
    }),
  );

  const articles: Article[] = [];
  const failed: FailedQuery[] = [];
  const seenLinks = new Set<string>();

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      failed.push({ query: jobs[index].query, reason: describeFailure(result.reason) });
      return;
    }
    // 같은 기사가 여러 검색어에 걸리면 먼저 찾은 것 하나만 남긴다
    for (const article of result.value) {
      if (seenLinks.has(article.link)) continue;
      seenLinks.add(article.link);
      articles.push(article);
    }
  });

  return { articles, failed };
}
