"use client";
import Link from "next/link";
import { XCircle } from "lucide-react";

export default function SubscriptionCancelPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-6 text-center max-w-md">
        <div className="text-gray-400 mb-4">
          <XCircle size={64} className="mx-auto" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-4">決済がキャンセルされました</h1>
        <p className="text-gray-600 mb-6">
          いつでもProプランにアップグレードできます。
        </p>
        <Link
          href="/"
          className="inline-block bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition"
        >
          ホームに戻る
        </Link>
      </div>
    </div>
  );
}

