import { NextResponse } from "next/server";
import { stripe, PRO_PRICE_ID } from "@/lib/stripe";
import { headers } from "next/headers";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "No signature" },
      { status: 400 }
    );
  }

  let event;
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    }
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  // サブスクリプション関連のイベントを処理
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    console.log("Checkout session completed:", session.id);
    // ここで必要に応じてデータベースに保存する処理を追加
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const subscription = event.data.object as any;
    console.log("Subscription created/updated:", subscription.id);
    // ここで必要に応じてデータベースに保存する処理を追加
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as any;
    console.log("Subscription deleted:", subscription.id);
    // ここで必要に応じてデータベースから削除する処理を追加
  }

  return NextResponse.json({ received: true });
}

