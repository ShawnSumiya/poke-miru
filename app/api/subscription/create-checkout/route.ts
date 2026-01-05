import { NextResponse } from "next/server";
import { stripe, PRO_PRICE_ID } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const { customerId } = await req.json();

    // Checkout Sessionを作成
    const session = await stripe.checkout.sessions.create({
      customer: customerId || undefined,
      mode: "subscription",
      line_items: [
        {
          price: PRO_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${req.headers.get("origin") || "http://localhost:3000"}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin") || "http://localhost:3000"}/subscription/cancel`,
      metadata: {
        plan: "pro",
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout session creation error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

