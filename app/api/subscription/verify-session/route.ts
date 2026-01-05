import { NextResponse } from "next/server";
import { getCustomerIdFromSession, checkSubscriptionStatus } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 }
      );
    }

    // セッションからCustomer IDを取得
    const customerId = await getCustomerIdFromSession(sessionId);

    if (!customerId) {
      return NextResponse.json(
        { error: "Customer ID not found in session" },
        { status: 404 }
      );
    }

    // サブスクリプション状態を確認
    const isPro = await checkSubscriptionStatus(customerId);

    return NextResponse.json({
      customerId,
      isPro,
    });
  } catch (error: any) {
    console.error("Session verification error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to verify session" },
      { status: 500 }
    );
  }
}

