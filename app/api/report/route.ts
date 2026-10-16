// 간단 요약 보고서 API. 구역(분야·검색어)별 기사 요약을 받아 구역마다 합친 문단을 돌려준다.
// 보안: 받은 값을 믿지 않고 모양과 길이를 먼저 검사한다. 링크와 본문은 받지 않는다.
import { z } from "zod";
import { writeReport, type ReportSectionResult } from "@/lib/report";
import type { ApiResult } from "@/lib/types";

export const maxDuration = 60;

const MAX_SECTIONS = 10;
const MAX_ITEMS_TOTAL = 60;
const MAX_REQUEST_CHARS = MAX_ITEMS_TOTAL * 1500 + 5000;

const requestSchema = z.object({
  sections: z
    .array(
      z.object({
        id: z.number().int().min(0).max(100),
        heading: z.string().trim().min(1).max(60),
        items: z
          .array(
            z.object({
              press: z.string().trim().min(1).max(40),
              title: z.string().trim().min(1).max(300),
              summary: z.string().trim().min(1).max(800),
              importance: z.enum(["긴급", "주의", "참고"]),
              topic: z.string().trim().max(40).optional(),
            }),
          )
          .min(1)
          .max(MAX_ITEMS_TOTAL),
      }),
    )
    .min(1)
    .max(MAX_SECTIONS),
});

function fail(message: string, status: number): Response {
  const body: ApiResult<ReportSectionResult[]> = { ok: false, message };
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
  const total = parsed.data.sections.reduce((sum, section) => sum + section.items.length, 0);
  if (total > MAX_ITEMS_TOTAL) return fail("기사가 너무 많습니다.", 400);

  const outcome = await writeReport(parsed.data.sections);
  if (!outcome.ok) return fail(outcome.message, 502);

  const body: ApiResult<ReportSectionResult[]> = { ok: true, data: outcome.sections };
  return Response.json(body);
}
