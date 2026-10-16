// Design Ref: DESIGN §3.1(A)-4,5 — 본문을 읽을 기사를 고르고, 원문 주소를 알아낸 뒤, 지정 언론사 주소일 때만 본문을 읽어 온다.
// Plan SC: PLAN 7번 — 최대 20건, 분류별로 고르게·최신순, 실패해도 다른 기사로 채우지 않음.
// 보안: DESIGN §6 — 지정 언론사 주소만 접속, https만, 이동은 최대 3번(이동할 때마다 다시 검사), 응답 크기 제한.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { CATEGORIES, PRESS } from "./config";
import { hostMatchesDomain } from "./filter";
import { cached, MINUTE } from "./memory-cache";
import type { BriefingArticle, DesignatedArticle } from "./types";

/** 본문까지 처리하는 기사의 최대 수 */
export const MAX_BODY_ARTICLES = 20;
/** 본문을 동시에 몇 건씩 읽을지 */
const CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
/** 요약에 보낼 본문의 최대 글자 수 (비용과 남용을 막기 위해) */
export const MAX_BODY_CHARS = 8000;
/** 이보다 짧으면 본문을 제대로 못 읽은 것으로 본다 (유료 기사 안내문, 로그인 요구 등) */
const MIN_BODY_CHARS = 200;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const BODY_CACHE_MS = 30 * MINUTE;
const RESOLVE_CACHE_MS = 60 * MINUTE;

/** 화면에 그대로 보여 줘도 되는 실패 이유를 담은 오류 */
class BodyError extends Error {}

// ---------------------------------------------------------------------------
// 읽을 기사 고르기
// ---------------------------------------------------------------------------

/**
 * 본문을 읽을 기사를 최대 limit건 고른다.
 * 분류(농축수산물 / 석유류 / 기타 물가)별로 돌아가며 한 건씩, 같은 분류 안에서는 최신 기사부터.
 */
export function selectForBody<T extends DesignatedArticle>(articles: T[], limit: number = MAX_BODY_ARTICLES): T[] {
  const newestFirst = (list: T[]) => list.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  // 인턴이 직접 검색한 기사는 가장 앞 묶음에 두어 자리를 먼저 받게 한다
  const groups = [
    newestFirst(articles.filter((article) => article.custom)),
    ...CATEGORIES.map((category) => newestFirst(articles.filter((article) => !article.custom && article.category === category))),
  ];

  const picked: T[] = [];
  for (let round = 0; picked.length < limit; round++) {
    let added = false;
    for (const group of groups) {
      if (group[round] && picked.length < limit) {
        picked.push(group[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// 주소 검사
// ---------------------------------------------------------------------------

/** https이고, 사용자 이름·특수 포트가 없으며, 허용 도메인(또는 그 하위 주소)인지 본다 */
export function isAllowedUrl(raw: string, domains: string[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return domains.some((domain) => hostMatchesDomain(host, domain));
}

// ---------------------------------------------------------------------------
// 구글 중계 주소 → 원문 주소 (비공식 방법. 언론사 RSS가 없는 곳에만 쓴다)
// ---------------------------------------------------------------------------

async function resolveGoogleLink(link: string): Promise<string> {
  let id: string;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.hostname !== "news.google.com") throw new Error();
    id = url.pathname.split("/").pop() ?? "";
    if (!/^[\w-]+$/.test(id)) throw new Error();
  } catch {
    throw new BodyError("원문 주소를 알아내지 못했습니다");
  }

  const headers = { "User-Agent": USER_AGENT };
  const page = await (
    await fetch(`https://news.google.com/articles/${id}?hl=ko&gl=KR&ceid=KR:ko`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  ).text();
  const signature = /data-n-a-sg="([^"]+)"/.exec(page)?.[1];
  const timestamp = /data-n-a-ts="([^"]+)"/.exec(page)?.[1];
  if (!signature || !timestamp) throw new BodyError("원문 주소를 알아내지 못했습니다");

  const inner = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature,
  ]);
  const body = `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`;
  const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();

  // 응답은 ")]}'" 뒤에 글자 수와 JSON 조각이 여러 줄 이어지고, 그 조각 안에 한 번 더 JSON 글자가 들어 있다.
  // 그래서 전체를 한 번에 읽지 않고, 우리가 찾는 줄만 꺼내서 두 번 풀어 읽는다.
  try {
    const wrapped = /\["wrb\.fr","Fbv4je","((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
    if (wrapped) {
      const result = JSON.parse(JSON.parse(`"${wrapped}"`)) as unknown[];
      const resolved = String(result[1]);
      if (result[0] === "garturlres" && resolved.startsWith("https://")) return resolved;
    }
  } catch {
    // 아래에서 같은 실패로 처리한다
  }
  throw new BodyError("원문 주소를 알아내지 못했습니다");
}

// ---------------------------------------------------------------------------
// 본문 읽기
// ---------------------------------------------------------------------------

/** 응답을 최대 크기까지만 읽는다. 넘으면 읽기를 멈추고 실패로 본다 */
async function readLimited(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new BodyError("본문이 비어 있습니다");

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new BodyError("페이지가 너무 커서 읽지 않았습니다");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** 글자 인코딩을 헤더나 페이지 앞부분에서 찾아 글자로 바꾼다 (기본은 UTF-8) */
function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** 허용된 주소만, 이동도 최대 3번까지(이동할 때마다 다시 검사)로 페이지를 가져온다 */
async function fetchHtml(startUrl: string, domains: string[]): Promise<string> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(current, domains)) throw new BodyError("지정 언론사 주소가 아니어서 읽지 않았습니다");

    const response = await fetch(current, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new BodyError("페이지 이동 정보가 없습니다");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new BodyError(`언론사가 오류 코드 ${response.status}로 응답했습니다`);

    const contentType = response.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) throw new BodyError("기사 페이지가 아닙니다");
    return decodeHtml(await readLimited(response), contentType);
  }
  throw new BodyError("페이지가 너무 많이 이동해서 읽지 않았습니다");
}

