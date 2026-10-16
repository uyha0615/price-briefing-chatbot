// Design Ref: DESIGN §3.1(B) — 요약 API. 기사 한 건을 받아 요약을 돌려준다.
// 보안: DESIGN §6 — 받은 값을 믿지 않고 모양·길이·언론사를 먼저 검사한다.
// 링크는 요약에 필요 없어서 받지 않는다 (받는 값을 줄일수록 안전하다).
import { z } from "zod";
import { MAX_BODY_CHARS } from "@/lib/article-body";
import { PRESS } from "@/lib/config";
import { summarizeArticle } from "@/lib/summarize";
import type { ApiResult, SummaryResult } from "@/lib/types";

// 요약 요청은 AI 응답을 기다리므로 최대 실행 시간을 넉넉히 둔다(초). 배포할 때 Vercel 한도를 확인해 다시 정한다.
export const maxDuration = 60;

/** 요청 전체의 최대 크기(글자). 본문 최대 길이에 여유를 더한 값 */
const MAX_REQUEST_CHARS = MAX_BODY_CHARS * 4 + 2000;

const requestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  press: z.string().refine((name) => PRESS.some((press) => press.name === name), "지정 언론사가 아닙니다"),
  body: z.string().trim().min(200).max(MAX_BODY_CHARS),
});

function fail(message: string, status: number): Response {
  const body: ApiResult<SummaryResult> = { ok: false, message };
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_REQUEST_CHARS) return fail("요청이 너무 큽니다.", 413);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("요청 형식이 올바르지 않습니다.", 400);
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "요청")))].join(", ");
    return fail(`요청 값이 올바르지 않습니다 (${fields}).`, 400);
  }

  const outcome = await summarizeArticle(parsed.data);
  if (!outcome.ok) return fail(outcome.message, 502);

  const body: ApiResult<SummaryResult> = { ok: true, data: outcome.result };
  return Response.json(body);
}
