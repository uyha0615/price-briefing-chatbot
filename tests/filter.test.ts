// 수집 거르기(lib/filter.ts) 테스트: 지정 언론사 판별, 가짜 주소 차단, 기간 필터, 키워드 분류를 확인한다.
import { describe, expect, it } from "vitest";
import { classifyTitle, findPress, hostMatchesDomain, keepRecent } from "@/lib/filter";
import { findFailedPresses } from "@/lib/rss";

describe("hostMatchesDomain", () => {
  it("같은 도메인과 하위 주소는 통과한다", () => {
    expect(hostMatchesDomain("chosun.com", "chosun.com")).toBe(true);
    expect(hostMatchesDomain("www.chosun.com", "chosun.com")).toBe(true);
  });
  it("가짜 주소(앞뒤에 붙인 주소)는 막는다", () => {
    expect(hostMatchesDomain("chosun.com.evil.com", "chosun.com")).toBe(false);
    expect(hostMatchesDomain("evilchosun.com", "chosun.com")).toBe(false);
  });
});

describe("findPress", () => {
  it("지정 언론사 주소면 정식 이름을 돌려준다", () => {
    expect(findPress({ sourceUrl: "https://www.chosun.com", sourceName: "아무이름" })).toBe("조선일보");
  });
  it("지정 언론사가 아니면 undefined다", () => {
    expect(findPress({ sourceUrl: "https://random-blog.example.com", sourceName: "조선일보" })).toBeUndefined();
  });
  it("이름만 같고 주소가 다른 가짜 매체는 주소로 걸러낸다", () => {
    expect(findPress({ sourceUrl: "https://chosun.com.evil.com", sourceName: "조선일보" })).toBeUndefined();
  });
});

describe("classifyTitle", () => {
  it("물가와 무관한 제목은 분류하지 않는다", () => {
    expect(classifyTitle("인기 가수 새 앨범 발표")).toBeUndefined();
  });
  it("유가증권시장 소식은 석유류(유가)로 잘못 분류하지 않는다", () => {
    expect(classifyTitle("유가증권시장 마감")?.category).not.toBe("석유류");
  });
  it("'이유가'처럼 글자만 겹치는 기사는 유가 기사로 잡지 않는다 (택일 출산 기사 사례)", () => {
    expect(classifyTitle("\"제왕절개 늘어난 이유가 사주?\"…날짜·시간까지 맞추는 ‘택일 출산’")).toBeUndefined();
  });
  it("국제유가·고유가·저유가처럼 진짜 유가 기사는 석유류로 분류한다", () => {
    expect(classifyTitle("국제유가 급등")?.category).toBe("석유류");
    expect(classifyTitle("고유가에 서민 부담")?.category).toBe("석유류");
    expect(classifyTitle("유가 하락세 이어져")?.category).toBe("석유류");
  });
  it("휘발유 가격 기사는 석유류로 분류한다", () => {
    expect(classifyTitle("휘발유 가격 5주 연속 하락")?.category).toBe("석유류");
  });
});

describe("findFailedPresses (RSS가 막힌 언론사 찾기)", () => {
  it("모든 RSS가 실패한 언론사만 돌려준다", () => {
    expect(
      findFailedPresses([
        { press: "한국경제", ok: false },
        { press: "한국경제", ok: false },
        { press: "조선일보", ok: true },
      ]),
    ).toEqual(["한국경제"]);
  });
  it("RSS가 하나라도 성공한 언론사는 실패로 보지 않는다", () => {
    expect(
      findFailedPresses([
        { press: "연합뉴스", ok: false },
        { press: "연합뉴스", ok: true },
      ]),
    ).toEqual([]);
  });
});

describe("keepRecent", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const at = (hoursAgo: number) => ({ publishedAt: new Date(now - hoursAgo * 3600_000).toISOString() });

  it("기간 안의 기사만 남긴다 (24시간)", () => {
    expect(keepRecent([at(1), at(23), at(25)], now, 24)).toHaveLength(2);
  });
  it("선택한 기간을 따른다 (6시간)", () => {
    expect(keepRecent([at(1), at(7)], now, 6)).toHaveLength(1);
  });
  it("미래 시각 기사는 시계 오차(5분) 안에서만 허용한다", () => {
    expect(keepRecent([at(-0.05)], now, 24)).toHaveLength(1);
    expect(keepRecent([at(-1)], now, 24)).toHaveLength(0);
  });
  it("날짜를 읽을 수 없는 기사는 뺀다", () => {
    expect(keepRecent([{ publishedAt: "날짜아님" }], now, 24)).toHaveLength(0);
  });
});
