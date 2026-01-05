This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## 環境変数の設定

プロジェクトルートに `.env.local` ファイルを作成し、以下の環境変数を設定してください：

```env
# Google Gemini API（無料枠あり！優先使用・推奨）
GEMINI_API_KEY=your_gemini_api_key_here

# OpenAI API（有料、フォールバック用）
OPENAI_API_KEY=your_openai_api_key_here

# eBay API
EBAY_APP_ID=your_ebay_app_id_here

# Stripe（Proプラン決済用）
STRIPE_SECRET_KEY=sk_test_... # テスト環境のシークレットキー
STRIPE_WEBHOOK_SECRET=whsec_... # Webhook署名検証用（本番環境で必要）
```

### AI APIの選択

- **Google Gemini API**: **無料枠が大きく、優先使用！** 最初にGemini APIを使用します
- **OpenAI API**: 有料ですが、高精度な解析が可能です。Gemini APIが失敗した場合に自動的にフォールバックします

### Gemini APIキーの取得方法（無料）

1. [Google AI Studio](https://makersuite.google.com/app/apikey) にアクセス
2. Googleアカウントでログイン
3. 「Create API Key」をクリック
4. 生成されたAPIキーを `.env.local` の `GEMINI_API_KEY` に設定

**無料枠**: Gemini APIは月60リクエスト/分まで無料で使用できます（十分な量です！）

### Stripe APIキーの取得方法

1. [Stripe Dashboard](https://dashboard.stripe.com/) にアクセス
2. テスト環境で「開発者」→「APIキー」からシークレットキーを取得
3. `.env.local` の `STRIPE_SECRET_KEY` に設定
4. Webhookを設定する場合（本番環境推奨）:
   - 「開発者」→「Webhook」からエンドポイントを追加
   - エンドポイントURL: `https://your-domain.com/api/subscription/webhook`
   - イベント: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - 署名シークレットを `STRIPE_WEBHOOK_SECRET` に設定

### レート制限とProプラン

- **無料プラン**: 1日3回まで検索可能（IPアドレスベース）
- **Proプラン（月額980円）**: 
  - 無制限検索
  - 検索履歴の自動保存
  - 「利益が出るカードリスト」のCSV出力

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
