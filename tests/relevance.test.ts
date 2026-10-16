// 제목 관련성 판단(lib/relevance.ts) 테스트: AI의 답이 이상해도 함부로 기사를 빼지 않는지 확인한다.
import { describe, expect, it } from "vitest";
import { pickIrrelevant } from "@/lib/relevance";

describe("pickIrrelevant", () => {
  const valid = new Set([0, 1, 2, 3]);

  it("관련 없음(false)으로 판단한 번호만 돌려준다", () => {
    const result = pickIrrelevant({ items: [{ id: 0, relevant: true }, { id: 1, relevant: false }, { id: 2, relevant: true }] }, valid);
    expect(result).toEqual([1]);
  });

  it("답이 빠진 기사는 관련 있는 것으로 두어 빼지 않는다", () => {
    const result = pickIrrelevant({ items: [{ id: 1, relevant: false }] }, valid);
    expect(result).toEqual([1]); // 0, 2, 3은 답이 없으니 남는다
  });

  it("없는 번호는 버린다", () => {
    expect(pickIrrelevant({ items: [{ id: 99, relevant: false }] }, valid)).toEqual([]);
  });

  it("같은 번호가 여러 번 와도 한 번만 돌려준다", () => {
    expect(pickIrrelevant({ items: [{ id: 2, relevant: false }, { id: 2, relevant: false }] }, valid)).toEqual([2]);
  });
});
