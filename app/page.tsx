import { CATEGORIES, PRESS, SEARCH_QUERIES } from "@/lib/config";
import { BriefingApp } from "./_components/briefing-app";
import { TodayDate } from "./_components/today-date";

// Design Ref: DESIGN §2 — ①머리말, ②~⑤ 브리핑 화면(BriefingApp), 아래에 대상 안내.
export default function Home() {
  return (
    <>
      {/* 맨 위 바: 서비스 이름, 아래에 가는 선 */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-surface/85 backdrop-blur dark:border-zinc-800">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-6">
          <span aria-hidden className="h-3 w-3 rounded-full bg-brand" />
          <span className="text-sm font-semibold">물가 브리핑</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 pb-12 pt-12">
        {/* ① 머리말: 가운데 큰 제목 + 한 줄 설명 */}
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">물가 브리핑 챗봇</h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            주요 언론사의 물가·농축수산물·석유류 기사를 모아 AI로 요약하고, 브리핑 초안을 만들어 드려요.
          </p>
          <p className="text-sm text-zinc-500">
            <TodayDate />
          </p>
        </div>

        {/* ②~⑤ 실행, 안내, 브리핑, 도구 */}
        <BriefingApp />

        {/* 어떤 기사를 모으는지 (설정 파일의 값을 보기만 한다) */}
        <section aria-label="수집 대상" className="flex flex-col gap-3 text-sm">
          <h2 className="text-base font-semibold">수집 대상</h2>
          {CATEGORIES.map((category) => (
            <div key={category} className="flex flex-col gap-1">
              <span className="text-zinc-600 dark:text-zinc-400">{category}</span>
              <ul className="flex flex-wrap gap-2">
                {SEARCH_QUERIES[category].map((query) => (
                  <li key={query} className="rounded-full bg-soft px-3 py-1 font-medium text-brand">
                    {query}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-zinc-600 dark:text-zinc-400">지정 언론사 {PRESS.length}곳의 기사를 대상으로 하고, 기간은 위에서 고른 시간(기본 24시간)을 따릅니다.</p>
        </section>
      </main>

      {/* 맨 아래: 가는 선과 작은 회색 안내 */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-6 py-8 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold">안내</span>
          <span>AI가 만든 요약·중요도·묶음·보고서는 초안입니다. 보고 전에 원문을 확인해 주세요.</span>
          <span>기사 본문은 각 언론사의 저작권 대상이며, 모든 요약에 언론사와 원문 링크를 함께 표시합니다.</span>
        </div>
      </footer>
    </>
  );
}
