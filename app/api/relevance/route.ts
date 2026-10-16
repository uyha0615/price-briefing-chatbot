// 제목 관련성 API. 본문 없이 제목만 있는 기사 목록을 받아 물가와 확실히 무관한 기사의 번호를 돌려준다.
// 보안: 받은 값을 믿지 않고 모양과 길이를 먼저 검사한다. 링크와 본문은 받지 않는다.
import { z } from "zod";
import { checkTitleRelevance } from "@/lib/relevance";
import type { ApiResult } from "@/lib/types";

export const maxDuration = 60;

const MAX_ITEMS = 80;
const MAX_REQUEST_CHARS = MAX_ITEMS * 500 + 2000;

const requestSchema = z.object({
  items: z
    .array(z.object({ id: z.number().int().min(0).max(10_000), title: z.string().trim().min(1).max(300) }))
    .max(MAX_ITEMS),
});

function fail(message: string, status: number): Response {
  const body: ApiResult<number[]> = { ok: false, message };
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

  const outcome = await checkTitleRelevance(parsed.data.items);
  if (!outcome.ok) return fail(outcome.message, 502);

  const body: ApiResult<number[]> = { ok: true, data: outcome.irrelevantIds };
  return Response.json(body);
}
