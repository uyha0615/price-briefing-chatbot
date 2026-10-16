// 중복 제거(lib/dedupe.ts) 테스트: 같은 기사는 합치고, 다른 기사는 남기는지 확인한다.
import { describe, expect, it } from "vitest";
import { dedupeArticles, titleSimilarity } from "@/lib/dedupe";

describe("titleSimilarity", () => {
  it("같은 제목은 1이다 (기호·공백 차이는 무시)", () => {
    expect(titleSimilarity("계란값 7000원 돌파…서민 부담", "계란값 7000원 돌파 서민 부담")).toBe(1);
  });
  it("전혀 다른 제목은 낮다", () => {
    expect(titleSimilarity("휘발유 가격 하락", "한우 경매 결과 발표")).toBeLessThan(0.3);
  });
  it("빈 제목은 0이다", () => {
    expect(titleSimilarity("", "물가")).toBe(0);
  });
});

describe("dedupeArticles", () => {
  type Item = { title: string; publishedAt: string; linkKind: string; custom?: boolean };
  const a: Item = { title: "계란값 7000원 돌파 서민 부담 커져", publishedAt: "2026-10-15T01:00:00Z", linkKind: "direct" };
  const b: Item = { title: "계란값 7000원 돌파…서민 부담 커져", publishedAt: "2026-10-15T03:00:00Z", linkKind: "direct" };
  const other: Item = { title: "휘발유 가격 5주 연속 하락", publishedAt: "2026-10-15T02:00:00Z", linkKind: "direct" };

  it("같은 기사는 먼저 발행된 쪽만 남긴다", () => {
    const result = dedupeArticles([b, a]);
    expect(result.articles).toEqual([a]);
    expect(result.mergedCount).toBe(1);
  });

  it("다른 기사는 둘 다 남기고 최신순으로 정렬한다", () => {
    const result = dedupeArticles([a, other]);
    expect(result.articles).toEqual([other, a]);
    expect(result.mergedCount).toBe(0);
  });

  it("구글 중계 주소와 원문 주소가 겹치면 원문 주소 쪽을 남긴다", () => {
    const google = { ...a, linkKind: "google" };
    const direct = { ...b, linkKind: "direct" };
    expect(dedupeArticles([google, direct]).articles).toEqual([direct]);
  });

  it("직접 검색 표시(custom)를 잃지 않는다", () => {
    const custom = { ...b, custom: true };
    const result = dedupeArticles([a, custom]);
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].custom).toBe(true);
  });
});
