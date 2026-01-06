"use client";
import { useState, useRef, useEffect } from "react";
import { Camera, X, ScanEye, TrendingUp, TrendingDown, ExternalLink, RefreshCw, Gem, Search, DollarSign, History, Trash2, Crown, Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getStripeCustomerId, setStripeCustomerId, getProStatus, setProStatus, verifyProStatus } from "@/lib/subscription";

interface CardData {
  cardName: string;
  cardNumber: string;
  jpName: string;
  searchKeyword: string;
  ebaySearchUrl?: string;
  jpPrice: number;
  jpNetIncome: number;
  usPrice: number;
  usPriceUsd: number;
  ebayNetIncome: number;
  ebayFees: number;
  ebayShippingCost: number;
  profit: number;
  
  psa10Price: number;
  psa10PriceUsd: number;
  psa10NetIncome: number;
  psa10EbayFees: number;
  psa10Profit: number;
  isPsa10Estimated: boolean;
  
  isSlab: boolean;
  recommendation: string;
  recColor: string;
  profitComparison: string;
}

interface SearchHistoryItem extends CardData {
  id: string;
  timestamp: number;
  imageUrl?: string; // base64形式で保存された画像
}

const HISTORY_STORAGE_KEY = "pokeMiru_search_history";
const MAX_HISTORY_ITEMS = 100;

