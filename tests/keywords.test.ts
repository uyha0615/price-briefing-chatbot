// 직접 검색어(lib/keywords.ts) 테스트: 입력 검사와 "유가 → 유가족" 같은 엉뚱한 기사 걸러내기를 확인한다.
import { describe, expect, it } from "vitest";
import { isExcludedOnly, parseCustomKeywords, titleMatches } from "@/lib/keywords";

const 유가 = { word: "유가", excludes: ["유가족", "유가증권"] };

describe("parseCustomKeywords", () => {
  it("비어 있으면 검색어 없음으로 본다", () => {
    expect(parseCustomKeywords("")).toEqual({ ok: true, keywords: [], normalized: "" });
  });

  it("쉼표로 나누고 -단어는 제외 단어로 읽는다", () => {
    const result = parseCustomKeywords("유가 -유가족, 쌀값");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords.map((k) => k.word)).toEqual(["유가", "쌀값"]);
    expect(result.keywords[0].excludes).toContain("유가족");
  });

  it("'유가'에는 따로 입력하지 않아도 유가족·유가증권이 기본으로 빠진다", () => {
    const result = parseCustomKeywords("유가");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords[0].excludes).toEqual(expect.arrayContaining(["유가족", "유가증권"]));
  });

  it("찾을 말 없이 제외 단어만 있으면 거절한다", () => {
    expect(parseCustomKeywords("-유가족").ok).toBe(false);
  });

  it("검색어는 최대 3개다", () => {
    expect(parseCustomKeywords("가격, 물가, 쌀값, 계란").ok).toBe(false);
  });

  it("너무 짧거나 긴 검색어를 거절한다", () => {
    expect(parseCustomKeywords("a").ok).toBe(false);
    expect(parseCustomKeywords("가".repeat(21)).ok).toBe(false);
  });

  it("주소나 특수 기호가 든 검색어를 거절한다", () => {
    expect(parseCustomKeywords("http://evil.com").ok).toBe(false);
    expect(parseCustomKeywords("<script>").ok).toBe(false);
  });
});

describe("titleMatches / isExcludedOnly", () => {
  it("유가족만 나오는 기사는 '유가' 검색에서 뺀다", () => {
    expect(titleMatches("참사 유가족과 합의", 유가)).toBe(false);
    expect(isExcludedOnly("참사 유가족과 합의", 유가)).toBe(true);
  });

  it("유가증권만 나오는 기사도 뺀다", () => {
    expect(titleMatches("유가증권시장 매도 사이드카", 유가)).toBe(false);
  });

  it("'이유가'만 나오는 기사는 '유가' 직접 검색에서 뺀다", () => {
    const 기본 = parseCustomKeywords("유가");
    expect(기본.ok).toBe(true);
    if (!기본.ok) return;
    expect(titleMatches("늘어난 이유가 사주?…택일 출산", 기본.keywords[0])).toBe(false);
    expect(titleMatches("국제유가 급등", 기본.keywords[0])).toBe(true);
  });

  it("진짜 유가 기사는 남긴다", () => {
    expect(titleMatches("국제유가 급등", 유가)).toBe(true);
    expect(isExcludedOnly("국제유가 급등", 유가)).toBe(false);
  });

  it("진짜 유가 기사가 유가족을 함께 언급해도 남긴다", () => {
    expect(titleMatches("국제유가 급등…유가족 지원도 논의", 유가)).toBe(true);
  });

  it("제외 단어가 없는 관련 없는 제목은 구글 결과를 함부로 빼지 않는다", () => {
    expect(isExcludedOnly("에너지 시장 동향", 유가)).toBe(false);
  });
});
