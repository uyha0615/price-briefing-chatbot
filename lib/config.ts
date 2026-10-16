// Design Ref: DESIGN §5 — 언론사와 검색어를 이 파일 한 곳에서만 관리한다.
// Plan SC: PLAN 2번 — 언론사를 추가·삭제할 때는 아래 PRESS 목록만 고친다.

/** 브리핑을 나누는 세 가지 분류 */
export type Category = "농축수산물" | "석유류" | "기타 물가";

/** 지정 언론사 한 곳의 정보 */
export interface Press {
  /** 화면에 보여 줄 이름 */
  name: string;
  /** 허용할 도메인(주소). 이 주소이거나 하위 주소(예: news.xxx)일 때만 본문을 읽는다 */
  domains: string[];
  /** RSS에 적혀 나올 수 있는 다른 표기. 이름이 조금 달라도 걸러지지 않게 한다 */
  aliases: string[];
  /**
   * 언론사가 직접 공개한 RSS 주소. 있으면 이것으로 기사를 가져온다(원문 주소를 바로 받음).
   * 없는 언론사는 구글 뉴스 RSS로 대신 가져온다.
   */
  feeds?: string[];
  /**
   * RSS가 없는 언론사 중, 구글 중계 주소에서 원문 주소를 알아내 본문까지 읽을 곳만 true로 둔다.
   * 구글의 비공식 방법이라 요청이 많으면 차단될 수 있어서, 꼭 필요한 곳에만 쓴다.
   * true가 아니면 구글에서 가져온 기사는 제목과 링크만 보여 준다.
   */
  resolveGoogleLink?: boolean;
}

// 주의: 도메인·별칭·RSS 주소는 확인된 값으로 채웠지만, 언론사가 주소를 바꾸면 안 될 수 있다.
// RSS 주소가 막히면 그 언론사만 feeds를 지우면 구글 뉴스 RSS로 자동 전환된다.
export const PRESS: Press[] = [
  // 신문
  {
    name: "경향신문",
    domains: ["khan.co.kr"],
    aliases: ["경향신문", "경향"],
    feeds: ["https://www.khan.co.kr/rss/rssdata/total_news.xml"],
  },
  {
    name: "국민일보",
    domains: ["kmib.co.kr"],
    aliases: ["국민일보"],
    feeds: ["https://www.kmib.co.kr/rss/data/kmibRssAll.xml"],
  },
  {
    name: "동아일보",
    domains: ["donga.com"],
    aliases: ["동아일보"],
    // 경제 분류 + 전체 기사 (농축수산물 기사는 사회·지역 분류에도 있어서 전체를 함께 받는다)
    feeds: ["https://rss.donga.com/economy.xml", "https://rss.donga.com/total.xml"],
  },
  {
    name: "서울신문",
    domains: ["seoul.co.kr"],
    aliases: ["서울신문"],
    feeds: [
      "https://www.seoul.co.kr/xml/rss/rss_economy.xml",
      "https://www.seoul.co.kr/xml/rss/rss_society.xml",
    ],
  },
  // 조선비즈(biz.chosun.com)는 chosun.com 하위 주소라 조선일보로 함께 잡힌다. RSS 이름이 Chosunbiz로 오는 경우를 위해 별칭을 둔다
  {
    name: "조선일보",
    domains: ["chosun.com"],
    aliases: ["조선일보", "조선닷컴", "조선비즈", "Chosunbiz"],
    feeds: [
      "https://www.chosun.com/arc/outboundfeeds/rss/category/economy/?outputType=xml",
      "https://www.chosun.com/arc/outboundfeeds/rss/category/national/?outputType=xml",
    ],
  },
  // 경제지
  {
    name: "매일경제",
    domains: ["mk.co.kr"],
    aliases: ["매일경제", "매경"],
    feeds: ["https://www.mk.co.kr/rss/30100041/", "https://www.mk.co.kr/rss/40300001/"],
  },
  {
    name: "서울경제",
    domains: ["sedaily.com"],
    aliases: ["서울경제"],
    feeds: ["https://www.sedaily.com/rss/economy", "https://www.sedaily.com/rss/society"],
  },
  {
    name: "한국경제",
    domains: ["hankyung.com"],
    aliases: ["한국경제", "한경"],
    feeds: ["https://www.hankyung.com/feed/economy", "https://www.hankyung.com/feed/all-news"],
  },
  {
    name: "머니투데이",
    domains: ["mt.co.kr"],
    aliases: ["머니투데이"],
    feeds: ["https://rss.mt.co.kr/mt_news.xml"],
  },
  {
    name: "아주경제",
    domains: ["ajunews.com"],
    aliases: ["아주경제"],
    feeds: [
      "https://www.ajunews.com/rss/economy.xml",
      "https://www.ajunews.com/rss/society.xml",
      "https://www.ajunews.com/rss/industry.xml",
    ],
  },
  {
    name: "이투데이",
    domains: ["etoday.co.kr"],
    aliases: ["이투데이"],
    feeds: ["https://rss.etoday.co.kr/eto/etoday_news_all.xml"],
  },
  // M이코노미뉴스(m-economynews.com)는 시장경제신문(meconomynews.com)과 다른 매체다. 주소가 비슷하니 헷갈리지 말 것
  {
    name: "M이코노미뉴스",
    domains: ["m-economynews.com"],
    aliases: ["M이코노미뉴스"],
    feeds: ["https://www.m-economynews.com/data/rss/news.xml"],
  },
  // 통신사·농업 전문지
  {
    name: "연합뉴스",
    domains: ["yna.co.kr"],
    aliases: ["연합뉴스"],
    feeds: [
      "https://www.yna.co.kr/rss/economy.xml",
      "https://www.yna.co.kr/rss/society.xml",
      "https://www.yna.co.kr/rss/news.xml",
    ],
  },
  {
    name: "뉴시스",
    domains: ["newsis.com"],
    aliases: ["뉴시스"],
    feeds: [
      "https://www.newsis.com/RSS/economy.xml",
      "https://www.newsis.com/RSS/society.xml",
      "https://www.newsis.com/RSS/sokbo.xml",
    ],
  },
  // 농민신문은 농축수산물 기사가 많아서 RSS는 없지만 구글 변환으로 본문까지 읽는다
  { name: "농민신문", domains: ["nongmin.com"], aliases: ["농민신문"], resolveGoogleLink: true },
  // 방송 (RSS 주소를 아직 못 찾은 곳은 feeds가 없어 구글 뉴스 RSS로 가져온다)
  { name: "KBS", domains: ["kbs.co.kr"], aliases: ["KBS", "KBS 뉴스", "KBS뉴스"] },
  { name: "MBC", domains: ["imbc.com", "mbc.co.kr"], aliases: ["MBC", "MBC 뉴스", "MBC뉴스"] },
  {
    name: "SBS",
    domains: ["sbs.co.kr"],
    aliases: ["SBS", "SBS 뉴스", "SBS뉴스"],
    feeds: [
      "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER",
      "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER",
      "https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER",
    ],
  },
  { name: "EBS", domains: ["ebs.co.kr"], aliases: ["EBS", "EBS 뉴스"] },
  {
    name: "JTBC",
    domains: ["jtbc.co.kr"],
    aliases: ["JTBC", "JTBC 뉴스"],
    feeds: [
      "https://news-ex.jtbc.co.kr/v1/get/rss/section/economy",
      "https://news-ex.jtbc.co.kr/v1/get/rss/section/society",
    ],
  },
  {
    name: "MBN",
    domains: ["mbn.co.kr"],
    aliases: ["MBN", "MBN 뉴스"],
    feeds: ["https://www.mbn.co.kr/rss"],
  },
  { name: "YTN", domains: ["ytn.co.kr"], aliases: ["YTN", "YTN 뉴스"] },
];

