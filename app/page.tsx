import { CATEGORIES, PRESS, SEARCH_QUERIES } from "@/lib/config";
import { BriefingApp } from "./_components/briefing-app";
import { TodayDate } from "./_components/today-date";

// Design Ref: DESIGN §2 — ①머리말, ②~⑤ 브리핑 화면(BriefingApp), 아래에 대상 안내.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      {/* ① 머리말 */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-blue-800 dark:text-sky-300">물가 브리핑 챗봇</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <TodayDate />
        </p>
      </header>

      {/* ②~⑤ 실행, 안내, 브리핑, 도구 */}
      <BriefingApp />

      {/* 어떤 기사를 모으는지 (설정 파일의 값을 보기만 한다) */}
      <section aria-label="수집 대상" className="flex flex-col gap-3 border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        <h2 className="font-medium">수집 대상</h2>
        {CATEGORIES.map((category) => (
          <div key={category} className="flex flex-col gap-1">
            <span className="text-zinc-600 dark:text-zinc-400">{category}</span>
            <ul className="flex flex-wrap gap-2">
              {SEARCH_QUERIES[category].map((query) => (
                <li key={query} className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                  {query}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-zinc-600 dark:text-zinc-400">지정 언론사 {PRESS.length}곳의 기사를 대상으로 하고, 기간은 위에서 고른 시간(기본 24시간)을 따릅니다.</p>
      </section>
    </main>
  );
}
