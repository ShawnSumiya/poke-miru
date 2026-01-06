import Link from 'next/link';

export default function LegalPage() {
  return (
    <div className="max-w-2xl mx-auto p-8 text-gray-800">
      <h1 className="text-3xl font-bold mb-8">特定商取引法に基づく表記</h1>

      <div className="space-y-6">
        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">販売業者（運営者）</h2>
          <p>角谷 ショーン洋平</p> 
          {/* 法人の場合は会社名 */}
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">所在地</h2>
          <p>〒161-0032<br />東京都新宿区中落合3-24-13 AXAS新宿中落合503</p>
          {/* ※自宅住所を公開したくない場合、バーチャルオフィス等の住所でも可ですが、Stripe審査には正確な情報が必要です */}
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">電話番号</h2>
          <p>080-4449-9955</p>
          <p className="text-sm text-gray-500">※お電話でのサポートは行っておりません。お問い合わせはメールにてお願いいたします。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">メールアドレス</h2>
          <p>shawn.sumiya@gmail.com</p>
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">販売価格</h2>
          <p>月額 980円（税込）</p>
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">商品代金以外の必要料金</h2>
          <p>インターネット接続にかかる通信料はお客様のご負担となります。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">お支払い方法・時期</h2>
          <p>クレジットカード決済（Stripe）<br />お申し込み時に即時決済され、以降1ヶ月ごとに自動更新されます。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">商品の引き渡し時期</h2>
          <p>決済完了後、直ちにご利用いただけます。</p>
        </section>

        <section>
          <h2 className="text-lg font-bold border-b border-gray-300 mb-2">返品・キャンセルについて</h2>
          <p>サービスの性質上、返品・返金はお受けしておりません。<br />解約はいつでも可能ですが、日割り計算による返金は行われません。</p>
        </section>
      </div>

      <div className="mt-12">
        <Link href="/" className="text-blue-600 hover:underline">
          &larr; トップページに戻る
        </Link>
      </div>
    </div>
  );
}