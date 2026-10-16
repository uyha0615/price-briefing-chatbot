// 요약 검증(lib/verify.ts) 테스트: "기사에 없는 숫자를 쓰지 않는다"는 핵심 약속을 지키는지 확인한다.
import { describe, expect, it } from "vitest";
import { checkSummary, containsLinkOrMarkup, countSentences, extractNumbers, findUnsupportedNumbers } from "@/lib/verify";

describe("extractNumbers", () => {
  it("쉼표를 뺀 숫자만 뽑는다", () => {
    expect(extractNumbers("1,464원, 3.5% 상승")).toEqual(["1464", "3.5"]);
  });
  it("숫자가 없으면 빈 목록이다", () => {
    expect(extractNumbers("가격이 올랐다")).toEqual([]);
  });
});

describe("findUnsupportedNumbers", () => {
  it("본문에 없는 숫자를 찾아낸다", () => {
    expect(findUnsupportedNumbers("가격이 120원 올랐다.", "가격은 100원이다.")).toEqual(["120"]);
  });
  it("본문에 있는 숫자는 통과시킨다", () => {
    expect(findUnsupportedNumbers("가격이 1,464원이다.", "가격은 1464원으로 집계됐다.")).toEqual([]);
  });
});

describe("containsLinkOrMarkup", () => {
  it("주소·HTML·마크다운 링크를 잡아낸다", () => {
    expect(containsLinkOrMarkup("자세히는 https://example.com 참고")).toBe(true);
    expect(containsLinkOrMarkup("<b>굵게</b>")).toBe(true);
    expect(containsLinkOrMarkup("[기사](https://a.com)")).toBe(true);
  });
  it("평범한 문장은 통과시킨다", () => {
    expect(containsLinkOrMarkup("계란 가격이 올랐다.")).toBe(false);
  });
});

describe("countSentences", () => {
  it("마침표 기준으로 문장 수를 센다", () => {
    expect(countSentences("하나. 둘. 셋. 넷.")).toBe(4);
  });
  it("내용이 있으면 최소 1문장이다", () => {
    expect(countSentences("마침표 없는 글")).toBe(1);
    expect(countSentences("   ")).toBe(0);
  });
});

describe("checkSummary", () => {
  it("모두 지키면 통과한다", () => {
    const result = checkSummary("계란 가격이 7,000원이다. 지난달보다 올랐다.", "계란 가격은 7000원으로 지난달보다 올랐다.");
    expect(result.passed).toBe(true);
  });
  it("없는 숫자가 있으면 실패한다", () => {
    expect(checkSummary("가격이 9999원이다.", "가격은 100원이다.").passed).toBe(false);
  });
  it("3문장을 넘으면 실패한다", () => {
    expect(checkSummary("가. 나. 다. 라.", "본문").passed).toBe(false);
  });
});
