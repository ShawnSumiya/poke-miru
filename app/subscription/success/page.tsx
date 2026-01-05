"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Crown } from "lucide-react";
import { setStripeCustomerId, setProStatus, verifyProStatus } from "@/lib/subscription";
import Link from "next/link";

function SubscriptionSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verifySubscription = async () => {
      if (!sessionId) {
        setError("セッションIDが見つかりません");
        setIsLoading(false);
        return;
      }

      try {
        // セッションからCustomer IDを取得
        const response = await fetch("/api/subscription/verify-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });

        if (!response.ok) {
          throw new Error("サブスクリプションの確認に失敗しました");
        }

        const data = await response.json();
        
        // Customer IDを保存
        if (data.customerId) {
          setStripeCustomerId(data.customerId);
        }

        // Pro状態を確認して保存
        await verifyProStatus();
        
        setIsLoading(false);
      } catch (err: any) {
        console.error("Subscription verification error:", err);
        setError(err.message || "エラーが発生しました");
        setIsLoading(false);
      }
    };

    verifySubscription();
  }, [sessionId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">処理中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center max-w-md">
          <div className="text-red-500 mb-4">
            <CheckCircle size={48} className="mx-auto" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">エラーが発生しました</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <Link
            href="/"
            className="inline-block bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 transition"
          >
            ホームに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-6 text-center max-w-md">
        <div className="text-green-500 mb-4">
          <CheckCircle size={64} className="mx-auto" />
        </div>
        <div className="flex items-center justify-center gap-2 mb-4">
          <Crown className="text-yellow-500" size={24} />
          <h1 className="text-2xl font-bold text-gray-800">Proプランにアップグレードしました！</h1>
        </div>
        <p className="text-gray-600 mb-6">
          これで無制限で検索でき、すべてのPro機能が利用できます。
        </p>
        <Link
          href="/"
          className="inline-block bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold py-3 px-6 rounded-lg hover:from-yellow-500 hover:to-orange-600 transition"
        >
          アプリに戻る
        </Link>
      </div>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-sm p-6 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">読み込み中...</p>
          </div>
        </div>
      }
    >
      <SubscriptionSuccessContent />
    </Suspense>
  );
}

