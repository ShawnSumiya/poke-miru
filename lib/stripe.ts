// Stripeサブスクリプション管理

import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY environment variable is not set");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-11-20.acacia",
});

// Proプランの価格ID
export const PRO_PRICE_ID = "price_1Sm9AvAxstjNYgiI1VZsnG5W";

/**
 * Stripe Customer IDからサブスクリプション状態を取得
 * @param customerId Stripe Customer ID
 * @returns アクティブなサブスクリプションがあるかどうか
 */
export async function checkSubscriptionStatus(
  customerId: string
): Promise<boolean> {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    // アクティブなサブスクリプションがあり、Proプラン（指定の価格ID）を含んでいるかチェック
    if (subscriptions.data.length > 0) {
      const subscription = subscriptions.data[0];
      return subscription.items.data.some(
        (item) => item.price.id === PRO_PRICE_ID
      );
    }

    return false;
  } catch (error) {
    console.error("Stripe subscription check error:", error);
    return false;
  }
}

/**
 * セッションIDからCustomer IDを取得
 * @param sessionId Stripe Checkout Session ID
 * @returns Customer ID
 */
export async function getCustomerIdFromSession(
  sessionId: string
): Promise<string | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session.customer as string | null;
  } catch (error) {
    console.error("Stripe session retrieval error:", error);
    return null;
  }
}

