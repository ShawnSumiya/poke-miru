// IPアドレスベースのレート制限管理

interface RateLimitEntry {
  count: number;
  resetAt: number; // タイムスタンプ（ミリ秒）
}

// インメモリストレージ（本番環境ではRedisなどを推奨）
const rateLimitStore = new Map<string, RateLimitEntry>();

// 1日のミリ秒数
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * IPアドレスから使用回数を取得し、制限をチェック
 * @param ipAddress IPアドレス
 * @param maxRequests 最大リクエスト数（デフォルト: 3）
 * @returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(
  ipAddress: string,
  maxRequests: number = 3
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ipAddress);

  // エントリが存在しない、またはリセット時刻を過ぎている場合
  if (!entry || now > entry.resetAt) {
    // 新しいエントリを作成（24時間後にリセット）
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + ONE_DAY_MS,
    };
    rateLimitStore.set(ipAddress, newEntry);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: newEntry.resetAt,
    };
  }

  // 制限を超えている場合
  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  // カウントを増やす
  entry.count++;
  rateLimitStore.set(ipAddress, entry);

  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * IPアドレスをリクエストから取得
 * @param req Requestオブジェクト
 * @returns IPアドレス
 */
export function getClientIP(req: Request): string {
  // Vercelやその他のプロキシ経由の場合
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",");
    return ips[0]?.trim() || "unknown";
  }

  // 直接接続の場合
  const realIP = req.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }

  // フォールバック
  return "unknown";
}

/**
 * 古いエントリをクリーンアップ（メモリリーク防止）
 */
export function cleanupOldEntries() {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(ip);
    }
  }
}

// 定期的にクリーンアップ（1時間ごと）
if (typeof setInterval !== "undefined") {
  setInterval(cleanupOldEntries, 60 * 60 * 1000);
}