export default function Home() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<CardData | null>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [showProModal, setShowProModal] = useState(false);
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 履歴をlocalStorageから読み込む
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (saved) {
          const history = JSON.parse(saved) as SearchHistoryItem[];
          setSearchHistory(history);
        }
      } catch (error) {
        console.error("履歴の読み込みに失敗しました:", error);
      }
    }
  }, []);

  // Pro状態を確認
  useEffect(() => {
    const checkProStatus = async () => {
      const proStatus = getProStatus();
      setIsPro(proStatus);
      
      // サーバーで再確認
      if (proStatus) {
        await verifyProStatus();
        setIsPro(getProStatus());
      }
    };
    checkProStatus();
  }, []);

  // 履歴をlocalStorageに保存する
  const saveToHistory = (cardData: CardData, imageBase64?: string) => {
    try {
      const historyItem: SearchHistoryItem = {
        ...cardData,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        imageUrl: imageBase64, // base64形式の画像を保存
      };

      // 最新の履歴を取得
      const currentSaved = localStorage.getItem(HISTORY_STORAGE_KEY);
      const existingHistory = currentSaved ? (JSON.parse(currentSaved) as SearchHistoryItem[]) : [];

      const updatedHistory = [historyItem, ...existingHistory]
        .sort((a, b) => b.timestamp - a.timestamp) // 新しい順にソート
        .slice(0, MAX_HISTORY_ITEMS); // 最大件数に制限

      setSearchHistory(updatedHistory);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updatedHistory));
    } catch (error: any) {
      // localStorageの容量オーバーなどに対応
      if (error.name === 'QuotaExceededError') {
        console.warn("履歴の保存容量が上限に達しました。古い履歴を削除してください。");
        alert("履歴の保存容量が上限に達しました。古い履歴を削除してください。");
      } else {
        console.error("履歴の保存に失敗しました:", error);
      }
    }
  };

  // 履歴から結果を再表示
  const loadFromHistory = (historyItem: SearchHistoryItem) => {
    const cardData: CardData = {
      cardName: historyItem.cardName,
      cardNumber: historyItem.cardNumber,
      jpName: historyItem.jpName,
      searchKeyword: historyItem.searchKeyword,
      ebaySearchUrl: historyItem.ebaySearchUrl,
      jpPrice: historyItem.jpPrice,
      jpNetIncome: historyItem.jpNetIncome,
      usPrice: historyItem.usPrice,
      usPriceUsd: historyItem.usPriceUsd,
      ebayNetIncome: historyItem.ebayNetIncome,
      ebayFees: historyItem.ebayFees,
      ebayShippingCost: historyItem.ebayShippingCost,
      profit: historyItem.profit,
      psa10Price: historyItem.psa10Price,
      psa10PriceUsd: historyItem.psa10PriceUsd,
      psa10NetIncome: historyItem.psa10NetIncome,
      psa10EbayFees: historyItem.psa10EbayFees,
      psa10Profit: historyItem.psa10Profit,
      isPsa10Estimated: historyItem.isPsa10Estimated,
      isSlab: historyItem.isSlab,
      recommendation: historyItem.recommendation,
      recColor: historyItem.recColor,
      profitComparison: historyItem.profitComparison,
    };
    setResult(cardData);
    // 履歴に保存された画像を復元
    if (historyItem.imageUrl) {
      setSelectedImage(historyItem.imageUrl);
    } else {
      setSelectedImage(null);
    }
    // ページ上部にスクロール
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 履歴を削除
  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 親要素のクリックイベントを防ぐ
    try {
      const updatedHistory = searchHistory.filter(item => item.id !== id);
      setSearchHistory(updatedHistory);
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updatedHistory));
    } catch (error) {
      console.error("履歴の削除に失敗しました:", error);
    }
  };

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = document.createElement("img");
        img.src = event.target?.result as string;
        img.onload = () => {
          const maxWidth = 800;
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setSelectedImage(imageUrl);
      setResult(null);
    }
  };

  const handleAnalyze = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setIsAnalyzing(true);
    setRateLimitError(null);
    try {
      const base64Image = await compressImage(file);
      const customerId = getStripeCustomerId();
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image, customerId }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429) {
          // レート制限エラー
          setRateLimitError(errorData.message || "1日の検索上限に達しました。");
          if (errorData.upgradeRequired) {
            setShowProModal(true);
          }
          return;
        }
        throw new Error(errorData.error || "解析失敗");
      }
      
      const data = await response.json();
      setResult(data);
      // 履歴に自動保存（画像も含む）- Proユーザーのみ
      if (isPro) {
        saveToHistory(data, base64Image);
      }
    } catch (error: any) {
      alert(error.message || "解析に失敗しました。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Stripe決済セッションを作成
  const handleUpgradeToPro = async () => {
    setIsLoadingCheckout(true);
    try {
      const customerId = getStripeCustomerId();
      const response = await fetch("/api/subscription/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });

      if (!response.ok) {
        throw new Error("決済セッションの作成に失敗しました");
      }

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error: any) {
      alert(error.message || "決済の開始に失敗しました");
    } finally {
      setIsLoadingCheckout(false);
    }
  };

  // CSV出力機能（利益が出るカードリスト）
  const exportProfitableCardsCSV = () => {
    if (!isPro) {
      alert("Proプランでのみ利用可能な機能です。");
      setShowProModal(true);
      return;
    }

    // 利益が出るカード（未鑑定またはPSA10で利益が出る）をフィルタリング
    const profitableCards = searchHistory.filter(
      (item) => 
        (item.profit !== undefined && item.profit > 0) ||
        (item.psa10Profit !== undefined && item.psa10Profit > 0)
    );

    if (profitableCards.length === 0) {
      alert("利益が出るカードが見つかりませんでした。");
      return;
    }

    // CSV形式に変換
    const headers = [
      "カード名（日本語）",
      "カード名（英語）",
      "型番",
      "日本価格（円）",
      "eBay価格（USD）",
      "eBay価格（円）",
      "未鑑定利益（円）",
      "PSA10価格（USD）",
      "PSA10価格（円）",
      "PSA10利益（円）",
      "推奨",
      "検索日時",
    ];

    const rows = profitableCards.map((item) => [
      item.jpName,
      item.cardName,
      item.cardNumber,
      item.jpPrice,
      item.usPriceUsd,
      item.usPrice,
      item.profit || 0,
      item.psa10PriceUsd || 0,
      item.psa10Price || 0,
      item.psa10Profit || 0,
      item.recommendation,
      new Date(item.timestamp).toLocaleString("ja-JP"),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell)}"`).join(",")),
    ].join("\n");

    // BOMを追加してExcelで正しく開けるようにする
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `利益が出るカードリスト_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getBannerColor = (color: string) => {
    switch (color) {
      case "green": return "bg-green-600";
      case "red": return "bg-red-600";
      case "purple": return "bg-purple-600";
      default: return "bg-blue-600";
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes}分前`;
      }
      return `${hours}時間前`;
    } else if (days < 7) {
      return `${days}日前`;
    } else {
      return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10 font-sans flex flex-col items-center">
      <header className="w-full max-w-md bg-white p-4 shadow-sm sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScanEye className="text-blue-600" /> 
          <h1 className="text-xl font-bold text-gray-800">PokeMiru</h1>
          {isPro && (
            <span className="flex items-center gap-1 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
              <Crown size={12} /> Pro
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isPro && searchHistory.length > 0 && (
            <button
              onClick={exportProfitableCardsCSV}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              title="利益が出るカードリストをCSV出力"
            >
              <Download className="text-green-600" size={20} />
            </button>
          )}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-2 rounded-lg hover:bg-gray-100 transition relative"
            title="検索履歴"
          >
            <History className="text-gray-600" size={20} />
            {searchHistory.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {searchHistory.length}
              </span>
            )}
          </button>
          {!isPro && (
            <button
              onClick={() => setShowProModal(true)}
              className="px-3 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-xs font-bold rounded-lg hover:from-yellow-500 hover:to-orange-600 transition"
            >
              Pro
            </button>
          )}
        </div>
      </header>

      <main className="w-full max-w-md p-4 space-y-4">
        {/* 履歴一覧 */}
        {showHistory && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <History size={18} /> 検索履歴
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {searchHistory.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  <History size={48} className="mx-auto mb-2 opacity-50" />
                  <p>履歴がありません</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {searchHistory.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        loadFromHistory(item);
                        setShowHistory(false);
                      }}
                      className="p-4 hover:bg-gray-50 cursor-pointer transition relative group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* 画像サムネイル */}
                        {item.imageUrl ? (
                          <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                            <Image
                              src={item.imageUrl}
                              alt={item.jpName}
                              fill
                              className="object-contain"
                              sizes="64px"
                            />
                          </div>
                        ) : (
                          <div className="w-16 h-16 flex-shrink-0 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                            <Camera className="text-gray-400" size={24} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              item.recColor === 'green' ? 'bg-green-100 text-green-700' :
                              item.recColor === 'red' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {item.recommendation}
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-800 text-sm truncate">{item.jpName}</h3>
                          <p className="text-xs text-gray-400 mt-0.5">{item.cardName} ({item.cardNumber})</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                            <span>🇯🇵 ¥{(item.jpPrice ?? 0).toLocaleString()}</span>
                            <span>🇺🇸 ${(item.usPriceUsd ?? 0).toLocaleString()}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{formatDate(item.timestamp)}</p>
                        </div>
                        <button
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition opacity-0 group-hover:opacity-100 flex-shrink-0"
                          title="削除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 画像エリア */}
        <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageSelect} />
          {!selectedImage ? (
            <button onClick={() => fileInputRef.current?.click()} className="w-full h-40 border-2 border-dashed border-blue-200 rounded-xl bg-blue-50 flex flex-col items-center justify-center gap-2 text-blue-600 active:bg-blue-100 transition">
              <Camera size={32} /> <span className="font-bold">カードを撮影 / 選択</span>
            </button>
          ) : (
            <div className="space-y-4">
              <div className="relative h-64 w-full rounded-xl overflow-hidden bg-black">
                <Image src={selectedImage} alt="Card" fill className="object-contain" />
                <button onClick={() => {setSelectedImage(null); setResult(null);}} className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full"><X size={20} /></button>
              </div>
              {!result && (
                <button onClick={handleAnalyze} disabled={isAnalyzing} className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl shadow-md flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50">
                  {isAnalyzing ? <><RefreshCw className="animate-spin" /> 解析中...</> : "鑑定する"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 結果表示エリア */}
        {result && (
          <div className="space-y-4 animate-fade-in-up">
            
            {/* タイトル & 判定 */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-200">
              <div className={`${getBannerColor(result.recColor || "blue")} text-white p-3 text-center font-bold text-lg`}>
                {result.recommendation || "判定不能"}
              </div>
              <div className="p-4 text-center">
                <h2 className="font-bold text-gray-800 text-lg leading-tight">{result.jpName}</h2>
                <p className="text-gray-400 text-xs mt-1">{result.cardName} ({result.cardNumber})</p>
              </div>
            </div>

            {/* ① 未鑑定品（現状品）の比較エリア */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white p-3 rounded-xl shadow-sm border border-red-100 flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-bold text-red-500 mb-1">🇯🇵 未鑑定 (日本)</p>
                    <p className="text-[10px] text-gray-400">遊々亭 買取</p>
                  </div>
                  <p className="text-xl font-black text-gray-800 mt-2">¥{(result.jpPrice ?? 0).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-500 mt-1">手取り: ¥{(result.jpNetIncome ?? result.jpPrice ?? 0).toLocaleString()}</p>
                </div>
                <div className="bg-white p-3 rounded-xl shadow-sm border border-green-100 flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-bold text-green-600 mb-1">🇺🇸 未鑑定 (eBay)</p>
                    <p className="text-[10px] text-gray-400">販売価格</p>
                  </div>
                  <div>
                     <p className="text-2xl font-black text-green-600 text-right">
                       ${(result.usPriceUsd ?? 0).toLocaleString()}
                     </p>
                     <p className="text-[10px] text-gray-500 text-right font-bold mt-1">
                       手取り: ¥{(result.ebayNetIncome ?? 0).toLocaleString()}
                     </p>
                  </div>
                </div>
              </div>
              
              {/* 手数料・送料の内訳 */}
              {(result.ebayFees ?? 0) > 0 && (
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <p className="text-xs font-bold text-gray-700 mb-2">💰 eBay手数料・送料の内訳</p>
                  <div className="space-y-1 text-[10px] text-gray-600">
                    <div className="flex justify-between">
                      <span>販売額:</span>
                      <span className="font-bold">¥{(result.usPrice ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>手数料 (16.5%):</span>
                      <span className="font-bold">-¥{(result.ebayFees ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-red-600">
                      <span>送料:</span>
                      <span className="font-bold">-¥{(result.ebayShippingCost ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="border-t border-gray-300 pt-1 mt-1 flex justify-between font-bold text-gray-800">
                      <span>手取り:</span>
                      <span>¥{(result.ebayNetIncome ?? 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* 利益比較 */}
              {result.profitComparison && (
                <div className={`p-3 rounded-lg border ${
                  result.recColor === 'green' ? 'bg-green-50 border-green-200' :
                  result.recColor === 'red' ? 'bg-red-50 border-red-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <p className="text-xs font-bold text-gray-800">📊 利益比較（手数料・送料込み）</p>
                  <p className="text-sm font-bold text-gray-800 mt-1">{result.profitComparison}</p>
                  {result.profit !== undefined && (
                    <p className="text-xs text-gray-600 mt-1">
                      差額: ¥{Math.abs(result.profit).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ② PSA10 の比較エリア */}
            <div className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden">
              <div className="bg-purple-50 px-4 py-2 border-b border-purple-100 flex justify-between items-center">
                 <div className="flex items-center gap-1 font-bold text-purple-800">
                   <Gem size={16} /> PSA10を売る場合
                 </div>
                 {result.isPsa10Estimated && <span className="text-[10px] bg-purple-200 text-purple-800 px-1.5 rounded">推定</span>}
              </div>
              
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-4 items-center">
                  {/* eBay PSA10 販売額（ここもドルメインに変更） */}
                  <div className="text-center border-r border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">🇺🇸 eBay販売額</p>
                    {(result.psa10PriceUsd ?? 0) > 0 ? (
                      <>
                        <p className="text-2xl font-black text-purple-700">
                          ${(result.psa10PriceUsd ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          手取り: ¥{(result.psa10NetIncome ?? 0).toLocaleString()}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-bold text-gray-400">価格不明</p>
                        <p className="text-[10px] text-gray-400 mt-1">データ取得中</p>
                      </>
                    )}
                  </div>

                  {/* メルカリ PSA10 相場ボタン */}
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-2">🇯🇵 日本相場</p>
                    <a 
                      href={`https://jp.mercari.com/search?keyword=${encodeURIComponent(result.jpName + " PSA10")}`}
                      target="_blank" 
                      rel="noreferrer"
                      className="inline-flex items-center justify-center w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-2 rounded-lg text-xs transition gap-1"
                    >
                      <Search size={12} /> メルカリで見る
                    </a>
                    <p className="text-[10px] text-gray-400 mt-2">↑ タップして比較</p>
                  </div>
                </div>
                
                {/* PSA10の手数料・送料の内訳 */}
                {(result.psa10EbayFees ?? 0) > 0 && (
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <p className="text-xs font-bold text-gray-700 mb-2">💰 PSA10 eBay手数料・送料の内訳</p>
                    <div className="space-y-1 text-[10px] text-gray-600">
                      <div className="flex justify-between">
                        <span>販売額:</span>
                        <span className="font-bold">¥{(result.psa10Price ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>手数料 (16.5%):</span>
                        <span className="font-bold">-¥{(result.psa10EbayFees ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>送料:</span>
                        <span className="font-bold">-¥{(result.ebayShippingCost ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="border-t border-gray-300 pt-1 mt-1 flex justify-between font-bold text-gray-800">
                        <span>手取り:</span>
                        <span>¥{(result.psa10NetIncome ?? 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 外部リンク */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <a href={`https://jp.mercari.com/search?keyword=${encodeURIComponent(result.jpName || "")}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg font-bold text-sm transition">
                メルカリ (未鑑定) <ExternalLink size={14} />
              </a>
              <a href={result.ebaySearchUrl || (result.searchKeyword && result.searchKeyword.startsWith("http") ? result.searchKeyword : "#")} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 py-3 rounded-lg font-bold text-sm transition">
                eBay (米国) <ExternalLink size={14} />
              </a>
            </div>
          </div>
        )}

        {/* レート制限エラー表示 */}
        {rateLimitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <X className="text-red-600" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-red-800 mb-1">検索上限に達しました</p>
                <p className="text-xs text-red-600 mb-3">{rateLimitError}</p>
                <button
                  onClick={() => setShowProModal(true)}
                  className="w-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold py-2 px-4 rounded-lg text-sm hover:from-yellow-500 hover:to-orange-600 transition"
                >
                  Proプランにアップグレード
                </button>
              </div>
              <button
                onClick={() => setRateLimitError(null)}
                className="flex-shrink-0 text-red-400 hover:text-red-600"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="w-full max-w-md px-4 py-6 text-center">
        <Link
          href="/specified-commercial-transactions"
          className="text-xs text-gray-400 hover:text-gray-600 transition underline"
        >
          特定商取引法に基づく表記
        </Link>
      </footer>

      {/* Proモーダル */}
      {showProModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Crown className="text-yellow-500" size={24} />
                <h2 className="text-xl font-bold text-gray-800">Proプラン</h2>
              </div>
              <button
                onClick={() => setShowProModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 p-4 rounded-lg border border-yellow-200">
                <p className="text-2xl font-black text-gray-800 mb-1">月額980円</p>
                <p className="text-xs text-gray-600">いつでもキャンセル可能</p>
              </div>

              <div className="space-y-2">
                <h3 className="font-bold text-gray-800">Proプランの特典</h3>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✓</span>
                    <span>無制限検索（1日3回の制限なし）</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✓</span>
                    <span>検索履歴の自動保存</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✓</span>
                    <span>「利益が出るカードリスト」のCSV出力</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={handleUpgradeToPro}
                disabled={isLoadingCheckout}
                className="w-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold py-3 px-4 rounded-lg hover:from-yellow-500 hover:to-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingCheckout ? "処理中..." : "Proプランにアップグレード"}
              </button>

              <p className="text-xs text-center text-gray-500">
                決済はStripe経由で安全に処理されます
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}