/** 구글 뉴스 RSS로 검색할 분류별 검색어 (DESIGN §7 확정본) */
export const SEARCH_QUERIES: Record<Category, string[]> = {
  농축수산물: ["농산물 가격", "축산물 가격", "수산물 가격"],
  석유류: ["휘발유 가격", "경유 가격", "국제유가"],
  "기타 물가": ["물가", "소비자물가"],
};

/**
 * 언론사 RSS에는 검색 기능이 없어서, 기사 제목에 아래 말이 들어 있는 기사만 고른다.
 * 위에서부터 먼저 맞는 분류로 정한다(그래서 "기타 물가"는 맨 뒤).
 * 제목에서 오해를 부르는 말은 피했다(예: "사과"는 사과(謝過)와 헷갈리고, "경유"는 "~를 경유해"와 헷갈린다).
 */
export const TITLE_KEYWORDS: Record<Category, RegExp[]> = {
  농축수산물: [
    /농산물|축산물|수산물|농축수산|농작물/,
    /채소|과일값|과일 가격|쌀값|쌀 가격|한우|돼지고기|닭고기|계란|달걀/,
    /배추|양파|마늘|감귤|상추|시금치|경락|도매가|산지 ?가격/,
  ],
  석유류: [
    /휘발유|국제유가|기름값|주유소|두바이유|브렌트유|WTI/,
    // "유가"는 "이유가"(예: 늘어난 이유가…), "유가족", "유가증권" 안에 든 경우를 뺀다
    /경유(?![지하해했한])|(?<!이)유가(?!증권|족)|원유|석유|등유|LPG/,
  ],
  "기타 물가": [/물가|인플레이션|생활비|장바구니|CPI/],
};

/** 인턴이 고를 수 있는 기사 기간(시간). 이 값만 허용한다 */
export const PERIOD_HOURS = [6, 12, 24, 48, 72] as const;
export type PeriodHours = (typeof PERIOD_HOURS)[number];
/** 기본 기사 기간(시간) */
export const DEFAULT_PERIOD_HOURS: PeriodHours = 24;

/** 문자열이 허용된 기간 값이면 숫자로 돌려주고, 아니면 undefined */
export function parsePeriodHours(value: string | null | undefined): PeriodHours | undefined {
  const number = Number(value);
  return PERIOD_HOURS.find((hours) => hours === number);
}

/**
 * 기사 요약에 쓰는 OpenAI 모델. 바꾸려면 이 한 줄만 고친다.
 * 작고 저렴한 모델이면서 한국어 요약에 충분하다고 보고 정했다. 품질이 부족하면 더 큰 모델로 올린다.
 */
export const SUMMARY_MODEL = "gpt-5.4-mini";

/** 분류 순서 (화면에 보여 줄 순서이자, 키워드가 겹칠 때 먼저 정하는 순서) */
export const CATEGORIES: Category[] = ["농축수산물", "석유류", "기타 물가"];

/** 기사 중요도: 신속 보고가 필요한지, 참고만 해도 되는지 (AI가 먼저 정하고 인턴이 바꿀 수 있다) */
export const IMPORTANCE_LEVELS = ["긴급", "주의", "참고"] as const;
export type Importance = (typeof IMPORTANCE_LEVELS)[number];
