import { NextResponse } from "next/server";
import { checkSubscriptionStatus } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const { customerId } = await req.json();

    if (!customerId || typeof customerId !== "string") {
      return NextResponse.json(
        { error: "Customer ID is required" },
        { status: 400 }
      );
    }

    const isPro = await checkSubscriptionStatus(customerId);

    return NextResponse.json({ isPro, customerId });
  } catch (error: any) {
    console.error("Subscription status check error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to check subscription status" },
      { status: 500 }
    );
  }
}




