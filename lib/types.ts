// Design Ref: DESIGN §3.1 — 기사와 API 응답의 데이터 모양을 한 곳에 모아 둔다.
import type { Category, Importance } from "./config";

/** 구글 뉴스 RSS에서 가져온 기사 한 건 */
export interface Article {
  /** 기사 제목 (끝에 붙은 " - 언론사명"은 뺀 것) */
  title: string;
  /** 기사 주소. linkKind가 "google"이면 구글 중계 주소라서, 원문 주소는 본문 읽기 단계(PLAN 7번)에서 알아낸다 */
  link: string;
  /** direct: 언론사 RSS에서 받은 원문 주소 / google: 구글 뉴스 RSS의 중계 주소 */
  linkKind: "direct" | "google";
  /** 발행 시각 (ISO 형식, 예: 2026-10-15T01:45:35.000Z) */
  publishedAt: string;
  /** RSS에 적힌 언론사 이름 */
  sourceName: string;
  /** RSS에 적힌 언론사 주소 (예: https://www.busan.com) */
  sourceUrl: string;
  /** 이 기사를 찾은 검색어의 분류 */
  category: Category;
  /** 이 기사를 찾은 검색어(구글 RSS) 또는 제목에서 맞은 키워드(언론사 RSS) */
  query: string;
  /** 인턴이 직접 입력한 검색어로 찾은 기사인지 (true면 "직접 검색" 구역에 보여 준다) */
  custom?: boolean;
}

/** 지정 언론사로 확인된 기사 (설정 파일의 정식 언론사 이름이 붙음) */
export interface DesignatedArticle extends Article {
  /** 설정 파일(PRESS)에 적힌 정식 언론사 이름 */
  press: string;
}

/** 본문 읽기까지 마친 기사 */
export interface BriefingArticle extends DesignatedArticle {
  /**
   * ok: 본문을 읽음 / failed: 읽으려 했지만 실패("본문 확인 불가 — 제목만") /
   * not-selected: 20건 제한 때문에 읽지 않음("N건은 제목만")
   */
  bodyStatus: "ok" | "failed" | "not-selected";
  /** 읽은 본문 (bodyStatus가 ok일 때만) */
  body?: string;
  /** 구글 중계 주소에서 알아낸 원문 주소, 또는 언론사 RSS의 원문 주소 (bodyStatus가 ok일 때만) */
  originalUrl?: string;
  /** 실패한 이유 (bodyStatus가 failed일 때만, 화면에 그대로 보여 줘도 되는 문장) */
  bodyNote?: string;
}

/** 기사 한 건의 요약 결과 */
export interface SummaryResult {
  /** 3문장 이내 요약 */
  summary: string;
  /** AI가 고른 분류 */
  category: Category;
  /** 물가·가격을 직접 다루는 기사인지 (false면 브리핑에서 빼는 것을 권함) */
  relevant: boolean;
  /** 본문에 실제 기사 내용이 있었는지 (false면 추천기사·저작권 안내만 읽힌 것이라 "제목만"으로 처리한다) */
  bodyUsable: boolean;
  /** AI가 본 중요도: 긴급(신속 보고) / 주의(공유·확인) / 참고 */
  importance: Importance;
  /** 그렇게 판단한 이유 한 줄 (기사 내용에서만 근거를 댐) */
  importanceReason: string;
  /** 화면에 "확인 필요"를 붙일지 */
  needsCheck: boolean;
  /** "확인 필요"인 이유 (인턴이 무엇을 확인하면 되는지 알려 줌) */
  reasons: string[];
}

/** 서버가 화면에 돌려주는 공통 틀: 성공이면 data, 아니면 사실 그대로의 안내 메시지 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/** 수집 API(/api/articles)의 성공 데이터 */
export interface CollectResult {
  /** 지정 언론사 + 24시간 이내 + 중복 정리 + 본문 읽기까지 끝난 기사 (최신순) */
  articles: BriefingArticle[];
  /** 가져오지 못한 검색어와 그 이유 */
  failedQueries: { query: string; reason: string }[];
  /** 단계마다 몇 건이 남았는지 (화면 안내와 점검용) */
  counts: {
    /** 언론사 RSS와 구글 RSS에서 가져온 기사 전체 */
    fetched: number;
    /** 그중 지정 언론사 기사이면서 물가 관련 키워드가 맞는 기사 */
    designated: number;
    /** 그중 24시간 이내 기사 */
    recent: number;
    /** 중복을 합친 뒤 남은 기사 */
    final: number;
    /** 본문을 읽은 기사 */
    bodyOk: number;
    /** 본문 읽기를 시도했지만 실패한 기사 */
    bodyFailed: number;
    /** 20건 제한 때문에 제목만 남은 기사 */
    titleOnly: number;
  };
}
