import "server-only";

// 給簡訊 adapter 共用的 HTTP 重試 helper。
// 政策與 src/lib/email/broadcast.ts 的 postBatchWithRetry 完全一致，
// 之後新增任何簡訊商 adapter 都直接用這支，不要各自再寫一份。
//
// dryrun 不連網，所以目前沒有呼叫者——這是為了接三竹時不必重寫而預先備好的。

export const MAX_ATTEMPTS = 3; // 初次 + 2 次重試
export const BACKOFF_BASE_MS = 2_000; // 指數退避：2s → 4s
export const RETRY_AFTER_CAP_MS = 10_000; // 429 Retry-After 上限
export const FETCH_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET 版：查詢送達狀態用。政策與 postWithRetry 完全一致，只是不帶 body。 */
export async function getWithRetry(
  url: string,
  headers: Record<string, string>,
  tag: string,
): Promise<Response | { networkError: string }> {
  return postWithRetry(url, { method: "GET", headers }, tag);
}

/** 429/5xx/網路錯誤自動退避重試；其他 4xx 不重試直接回傳失敗 response。
 *  網路錯誤回傳 discriminated union 而非 throw，呼叫端用 `"networkError" in res` 判斷。 */
export async function postWithRetry(
  url: string,
  init: RequestInit,
  tag: string,
): Promise<Response | { networkError: string }> {
  let lastNetworkError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      lastNetworkError = e instanceof Error ? e.message : String(e);
      console.error(`[${tag}] 網路錯誤（第 ${attempt} 次）：`, lastNetworkError);
    }

    if (res) {
      const retryable = res.status === 429 || res.status >= 500;
      if (res.ok || !retryable) return res;
      if (attempt < MAX_ATTEMPTS) {
        const retryAfterSec = Number(res.headers.get("retry-after"));
        const waitMs =
          res.status === 429 && Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, RETRY_AFTER_CAP_MS)
            : BACKOFF_BASE_MS * 2 ** (attempt - 1);
        console.error(
          `[${tag}] HTTP ${res.status}，${waitMs}ms 後重試（第 ${attempt}/${MAX_ATTEMPTS} 次）`,
        );
        await sleep(waitMs);
        continue;
      }
      return res; // 用盡重試，回傳最後的失敗 response
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
  }
  return { networkError: lastNetworkError || "連線失敗" };
}
