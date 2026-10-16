// 보안 검사와 "AI의 답을 믿지 않는 장치" 테스트.
// 외부 주소를 읽어 올 때의 안전 규칙, 본문 읽을 기사 고르기, AI가 이상한 답을 줘도 걸러내는지를 확인한다.
import { describe, expect, it } from "vitest";
import { isAllowedUrl, MAX_BODY_ARTICLES, selectForBody } from "@/lib/article-body";
import { cleanGroups } from "@/lib/group";
import { cleanTrends } from "@/lib/trend";
import type { DesignatedArticle } from "@/lib/types";

describe("isAllowedUrl (외부 주소 읽기 안전 규칙)", () => {
  const domains = ["chosun.com"];
  it("https이고 허용 도메인이면 통과한다", () => {
    expect(isAllowedUrl("https://www.chosun.com/article/1", domains)).toBe(true);
    expect(isAllowedUrl("https://chosun.com:443/a", domains)).toBe(true);
  });
  it("http는 막는다", () => {
    expect(isAllowedUrl("http://www.chosun.com/a", domains)).toBe(false);
  });
  it("허용 목록 밖의 주소와 가짜 주소를 막는다", () => {
    expect(isAllowedUrl("https://example.com/a", domains)).toBe(false);
    expect(isAllowedUrl("https://chosun.com.evil.com/a", domains)).toBe(false);
  });
  it("사용자 이름·비밀번호나 특수 포트가 든 주소를 막는다", () => {
    expect(isAllowedUrl("https://user:pw@chosun.com/a", domains)).toBe(false);
    expect(isAllowedUrl("https://chosun.com:8080/a", domains)).toBe(false);
  });
  it("내부망 주소와 이상한 주소를 막는다", () => {
    expect(isAllowedUrl("https://127.0.0.1/a", domains)).toBe(false);
    expect(isAllowedUrl("javascript:alert(1)", domains)).toBe(false);
    expect(isAllowedUrl("주소아님", domains)).toBe(false);
  });
});

describe("selectForBody (본문 읽을 기사 고르기)", () => {
  function make(count: number, category: DesignatedArticle["category"], custom = false): DesignatedArticle[] {
    return Array.from({ length: count }, (_, i) => ({
      title: `${category}-${custom ? "직접-" : ""}${i}`,
      link: `https://example.com/${category}/${custom}/${i}`,
      linkKind: "direct" as const,
      publishedAt: new Date(Date.UTC(2026, 9, 15, 12, 0) - i * 60_000).toISOString(),
      sourceName: "x",
      sourceUrl: "https://example.com",
      category,
      query: "q",
      press: "조선일보",
      custom: custom || undefined,
    }));
  }

  it("한 번에 최대 20건까지만 고른다", () => {
    const picked = selectForBody([...make(15, "농축수산물"), ...make(15, "석유류"), ...make(15, "기타 물가")]);
    expect(picked).toHaveLength(MAX_BODY_ARTICLES);
  });

  it("분류별로 돌아가며 고르고, 같은 분류에서는 최신 기사부터 고른다", () => {
    const picked = selectForBody([...make(10, "농축수산물"), ...make(10, "석유류")], 4);
    expect(picked.map((p) => p.title)).toEqual(["농축수산물-0", "석유류-0", "농축수산물-1", "석유류-1"]);
  });

  it("직접 검색한 기사가 먼저 자리를 받는다", () => {
    const picked = selectForBody([...make(5, "농축수산물"), ...make(2, "기타 물가", true)], 3);
    expect(picked[0].custom).toBe(true);
    expect(picked.filter((p) => p.custom)).toHaveLength(2);
  });
});

describe("cleanGroups (주제 묶기 답 거르기)", () => {
  it("없는 번호·중복 배정·1건짜리 묶음·이상한 이름을 걸러낸다", () => {
    const result = cleanGroups(
      {
        groups: [
          { topic: "계란 수입", ids: [0, 1] },
          { topic: "겹치는 묶음", ids: [1, 2] }, // 1은 이미 배정돼서 2만 남아 1건 → 제외
          { topic: "혼자", ids: [3] },
          { topic: "<b>태그</b>", ids: [4, 5] },
          { topic: "없는 번호", ids: [98, 99] },
        ],
      },
      new Set([0, 1, 2, 3, 4, 5]),
    );
    expect(result).toEqual([{ topic: "계란 수입", ids: [0, 1] }]);
  });
});

describe("cleanTrends (물가 동향 답 거르기)", () => {
  const inputs = [
    { id: 0, title: "유가", summary: "국제유가가 배럴당 106달러로 상승했다." },
    { id: 1, title: "계란", summary: "계란 가격이 7,000원으로 올랐다." },
  ];

  it("요약에 있는 수치는 그대로 보여 준다", () => {
    const rows = cleanTrends({ trends: [{ name: "국제유가", direction: "상승", figure: "배럴당 106달러", ids: [0] }] }, inputs);
    expect(rows[0].figure).toBe("배럴당 106달러");
  });

  it("요약에 없는 숫자가 든 수치는 지운다 (없는 숫자는 절대 보여 주지 않는다)", () => {
    const rows = cleanTrends({ trends: [{ name: "계란", direction: "상승", figure: "9999원 급등", ids: [1] }] }, inputs);
    expect(rows).toHaveLength(1);
    expect(rows[0].figure).toBe("");
  });

  it("근거 기사가 없는 항목과 이상한 이름은 뺀다", () => {
    const rows = cleanTrends(
      {
        trends: [
          { name: "허위 항목", direction: "상승", figure: "", ids: [42] },
          { name: "<script>", direction: "하락", figure: "", ids: [0] },
        ],
      },
      inputs,
    );
    expect(rows).toEqual([]);
  });

  it("물가 품목이 아닌 항목(주가·환율·금리·금값·메모리 등)은 AI가 뽑아도 뺀다", () => {
    const rows = cleanTrends(
      {
        trends: [
          { name: "코스피", direction: "하락", figure: "", ids: [0] },
          { name: "원·달러 환율", direction: "상승", figure: "", ids: [0] },
          { name: "기준금리", direction: "보합", figure: "", ids: [0] },
          { name: "국제 금값", direction: "상승", figure: "", ids: [0] },
          { name: "메모리가격", direction: "상승", figure: "", ids: [0] },
          { name: "국제유가", direction: "상승", figure: "배럴당 106달러", ids: [0] },
          { name: "계란", direction: "상승", figure: "", ids: [1] },
        ],
      },
      inputs,
    );
    expect(rows.map((row) => row.name)).toEqual(["국제유가", "계란"]);
  });

  it("주소가 든 수치는 지운다", () => {
    const rows = cleanTrends({ trends: [{ name: "계란", direction: "상승", figure: "https://evil.com", ids: [1] }] }, inputs);
    expect(rows[0].figure).toBe("");
  });
});
