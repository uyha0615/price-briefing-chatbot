"use client";

// Design Ref: DESIGN §2 — ②실행 영역, ③안내 띠, ④브리핑 영역, ⑤도구 줄(복사)을 한 부품에 모은다.
// Plan SC: PLAN 3·10·11·12·13번 — 버튼 한 번으로 수집 → 요약 → 분류별 브리핑, 직접 수정, 예외 안내, 복사.
import { useMemo, useState } from "react";
import {
  CATEGORIES,
  DEFAULT_PERIOD_HOURS,
  IMPORTANCE_LEVELS,
  PERIOD_HOURS,
  type Category,
  type Importance,
  type PeriodHours,
} from "@/lib/config";
import { parseCustomKeywords } from "@/lib/keywords";
import type { TrendRow } from "@/lib/trend";
import type { ApiResult, BriefingArticle, CollectResult, SummaryResult } from "@/lib/types";

/** 요약 글 합계 분량 기준 (A4 2장 ≈ 3,500자, 출처 줄 제외) */
const MAX_SUMMARY_CHARS = 3500;
/** 요약을 동시에 몇 건씩 요청할지 */
const SUMMARY_CONCURRENCY = 3;

type Phase = "idle" | "collecting" | "summarizing" | "grouping" | "done";
type ItemStatus = "pending" | "summarizing" | "done" | "failed";

interface Item {
  article: BriefingArticle;
  status: ItemStatus;
  summary?: SummaryResult;
  /** 인턴이 고친 요약. 없으면 AI가 쓴 요약을 그대로 쓴다 */
  edited?: string;
  /** 인턴이 바꾼 중요도. 없으면 AI가 정한 중요도를 그대로 쓴다 */
  importanceEdited?: Importance;
  /** 요약에 실패한 이유 (화면에 보여 줘도 되는 문장) */
  error?: string;
}

/** 링크는 https일 때만 연결한다 (javascript: 같은 주소가 끼어드는 것을 막는다) */
function safeHref(url: string | undefined): string | undefined {
  return url && url.startsWith("https://") ? url : undefined;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function textOf(item: Item): string {
  return item.edited ?? item.summary?.summary ?? "";
}

function importanceOf(item: Item): Importance {
  return item.importanceEdited ?? item.summary?.importance ?? "참고";
}

/** 중요도 표시 색: 긴급은 붉게, 주의는 노랗게, 참고는 파랗게 (색만으로 구분하지 않고 글자도 함께 쓴다) */
const IMPORTANCE_STYLE: Record<Importance, string> = {
  긴급: "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-200",
  주의: "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  참고: "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100",
};

const DIRECTION_MARK: Record<TrendRow["direction"], string> = { 상승: "▲", 하락: "▼", 보합: "―", 엇갈림: "◆" };
/** 오름은 붉게, 내림은 파랗게(색과 함께 ▲▼ 기호와 글자도 같이 써서 색만으로 구분하지 않는다) */
const DIRECTION_STYLE: Record<TrendRow["direction"], string> = {
  상승: "text-red-700 dark:text-red-300",
  하락: "text-blue-700 dark:text-sky-300",
  보합: "text-zinc-600 dark:text-zinc-300",
  엇갈림: "text-amber-700 dark:text-amber-300",
};

/** 긴급 → 주의 → 참고 순으로 앞에 오게 정렬한다 (같은 중요도끼리는 원래 순서 유지) */
function sortByImportance(list: Item[]): Item[] {
  return [...list].sort((a, b) => IMPORTANCE_LEVELS.indexOf(importanceOf(a)) - IMPORTANCE_LEVELS.indexOf(importanceOf(b)));
}

/** 정해진 수만큼 동시에 일하면서 모든 항목을 처리한다 */
async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = items[next++];
      await work(current);
    }
  });
  await Promise.all(runners);
}

