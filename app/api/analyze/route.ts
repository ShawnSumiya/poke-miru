import { NextResponse } from "next/server";
import OpenAI from "openai";
import axios from "axios";
import * as cheerio from "cheerio";
import { checkRateLimit, getClientIP } from "@/lib/rateLimit";
import { checkSubscriptionStatus } from "@/lib/stripe";

const IS_TEST_MODE = false;

const MAX_PRICE = 2000000;
const USD_JPY_RATE = 150;
const FREE_TIER_LIMIT = 3; // 無料プラン: 1日3回まで

// OpenAIクライアントを取得する関数（遅延初期化）
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return new OpenAI({ apiKey });
}

export async function POST(req: Request) {
  try {
    const { image, customerId } = await req.json();
    if (!image) return NextResponse.json({ error: "Image required" }, { status: 400 });

    // Pro機能チェック
    let isPro = false;
    if (customerId && typeof customerId === "string") {
      try {
        isPro = await checkSubscriptionStatus(customerId);
      } catch (error) {
        console.error("Subscription check error:", error);
        // エラーが発生しても続行（無料プランとして扱う）
      }
    }

    // Proユーザーでない場合、レート制限をチェック
    if (!isPro) {
      const ipAddress = getClientIP(req);
      const rateLimitResult = checkRateLimit(ipAddress, FREE_TIER_LIMIT);

      if (!rateLimitResult.allowed) {
        const resetDate = new Date(rateLimitResult.resetAt);
        return NextResponse.json(
          {
            error: "Rate limit exceeded",
            message: `1日の検索上限（${FREE_TIER_LIMIT}回）に達しました。Proプランにアップグレードすると無制限で検索できます。`,
            resetAt: rateLimitResult.resetAt,
            resetAtFormatted: resetDate.toISOString(),
            upgradeRequired: true,
          },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": String(FREE_TIER_LIMIT),
              "X-RateLimit-Remaining": String(rateLimitResult.remaining),
              "X-RateLimit-Reset": String(rateLimitResult.resetAt),
            },
          }
        );
      }
    }

    let aiData;
    if (IS_TEST_MODE) {
       aiData = { cardName: "Jolteon ex", cardNumber: "209/SAR", jpName: "サンダースex", yuyuteiKeyword: "サンダースex", isSlab: false, grade: null };
    } else {
      console.log("🚀 OpenAI問い合わせ中...");
      const openai = getOpenAIClient();
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `トレカ鑑定士です。画像を見てJSONのみ返却。
必須項目:
- cardName: 英語名 (例: "Pikachu")
- cardNumber: 型番 (例: "151/165" や "209/SAR" など、レアリティ含む場合は必ず入れる)
- jpName: 日本語名 (例: "ピカチュウ")
- yuyuteiKeyword: 遊々亭検索用（日本語名。例: "ピカチュウ"）
- rarity: string (レアリティ。SAR, SR, UR, HR, AR, Master Ball, RR など。不明ならnull)
- isJapanese: boolean (カードが日本語版かどうか。カードのテキストが日本語で書かれている、または日本語版のセット名が表示されている場合はtrue)
- isSlab: boolean
- grade: number | null`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "このカードを特定して。" },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });
      const content = aiResponse.choices[0].message.content;
      aiData = JSON.parse(content || "{}");
    }

    console.log(`🤖 特定: ${aiData.jpName} (${aiData.cardNumber}) [${aiData.rarity}]`);

    // 2. 価格調査
    // ★ レアリティを考慮した強力な検索ワード生成
    const rarity = aiData.rarity || aiData.cardNumber?.split("/")[1] || ""; // 型番の / の後ろもレアリティ扱い
    const cleanRarity = rarity.replace(/[^a-zA-Z]/g, "").toUpperCase(); // 記号除去して大文字化

    const yuyuteiKeywords = [
      // 1. 名前 + レアリティ (例: サンダースex SAR) ← これが一番確実
      cleanRarity ? `${aiData.jpName} ${cleanRarity}` : "",
      // 2. 名前 + 型番 (例: サンダースex 209/SAR)
      `${aiData.jpName} ${aiData.cardNumber}`,
      // 3. 名前のみ (例: サンダースex)
      aiData.yuyuteiKeyword,
    ].filter(Boolean) as string[];

    // ★ 画像が既にPSA10の場合、eBay検索をスキップ（PSA10価格が混入するのを防ぐ）
    const isAlreadyPsa10 = aiData.isSlab && aiData.grade === 10;
    console.log(`📋 カード情報: isSlab=${aiData.isSlab}, grade=${aiData.grade}, isAlreadyPsa10=${isAlreadyPsa10}`);
    
    // ★ 日本語版か英語版かを判断して価格取得
    const isJapanese = aiData.isJapanese ?? false; // デフォルトはfalse（英語版）
    console.log(`🌏 カード版: ${isJapanese ? '日本語版' : '英語版'}`);
    
    const [usData, jpPrice] = await Promise.all([
      fetchUsPriceWithFallback(aiData.cardName, aiData.cardNumber, isAlreadyPsa10, isJapanese),
      // ★ 検索時に「探すべきレアリティ」も渡す
      fetchYuyuteiPriceWithFallback(yuyuteiKeywords, aiData.jpName, cleanRarity)
    ]);

    // 数値整理（PriceChartingから取得した価格をバックアップとして保持）
    const priceChartingRawPrice = usData.rawPrice || 0;
    const priceChartingPsa10Price = usData.psa10Price || 0;
    let rawPriceUsd = priceChartingRawPrice;
    let psa10PriceUsd = priceChartingPsa10Price;
    let isPsa10Estimated = usData.isEstimated;
    const validJpPrice = jpPrice || 0;
    
    // デバッグ: PriceChartingから取得した価格をログ出力
    console.log(`💰 価格取得結果 (PriceCharting):`);
    console.log(`  rawPriceUsd: $${priceChartingRawPrice} (取得元: ${usData.url || '不明'})`);
    console.log(`  psa10PriceUsd: $${priceChartingPsa10Price} (推定: ${isPsa10Estimated})`);

    // ★ eBayから価格を取得（直近の売却価格を優先）
    if (!isAlreadyPsa10) {
      // 未鑑定価格をeBayから取得
      console.log(`🔍 eBayから未鑑定価格を取得します...`);
      const ebayRawPrice = await fetchEbayDirect(aiData.cardName, aiData.cardNumber);
      if (ebayRawPrice > 0) {
        console.log(`✅ eBayから未鑑定価格を取得: $${ebayRawPrice}`);
        rawPriceUsd = ebayRawPrice;
      } else {
        console.log(`❌ eBayから未鑑定価格を取得できませんでした（PriceChartingの価格を使用）`);
      }
    }
    
    // ★ PSA10価格は常にeBayから取得（画像がPSA10の場合でも表示するため）
    console.log(`🔍 eBayからPSA10価格を取得します...`);
    const ebayPsa10Price = await fetchEbayPsa10Price(aiData.cardName, aiData.cardNumber, isJapanese, aiData.jpName);
    if (ebayPsa10Price > 0) {
      console.log(`✅ eBayからPSA10価格を取得: $${ebayPsa10Price}`);
      psa10PriceUsd = ebayPsa10Price;
      isPsa10Estimated = false; // eBayから取得したので推定ではない
    } else {
      console.log(`❌ eBayからPSA10価格を取得できませんでした`);
      // PSA10補完（eBayから取得できなかった場合、推定価格を計算）
      if (rawPriceUsd > 0 && psa10PriceUsd === 0) {
        psa10PriceUsd = parseFloat((rawPriceUsd * 2.8).toFixed(2));
        isPsa10Estimated = true;
        console.log(`📊 PSA10推定価格を計算: $${rawPriceUsd} × 2.8 = $${psa10PriceUsd}`);
      } else if (priceChartingPsa10Price > 0) {
        // PriceChartingの価格を使用
        psa10PriceUsd = priceChartingPsa10Price;
        isPsa10Estimated = usData.isEstimated;
        console.log(`📊 PriceChartingのPSA10価格を使用: $${psa10PriceUsd}`);
      } else {
        console.log(`⚠️ PSA10価格を取得できませんでした（未鑑定価格も取得できていないため推定不可）`);
      }
    }

    // 3. 損益計算
    const rawPriceYen = Math.floor(rawPriceUsd * USD_JPY_RATE);
    const psa10PriceYen = Math.floor(psa10PriceUsd * USD_JPY_RATE);

    // eBay手数料・送料の詳細計算
    // eBay最終価値手数料: 12.9% (トレーディングカード)
    // 決済手数料: 3.6% (Managed Payments)
    // 送料: 国際郵便で約1500円（EMS/国際eパケット）
    const EBAY_FINAL_VALUE_FEE_RATE = 0.129; // 12.9%
    const EBAY_PAYMENT_FEE_RATE = 0.036; // 3.6%
    const EBAY_SHIPPING_COST = 1500; // 送料（円）
    const EBAY_TOTAL_FEE_RATE = EBAY_FINAL_VALUE_FEE_RATE + EBAY_PAYMENT_FEE_RATE; // 合計16.5%

    // 未鑑定の手取り（eBay）
    const rawEbayFees = rawPriceYen > 0 ? Math.floor(rawPriceYen * EBAY_TOTAL_FEE_RATE) : 0;
    const rawNetIncome = rawPriceYen > 0 ? Math.floor(rawPriceYen - rawEbayFees - EBAY_SHIPPING_COST) : 0;
    
    // PSA10の手取り（eBay）
    const psa10EbayFees = psa10PriceYen > 0 ? Math.floor(psa10PriceYen * EBAY_TOTAL_FEE_RATE) : 0;
    const psa10NetIncome = psa10PriceYen > 0 ? Math.floor(psa10PriceYen - psa10EbayFees - EBAY_SHIPPING_COST) : 0;

    // 日本での売却（遊々亭）の手取り計算
    // 遊々亭の手数料: 約10%（買取価格がそのまま手取り）
    const jpNetIncome = validJpPrice; // 遊々亭は買取価格がそのまま手取り

    // 利益計算（eBay手取り - 日本での手取り）
    // 両方とも手取りで比較する
    const rawProfit = (rawNetIncome > 0 && jpNetIncome > 0) ? rawNetIncome - jpNetIncome : 0;
    const psa10Profit = (psa10NetIncome > 0 && jpNetIncome > 0) ? psa10NetIncome - jpNetIncome : 0;
    
    // 判定ロジック（手数料・送料を加味した利益比較）
    // ★ 常に未鑑定同士で比較（rawProfitを使用）
    let recommendation = "データ不足";
    let recColor = "gray";
    let profitComparison = "";

    if (isAlreadyPsa10) {
       recommendation = "💎 PSA10 保有中";
       recColor = "green";
       // PSA10の場合でも、未鑑定同士で比較（未鑑定で売る場合の比較）
       if (rawNetIncome > 0 && jpNetIncome > 0) {
         if (rawProfit >= 1000) {
           profitComparison = `eBayの方が¥${rawProfit.toLocaleString()}お得（手数料・送料込み）`;
         } else if (rawProfit > -500) {
           profitComparison = "どちらでもほぼ同じ（手数料・送料込み）";
         } else {
           profitComparison = `日本の方が¥${Math.abs(rawProfit).toLocaleString()}お得（手数料・送料込み）`;
         }
       }
    } else {
       // 両方の価格が取得できている場合のみ判定（未鑑定同士で比較）
       if (rawNetIncome > 0 && jpNetIncome > 0) {
         if (rawProfit >= 1000) {
           recommendation = "🇺🇸 eBay輸出がおすすめ";
           recColor = "green";
           profitComparison = `eBayの方が¥${rawProfit.toLocaleString()}お得（手数料・送料込み）`;
         } else if (rawProfit > -500) {
           recommendation = "⚖️ 国内外どちらでも";
           recColor = "blue";
           profitComparison = "どちらでもほぼ同じ（手数料・送料込み）";
         } else {
           recommendation = "🇯🇵 日本で売るべき";
           recColor = "red";
           profitComparison = `日本の方が¥${Math.abs(rawProfit).toLocaleString()}お得（手数料・送料込み）`;
         }
       } else if (rawNetIncome > 0) {
         recommendation = "🇺🇸 eBay輸出がおすすめ";
         recColor = "green";
       } else if (jpNetIncome > 0) {
         recommendation = "🇯🇵 日本で売るべき";
         recColor = "red";
       }
    }

    // eBay検索URLを生成（アフィリエイトリンク）
    const cleanCardNumber = aiData.cardNumber.replace(/^#+/, "");
    const ebayQuery = `${aiData.cardName} ${cleanCardNumber} Pokemon`.trim();
    const ebaySearchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(ebayQuery)}&LH_Sold=1&LH_Complete=1&_sop=12&campid=5339136426`;

    return NextResponse.json({
      cardName: aiData.cardName,
      cardNumber: aiData.cardNumber,
      jpName: aiData.jpName,
      searchKeyword: usData.url, // PriceChartingのURL（互換性のため残す）
      ebaySearchUrl: ebaySearchUrl, // eBayの検索URL
      
      jpPrice: validJpPrice,
      jpNetIncome: jpNetIncome, // 日本での売却手取り
      
      usPrice: rawPriceYen,
      usPriceUsd: rawPriceUsd,
      ebayNetIncome: rawNetIncome,
      ebayFees: rawEbayFees, // eBay手数料
      ebayShippingCost: EBAY_SHIPPING_COST, // 送料
      
      psa10Price: psa10PriceYen,
      psa10PriceUsd: psa10PriceUsd,
      psa10NetIncome: psa10NetIncome,
      psa10EbayFees: psa10EbayFees, // PSA10のeBay手数料
      
      isPsa10Estimated: isPsa10Estimated,
      isSlab: aiData.isSlab,
      grade: aiData.grade,
      
      profit: rawProfit,
      psa10Profit: psa10Profit, // PSA10の利益
      profitComparison: profitComparison, // 利益比較の説明
      recommendation: recommendation,
      recColor: recColor,
      
      isValid: (rawPriceUsd > 0 || validJpPrice > 0),
    });

  } catch (error: any) {
    console.error("Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// スクレイピング関数群

async function fetchUsPriceWithFallback(cardName: string, cardNumber: string, skipEbay: boolean = false, isJapanese: boolean = false) {
  console.log(`🔍 価格取得開始: ${cardName} ${cardNumber} (${isJapanese ? '日本語版' : '英語版'})`);
  
  let data = await fetchPriceChartingSafe(cardName, cardNumber, isJapanese);
  if (data.rawPrice > 0) {
    console.log(`✅ PriceChartingから取得: $${data.rawPrice} (未鑑定)`);
    return data;
  }
  console.log(`❌ PriceChartingから取得できませんでした`);
  
  // ★ 画像が既にPSA10の場合、eBay検索をスキップ（PSA10価格が混入するのを防ぐ）
  if (skipEbay) {
    console.log("⚠️ 画像がPSA10のため、eBay検索をスキップ（未鑑定価格が取得できないため）");
    return { rawPrice: 0, psa10Price: 0, url: "", isEstimated: false };
  }
  
  console.log(`🔍 eBayから取得を試みます...`);
  const ebayPrice = await fetchEbayDirect(cardName, cardNumber);
  if (ebayPrice > 0) {
    console.log(`✅ eBayから取得: $${ebayPrice} (未鑑定として扱う)`);
    return { rawPrice: ebayPrice, psa10Price: parseFloat((ebayPrice * 2.8).toFixed(2)), url: "https://www.ebay.com", isEstimated: true };
  }
  console.log(`❌ eBayからも取得できませんでした`);
  return { rawPrice: 0, psa10Price: 0, url: "", isEstimated: false };
}

async function fetchPriceChartingSafe(cardName: string, cardNumber: string, isJapanese: boolean = false) {
  try {
    const cleanCardName = cardName.replace(/[^\w\s]/gi, "").trim(); 
    const cleanCardNumber = (cardNumber || "").replace(/[^\w\/]/g, "").trim();
    
    // ★ 画像から判断した版に応じて検索クエリを調整
    const query = isJapanese 
      ? `${cleanCardName} ${cleanCardNumber} Japanese`.trim()
      : `${cleanCardName} ${cleanCardNumber}`.trim();
    const searchUrl = `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;
    
    console.log(`🔍 PriceCharting検索: "${query}" (${isJapanese ? '日本語版' : '英語版'})`);
    
    const { data } = await axios.get(searchUrl, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }, timeout: 4000 });
    const $ = cheerio.load(data);
    
    // ★ 画像から判断した版に応じて検索結果をフィルタリング
    let targetRow = null;
    if (isJapanese) {
      // 日本語版の場合、「Japanese」が含まれている行を探す
      $("#games_table tbody tr").each((_, el) => {
        const $el = $(el);
        const title = $el.find(".title a").text().toLowerCase();
        if (title.includes("japanese")) {
          targetRow = $el;
          console.log(`✅ 日本語版カードを発見: ${title}`);
          return false; // ループを終了
        }
      });
    } else {
      // 英語版の場合、「Japanese」が含まれていない行を探す
      $("#games_table tbody tr").each((_, el) => {
        const $el = $(el);
        const title = $el.find(".title a").text().toLowerCase();
        if (!title.includes("japanese")) {
          targetRow = $el;
          console.log(`✅ 英語版カードを発見: ${title}`);
          return false; // ループを終了
        }
      });
    }
    
    // 適切な版が見つからなかった場合、最初の行を使用
    if (!targetRow) {
      targetRow = $("#games_table tbody tr").first();
      console.log(`⚠️ 適切な版が見つからず、最初の結果を使用`);
    }
    
    if (targetRow.length === 0) return { rawPrice: 0, psa10Price: 0, url: searchUrl, isEstimated: false };
    
    const firstRow = targetRow;
    const parsePrice = (t: string) => { const m = t?.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/); return m ? parseFloat(m[1].replace(/,/g, "")) : 0; };
    
    // ★ Pokemonカードの場合、PriceChartingの検索結果ページでは:
    // 検索結果ページでは価格の対応が不正確な可能性があるため、
    // 個別ページにアクセスするか、eBayから取得した価格を優先する
    // ここではバックアップとして最低限の価格を取得（eBayが優先）
    let rawPrice = parsePrice(firstRow.find(".new_price").text()) || parsePrice(firstRow.find(".used_price").text());
    let psa10Price = 0; // 検索結果ページからはPSA10価格を取得しない（eBayから取得）
    let isEstimated = false;
    
    // PSA10価格はeBayから取得するため、ここでは0のまま
    
    if (rawPrice > MAX_PRICE) rawPrice = 0;
    
    console.log(`📊 PriceCharting価格取得（バックアップ）: 未鑑定=$${rawPrice}, PSA10=取得しない（eBayから取得）`);
    
    return { rawPrice, psa10Price, url: searchUrl, isEstimated };
  } catch (e) { return { rawPrice: 0, psa10Price: 0, url: "", isEstimated: false }; }
}

