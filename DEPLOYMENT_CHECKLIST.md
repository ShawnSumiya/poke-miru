# 本番環境デプロイチェックリスト

## ✅ デプロイ前の確認事項

### 1. 環境変数の設定

Vercel（または使用しているホスティングサービス）の環境変数設定で、以下を確認してください：

#### 必須環境変数
- [ ] `OPENAI_API_KEY` - OpenAI APIキー
- [ ] `EBAY_APP_ID` - eBay Finding API アプリID（現在: `ShawnSum-PokeMiru-PRD-d46241164-bfb2dd8b`）
- [ ] `STRIPE_SECRET_KEY` - Stripe シークレットキー（本番環境用: `sk_live_...`）
- [ ] `STRIPE_WEBHOOK_SECRET` - Stripe Webhook署名シークレット（本番環境用）

#### 推奨環境変数
- [ ] `ZENROWS_API_KEY` - ZenRows APIキー（遊々亭スクレイピングの403エラー回避用）

### 2. コードの確認

- [x] `IS_TEST_MODE = false` になっている（✅ 確認済み）
- [x] eBay APIキーが環境変数から読み込まれる（✅ 修正済み）
- [x] eBayボット検出対策が実装されている（✅ 実装済み）

### 3. eBayボット検出対策の確認

実装済みの対策：
- ✅ グローバルレート制限（1分間に最大3リクエスト）
- ✅ ランダム待機時間（5-15秒）
- ✅ キャッシュ機能（30分間）
- ✅ 指数バックオフによるリトライ
- ✅ ボット検出時の自動ブロック（30分間）
- ✅ ブロック時のPriceChartingフォールバック

### 4. Stripe設定（Proプラン機能を使用する場合）

- [ ] Stripe本番環境のAPIキーを設定
- [ ] Webhookエンドポイントを設定
  - URL: `https://your-domain.com/api/subscription/webhook`
  - イベント: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Webhook署名シークレットを環境変数に設定

### 5. デプロイ手順（Vercelの場合）

1. **GitHubにプッシュ**
   ```bash
   git add .
   git commit -m "本番環境対応: eBayボット検出対策実装"
   git push origin main
   ```

2. **Vercelで環境変数を設定**
   - Vercel Dashboard → Project Settings → Environment Variables
   - 上記の環境変数をすべて設定

3. **デプロイ**
   - Vercelが自動的にデプロイを開始
   - または手動で「Redeploy」を実行

4. **動作確認**
   - [ ] カード画像のアップロードが正常に動作する
   - [ ] 価格取得が正常に動作する
   - [ ] eBayからの価格取得が正常に動作する（レート制限内）
   - [ ] ボット検出時はPriceChartingにフォールバックする
   - [ ] Proプラン機能が正常に動作する（該当する場合）

### 6. 本番環境での監視ポイント

#### ログで確認すべき項目
- eBayレート制限の警告メッセージ
- ボット検出の警告メッセージ
- キャッシュヒット率
- エラーレート

#### 注意すべき状況
- 複数のユーザーが同時にアクセスした場合、eBayレート制限に達する可能性
- ボット検出が発生した場合、30分間eBayアクセスがブロックされる
- ブロック中はPriceChartingの価格のみを使用

### 7. トラブルシューティング

#### eBayボット検出が頻繁に発生する場合
- レート制限の設定をさらに厳しくする（`EBAY_MAX_REQUESTS_PER_MINUTE`を2に減らす）
- 待機時間を延長する（`EBAY_MIN_INTERVAL`を10秒、`EBAY_MAX_INTERVAL`を20秒に）

#### 遊々亭で403エラーが発生する場合
- `ZENROWS_API_KEY`が正しく設定されているか確認
- ZenRowsのプレミアムプロキシが有効になっているか確認

#### 価格が取得できない場合
- ログを確認して、どのサービスでエラーが発生しているか確認
- PriceChartingの価格がフォールバックとして使用されているか確認

## 🚀 デプロイ準備完了

上記のチェックリストを確認し、すべての項目にチェックを入れたら、本番環境へのデプロイを実行してください。