export function BriefingApp() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [copyMessage, setCopyMessage] = useState("");
  /** 간단 요약 보고서 (글은 인턴이 고칠 수 있다). notes는 확인이 필요한 부분 안내 */
  const [report, setReport] = useState<{ text: string; notes: string[] } | null>(null);
  const [reporting, setReporting] = useState(false);
  /** 같은 주제끼리 묶은 결과: 기사 주소 → 묶음 이름 (묶이지 않은 기사는 없다) */
  const [topics, setTopics] = useState<Record<string, string>>({});
  /** 같은 주제로 묶인 기사들이 한 분류 구역에 모이도록 정한 분류: 기사 주소 → 분류 */
  const [categoryOverride, setCategoryOverride] = useState<Record<string, Category>>({});
  /** 제목만 보고 물가와 확실히 무관하다고 판단한 기사: 기사 주소 → true */
  const [irrelevantTitles, setIrrelevantTitles] = useState<Record<string, true>>({});
  /** 품목·지표별 물가 동향 (근거 언론사 이름 포함) */
  const [trends, setTrends] = useState<{ row: TrendRow; presses: string[] }[]>([]);
  /** 인턴이 고른 기사 기간(시간) */
  const [hours, setHours] = useState<PeriodHours>(DEFAULT_PERIOD_HOURS);
  /** 인턴이 직접 입력한 검색어(쉼표로 구분한 글) */
  const [keywordText, setKeywordText] = useState("");
  /** true면 고정 검색어는 빼고 직접 입력한 검색어로만 찾는다 */
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [keywordError, setKeywordError] = useState("");

  const busy = phase === "collecting" || phase === "summarizing" || phase === "grouping";

  /** 항목 하나만 바꾼다 */
  function patchItem(link: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => (item.article.link === link ? { ...item, ...patch } : item)));
  }

  /** sink에는 성공한 요약을 모아 둔다 (끝난 뒤 주제 묶기에 쓴다) */
  async function summarizeOne(item: Item, sink: Map<string, SummaryResult>) {
    const { article } = item;
    patchItem(article.link, { status: "summarizing" });
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: article.title, press: article.press, body: article.body }),
      });
      const result = (await response.json()) as ApiResult<SummaryResult>;
      if (result.ok && !result.data.bodyUsable) {
        // 본문에 기사 내용이 없고 안내 문구만 읽힌 기사: 요약하지 않고 "제목만"으로 다룬다 (관련 낮음으로 빠지지 않게)
        patchItem(article.link, {
          status: "done",
          article: { ...article, bodyStatus: "failed", bodyNote: "본문에서 기사 내용을 확인하지 못했습니다" },
        });
      } else if (result.ok) {
        sink.set(article.link, result.data);
        patchItem(article.link, { status: "done", summary: result.data });
      } else patchItem(article.link, { status: "failed", error: result.message });
    } catch {
      patchItem(article.link, { status: "failed", error: "요약 서비스에 연결하지 못했습니다." });
    }
  }

  async function makeBriefing() {
    // 직접 입력한 검색어를 먼저 검사한다 (서버도 한 번 더 검사한다)
    const parsedKeywords = parseCustomKeywords(keywordText);
    if (!parsedKeywords.ok) {
      setKeywordError(parsedKeywords.message);
      return;
    }
    setKeywordError("");
    const keywords = parsedKeywords.keywords.map((keyword) => keyword.word);
    const query =
      `hours=${hours}` +
      (keywords.length > 0 ? `&keywords=${encodeURIComponent(parsedKeywords.normalized)}` : "") +
      (onlyCustom && keywords.length > 0 ? "&only=1" : "");

    setPhase("collecting");
    setItems([]);
    setNotices([]);
    setCopyMessage("");
    setTopics({});
    setCategoryOverride({});
    setIrrelevantTitles({});
    setTrends([]);
    setReport(null);

    // 1) 기사 수집
    let collected: CollectResult;
    try {
      const response = await fetch(`/api/articles?${query}`);
      const result = (await response.json()) as ApiResult<CollectResult>;
      if (!result.ok) {
        setNotices([`${result.message} 잠시 뒤 다시 눌러 주세요.`]);
        setPhase("idle");
        return;
      }
      collected = result.data;
    } catch {
      setNotices(["서버에 연결하지 못했습니다. 인터넷 연결과 개발 서버를 확인해 주세요."]);
      setPhase("idle");
      return;
    }

    const notes: string[] = [];
    if (collected.failedQueries.length > 0) {
      const names = collected.failedQueries.map((f) => `${f.query}(${f.reason})`).join(", ");
      notes.push(`일부를 가져오지 못했습니다: ${names}. 나머지 결과로 만들었어요.`);
    }
    // 직접 입력한 검색어마다 결과가 있었는지 알려 준다 (없으면 없다고 사실 그대로)
    for (const keyword of keywords) {
      if (!collected.articles.some((a) => a.custom && a.query === keyword)) {
        notes.push(`직접 검색어 "${keyword}"에 해당하는 기사가 최근 ${hours}시간 안에는 없습니다.`);
      }
    }
    if (collected.articles.length === 0) {
      notes.push(`최근 ${hours}시간 동안 지정 언론사의 새 기사가 없습니다. 기간을 더 길게 골라 보세요.`);
      setNotices(notes);
      setPhase("done");
      return;
    }

    const next: Item[] = collected.articles.map((article) => ({
      article,
      status: article.bodyStatus === "ok" ? "pending" : "done",
    }));
    setItems(next);
    setNotices(notes);

    // 2) 본문을 읽은 기사만 요약
    setPhase("summarizing");
    const summaries = new Map<string, SummaryResult>();
    await runPool(
      next.filter((item) => item.article.bodyStatus === "ok"),
      SUMMARY_CONCURRENCY,
      (item) => summarizeOne(item, summaries),
    );

    // 3) 요약이 없는 기사(제목만 있는 기사)는 물가와 확실히 무관한지 제목으로 한 번 거른다. 실패하면 거르지 않고 그대로 둔다.
    // (직접 검색한 기사는 인턴이 일부러 찾은 것이라 거르지 않는다)
    setPhase("grouping");
    const titleChecks = next.filter((item) => !item.article.custom && !summaries.has(item.article.link)).slice(0, 80);
    const irrelevantLinks = new Set<string>();
    if (titleChecks.length > 0) {
      try {
        const response = await fetch("/api/relevance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: titleChecks.map((item, index) => ({ id: index, title: item.article.title })) }),
        });
        const result = (await response.json()) as ApiResult<number[]>;
        if (result.ok) {
          for (const id of result.data) {
            const checked = titleChecks[id];
            if (checked) irrelevantLinks.add(checked.article.link);
          }
          setIrrelevantTitles(Object.fromEntries([...irrelevantLinks].map((link) => [link, true])));
        } else {
          setNotices((current) => [...current, `제목만 있는 기사의 관련성을 거르지 못했습니다(${result.message}). 거르지 않고 보여 드려요.`]);
        }
      } catch {
        setNotices((current) => [...current, "제목만 있는 기사의 관련성을 거르지 못했습니다. 거르지 않고 보여 드려요."]);
      }
    }

    // 4) 요약이 끝난 기사 중 물가와 관련 있는 것만 같은 주제끼리 묶는다. 실패해도 브리핑은 그대로 보여 준다
    // (제목만 있는 기사도 제목으로 함께 묶는다: 같은 사건이면 요약 카드 옆에 놓인다)
    const targets = next
      .filter((item) => {
        const summary = summaries.get(item.article.link);
        return summary ? summary.relevant : !irrelevantLinks.has(item.article.link);
      })
      .slice(0, 60); // 묶기 요청은 한 번에 60건까지만 받는다
    const groupTask = async () => {
      if (targets.length < 2) return;
      try {
        const response = await fetch("/api/group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: targets.map((item, index) => ({
              id: index,
              title: item.article.title,
              // 요약이 없는 기사는 제목을 대신 보낸다 (본문을 못 읽었으니 제목 외의 내용은 만들지 않는다)
              summary: summaries.get(item.article.link)?.summary ?? item.article.title,
            })),
          }),
        });
        const result = (await response.json()) as ApiResult<{ topic: string; ids: number[] }[]>;
        if (result.ok) {
          const map: Record<string, string> = {};
          const overrides: Record<string, Category> = {};
          for (const group of result.data) {
            const members = group.ids.map((id) => targets[id]).filter((target): target is Item => Boolean(target));
            // 같은 사건이 분류 구역 두 곳에 나뉘어 뜨지 않도록, 묶음 안에서 가장 많은 분류(동률이면 앞 분류)로 모은다
            const tally = new Map<Category, number>();
            for (const member of members) {
              const category = summaries.get(member.article.link)?.category ?? member.article.category;
              tally.set(category, (tally.get(category) ?? 0) + 1);
            }
            const dominant = CATEGORIES.reduce((best, category) => ((tally.get(category) ?? 0) > (tally.get(best) ?? 0) ? category : best));
            for (const member of members) {
              map[member.article.link] = group.topic;
              overrides[member.article.link] = dominant;
            }
          }
          setTopics(map);
          setCategoryOverride(overrides);
        } else {
          setNotices((current) => [...current, `같은 주제로 묶지 못했습니다(${result.message}). 묶지 않고 보여 드려요.`]);
        }
      } catch {
        setNotices((current) => [...current, "같은 주제로 묶지 못했습니다. 묶지 않고 보여 드려요."]);
      }
    };

    // 4) 요약이 있는 기사에서 품목·지표별 물가 동향(오르내림 + 수치)을 뽑는다. 묶기와 동시에 진행한다
    const summarizedTargets = next
      .filter((item) => summaries.get(item.article.link)?.relevant)
      .slice(0, 60);
    const trendTask = async () => {
      if (summarizedTargets.length === 0) return;
      try {
        const response = await fetch("/api/trend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: summarizedTargets.map((item, index) => ({
              id: index,
              title: item.article.title,
              summary: summaries.get(item.article.link)?.summary ?? "",
            })),
          }),
        });
        const result = (await response.json()) as ApiResult<TrendRow[]>;
        if (result.ok) {
          setTrends(
            result.data.map((row) => ({
              row,
              presses: [...new Set(row.ids.map((id) => summarizedTargets[id]?.article.press).filter((p): p is string => Boolean(p)))],
            })),
          );
        } else {
          setNotices((current) => [...current, `물가 동향을 정리하지 못했습니다(${result.message}).`]);
        }
      } catch {
        setNotices((current) => [...current, "물가 동향을 정리하지 못했습니다."]);
      }
    };

    await Promise.all([groupTask(), trendTask()]);
    setPhase("done");
  }

  // 요약이 끝난 기사만 분류별로 모은다. AI가 "물가와 관련이 낮다"고 한 기사는 따로 둔다.
  const view = useMemo(() => {
    const byCategory = new Map<Category, Item[]>(CATEGORIES.map((c) => [c, []]));
    const lowRelevance: Item[] = [];
    const titleOnly: Item[] = [];
    const summaryFailed: Item[] = [];
    /** 직접 검색어로 찾은 기사 (요약 여부와 상관없이 모두 "직접 검색" 구역에 보여 준다) */
    const custom: Item[] = [];
    let summarizeTotal = 0;
    let summarizeDone = 0;

    // 요약이 모두 끝난 뒤에만 중요도 순으로 정렬한다 (만드는 도중에 카드가 자꾸 움직이지 않게)
    for (const item of phase === "done" ? sortByImportance(items) : items) {
      const { bodyStatus } = item.article;
      if (item.article.custom) {
        custom.push(item);
        if (bodyStatus === "ok") {
          summarizeTotal++;
          if (item.status === "done" || item.status === "failed") summarizeDone++;
        }
        continue;
      }
      if (bodyStatus !== "ok") {
        // 제목으로 보아 물가와 확실히 무관한 기사는 "관련 낮음" 접힌 칸으로 보낸다
        if (irrelevantTitles[item.article.link]) lowRelevance.push(item);
        else titleOnly.push(item);
        continue;
      }
      summarizeTotal++;
      if (item.status === "done" || item.status === "failed") summarizeDone++;
      if (item.status === "failed") {
        if (irrelevantTitles[item.article.link]) lowRelevance.push(item);
        else summaryFailed.push(item);
      }
      else if (item.status === "done" && item.summary) {
        if (item.summary.relevant) byCategory.get(categoryOverride[item.article.link] ?? item.summary.category)?.push(item);
        else lowRelevance.push(item);
      }
    }
    // 직접 검색 결과는 검색어별로 묶는다
    const customByKeyword = new Map<string, Item[]>();
    for (const item of custom) {
      customByKeyword.set(item.article.query, [...(customByKeyword.get(item.article.query) ?? []), item]);
    }
    const summarized = (item: Item) => item.status === "done" && item.summary !== undefined;
    const totalChars = [...byCategory.values(), ...customByKeyword.values()]
      .flat()
      .filter(summarized)
      .reduce((sum, item) => sum + textOf(item).length, 0);
    // 본문을 못 읽었거나 요약에 실패한 기사도 찾은 분류(검색어 기준)에 따라 각 분류 구역에 함께 둔다
    const titleByCategory = new Map<Category, Item[]>(CATEGORIES.map((c) => [c, []]));
    for (const item of [...titleOnly, ...summaryFailed]) {
      titleByCategory.get(categoryOverride[item.article.link] ?? item.article.category)?.push(item);
    }
    // 화면 위쪽에 보여 줄 중요도별 건수 (물가와 관련 있는 요약 기사만)
    const importanceCounts: Record<Importance, number> = { 긴급: 0, 주의: 0, 참고: 0 };
    for (const item of [...byCategory.values(), ...customByKeyword.values()].flat().filter(summarized)) {
      importanceCounts[importanceOf(item)]++;
    }
    return { byCategory, titleByCategory, lowRelevance, titleOnly, summaryFailed, customByKeyword, summarizeTotal, summarizeDone, totalChars, importanceCounts };
  }, [items, phase, categoryOverride, irrelevantTitles]);

  const overBy = view.totalChars - MAX_SUMMARY_CHARS;
  const hasBriefing =
    [...view.byCategory.values()].some((list) => list.length > 0) ||
    [...view.customByKeyword.values()].flat().some((item) => item.summary);
  /** 제목만 있는 기사만 있어도 복사·저장은 할 수 있게 한다 */
  const hasAnyArticle = hasBriefing || [...view.titleByCategory.values()].some((list) => list.length > 0);

  /**
   * 같은 주제로 묶인 기사를 한 덩어리로 모은다. 덩어리는 목록에서 그 주제의 첫 기사가 나온 자리에 놓이고,
   * 이 구역 안에 같은 주제 기사가 1건뿐이면 묶음 없이 그대로 둔다.
   */
  function arrange(list: Item[]): { topic?: string; items: Item[] }[] {
    const blocks: { topic?: string; items: Item[] }[] = [];
    const placed = new Set<string>();
    for (const item of list) {
      const topic = topics[item.article.link];
      if (!topic) {
        blocks.push({ items: [item] });
        continue;
      }
      if (placed.has(topic)) continue;
      placed.add(topic);
      const members = list.filter((other) => topics[other.article.link] === topic);
      blocks.push(members.length >= 2 ? { topic, items: members } : { items: members });
    }
    return blocks;
  }

  /** 기사 한 건: 요약이 있으면 카드, 없으면 제목 한 줄 */
  function renderItem(item: Item) {
    if (item.summary) {
      return (
        <SummaryCard
          key={item.article.link}
          item={item}
          onEdit={(text) => patchItem(item.article.link, { edited: text })}
          onImportance={(level) => patchItem(item.article.link, { importanceEdited: level })}
        />
      );
    }
    return (
      <TitleRow
        key={item.article.link}
        item={item}
        badge={
          item.status === "failed"
            ? "요약 실패 — 제목만"
            : item.status === "pending" || item.status === "summarizing"
              ? "요약 중…"
              : item.article.bodyStatus === "failed"
                ? "본문 확인 불가 — 제목만"
                : "제목만"
        }
        note={item.error ?? item.article.bodyNote}
      />
    );
  }

  /** 묶음이면 이름표와 왼쪽 파란 줄로 한 덩어리처럼 보이게 하고, 혼자인 기사는 그대로 보여 준다 */
  function renderBlock(block: { topic?: string; items: Item[] }) {
    if (!block.topic) return block.items.map(renderItem);
    return (
      <div key={`topic:${block.topic}`} className="flex flex-col gap-3 border-l-4 border-sky-300 pl-4 dark:border-sky-700">
        <h3 className="text-sm font-semibold text-brand">
          ▸ {block.topic} <span className="font-normal text-zinc-600 dark:text-zinc-400">({block.items.length}건 같은 주제)</span>
        </h3>
        {block.items.map(renderItem)}
      </div>
    );
  }

  /** 복사와 파일 저장이 같은 글을 쓰도록 브리핑 전체 글을 한 곳에서 만든다 */
  function buildBriefingText(): string {
    const lines: string[] = [`물가 브리핑 (${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })})`];
    const addSection = (heading: string, list: Item[]) => {
      // 요약 중인 기사는 뺀다. 제목만 있는 기사는 "[제목만]"으로 함께 적는다
      const readyList = list.filter((item) => item.status === "done" || item.status === "failed");
      if (readyList.length === 0) return;
      lines.push("", heading);
      for (const block of arrange(readyList)) {
        if (block.topic) lines.push(`▶ ${block.topic}`);
        for (const item of block.items) {
          const link = item.article.originalUrl ?? item.article.link;
          if (!item.summary) {
            lines.push(`- [제목만] ${item.article.title}`, `  (${item.article.press}, ${link})`);
            continue;
          }
          lines.push(`- [${importanceOf(item)}] ${textOf(item)}`, `  (${item.article.press}, "${item.article.title}", ${link})`);
        }
      }
    };
    if (trends.length > 0) {
      lines.push("", "■ 오늘의 물가 동향");
      for (const { row, presses } of trends) {
        lines.push(`- ${row.name}: ${row.direction}${row.figure ? ` (${row.figure})` : ""} [${presses.join("·")}]`);
      }
    }
    for (const [keyword, list] of view.customByKeyword) addSection(`■ 직접 검색: ${keyword}`, list);
    for (const category of CATEGORIES) {
      addSection(`■ ${category}`, [...(view.byCategory.get(category) ?? []), ...(view.titleByCategory.get(category) ?? [])]);
    }
    return lines.join("\n");
  }

  /** 브리핑을 .txt 파일로 내려받는다 (한글 프로그램·메모장에서 바로 열린다) */
  function downloadText(content: string, filePrefix: string) {
    // 맨 앞 BOM(﻿)은 메모장 등이 한글을 UTF-8로 알아보게 하는 표시, 줄바꿈은 윈도우 방식(\r\n)
    const text = "﻿" + content.replace(/\n/g, "\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filePrefix}_${date}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCopyMessage("텍스트 파일로 저장했습니다. 다운로드 폴더를 확인해 주세요.");
  }

  function downloadBriefing() {
    downloadText(buildBriefingText(), "물가브리핑");
  }

  async function copyBriefing() {
    await copyText(buildBriefingText(), "브리핑 전체를 복사했습니다.");
  }

  /** 글을 클립보드로 복사한다 */
  async function copyText(text: string, okMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage(okMessage);
    } catch {
      // 클립보드 권한이 막힌 브라우저에서는 예전 방식(보이지 않는 입력칸을 선택해 복사)을 한 번 더 시도한다
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(helper);
      setCopyMessage(copied ? okMessage : "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.");
    }
  }

  /** 분야·검색어별로 요약을 합친 간단 요약 보고서를 만든다. 요약이 끝난 기사만 쓴다 */
  async function makeReport() {
    const sectionsSource: { heading: string; list: Item[] }[] = [
      ...[...view.customByKeyword.entries()].map(([keyword, list]) => ({ heading: `직접 검색: ${keyword}`, list })),
      ...CATEGORIES.map((category) => ({ heading: category, list: view.byCategory.get(category) ?? [] })),
    ];
    let budget = 60; // 서버가 한 번에 받는 기사 수
    const inputs = sectionsSource
      .map((section, id) => {
        const items = section.list
          .filter((item) => item.summary)
          .slice(0, Math.max(budget, 0))
          .map((item) => ({
            press: item.article.press,
            title: item.article.title,
            summary: textOf(item),
            importance: importanceOf(item),
            ...(topics[item.article.link] ? { topic: topics[item.article.link] } : {}),
          }));
        budget -= items.length;
        return { id, heading: section.heading, items };
      })
      .filter((section) => section.items.length > 0)
      .slice(0, 10);
    if (inputs.length === 0) return;

    setReporting(true);
    setReport(null);
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections: inputs }),
      });
      const result = (await response.json()) as ApiResult<{ id: number; text: string; needsCheck: boolean; reasons: string[] }[]>;
      if (!result.ok) {
        setReport({ text: "", notes: [`보고서를 만들지 못했습니다(${result.message}). 잠시 뒤 다시 눌러 주세요.`] });
        return;
      }

      const date = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
      const lines: string[] = [`물가 동향 요약 보고 (${date})`];
      const notes: string[] = [];
      if (trends.length > 0) {
        lines.push("", "1. 주요 지표 동향");
        for (const { row } of trends) lines.push(`- ${row.name}: ${row.direction}${row.figure ? ` (${row.figure})` : ""}`);
      }
      lines.push("", `${trends.length > 0 ? "2" : "1"}. 분야별 요약`);
      for (const input of inputs) {
        const section = result.data.find((s) => s.id === input.id);
        lines.push("", `■ ${input.heading} (기사 ${input.items.length}건)`);
        if (!section) {
          lines.push("(이 분야의 보고 문단을 만들지 못했습니다. 아래 기사 요약을 참고해 주세요.)");
          notes.push(`${input.heading}: 문단을 만들지 못했습니다.`);
          continue;
        }
        lines.push(section.text);
        if (section.needsCheck) notes.push(`${input.heading}: 확인 필요 — ${section.reasons.join(" · ")}`);
      }
      // 신속 보고 사항은 AI가 아니라 화면의 중요도 표시(인턴이 바꾼 것 포함)에서 그대로 뽑는다
      const urgent = sectionsSource.flatMap((section) => section.list).filter((item) => item.summary && importanceOf(item) === "긴급");
      lines.push("", `${trends.length > 0 ? "3" : "2"}. 신속 보고 필요 사항`);
      if (urgent.length === 0) lines.push("- 긴급으로 표시된 기사가 없습니다.");
      for (const item of urgent) lines.push(`- [${item.article.press}] ${item.article.title}`);
      lines.push("", "※ AI가 기사 요약을 바탕으로 작성한 초안이므로 보고 전에 내용을 확인해 주세요.");
      setReport({ text: lines.join("\n"), notes });
    } catch {
      setReport({ text: "", notes: ["보고서를 만들지 못했습니다. 서버에 연결하지 못했습니다."] });
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ② 실행 영역 */}
      <section aria-labelledby="run-title" className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-surface p-6 dark:border-zinc-800">
        <h2 id="run-title" className="text-base font-medium">
          오늘의 브리핑
        </h2>
        {/* 기사 기간 선택: 최근 몇 시간 이내에 나온 기사를 모을지 고른다 */}
        <div role="group" aria-label="기사 기간" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">기사 기간</span>
          {PERIOD_HOURS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={hours === option}
              disabled={busy}
              onClick={() => setHours(option)}
              className={`rounded-xl px-4 py-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                hours === option
                  ? "bg-brand text-white dark:text-zinc-950"
                  : "bg-soft text-brand hover:opacity-80"
              }`}
            >
              최근 {option}시간
            </button>
          ))}
        </div>
        {/* 직접 검색어: 고정 검색어 외에 인턴이 찾고 싶은 말을 더한다 */}
        <div className="flex flex-col gap-2 text-sm">
          <label htmlFor="custom-keywords" className="text-zinc-600 dark:text-zinc-400">
            직접 검색어{" "}
            <span className="text-xs">
              (쉼표로 구분해 최대 3개, 빼고 싶은 말은 앞에 -를 붙여요. 비워 두면 고정 검색어만 씁니다)
            </span>
          </label>
          <input
            id="custom-keywords"
            type="text"
            value={keywordText}
            maxLength={80}
            disabled={busy}
            placeholder="예: 쌀값, 계란"
            onChange={(event) => {
              setKeywordText(event.target.value);
              setKeywordError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !busy) void makeBriefing();
            }}
            aria-invalid={keywordError ? true : undefined}
            aria-describedby={keywordError ? "custom-keywords-error" : undefined}
            className="w-full rounded-xl border border-zinc-300 bg-surface px-4 py-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-sky-200 dark:focus:ring-sky-900 disabled:opacity-40 dark:border-zinc-700"
          />
          <div className="flex items-center gap-2">
            <input
              id="only-custom"
              type="checkbox"
              checked={onlyCustom}
              disabled={busy}
              onChange={(event) => setOnlyCustom(event.target.checked)}
            />
            <label htmlFor="only-custom">고정 검색어는 빼고 직접 검색어로만 찾기</label>
          </div>
          {keywordError && (
            <p id="custom-keywords-error" role="alert" className="text-red-700 dark:text-red-300">
              {keywordError}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={makeBriefing}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-950"
          >
            {busy ? "만드는 중…" : items.length > 0 || phase === "done" ? "다시 만들기" : "브리핑 만들기"}
          </button>
          {phase === "collecting" && <span className="text-sm text-zinc-600 dark:text-zinc-400">기사를 모으고 본문을 읽는 중입니다…</span>}
          {phase === "grouping" && <span className="text-sm text-zinc-600 dark:text-zinc-400">제목만 있는 기사를 거르고, 같은 주제로 묶고, 물가 동향을 정리하는 중입니다…</span>}
          {phase === "summarizing" && (
            <span className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <progress value={view.summarizeDone} max={Math.max(view.summarizeTotal, 1)} className="h-2 w-40" />
              요약 {view.summarizeDone}/{view.summarizeTotal}건
            </span>
          )}
        </div>
      </section>

      {/* ③ 안내 띠: 일어난 일을 사실 그대로 알린다 */}
      {notices.length > 0 && (
        <div role="status" className="flex flex-col gap-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
      )}
      {overBy > 0 && (
        <div role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          분량 기준(약 {MAX_SUMMARY_CHARS.toLocaleString()}자)을 {overBy.toLocaleString()}자 넘었습니다. 줄여 주세요.
        </div>
      )}
      {phase === "done" && items.length > 0 && !hasBriefing && view.summarizeTotal > 0 && view.summaryFailed.length === view.summarizeTotal && (
        <div role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          요약을 만들지 못했습니다. 아래 기사는 제목과 링크만 볼 수 있어요.
        </div>
      )}

      {/* 오늘의 물가 동향: 품목·지표별 오르내림과 기사에 나온 수치만 모아 한눈에 보여 준다 */}
      {trends.length > 0 && (
        <section aria-label="오늘의 물가 동향" className="flex flex-col gap-3 rounded-2xl bg-soft p-6">
          <h2 className="text-xl font-semibold">오늘의 물가 동향</h2>
          <ul className="flex flex-col divide-y divide-blue-100 dark:divide-sky-950">
            {trends.map(({ row, presses }) => (
              <li key={row.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className={`w-16 shrink-0 font-semibold ${DIRECTION_STYLE[row.direction]}`}>{DIRECTION_MARK[row.direction]} {row.direction}</span>
                <span className="font-semibold">{row.name}</span>
                {row.figure && <span>{row.figure}</span>}
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {presses.join("·")} 기사 {row.ids.length}건
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">요약된 기사에 적힌 내용만 모은 것이에요. 자세한 내용은 아래 기사에서 확인하세요.</p>
        </section>
      )}

      {/* 중요도별 건수: 신속 보고할 기사가 몇 건인지 한눈에 본다 */}
      {hasBriefing && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">중요도</span>
          {IMPORTANCE_LEVELS.map((level) => (
            <span key={level} className={`rounded-full border px-3 py-1 font-medium ${IMPORTANCE_STYLE[level]}`}>
              {level} {view.importanceCounts[level]}건
            </span>
          ))}
          <span className="text-xs text-zinc-600 dark:text-zinc-400">AI가 정한 것이니 각 카드에서 바꿀 수 있어요.</span>
        </div>
      )}

      {/* ④ 브리핑 영역 — 먼저 인턴이 직접 검색한 결과 */}
      {[...view.customByKeyword.entries()].map(([keyword, list]) => (
        <section key={keyword} aria-label={`직접 검색: ${keyword}`} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            ■ 직접 검색: {keyword} <span className="text-sm font-normal text-zinc-600 dark:text-zinc-400">({list.length}건)</span>
          </h2>
          {arrange(list).map(renderBlock)}
        </section>
      ))}

      {CATEGORIES.map((category) => {
        const list = [...(view.byCategory.get(category) ?? []), ...(view.titleByCategory.get(category) ?? [])];
        if (list.length === 0) return null;
        return (
          <section key={category} aria-label={category} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">■ {category}</h2>
            {arrange(list).map(renderBlock)}
          </section>
        );
      })}

      {/* 제목만 있는 기사는 위의 각 분류 구역에 함께 보여 준다 */}
      {view.lowRelevance.length > 0 && (
        <details className="rounded-2xl border border-zinc-200 bg-surface p-4 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer font-medium">물가와 관련이 낮다고 판단해 뺀 기사 {view.lowRelevance.length}건 (눌러서 확인)</summary>
          <div className="mt-2 flex flex-col gap-2">
            {view.lowRelevance.map((item) => (
              <TitleRow key={item.article.link} item={item} badge="관련 낮음" note={textOf(item)} />
            ))}
          </div>
        </details>
      )}

      {/* ⑤ 도구 줄 */}
      {hasAnyArticle && (
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={copyBriefing}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-soft px-6 text-sm font-semibold text-brand transition hover:opacity-80"
          >
            브리핑 복사
          </button>
          <button
            type="button"
            onClick={downloadBriefing}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-soft px-6 text-sm font-semibold text-brand transition hover:opacity-80"
          >
            텍스트 파일로 저장
          </button>
          <button
            type="button"
            onClick={makeReport}
            disabled={busy || reporting || !hasBriefing}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-6 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-950"
          >
            {reporting ? "보고서 만드는 중…" : report ? "요약 보고서 다시 만들기" : "요약 보고서 만들기"}
          </button>
          <span role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            {copyMessage}
          </span>
        </div>
      )}

      {/* 간단 요약 보고서: 분야·검색어별 요약을 합친 글. 고쳐서 복사하거나 파일로 저장한다 */}
      {report && (
        <section aria-label="간단 요약 보고서" className="flex flex-col gap-3 rounded-2xl bg-soft p-6">
          <h2 className="text-xl font-semibold">간단 요약 보고서</h2>
          {report.notes.length > 0 && (
            <div role="status" className="flex flex-col gap-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {report.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}
          {report.text && (
            <>
              <textarea
                aria-label="간단 요약 보고서 (고칠 수 있어요)"
                value={report.text}
                onChange={(event) => setReport({ ...report, text: event.target.value })}
                rows={18}
                className="w-full resize-y rounded-xl border border-zinc-200 bg-surface p-3 text-sm leading-6 dark:border-zinc-700"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => copyText(report.text, "보고서를 복사했습니다.")}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-surface px-6 text-sm font-semibold text-brand transition hover:opacity-80"
                >
                  보고서 복사
                </button>
                <button
                  type="button"
                  onClick={() => downloadText(report.text, "물가요약보고")}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-surface px-6 text-sm font-semibold text-brand transition hover:opacity-80"
                >
                  보고서 파일로 저장
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** 요약이 끝난 기사 한 건: 고칠 수 있는 요약 + 지워지지 않는 출처 줄 */
function SummaryCard({
  item,
  onEdit,
  onImportance,
}: {
  item: Item;
  onEdit: (text: string) => void;
  onImportance: (level: Importance) => void;
}) {
  const { article, summary } = item;
  const href = safeHref(article.originalUrl ?? article.link);
  const level = importanceOf(item);
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-surface p-5 dark:border-zinc-800">
      {/* 중요도: 글자와 색으로 표시하고, 인턴이 직접 바꿀 수 있다 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          aria-label="중요도 (바꿀 수 있어요)"
          value={level}
          onChange={(event) => onImportance(event.target.value as Importance)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${IMPORTANCE_STYLE[level]}`}
        >
          {IMPORTANCE_LEVELS.map((option) => (
            <option key={option} value={option}>
              {option === "긴급" ? "긴급 · 신속 보고" : option === "주의" ? "주의 · 공유·확인" : "참고"}
            </option>
          ))}
        </select>
        {summary?.importanceReason && <span className="text-xs text-zinc-600 dark:text-zinc-400">AI 판단: {summary.importanceReason}</span>}
      </div>
      <textarea
        aria-label={`${article.title} 요약 (고칠 수 있어요)`}
        value={textOf(item)}
        onChange={(event) => onEdit(event.target.value)}
        rows={4}
        className="w-full resize-y rounded-xl border border-zinc-200 bg-transparent p-3 text-sm leading-6 dark:border-zinc-700"
      />
      {summary?.needsCheck && (
        <p className="text-sm text-red-700 dark:text-red-300">
          <span className="mr-2 rounded bg-red-100 px-2 py-0.5 text-xs font-medium dark:bg-red-950">확인 필요</span>
          {summary.reasons.join(" · ")}
        </p>
      )}
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {article.press} ·{" "}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {article.title}
          </a>
        ) : (
          article.title
        )}{" "}
        · {formatTime(article.publishedAt)}
      </p>
    </article>
  );
}

/** 제목과 링크만 보여 주는 한 줄 */
function TitleRow({ item, badge, note }: { item: Item; badge?: string; note?: string }) {
  const { article } = item;
  const href = safeHref(article.originalUrl ?? article.link);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        {badge && <span className="mr-2 rounded bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">{badge}</span>}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {article.title}
          </a>
        ) : (
          article.title
        )}
        <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
          {article.press} · {formatTime(article.publishedAt)}
        </span>
      </p>
      {note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{note}</p>}
    </div>
  );
}