// eBay Finding API (Legacy)を使用してPSA10価格を取得する関数
async function fetchEbayPsa10PriceViaAPI(cardName: string, cardNumber: string, isJapanese: boolean = false) {
  const EBAY_APP_ID = "ShawnSum-PokeMiru-PRD-d46241164-bfb2dd8b";
  const EBAY_FINDING_API = "https://svcs.ebay.com/services/search/FindingService/v1";
  
  try {
    // 型番から#記号を除去
    const cleanCardNumber = cardNumber.replace(/^#+/, "");
    const cleanNumber = cleanCardNumber.split('/')[0];
    
    // 検索クエリを構築（複数のパターンを試す）
    const queries: string[] = [];
    
    // ★ 日本語版の場合、cleanNumber + Japanese パターンを最優先
    if (isJapanese && cleanNumber) {
      queries.push(`${cardName} ${cleanNumber} Japanese PSA 10`);
      queries.push(`${cardName} ${cleanNumber} Japanese Pokemon PSA 10`);
    }
    
    // 完全な型番を含むパターン
    queries.push(`${cardName} ${cleanCardNumber} PSA 10`);
    queries.push(`${cardName} ${cleanCardNumber} Pokemon PSA 10`);
    
    // 型番（レアリティ除去）+ PSA 10
    queries.push(`${cardName} ${cleanNumber} Pokemon PSA 10`);
    queries.push(`${cardName} ${cleanNumber} PSA 10`);
    
    // 型番なし
    queries.push(`${cardName} Pokemon PSA 10`);
    
    // 日本語版の場合、その他のパターン
    if (isJapanese) {
      queries.push(`${cardName} ${cleanCardNumber} Japanese PSA 10`);
      queries.push(`${cardName} Japanese Pokemon PSA 10`);
    }
    
    // 各クエリを試す（最大4件までに制限して高速化）
    const maxQueries = Math.min(queries.length, 4);
    for (let i = 0; i < maxQueries; i++) {
      const query = queries[i];
      
      // リクエスト間隔を空ける
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      try {
        console.log(`🔍 eBay Finding API PSA10検索試行: "${query}"`);
        
        // Finding API はXMLレスポンスを返すため、JSON形式でリクエスト
        const response = await axios.get(EBAY_FINDING_API, {
          headers: {
            "X-EBAY-SOA-SECURITY-APPNAME": EBAY_APP_ID,
            "X-EBAY-SOA-OPERATION-NAME": "findItemsAdvanced",
            "X-EBAY-SOA-SERVICE-VERSION": "1.0.0",
            "X-EBAY-SOA-GLOBAL-ID": "EBAY-US",
            "X-EBAY-SOA-RESPONSE-DATA-FORMAT": "JSON"
          },
          params: {
            "OPERATION-NAME": "findItemsAdvanced",
            "SERVICE-VERSION": "1.0.0",
            "SECURITY-APPNAME": EBAY_APP_ID,
            "RESPONSE-DATA-FORMAT": "JSON",
            "GLOBAL-ID": "EBAY-US",
            "keywords": query.trim(),
            "paginationInput.entriesPerPage": 50,
            "sortOrder": "PricePlusShippingLowest",
            "itemFilter(0).name": "ListingType",
            "itemFilter(0).value(0)": "FixedPrice",
            "itemFilter(0).value(1)": "Auction",
            "itemFilter(1).name": "Currency",
            "itemFilter(1).value": "USD"
          },
          timeout: 10000
        });
        
        // Finding APIのレスポンス構造を処理
        const searchResult = response.data?.findItemsAdvancedResponse?.[0]?.searchResult?.[0];
        const items = searchResult?.item || [];
        const totalItems = parseInt(searchResult?.['@count']?.[0] || searchResult?.count || "0", 10);
        const prices: number[] = [];
        
        console.log(`📊 eBay Finding API検索結果: ${items.length}件のアイテムを発見（総数: ${totalItems}件）`);
        
        // 注意: Finding APIはアクティブな商品のみを返します（売却済み商品は含まれません）
        // そのため、現在販売中の商品から価格を取得します
        
        // PSA10のアイテムをフィルタリングして価格を取得
        for (const item of items) {
          const title = (item.title?.[0] || item.title || "").toUpperCase();
          const subtitle = (item.subtitle?.[0] || item.subtitle || "").toUpperCase();
          const fullText = `${title} ${subtitle}`.toUpperCase();
          
          // PSA10であることを確認
          const isPsa10 = fullText.includes("PSA 10") || fullText.includes("PSA10");
          if (!isPsa10) {
            console.log(`  ⏭️ PSA10ではないためスキップ: ${title.substring(0, 60)}...`);
            continue;
          }
          
          // ノイズを除外
          if (fullText.includes("LOT") || fullText.includes("SET") || fullText.includes("BOX")) {
            console.log(`  ⏭️ ノイズ（LOT/SET/BOX）をスキップ: ${title.substring(0, 60)}...`);
            continue;
          }
          
          // 価格を取得（Finding APIの構造）
          let price: number | null = null;
          const sellingStatus = item.sellingStatus?.[0] || item.sellingStatus;
          const currentPrice = sellingStatus?.currentPrice?.[0] || sellingStatus?.currentPrice;
          
          // 価格の値を取得（複数のパターンを試す）
          if (currentPrice?.['#text']) {
            price = parseFloat(currentPrice['#text']);
          } else if (typeof currentPrice === 'string' || typeof currentPrice === 'number') {
            price = parseFloat(String(currentPrice));
          } else if (currentPrice?._) {
            price = parseFloat(currentPrice._);
          }
          
          const priceCurrency = currentPrice?.['@currencyId']?.[0] || 
                               currentPrice?.['currencyId'] || 
                               currentPrice?.currencyId || 
                               "USD";
          
          if (price && price > 0 && price < MAX_PRICE && priceCurrency === "USD") {
            prices.push(price);
            console.log(`  💎 eBay Finding API PSA10価格候補: $${price} (${title.substring(0, 50)}...)`);
          } else if (price) {
            console.log(`  ⚠️ 価格が範囲外または通貨不一致: $${price} (通貨: ${priceCurrency})`);
          }
        }
        
        if (prices.length > 0) {
          prices.sort((a, b) => a - b);
          const median = prices[Math.floor(prices.length / 2)];
          console.log(`✅ eBay Finding API PSA10中央値: $${median} (${prices.length}件の価格から) - クエリ: "${query}"`);
          return median;
        } else {
          console.log(`  ⚠️ クエリ "${query}" では価格が見つかりませんでした（検索結果は${items.length}件）`);
        }
      } catch (apiError: any) {
        const errorMsg = apiError.response?.data?.errorMessage?.[0]?.error?.[0]?.message?.[0] || 
                        apiError.response?.data?.errorMessage?.[0]?.longMessage?.[0] ||
                        apiError.message;
        console.log(`  ⚠️ クエリ "${query}" でFinding APIエラー: ${apiError.response?.status || '不明'} - ${errorMsg}`);
        if (apiError.response?.data && !apiError.response.data.findItemsAdvancedResponse) {
          console.log(`     APIエラー詳細: ${JSON.stringify(apiError.response.data).substring(0, 300)}`);
        }
        continue; // 次のクエリを試す
      }
    }
    
    console.log(`❌ eBay Finding API PSA10: すべての検索クエリで価格が見つかりませんでした`);
    return 0;
  } catch (e: any) {
    console.error(`❌ eBay Finding API PSA10エラー:`, e.message);
    if (e.response) {
      console.error(`   ステータス: ${e.response.status}`);
      console.error(`   データ: ${JSON.stringify(e.response.data).substring(0, 300)}`);
    }
    return 0;
  }
}

// eBayからPSA10価格を取得する関数（スクレイピング方式をフォールバックとして使用）
async function fetchEbayPsa10Price(cardName: string, cardNumber: string, isJapanese: boolean = false, jpName?: string) {
  // まずeBay APIを試す
  console.log(`🔍 eBay APIからPSA10価格を取得します...`);
  const apiPrice = await fetchEbayPsa10PriceViaAPI(cardName, cardNumber, isJapanese);
  if (apiPrice > 0) {
    console.log(`✅ eBay APIからPSA10価格を取得: $${apiPrice}`);
    return apiPrice;
  }
  
  // APIで取得できなかった場合、スクレイピング方式を試す
  console.log(`⚠️ eBay APIで取得できなかったため、スクレイピング方式を試します...`);
  try {
    // 検索クエリを構築（複数のパターンを試す）
    const queries: string[] = [];
    
    // 型番から#記号を除去し、レアリティ部分も除去（例: "#209/SAR" → "209"）
    const cleanCardNumber = cardNumber.replace(/^#+/, ""); // 先頭の#を除去
    const cleanNumber = cleanCardNumber.split('/')[0];
    
    // ★ 日本語版の場合、cleanNumber + Japanese パターンを最優先（例: "Jolteon ex 209 Japanese PSA 10"）
    if (isJapanese && cleanNumber) {
      queries.push(`${cardName} ${cleanNumber} Japanese PSA 10`);
      queries.push(`${cardName} ${cleanNumber} Japanese Pokemon PSA 10`);
    }
    
    // ★ 完全な型番を含むパターン（#記号なし）
    queries.push(`${cardName} ${cleanCardNumber} PSA 10`);
    queries.push(`${cardName} ${cleanCardNumber} Pokemon PSA 10`);
    
    // パターン1: 英語名 + 型番（レアリティ除去）+ PSA 10
    queries.push(`${cardName} ${cleanNumber} Pokemon PSA 10`);
    queries.push(`${cardName} ${cleanNumber} PSA 10`);
    
    // パターン2: 英語名 + PSA 10（型番なし）
    queries.push(`${cardName} Pokemon PSA 10`);
    
    // パターン3: 日本語版の場合、その他のパターン
    if (isJapanese) {
      queries.push(`${cardName} ${cleanCardNumber} Japanese PSA 10`);
      queries.push(`${cardName} ${cleanCardNumber} Japanese Pokemon PSA 10`);
      queries.push(`${cardName} Japanese Pokemon PSA 10`);
    }
    
    // 各クエリを試す（最大4件までに制限して高速化）
    const maxQueries = Math.min(queries.length, 4);
    for (let i = 0; i < maxQueries; i++) {
      const query = queries[i];
      
      // リクエスト間隔を空ける（ボット検出を回避）
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query.trim())}&LH_Sold=1&LH_Complete=1&_sop=12`;
      console.log(`🔍 eBay PSA10検索試行: "${query}"`);
      console.log(`🔍 eBay PSA10 URL: ${searchUrl}`);
      
      try {
        const { data } = await axios.get(searchUrl, { 
          headers: { 
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Referer": "https://www.ebay.com/",
            "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            "Sec-CH-UA-Mobile": "?0",
            "Sec-CH-UA-Platform": '"macOS"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
            "Cache-Control": "max-age=0"
          }, 
          timeout: 10000,
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        
        // ボット検出ページかどうかをチェック
        if (data.includes("Pardon Our Interruption") || data.includes("security check") || data.includes("bot detection")) {
          console.log(`  ⚠️ eBayのボット検出に引っかかりました（クエリ: "${query}"）`);
          // 少し長めに待機してから次のクエリを試す
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        
        const $ = cheerio.load(data);
        const prices: number[] = [];
        
        // 複数のセレクターパターンを試す（eBayのHTML構造が変わった場合に対応）
        const selectors = [
          ".srp-results ul li.s-card",
          ".srp-results .s-item",
          ".srp-results li[data-view]",
          ".srp-results .sresult",
          "ul.srp-results li.s-item"
        ];
        
        let allCards = $();
        let usedSelector = "";
        for (const selector of selectors) {
          const found = $(selector);
          if (found.length > 0) {
            allCards = found;
            usedSelector = selector;
            console.log(`📊 eBay PSA10検索結果: ${allCards.length}件のカード要素を発見（セレクター: ${selector}）`);
            break;
          }
        }
        
        // セレクターが見つからない場合、デバッグ情報を出力
        if (allCards.length === 0) {
          console.log(`⚠️ 検索結果のセレクターが見つかりません。HTML構造を確認します...`);
          const pageText = $.text().substring(0, 500);
          console.log(`   ページの先頭500文字: ${pageText}...`);
          const hasResults = $.text().toLowerCase().includes("results") || $.text().toLowerCase().includes("listing");
          console.log(`   検索結果ページらしい: ${hasResults}`);
        }
        
        // PSA10の検索結果から価格を取得
        allCards.each((_, el) => {
          const $el = $(el);
          const fullText = $el.text().toUpperCase();
          
          // タイトル取得（複数のパターンを試す）
          let title = $el.find(".s-card__title, h3.s-card__title, .s-item__title, .s-item__link, a").first().text().trim();
          if (!title) {
            title = $el.find("h3").first().text().trim();
          }
          if (!title) {
            title = fullText.substring(0, 100);
          }
          
          // PSA10であることを確認（「PSA 10」または「PSA10」が含まれている）
          const isPsa10 = fullText.includes("PSA 10") || fullText.includes("PSA10");
          if (!isPsa10) {
            console.log(`  ⏭️ PSA10ではないためスキップ: ${title.substring(0, 60)}...`);
            return;
          }
          
          // ノイズを除外
          if (fullText.includes("LOT") || fullText.includes("SET") || fullText.includes("BOX")) {
            console.log(`  ⏭️ ノイズ（LOT/SET/BOX）をスキップ: ${title.substring(0, 60)}...`);
            return;
          }
          
          // 価格取得（複数のセレクターを試す）
          let priceText = $el.find(".s-card__price").first().text().trim();
          if (!priceText) {
            priceText = $el.find(".s-item__price").first().text().trim();
          }
          if (!priceText) {
            priceText = $el.find(".s-item__detail").first().text().trim();
          }
          if (!priceText) {
            // さらに広範囲に検索
            const priceElements = $el.find("[class*='price'], [class*='Price']");
            priceElements.each((_, priceEl) => {
              const text = $(priceEl).text().trim();
              if (text.includes("$")) {
                priceText = text;
                return false; // ループ終了
              }
            });
          }
          
          // 価格が見つからない場合、要素全体から価格を検索
          if (!priceText) {
            const priceMatch = fullText.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
            if (priceMatch) {
              priceText = "$" + priceMatch[1];
            }
          }
          
          // USD価格を検索
          let price: number | null = null;
          const usdMatch = priceText.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
          if (usdMatch) {
            price = parseFloat(usdMatch[1].replace(/,/g, ""));
          } else {
            // 円表示の価格を検索（例: "16,174 円"）
            const yenMatch = priceText.match(/(\d{1,3}(?:,\d{3})*)\s*円/);
            if (yenMatch) {
              const yenPrice = parseFloat(yenMatch[1].replace(/,/g, ""));
              // 円をUSDに変換（USD_JPY_RATEを使用）
              price = parseFloat((yenPrice / USD_JPY_RATE).toFixed(2));
              console.log(`  💱 円価格をUSDに変換: ¥${yenPrice} → $${price} (レート: ${USD_JPY_RATE})`);
            }
          }
          
          if (price && price > 0 && price < MAX_PRICE) {
            prices.push(price);
            console.log(`  💎 eBay PSA10価格候補: $${price} (${title.substring(0, 50)}...)`);
          } else if (price) {
            console.log(`  ⚠️ 価格が範囲外: $${price} (${title.substring(0, 50)}...)`);
          } else {
            console.log(`  ⚠️ 価格が見つかりません: ${title.substring(0, 50)}... (価格テキスト: "${priceText}")`);
            // デバッグ: 要素のHTMLの一部を表示
            if (allCards.length > 0 && prices.length === 0) {
              const htmlPreview = $el.html()?.substring(0, 200) || "";
              console.log(`     要素のHTMLプレビュー: ${htmlPreview}...`);
            }
          }
        });
        
        if (prices.length > 0) {
          prices.sort((a, b) => a - b);
          const median = prices[Math.floor(prices.length / 2)];
          console.log(`✅ eBay PSA10中央値: $${median} (${prices.length}件の価格から) - クエリ: "${query}"`);
          return median;
        } else {
          if (allCards.length > 0) {
            console.log(`  ⚠️ クエリ "${query}" では価格が見つかりませんでした（検索結果は${allCards.length}件、セレクター: ${usedSelector || '不明'}）`);
            // 最初の数件のタイトルを表示してデバッグ
            allCards.slice(0, 3).each((i, el) => {
              const $el = $(el);
              const title = $el.find(".s-card__title, h3.s-card__title, .s-item__title").first().text().trim() || 
                           $el.text().substring(0, 80);
              console.log(`     検索結果${i + 1}: ${title}...`);
            });
          } else {
            console.log(`  ⚠️ クエリ "${query}" では検索結果が見つかりませんでした（セレクターが見つからない可能性）`);
          }
        }
      } catch (queryError: any) {
        console.log(`  ⚠️ クエリ "${query}" でエラー: ${queryError.message}`);
        continue; // 次のクエリを試す
      }
    }
    
    // すべてのクエリで失敗
    console.log(`❌ eBay PSA10: すべての検索クエリで価格が見つかりませんでした`);
    return 0;
  } catch (e: any) {
    console.error(`❌ eBay PSA10エラー:`, e.message);
    if (e.response) {
      console.error(`   ステータス: ${e.response.status}`);
      console.error(`   URL: ${e.config?.url}`);
    } else {
      console.error(`   エラー詳細:`, e);
    }
    return 0;
  }
}

async function fetchEbayDirect(cardName: string, cardNumber: string) {
  try {
    // 型番から#記号を除去
    const cleanCardNumber = cardNumber.replace(/^#+/, "");
    const query = `${cardName} ${cleanCardNumber} Pokemon`.trim();
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=12`;
    console.log(`🔍 eBay URL: ${searchUrl}`);
    
    const { data } = await axios.get(searchUrl, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Referer": "https://www.ebay.com/",
        "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0"
      }, 
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    // ボット検出ページかどうかをチェック
    if (data.includes("Pardon Our Interruption") || data.includes("security check") || data.includes("bot detection")) {
      console.log(`  ⚠️ eBayのボット検出に引っかかりました（未鑑定価格取得）`);
      return 0;
    }
    
    const $ = cheerio.load(data);
    const prices: number[] = [];
    
    // ★ 新しい構造: .srp-results ul li.s-card を使用
    $(".srp-results ul li.s-card").each((_, el) => {
      const $el = $(el);
      
      // カード要素全体のテキストを取得（タイトル、サブタイトル、説明などすべて）
      const fullText = $el.text().toUpperCase();
      
      // タイトル取得（ログ用）
      const title = $el.find(".s-card__title, h3.s-card__title").text().trim();
      
      // ★ より厳密なフィルタリング: グレーディング関連のキーワードを除外
      // カード要素全体のテキストをチェック（タイトルだけでなく説明文も含む）
      const gradingKeywords = [
        "PSA", "GRADED", "BGS", "CGC", "SGC", "BECKETT",
        "PSA 10", "PSA10", "GRADED 10", "BGS 10", "CGC 10",
        "GEM MINT", "GEM-MINT", "MINT CONDITION",
        "GRADING", "GRADED CARD", "SLA B"
      ];
      
      // カード要素全体のテキストからグレーディングキーワードをチェック
      const isGraded = gradingKeywords.some(keyword => fullText.includes(keyword));
      const isNoise = isGraded || fullText.includes("LOT") || fullText.includes("SET") || fullText.includes("BOX");
      
      if (isNoise) {
        console.log(`  ⏭️ グレーディング/ノイズをスキップ: ${title.substring(0, 60)}...`);
        return;
      }
      
      // 価格取得: .s-card__price
      const priceText = $el.find(".s-card__price").first().text().trim();
      
      let price: number | null = null;
      
      // USD価格を探す ($記号付き)
      const usdMatch = priceText.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
      if (usdMatch) {
        price = parseFloat(usdMatch[1].replace(/,/g, ""));
      } else {
        // 円表示の価格を取得してUSDに変換
        const yenMatch = priceText.match(/(\d{1,3}(?:,\d{3})*)\s*円/);
        if (yenMatch) {
          const yenPrice = parseFloat(yenMatch[1].replace(/,/g, ""));
          // 円をUSDに変換（USD_JPY_RATEを使用）
          price = parseFloat((yenPrice / USD_JPY_RATE).toFixed(2));
          console.log(`  💱 円価格をUSDに変換: ¥${yenPrice} → $${price} (レート: ${USD_JPY_RATE})`);
        }
      }
      
      if (price && price > 0 && price < MAX_PRICE) {
        prices.push(price);
        console.log(`  ✅ eBay未鑑定価格候補: $${price} (${title.substring(0, 50)}...)`);
      } else if (price) {
        console.log(`  ⚠️ 価格が範囲外: $${price} (${title.substring(0, 50)}...)`);
      }
    });
    
    if (prices.length === 0) {
      console.log(`❌ eBay: 価格が見つかりませんでした（USDまたは円表示）`);
      return 0;
    }
    
    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    console.log(`✅ eBay中央値: $${median} (${prices.length}件の価格から)`);
    return median;
  } catch (e: any) {
    console.error(`❌ eBayエラー:`, e.message);
    if (e.response) {
      console.error(`   ステータス: ${e.response.status}`);
    }
    return 0;
  }
}

// ★ 遊々亭: レアリティ一致チェックを追加した最強版
async function fetchYuyuteiPriceWithFallback(keywords: string[], targetName: string, targetRarity: string) {
  const uniqueKeywords = [...new Set(keywords)];

  for (const k of uniqueKeywords) {
    if (!k || k.length < 2) continue;
    console.log(`🇯🇵 遊々亭検索試行: "${k}"`);
    await new Promise(r => setTimeout(r, 500));
    
    // ★ レアリティ情報も渡す
    const p = await fetchYuyuteiPrice(k, targetName, targetRarity);
    if (p > 0) return p;
  }
  return 0;
}

async function fetchYuyuteiPrice(keyword: string, targetName: string, targetRarity: string) {
  try {
    const url = `https://yuyu-tei.jp/sell/poc/s/search?search_word=${encodeURIComponent(keyword)}`;
    console.log(`🔍 遊々亭URL: ${url}`);
    
    const { data } = await axios.get(url, { 
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
        "Referer": "https://yuyu-tei.jp/"
      },
      timeout: 7000
    });
    
    const $ = cheerio.load(data);
    let price = 0;
    
    // デバッグ: HTML構造の確認
    const cardProducts = $(".card-product");
    console.log(`📊 検出されたcard-product要素数: ${cardProducts.length}`);
    
    // デバッグ: HTMLの一部を確認（card-productが見つからない場合）
    if (cardProducts.length === 0) {
      // HTMLにcard-productが含まれているか確認
      const hasCardProductInHtml = data.includes('card-product');
      console.log(`🔍 HTMLに"card-product"が含まれているか: ${hasCardProductInHtml}`);
      
      // 代替セレクターを試す
      const altSelectors = [
        '.card-product',
        '[class*="card-product"]',
        '.product-img',
        'h4.text-primary'
      ];
      
      for (const selector of altSelectors) {
        const elements = $(selector);
        console.log(`🔍 セレクター "${selector}": ${elements.length}件`);
        if (elements.length > 0 && selector === 'h4.text-primary') {
          // h4が見つかった場合、親要素を確認
          const firstH4 = elements.first();
          const parent = firstH4.parent().parent();
          console.log(`🔍 最初のh4の親要素のクラス: ${parent.attr('class')}`);
        }
      }
      
      // HTMLの一部を出力（デバッグ用）
      const htmlSample = data.substring(0, 5000);
      if (htmlSample.includes('card-product')) {
        const matchIndex = htmlSample.indexOf('card-product');
        const context = htmlSample.substring(Math.max(0, matchIndex - 200), matchIndex + 500);
        console.log(`🔍 HTMLサンプル（card-product周辺）: ${context.substring(0, 500)}`);
      }
    }
    
    const normalize = (s: string) => s.replace(/\s/g, "").toLowerCase();
    const targetCheck = normalize(targetName || "");
    const rarityCheck = targetRarity ? targetRarity.toUpperCase() : "";

    // ★ 新しい構造: .card-product を使用（複数のセレクターパターンを試す）
    const cardProductSelector = [
      ".card-product",
      '[class*="card-product"]',
      ".card-product.position-relative",
      '[class*="card-product"][class*="position-relative"]'
    ];
    
    let foundElements = $();
    for (const selector of cardProductSelector) {
      const elements = $(selector);
      if (elements.length > 0) {
        foundElements = elements;
        console.log(`✅ セレクター "${selector}" で ${elements.length}件の要素を発見`);
        break;
      }
    }
    
    if (foundElements.length === 0) {
      console.log(`⚠️ card-product要素が見つかりません。代替方法を試します...`);
      // 代替: h4.text-primary.fw-bold の親要素を探す
      $("h4.text-primary.fw-bold").each((_, h4El) => {
        const $h4 = $(h4El);
        const parent = $h4.closest('[class*="card"], [class*="product"]').first();
        if (parent.length > 0) {
          foundElements = foundElements.add(parent);
        }
      });
      console.log(`📊 代替方法で ${foundElements.length}件の要素を発見`);
    }
    
    foundElements.each((_, el) => {
      const $el = $(el);
      const isFirstElement = price === 0; // 最初の要素かどうかを判定
      
      // カード名: h4.text-primary.fw-bold または a > h4
      const cardTitle = $el.find("h4.text-primary.fw-bold, h4, a h4").first().text().trim();
      const normalizedTitle = normalize(cardTitle);
      
      // デバッグ: 最初の数件のカードタイトルを出力
      if (isFirstElement) {
        console.log(`📝 カードタイトル候補: "${cardTitle}"`);
      }
      
      // 1. 名前チェック (全く違うカードを除外)
      if (targetCheck.length > 2 && !normalizedTitle.includes(targetCheck.substring(0, 2))) {
          return;
      }

      // 2. ★ レアリティチェック (重要)
      // タイトル、型番、alt属性などにレアリティが含まれているか確認
      // 例: SARを探しているのに、タイトルに SAR がなければスキップ (RRなどを除外)
      // ※ただし、キーワード検索で既に絞り込まれている場合は柔軟に
      if (rarityCheck) {
        // カードタイトル、型番、alt属性などからレアリティを確認
        const cardNumber = $el.find('span[class*="border"]').first().text().trim(); // 型番（例: 210/172）
        const cardAlt = $el.find('img.card').attr('alt') || ''; // alt属性（例: "210/172 SAR リーフィアVSTAR"）
        const fullText = `${cardTitle} ${cardNumber} ${cardAlt}`.toUpperCase();
        
        const hasRarity = fullText.includes(rarityCheck);
        
        if (!hasRarity) {
          // レアリティ不一致の可能性が高いが、表記揺れもあるので
          // 「SAR」を探してるのに「RR」と書いてあったら確実に除外する
          if (fullText.includes("RR") || fullText.includes("AR")) {
            if (isFirstElement) {
              console.log(`  ⏭️ レアリティ不一致でスキップ: タイトル="${cardTitle}", 型番="${cardNumber}", alt="${cardAlt}"`);
            }
            return; 
          }
          // 明確な除外対象でなければ、一旦候補にする（価格で判断）
          if (isFirstElement) {
            console.log(`  ⚠️ レアリティが見つかりませんが、候補として続行: タイトル="${cardTitle}", 型番="${cardNumber}", alt="${cardAlt}"`);
          }
        } else if (isFirstElement) {
          console.log(`  ✅ レアリティ一致: タイトル="${cardTitle}", 型番="${cardNumber}", alt="${cardAlt}"`);
        }
      }

      // 価格取得: 複数のセレクターパターンを試す
      let priceText = "";
      
      // デバッグ: 最初の要素の場合、strong要素の数を確認
      if (isFirstElement) {
        const strongCount = $el.find("strong").length;
        console.log(`  🔍 strong要素の数: ${strongCount}`);
        $el.find("strong").each((idx, strongEl) => {
          const $strong = $(strongEl);
          const classAttr = $strong.attr("class") || "";
          const text = $strong.text().trim();
          console.log(`  🔍 strong[${idx}]: class="${classAttr}", text="${text}"`);
        });
      }
      
      // パターン1: strong[class*="text-end"] または strong[class*="d-block"] で確実に取得
      priceText = $el.find('strong[class*="text-end"], strong[class*="d-block"]').first().text().trim();
      if (isFirstElement) {
        console.log(`  🔍 パターン1結果: "${priceText}"`);
      }
      
      // パターン2: strong.text-end, strong.d-block (既存のセレクターも試す)
      if (!priceText || !priceText.match(/\d/)) {
        priceText = $el.find("strong.text-end, strong.d-block").first().text().trim();
        if (isFirstElement) {
          console.log(`  🔍 パターン2結果: "${priceText}"`);
        }
      }
      
      // パターン2.5: class属性に"text-end"と"d-block"の両方を含むstrong要素
      if (!priceText || !priceText.match(/\d/)) {
        $el.find("strong").each((_, strongEl) => {
          const $strong = $(strongEl);
          const classAttr = $strong.attr("class") || "";
          if (classAttr.includes("text-end") && classAttr.includes("d-block")) {
            const text = $strong.text().trim();
            if (text.match(/\d/)) {
              priceText = text;
              return false; // ループ終了
            }
          }
        });
        if (isFirstElement) {
          console.log(`  🔍 パターン2.5結果: "${priceText}"`);
        }
      }
      
      // パターン3: すべてのstrong要素を確認（クラス指定なし）
      if (!priceText || !priceText.match(/\d/)) {
        $el.find("strong").each((_, strongEl) => {
          const text = $(strongEl).text().trim();
          if (text.match(/\d{1,3}(?:,\d{3})*\s*円/)) {
            priceText = text;
            return false; // ループ終了
          }
        });
        if (isFirstElement) {
          console.log(`  🔍 パターン3結果: "${priceText}"`);
        }
      }
      
      // パターン4: 要素全体から価格パターンを検索（最後の手段）
      if (!priceText || !priceText.match(/\d/)) {
        const elementText = $el.text();
        const priceMatch = elementText.match(/(\d{1,3}(?:,\d{3})*)\s*円/);
        if (priceMatch) {
          priceText = priceMatch[0];
        }
        if (isFirstElement) {
          console.log(`  🔍 パターン4結果: "${priceText}"`);
        }
      }
      
      // デバッグ: 価格テキストを出力（最初の要素のみ）
      if (isFirstElement) {
        console.log(`  💰 最終的な価格テキスト候補: "${priceText}"`);
      }
      
      const match = priceText.match(/(\d{1,3}(?:,\d{3})*)/);
      if (match) {
        const p = parseInt(match[1].replace(/,/g, ""), 10);
        
        // 80円問題対策: レアリティ指定があるのに安すぎる場合はスキップ
        // SARやSRなら通常1000円以上
        if (rarityCheck && (rarityCheck === "SAR" || rarityCheck === "SR") && p < 500) {
            return;
        }

        if (p > 10 && p < MAX_PRICE) {
          price = p;
          console.log(`✅ 遊々亭ヒット: ¥${price} (${cardTitle})`);
          return false; // 発見したらループ終了
        }
      } else if (isFirstElement) {
        console.log(`  ⚠️ 価格パターンが見つかりませんでした。要素のHTML構造を確認: ${$el.html()?.substring(0, 300)}`);
      }
    });
    
    if (price === 0) {
      console.log(`❌ 遊々亭: 価格が見つかりませんでした (キーワード: "${keyword}")`);
    }
    
    return price;
  } catch (e: any) {
    console.error(`❌ 遊々亭エラー (キーワード: "${keyword}"):`, e.message);
    if (e.response) {
      console.error(`   ステータス: ${e.response.status}, URL: ${e.config?.url}`);
    }
    return 0;
  }
}