// 같은 요청을 짧은 시간 안에 반복하지 않도록 결과를 서버 메모리에 잠깐 보관한다.
// 구글이 자동 요청을 의심해 차단(CAPTCHA)한 적이 있어서, 구글·언론사 사이트·OpenAI에 가는 요청 수를 줄이는 것이 목적이다.
// 서버를 다시 켜면 비워진다. 실패한 결과는 보관하지 않는다(다음에 다시 시도할 수 있게).

interface Entry<T> {
  expiresAt: number;
  value: Promise<T>;
}

const MAX_ENTRIES = 500;
const store = new Map<string, Entry<unknown>>();

/** 오래된 것부터 지워 최대 개수를 지킨다 */
function trim(now: number) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * key로 보관된 결과가 있고 아직 유효하면 그것을 쓰고, 아니면 work를 실행해 결과를 보관한다.
 * 같은 key를 동시에 여러 번 요청해도 work는 한 번만 실행된다. work가 실패하면 보관하지 않고 오류를 그대로 던진다.
 */
export function cached<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const value = work().catch((error: unknown) => {
    store.delete(key);
    throw error;
  });
  store.set(key, { expiresAt: now + ttlMs, value });
  trim(now);
  return value;
}

export const MINUTE = 60 * 1000;
