// 물가 동향 API. 요약이 끝난 기사의 번호·제목·요약을 받아 품목·지표별 오르내림을 돌려준다.
// 보안: 받은 값을 믿지 않고 모양과 길이를 먼저 검사한다. 링크와 본문은 받지 않는다.
import { z } from "zod";
import { extractTrends, type TrendRow } from "@/lib/trend";
import type { ApiResult } from "@/lib/types";

export const maxDuration = 60;

const MAX_ITEMS = 60;
const MAX_REQUEST_CHARS = MAX_ITEMS * 1200 + 2000;

const requestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().min(0).max(10_000),
        title: z.string().trim().min(1).max(300),
        summary: z.string().trim().min(1).max(800),
      }),
    )
    .max(MAX_ITEMS),
});

function fail(message: string, status: number): Response {
  const body: ApiResult<TrendRow[]> = { ok: false, message };
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
  if (!parsed.success) return fail("요청 값이 올바르지 않습니다.", 400);

  const outcome = await extractTrends(parsed.data.items);
  if (!outcome.ok) return fail(outcome.message, 502);

  const body: ApiResult<TrendRow[]> = { ok: true, data: outcome.trends };
  return Response.json(body);
}