/** 페이지에서 광고·메뉴를 빼고 본문 글자만 꺼낸다 */
function extractText(html: string): string {
  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as Document, { charThreshold: MIN_BODY_CHARS }).parse();
  const text = (parsed?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.slice(0, MAX_BODY_CHARS);
}

/**
 * 본문을 읽을 방법이 있는 기사인지 본다.
 * 언론사 RSS로 받은 기사(원문 주소)는 읽을 수 있고, 구글 중계 주소 기사는 설정에서 허용한 언론사만 읽을 수 있다.
 */
function canReadBody(article: DesignatedArticle): boolean {
  if (article.linkKind === "direct") return true;
  return PRESS.find((press) => press.name === article.press)?.resolveGoogleLink === true;
}

/** 구글에 요청하지 않고, 제목과 링크만 보여 주기로 한 기사 */
function unreadable(article: DesignatedArticle): BriefingArticle {
  return { ...article, bodyStatus: "failed", bodyNote: "구글 검색으로 찾은 기사라 원문 주소를 바로 알 수 없어 제목만 표시합니다" };
}

/** 기사 한 건의 본문을 읽는다. 실패해도 오류를 던지지 않고 이유를 돌려준다 */
export async function readArticleBody(article: DesignatedArticle): Promise<BriefingArticle> {
  if (!canReadBody(article)) return unreadable(article);

  const domains = PRESS.find((press) => press.name === article.press)?.domains ?? [];
  try {
    // 구글 주소 변환은 구글에 가는 요청이라 더 오래(1시간) 보관하고, 본문은 30분 보관한다. 실패한 결과는 보관하지 않는다
    const originalUrl =
      article.linkKind === "google"
        ? await cached(`resolve:${article.link}`, RESOLVE_CACHE_MS, () => resolveGoogleLink(article.link))
        : article.link;
    const body = await cached(`body:${originalUrl}`, BODY_CACHE_MS, async () => {
      const text = extractText(await fetchHtml(originalUrl, domains));
      if (text.length < MIN_BODY_CHARS) {
        throw new BodyError("본문을 충분히 읽지 못했습니다 (유료 기사이거나 로그인이 필요할 수 있습니다)");
      }
      return text;
    });
    return { ...article, bodyStatus: "ok", body, originalUrl };
  } catch (error) {
    const note =
      error instanceof BodyError
        ? error.message
        : error instanceof Error && error.name === "TimeoutError"
          ? `${REQUEST_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다`
          : "본문을 읽는 중 오류가 발생했습니다";
    return { ...article, bodyStatus: "failed", bodyNote: note };
  }
}

/** 동시에 limit건씩만 처리하면서, 순서를 지켜 결과를 돌려준다 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 기사 목록에서 최대 20건을 골라 본문을 읽고, 나머지는 제목만 남긴 채 돌려준다.
 * 읽기에 실패해도 다른 기사로 채우지 않는다.
 */
export async function attachBodies(articles: DesignatedArticle[]): Promise<BriefingArticle[]> {
  // 본문을 읽을 방법이 없는 기사(구글 변환을 허용하지 않은 언론사)는 20건 자리를 차지하지 않게 먼저 뺀다
  const readable = articles.filter((article) => canReadBody(article));
  const selected = selectForBody(readable);
  const selectedLinks = new Set(selected.map((article) => article.link));

  const withBodies = await mapWithConcurrency(selected, CONCURRENCY, readArticleBody);
  const bodyByLink = new Map(withBodies.map((article) => [article.link, article]));

  // 원래 순서(최신순)를 그대로 지키고, 선택되지 않은 기사는 제목만 표시한다
  return articles.map((article) => {
    if (!canReadBody(article)) return unreadable(article);
    return selectedLinks.has(article.link)
      ? (bodyByLink.get(article.link) as BriefingArticle)
      : { ...article, bodyStatus: "not-selected" as const };
  });
}
