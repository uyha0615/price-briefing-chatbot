// Design Ref: DESIGN §3.1(A) — 수집 API. 가져오기 → 거르기 → 중복 합치기 → 본문 읽기까지 한다.
import { collectBriefingArticles } from "@/lib/collect";
import { DEFAULT_PERIOD_HOURS, parsePeriodHours } from "@/lib/config";
import { parseCustomKeywords } from "@/lib/keywords";
import type { ApiResult, CollectResult } from "@/lib/types";

// 기사 20건의 본문까지 읽으면 시간이 걸릴 수 있어 최대 실행 시간을 넉넉히 둔다(초).
// 배포할 때는 Vercel의 실제 시간 한도를 확인해서 다시 정한다.
export const maxDuration = 60;

function fail(message: string, status: number): Response {
  const body: ApiResult<CollectResult> = { ok: false, message };
  return Response.json(body, { status });
}

// 네트워크로 최신 기사를 가져오므로 요청이 올 때마다 실행된다.
// 받는 값(모두 화면에서 온 값이라 믿지 않고 검사한다):
//  - hours: 기사 기간. 허용된 값(6·12·24·48·72)만 쓴다.
//  - keywords: 인턴이 직접 입력한 검색어(쉼표로 구분, 최대 3개). 글자·숫자·공백만 허용한다.
//  - only: "1"이면 고정 검색어는 빼고 직접 입력한 검색어로만 찾는다 (검색어가 있을 때만 의미가 있다).
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const hoursParam = params.get("hours");
  const hours = hoursParam === null ? DEFAULT_PERIOD_HOURS : parsePeriodHours(hoursParam);
  if (hours === undefined) return fail("기사 기간 값이 올바르지 않습니다.", 400);

  const keywordResult = parseCustomKeywords(params.get("keywords") ?? "");
  if (!keywordResult.ok) return fail(keywordResult.message, 400);
  const customKeywords = keywordResult.keywords;

  const includeFixed = !(params.get("only") === "1" && customKeywords.length > 0);

  const result = await collectBriefingArticles(hours, { customKeywords, includeFixed });

  // 구글에서 한 건도 가져오지 못했을 때만 실패로 알린다 (일부 검색어만 실패하면 나머지로 계속 진행)
  if (result.counts.fetched === 0 && result.failedQueries.length > 0) {
    return fail("구글 뉴스에서 기사를 가져오지 못했습니다.", 502);
  }

  // 가져오기는 됐는데 조건에 맞는 기사가 없으면, 그 사실을 그대로 알린다 (빈 목록과 함께 성공으로 응답)
  const body: ApiResult<CollectResult> = { ok: true, data: result };
  return Response.json(body);
}
