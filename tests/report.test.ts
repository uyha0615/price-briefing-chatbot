// 요약 보고서 검사(lib/report.ts) 테스트: AI가 쓴 문단에 근거 없는 숫자·주소가 있으면 "확인 필요"로 표시하는지 확인한다.
import { describe, expect, it } from "vitest";
import { checkReportSections, type ReportSectionInput } from "@/lib/report";

const inputs: ReportSectionInput[] = [
  {
    id: 0,
    heading: "석유류",
    items: [{ press: "뉴시스", title: "국제유가 상승", summary: "국제유가가 배럴당 106달러로 올랐다.", importance: "주의" }],
  },
  {
    id: 1,
    heading: "농축수산물",
    items: [{ press: "연합뉴스", title: "계란 가격", summary: "계란 가격이 7,000원이다.", importance: "참고" }],
  },
];

describe("checkReportSections", () => {
  it("근거 요약에 있는 숫자만 쓰면 통과한다", () => {
    const [section] = checkReportSections({ sections: [{ id: 0, text: "국제유가가 배럴당 106달러로 올랐다." }] }, inputs);
    expect(section.needsCheck).toBe(false);
  });

  it("근거에 없는 숫자가 있으면 확인 필요로 표시한다", () => {
    const [section] = checkReportSections({ sections: [{ id: 0, text: "국제유가가 배럴당 150달러까지 올랐다." }] }, inputs);
    expect(section.needsCheck).toBe(true);
    expect(section.reasons.join()).toContain("150");
  });

  it("다른 구역의 숫자를 빌려 써도 확인 필요로 표시한다", () => {
    const [section] = checkReportSections({ sections: [{ id: 0, text: "국제유가가 올랐고 계란은 7000원이다." }] }, inputs);
    expect(section.needsCheck).toBe(true);
  });

  it("주소가 들어 있으면 확인 필요로 표시한다", () => {
    const [section] = checkReportSections({ sections: [{ id: 1, text: "자세한 내용은 https://evil.com 에서 볼 수 있다." }] }, inputs);
    expect(section.needsCheck).toBe(true);
  });

  it("없는 구역 번호·중복 답·빈 글은 버린다", () => {
    const result = checkReportSections(
      {
        sections: [
          { id: 99, text: "없는 구역" },
          { id: 0, text: "   " },
          { id: 1, text: "계란 가격이 7,000원이다." },
          { id: 1, text: "중복 답" },
        ],
      },
      inputs,
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].text).toBe("계란 가격이 7,000원이다.");
  });
});
