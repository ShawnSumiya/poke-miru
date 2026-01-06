// サブスクリプション状態の管理（クライアント側）

/**
 * ローカルストレージからStripe Customer IDを取得
 */
export function getStripeCustomerId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("stripe_customer_id");
}

/**
 * ローカルストレージにStripe Customer IDを保存
 */
export function setStripeCustomerId(customerId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("stripe_customer_id", customerId);
}

/**
 * ローカルストレージからPro状態を取得
 */
export function getProStatus(): boolean {
  if (typeof window === "undefined") return false;
  const status = localStorage.getItem("pro_status");
  return status === "true";
}

/**
 * ローカルストレージにPro状態を保存
 */
export function setProStatus(isPro: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("pro_status", String(isPro));
}

/**
 * サーバーからPro状態を確認
 */
export async function verifyProStatus(): Promise<boolean> {
  const customerId = getStripeCustomerId();
  if (!customerId) {
    setProStatus(false);
    return false;
  }

  try {
    const response = await fetch("/api/subscription/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });

    if (!response.ok) {
      setProStatus(false);
      return false;
    }

    const data = await response.json();
    setProStatus(data.isPro);
    return data.isPro;
  } catch (error) {
    console.error("Pro status verification error:", error);
    setProStatus(false);
    return false;
  }
}



