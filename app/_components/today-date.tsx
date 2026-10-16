"use client";

import { useSyncExternalStore } from "react";

// 오늘 날짜를 한국어로 보여 준다.
// 서버에서 미리 그려 둘 때는 현재 시각을 쓸 수 없으므로(Cache Components 규칙),
// 서버에서는 빈 글자를 쓰고, 브라우저에 뜬 뒤에 날짜를 채운다.
function getToday() {
  return new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

// 날짜는 바뀌어도 화면을 다시 그릴 필요가 없어서 구독할 것이 없다.
function subscribe() {
  return () => {};
}

export function TodayDate() {
  const text = useSyncExternalStore(subscribe, getToday, () => "");

  // 날짜가 채워지기 전에도 자리를 잡아 두어 화면이 흔들리지 않게 한다.
  return <span className="inline-block min-h-5">{text}</span>;
}
