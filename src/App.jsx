import { useEffect, useRef, useState } from "react";
import {
  STORAGE_KEYS,
  REPO_SAMPLE_PATHS,
  DEFAULT_SENTIMENT_SCHEMA,
  loadJson,
  saveJson,
  parseJsonl,
  parseCsv,
  ensureArray,
  formatDateId,
  compactDateId,
  formatPercent,
  maskKey,
  buildNewsByDate,
  normalizeNewsRecord,
  buildNewsAggregate,
  normalizeEntityPayload,
  deriveEntitiesFromNews,
  sentimentToVector,
  validateSentiment,
  buildSentimentPrompt,
  normalizeWeights,
  cosineSimilarity,
  jaccardSimilarity
} from "./utils";

function App() {
  const heroImageUrl = new URL(`${import.meta.env.BASE_URL}image-stock.jpg`, window.location.href).href;
  const [apiKey, setApiKey] = useState(localStorage.getItem(STORAGE_KEYS.apiKey) || "");
  const [pipeline, setPipeline] = useState(loadJson(STORAGE_KEYS.pipeline, {}));
  const [newsRecords, setNewsRecords] = useState([]);
  const [newsByDate, setNewsByDate] = useState({});
  const [newsMeta, setNewsMeta] = useState(loadJson(STORAGE_KEYS.newsMetadata, {}));
  const [sentiments, setSentiments] = useState(loadJson(STORAGE_KEYS.sentiments, {}));
  const [entities, setEntities] = useState(loadJson(STORAGE_KEYS.entities, {}));
  const [marketData, setMarketData] = useState(loadJson(STORAGE_KEYS.market, { rows: [], fetchReport: null }));
  const [prediction, setPrediction] = useState(loadJson(STORAGE_KEYS.prediction, null));
  const [newsTextarea, setNewsTextarea] = useState("");
  const [sentimentTextarea, setSentimentTextarea] = useState("");
  const [entityTextarea, setEntityTextarea] = useState("");
  const [marketTextarea, setMarketTextarea] = useState("");
  const [modelName, setModelName] = useState("gemini-3-flash-preview");
  const [weights, setWeights] = useState({ sentiment: 0.4, entity: 0.3, market: 0.3 });
  const [status, setStatus] = useState({
    api: { kind: "neutral", text: "未設定", detail: "Gemini API Key は未保存です。" },
    news: { kind: "neutral", text: "未読込", detail: "ニュースデータを読み込むと概要が表示されます。" },
    sentiment: { kind: "neutral", text: "未生成", detail: "対象日のニュースを選ぶと、ここに入力概要と保存状態が出ます。" },
    entity: { kind: "neutral", text: "未設定", detail: "ニュースから派生した注目キーワード概要や手動投入結果を表示します。" },
    market: { kind: "neutral", text: "未読込", detail: "市場データを読むとティッカー一覧と日付範囲を表示します。" },
    similarity: { kind: "neutral", text: "未計算", detail: "対象日・対象ティッカーを選び、類似日計算を実行してください。" },
    output: { kind: "neutral", text: "未出力" }
  });
  const dialogRef = useRef(null);

  useEffect(() => {
    const rawNews = localStorage.getItem(STORAGE_KEYS.newsRaw);
    if (rawNews) {
      try {
        const parsed = JSON.parse(rawNews);
        setNewsRecords(parsed.records || []);
        setNewsByDate(parsed.byDate || {});
      } catch {
        setNewsRecords([]);
        setNewsByDate({});
      }
    }
  }, []);

  useEffect(() => {
    if (!apiKey && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
  }, [apiKey]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.pipeline, pipeline);
  }, [pipeline]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.sentiments, sentiments);
  }, [sentiments]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.entities, entities);
  }, [entities]);

  useEffect(() => {
    saveJson(STORAGE_KEYS.market, marketData);
  }, [marketData]);

  useEffect(() => {
    if (prediction) {
      saveJson(STORAGE_KEYS.prediction, prediction);
    } else {
      localStorage.removeItem(STORAGE_KEYS.prediction);
    }
  }, [prediction]);

  useEffect(() => {
    const hasKey = Boolean(apiKey);
    setStatus((current) => ({
      ...current,
      api: {
        kind: hasKey ? "ready" : "neutral",
        text: hasKey ? "保存済み" : "未設定",
        detail: hasKey
          ? `保存済みキー: ${maskKey(apiKey)}\n保存先: localStorage\n注意: デモ用途のみ`
          : "Gemini API Key は未保存です。"
      }
    }));
  }, [apiKey]);

  useEffect(() => {
    const dates = Object.keys(newsByDate).sort();
    if (!newsRecords.length) {
      setStatus((current) => ({
        ...current,
        news: {
          kind: "neutral",
          text: "未読込",
          detail: "ニュースデータを読み込むと概要が表示されます。"
        }
      }));
      return;
    }
    const uniqueEntities = new Set(newsRecords.flatMap((record) => ensureArray(record.named_entities))).size;
    setStatus((current) => ({
      ...current,
      news: {
        kind: "ready",
        text: "読込済み",
        detail:
          `レコード数: ${newsRecords.length}\n` +
          `日付数: ${dates.length}\n` +
          `期間: ${dates[0]} 〜 ${dates[dates.length - 1]}\n` +
          `ユニークエンティティ数: ${uniqueEntities}\n` +
          `備考: canceled=true でも除外せず読込`
      }
    }));
  }, [newsRecords, newsByDate]);

  const newsDates = Object.keys(newsByDate).sort();
  const selectedDate = pipeline.selectedDate && newsDates.includes(pipeline.selectedDate)
    ? pipeline.selectedDate
    : newsDates[0] || "";

  const tickers = [...new Set((marketData.rows || []).map((row) => row.ticker))];
  const selectedTicker = pipeline.selectedTicker && tickers.includes(pipeline.selectedTicker)
    ? pipeline.selectedTicker
    : tickers[0] || "";

  const marketDates = (marketData.rows || [])
    .filter((row) => !selectedTicker || row.ticker === selectedTicker)
    .map((row) => row.trade_date)
    .sort();
  const selectedMarketDate = pipeline.selectedDate && marketDates.includes(formatDateId(pipeline.selectedDate))
    ? formatDateId(pipeline.selectedDate)
    : selectedDate && marketDates.includes(formatDateId(selectedDate))
      ? formatDateId(selectedDate)
      : marketDates[0] || "";

  useEffect(() => {
    if (selectedDate && sentimentTextarea === "" && sentiments[selectedDate]) {
      setSentimentTextarea(JSON.stringify(sentiments[selectedDate], null, 2));
    }
    if (selectedDate && entityTextarea === "" && entities[selectedDate]) {
      setEntityTextarea(JSON.stringify(entities[selectedDate], null, 2));
    }
  }, [selectedDate, sentiments, entities, sentimentTextarea, entityTextarea]);

  useEffect(() => {
    if (!selectedDate) {
      setStatus((current) => ({
        ...current,
        sentiment: {
          kind: "neutral",
          text: "未生成",
          detail: "対象日のニュースを選ぶと、ここに入力概要と保存状態が出ます。"
        },
        entity: {
          kind: "neutral",
          text: "未設定",
          detail: "ニュースから派生した注目キーワード概要や手動投入結果を表示します。"
        }
      }));
      return;
    }

    const records = newsByDate[selectedDate] || [];
    const aggregate = buildNewsAggregate(records);
    const derived = deriveEntitiesFromNews(newsByDate, selectedDate);
    const hasSentiment = Boolean(sentiments[selectedDate]);
    const hasEntity = Boolean(entities[selectedDate]);

    setStatus((current) => ({
      ...current,
      sentiment: {
        kind: hasSentiment ? "ready" : records.length ? "busy" : "neutral",
        text: hasSentiment ? "保存済み" : records.length ? "生成可能" : "未入力",
        detail:
          `対象日: ${selectedDate}\n` +
          `ニュース件数: ${records.length}\n` +
          `ユニークキーワード数: ${aggregate.uniqueEntityCount}\n` +
          `平均本文長: ${aggregate.averageContentLength.toFixed(1)}\n` +
          `保存済みセンチメント: ${hasSentiment ? "あり" : "なし"}`
      },
      entity: {
        kind: hasEntity || derived.named_entities.length ? "ready" : "neutral",
        text: hasEntity ? "保存済み" : derived.named_entities.length ? "派生可能" : "未設定",
        detail:
          `対象日: ${selectedDate}\n` +
          `ニュース由来ユニークキーワード数: ${derived.named_entities.length}\n` +
          `保存済み: ${hasEntity ? "あり" : "なし"}\n` +
          `先頭例: ${(entities[selectedDate]?.named_entities || derived.named_entities).slice(0, 12).join(", ") || "-"}`
      }
    }));
  }, [selectedDate, newsByDate, sentiments, entities]);

  useEffect(() => {
    const rows = marketData.rows || [];
    if (!rows.length) {
      setStatus((current) => ({
        ...current,
        market: {
          kind: "neutral",
          text: "未読込",
          detail: "市場データを読むとティッカー一覧と日付範囲を表示します。"
        }
      }));
      return;
    }
    const dates = rows.map((row) => row.trade_date).sort();
    const tickerList = [...new Set(rows.map((row) => row.ticker))];
    setStatus((current) => ({
      ...current,
      market: {
        kind: "ready",
        text: "読込済み",
        detail:
          `行数: ${rows.length}\n` +
          `ティッカー: ${tickerList.join(", ")}\n` +
          `CSV 内期間: ${dates[0]} 〜 ${dates[dates.length - 1]}\n` +
          (marketData.fetchReport
            ? `fetch_report 範囲: ${marketData.fetchReport.history_fetch_start} 〜 ${marketData.fetchReport.history_fetch_end}\nrequested_dates: ${marketData.fetchReport.requested_dates.join(", ")}`
            : "fetch_report: 未読込")
      }
    }));
  }, [marketData]);

  useEffect(() => {
    if (!prediction) {
      setStatus((current) => ({
        ...current,
        similarity: {
          kind: "neutral",
          text: "未計算",
          detail: "対象日・対象ティッカーを選び、類似日計算を実行してください。"
        },
        output: {
          kind: "neutral",
          text: "未出力"
        }
      }));
      return;
    }
    setStatus((current) => ({
      ...current,
      similarity: {
        kind: "ready",
        text: "計算済み",
        detail:
          `対象日: ${prediction.targetDate}\n` +
          `対象ティッカー: ${prediction.ticker}\n` +
          `最類似日: ${prediction.bestCandidate?.date || "-"}\n` +
          `予測方向: ${prediction.predictionDirection}\n` +
          `予測変化率: ${formatPercent(prediction.predictionPct)}`
      },
      output: {
        kind: "ready",
        text: "出力済み"
      }
    }));
  }, [prediction]);

  const newsCounts = newsDates.map((date) => ({
    date,
    count: (newsByDate[date] || []).length
  }));

  const summaryItems = [
    { label: "API", value: apiKey ? "保存済み" : "未設定" },
    { label: "News", value: newsRecords.length ? `${newsRecords.length}件` : "未読込" },
    { label: "Dates", value: newsDates.length },
    { label: "Sentiments", value: Object.keys(sentiments).length },
    { label: "Entities", value: Object.keys(entities).length },
    { label: "Market", value: marketData.rows?.length || 0 }
  ];

  async function readFile(file, handler) {
    if (!file) {
      return;
    }
    const text = await file.text();
    handler(text, file.name);
  }

  function updatePipeline(next) {
    setPipeline((current) => ({ ...current, ...next }));
  }

  function clearStoredKeys() {
    [
      STORAGE_KEYS.apiKey,
      STORAGE_KEYS.pipeline,
      STORAGE_KEYS.sentiments,
      STORAGE_KEYS.entities,
      STORAGE_KEYS.market,
      STORAGE_KEYS.newsRaw,
      STORAGE_KEYS.newsMetadata,
      STORAGE_KEYS.prediction
    ].forEach((key) => localStorage.removeItem(key));
    setApiKey("");
    setPipeline({});
    setNewsRecords([]);
    setNewsByDate({});
    setNewsMeta({});
    setSentiments({});
    setEntities({});
    setMarketData({ rows: [], fetchReport: null });
    setPrediction(null);
    setNewsTextarea("");
    setSentimentTextarea("");
    setEntityTextarea("");
    setMarketTextarea("");
  }

  async function loadRepoSample(kind) {
    try {
      const response = await fetch(REPO_SAMPLE_PATHS[kind]);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      if (kind === "news") {
        loadNewsText(text, REPO_SAMPLE_PATHS.news);
      }
      if (kind === "market") {
        loadMarketCsv(text, REPO_SAMPLE_PATHS.market);
        try {
          const reportResponse = await fetch(REPO_SAMPLE_PATHS.fetchReport);
          if (reportResponse.ok) {
            const reportText = await reportResponse.text();
            const report = JSON.parse(reportText);
            setMarketData((current) => ({
              ...current,
              fetchReport: report
            }));
          }
        } catch {
          // ignore report preload errors
        }
      }
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [kind]: {
          kind: "error",
          text: "失敗",
          detail: `リポジトリ内サンプルの取得に失敗しました: ${error.message}\nGitHub Pages 上では file input を使ってください。`
        }
      }));
    }
  }

  function loadNewsText(text, sourceLabel) {
    try {
      const records = parseJsonl(text).map(normalizeNewsRecord);
      if (!records.length) {
        throw new Error("有効な JSONL レコードがありません");
      }
      const byDate = buildNewsByDate(records);
      const dates = Object.keys(byDate).sort();
      setNewsRecords(records);
      setNewsByDate(byDate);
      const meta = {
        source: sourceLabel,
        loadedAt: new Date().toISOString(),
        recordCount: records.length,
        dates
      };
      setNewsMeta(meta);
      saveJson(STORAGE_KEYS.newsRaw, { records, byDate });
      saveJson(STORAGE_KEYS.newsMetadata, meta);
      updatePipeline({ newsLoaded: true, selectedDate: dates[0] || "" });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        news: { kind: "error", text: "エラー", detail: `ニュース読込に失敗しました: ${error.message}` }
      }));
    }
  }

  function loadEntityText(text) {
    try {
      const items = text.trim().startsWith("[") ? JSON.parse(text) : parseJsonl(text);
      const next = { ...entities };
      items.forEach((item) => {
        const normalized = normalizeEntityPayload(item);
        next[normalized.date_id] = normalized;
      });
      setEntities(next);
      updatePipeline({ entitiesConfigured: true });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        entity: { kind: "error", text: "エラー", detail: `注目キーワード読込に失敗しました: ${error.message}` }
      }));
    }
  }

  function loadMarketCsv(text) {
    try {
      const rows = parseCsv(text);
      if (!rows.length) {
        throw new Error("有効な CSV 行がありません");
      }
      setMarketData((current) => ({ ...current, rows }));
      updatePipeline({
        marketLoaded: true,
        selectedTicker: [...new Set(rows.map((row) => row.ticker))][0] || ""
      });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        market: { kind: "error", text: "エラー", detail: `市場データ読込に失敗しました: ${error.message}` }
      }));
    }
  }

  function loadFetchReport(text) {
    try {
      setMarketData((current) => ({ ...current, fetchReport: JSON.parse(text) }));
    } catch (error) {
      setStatus((current) => ({
        ...current,
        market: { kind: "error", text: "エラー", detail: `fetch_report 読込に失敗しました: ${error.message}` }
      }));
    }
  }

  async function generateSentiment() {
    if (!selectedDate) {
      setStatus((current) => ({
        ...current,
        sentiment: { kind: "error", text: "エラー", detail: "ニュース日付が未選択です。" }
      }));
      return;
    }
    if (!apiKey) {
      setStatus((current) => ({
        ...current,
        sentiment: { kind: "error", text: "エラー", detail: "Gemini API Key が未設定です。" }
      }));
      return;
    }
    const records = newsByDate[selectedDate] || [];
    if (!records.length) {
      setStatus((current) => ({
        ...current,
        sentiment: { kind: "error", text: "エラー", detail: "対象日のニュースがありません。" }
      }));
      return;
    }

    setStatus((current) => ({
      ...current,
      sentiment: { kind: "busy", text: "生成中", detail: "Gemini に structured output を要求しています。" }
    }));

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildSentimentPrompt(selectedDate, records) }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: DEFAULT_SENTIMENT_SCHEMA
            }
          })
        }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const payload = await response.json();
      const candidateText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        throw new Error("Gemini 応答から JSON テキストを取得できませんでした");
      }
      const sentiment = JSON.parse(candidateText);
      if (!sentiment.trade_date) {
        sentiment.trade_date = formatDateId(selectedDate);
      }
      validateSentiment(sentiment);
      const next = { ...sentiments, [selectedDate]: sentiment };
      setSentiments(next);
      setSentimentTextarea(JSON.stringify(sentiment, null, 2));
      updatePipeline({ sentimentGenerated: true });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        sentiment: {
          kind: "error",
          text: "エラー",
          detail: `Gemini 生成に失敗しました: ${error.message}\n代替として JSON を手動貼り付けして保存できます。`
        }
      }));
    }
  }

  function saveSentimentText() {
    try {
      const sentiment = JSON.parse(sentimentTextarea);
      if (!sentiment.trade_date) {
        sentiment.trade_date = formatDateId(selectedDate);
      }
      validateSentiment(sentiment);
      setSentiments((current) => ({ ...current, [selectedDate]: sentiment }));
      updatePipeline({ sentimentGenerated: true });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        sentiment: { kind: "error", text: "エラー", detail: `センチメント JSON の保存に失敗しました: ${error.message}` }
      }));
    }
  }

  function saveEntityText() {
    try {
      const payload = normalizeEntityPayload(JSON.parse(entityTextarea));
      setEntities((current) => ({ ...current, [payload.date_id]: payload }));
      updatePipeline({ entitiesConfigured: true });
    } catch (error) {
      setStatus((current) => ({
        ...current,
        entity: { kind: "error", text: "エラー", detail: `注目キーワード JSON の保存に失敗しました: ${error.message}` }
      }));
    }
  }

  function runSimilarity() {
    const targetDate = selectedMarketDate || formatDateId(selectedDate);
    if (!targetDate || !selectedTicker) {
      setStatus((current) => ({
        ...current,
        similarity: { kind: "error", text: "エラー", detail: "対象日と対象ティッカーを選択してください。" }
      }));
      return;
    }

    const normalizedWeights = normalizeWeights(weights);
    const candidateDates = [...new Set((marketData.rows || [])
      .filter((row) => row.ticker === selectedTicker)
      .map((row) => row.trade_date))]
      .filter((date) => date !== targetDate);

    const scores = candidateDates
      .map((date) => {
        const targetSentiment = sentiments[compactDateId(targetDate)];
        const candidateSentiment = sentiments[compactDateId(date)];
        const sentimentScore = targetSentiment && candidateSentiment
          ? cosineSimilarity(sentimentToVector(targetSentiment), sentimentToVector(candidateSentiment))
          : cosineSimilarity(
              Object.values(buildNewsAggregate(newsByDate[compactDateId(targetDate)] || [])),
              Object.values(buildNewsAggregate(newsByDate[compactDateId(date)] || []))
            );

        const targetEntities = entities[compactDateId(targetDate)]?.named_entities
          || deriveEntitiesFromNews(newsByDate, compactDateId(targetDate)).named_entities;
        const candidateEntities = entities[compactDateId(date)]?.named_entities
          || deriveEntitiesFromNews(newsByDate, compactDateId(date)).named_entities;
        const entityScore = jaccardSimilarity(new Set(targetEntities), new Set(candidateEntities));

        const targetRow = (marketData.rows || []).find((row) => row.ticker === selectedTicker && row.trade_date === targetDate);
        const candidateRow = (marketData.rows || []).find((row) => row.ticker === selectedTicker && row.trade_date === date);
        const targetVector = buildMarketVector(targetRow);
        const candidateVector = buildMarketVector(candidateRow);
        const marketScore = cosineSimilarity(targetVector, candidateVector);

        return {
          date,
          sentimentScore,
          entityScore,
          marketScore,
          totalScore:
            normalizedWeights.sentiment * sentimentScore +
            normalizedWeights.entity * entityScore +
            normalizedWeights.market * marketScore
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore);

    if (!scores.length) {
      setStatus((current) => ({
        ...current,
        similarity: { kind: "error", text: "エラー", detail: "比較対象の日付が不足しています。" }
      }));
      return;
    }

    const bestCandidate = scores[0];
    const dates = [...new Set((marketData.rows || [])
      .filter((row) => row.ticker === selectedTicker)
      .map((row) => row.trade_date))].sort();
    const index = dates.indexOf(bestCandidate.date);
    const nextTradeDate = index >= 0 ? dates[index + 1] || null : null;
    const nextTradeRow = (marketData.rows || []).find(
      (row) => row.ticker === selectedTicker && row.trade_date === nextTradeDate
    );
    const predictionPct = nextTradeRow ? Number(nextTradeRow.day_change_pct) / 100 : null;
    const predictionDirection = predictionPct == null ? "未知" : predictionPct >= 0 ? "上昇" : "下落";
    const targetEntities = entities[compactDateId(targetDate)]?.named_entities
      || deriveEntitiesFromNews(newsByDate, compactDateId(targetDate)).named_entities;
    const candidateEntities = entities[compactDateId(bestCandidate.date)]?.named_entities
      || deriveEntitiesFromNews(newsByDate, compactDateId(bestCandidate.date)).named_entities;
    const overlap = [...new Set(targetEntities.filter((item) => candidateEntities.includes(item)))];

    setPrediction({
      createdAt: new Date().toISOString(),
      targetDate,
      ticker: selectedTicker,
      weights: normalizedWeights,
      candidates: scores.slice(0, 5),
      bestCandidate,
      nextTradeDate,
      predictionPct,
      predictionDirection,
      rationale:
        `${targetDate} の ${selectedTicker} は ${bestCandidate.date} が最類似日でした。` +
        ` 注目キーワードの重なりは ${overlap.slice(0, 6).join(" / ") || "限定的"}。` +
        ` 総合スコアは ${bestCandidate.totalScore.toFixed(3)}。` +
        (nextTradeRow
          ? ` 類似日の翌営業日 ${nextTradeRow.trade_date} の実績 day_change_pct は ${formatPercent(Number(nextTradeRow.day_change_pct) / 100)} でした。`
          : " 類似日の翌営業日データは見つかりませんでした。")
    });
    updatePipeline({ predictionReady: true });
  }

  return (
    <div id="app">
      <header
        className="hero"
        style={{ "--hero-image": `url(${heroImageUrl})` }}
      >
        <div className="hero-copy">
          <p className="eyebrow">daily-aura-predictor-nikkei</p>
          <h1>ニュース要因と市場データから翌営業日の相場傾向を読む</h1>
          <p className="hero-text">
            React + Vite で構成した GitHub Pages 向けフロントエンドです。Gemini API キーはブラウザの
            <code> localStorage </code>
            に保存されます。この方式はデモ専用で、本番では非推奨です。
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => dialogRef.current?.showModal()}>
              Gemini API Key を設定
            </button>
            <button className="button ghost" onClick={clearStoredKeys}>
              保存状態をリセット
            </button>
          </div>
        </div>
        <aside className="hero-panel">
          <h2>現在の状態</h2>
          <div className="summary-grid">
            {summaryItems.map((item) => (
              <div className="summary-item" key={item.label}>
                <p className="summary-label">{item.label}</p>
                <p className="summary-value">{item.value}</p>
              </div>
            ))}
          </div>
        </aside>
      </header>

      <main className="pipeline">
        <PhaseCard number="Phase 1" title="API キー入力" badge={status.api}>
          <p className="phase-text">Gemini API Key はユーザー入力で扱います。ソースコードには埋め込みません。</p>
          <div className="inline-actions">
            <button className="button primary" onClick={() => dialogRef.current?.showModal()}>モーダルを開く</button>
            <button className="button ghost" onClick={() => setApiKey("")}>保存キーを削除</button>
          </div>
          <pre className="detail-box">{status.api.detail}</pre>
        </PhaseCard>

        <PhaseCard number="Phase 2" title="ニュース入力" badge={status.news}>
          <p className="phase-text">
            <code>news_full_mcq3_type9_entities_novectors.jsonl</code> に対応します。JSONL の手動貼り付けも可能です。
          </p>
          <div className="field-grid">
            <label className="field">
              <span>ニュース JSONL ファイル</span>
              <input type="file" accept=".jsonl,.json" onChange={(event) => readFile(event.target.files?.[0], loadNewsText)} />
            </label>
            <div className="field repo-loader">
              <span>リポジトリ内サンプル</span>
              <button className="button ghost" onClick={() => loadRepoSample("news")}>リポジトリ内サンプルを試す</button>
            </div>
          </div>
          <label className="field">
            <span>JSONL 手動貼り付け</span>
            <textarea rows="8" value={newsTextarea} onChange={(event) => setNewsTextarea(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button className="button secondary" onClick={() => loadNewsText(newsTextarea, "textarea")}>テキストから読込</button>
            <button className="button ghost" onClick={() => { setNewsTextarea(""); setNewsRecords([]); setNewsByDate({}); }}>ニュースをクリア</button>
          </div>
          <pre className="detail-box">{status.news.detail}</pre>
          <div className="chip-list">
            {newsCounts.map((item) => (
              <span className="chip" key={item.date}>{item.date}: {item.count}件</span>
            ))}
          </div>
        </PhaseCard>

        <PhaseCard number="Phase 3" title="日次センチメント表現生成" badge={status.sentiment}>
          <p className="phase-text">Gemini 3 Flash 系へニュース群を送り、日次センチメント表現を structured output で取得します。</p>
          <div className="field-grid">
            <label className="field">
              <span>対象日</span>
              <select value={selectedDate} onChange={(event) => updatePipeline({ selectedDate: event.target.value })}>
                {newsDates.length ? newsDates.map((date) => <option key={date} value={date}>{date}</option>) : <option>選択肢なし</option>}
              </select>
            </label>
            <label className="field">
              <span>モデル名</span>
              <input value={modelName} onChange={(event) => setModelName(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>日次センチメント JSON 手動貼り付け</span>
            <textarea rows="10" value={sentimentTextarea} onChange={(event) => setSentimentTextarea(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button className="button primary" onClick={generateSentiment}>Gemini で生成</button>
            <button className="button secondary" onClick={saveSentimentText}>テキストを保存</button>
            <button className="button ghost" onClick={() => {
              const next = { ...sentiments };
              delete next[selectedDate];
              setSentiments(next);
              setSentimentTextarea("");
            }}>対象日の保存を削除</button>
          </div>
          <pre className="detail-box">{status.sentiment.detail}</pre>
        </PhaseCard>

        <PhaseCard number="Phase 4" title="注目キーワード入力 / 読み込み" badge={status.entity}>
          <p className="phase-text">Gemma 3 の出力を手動投入できます。ニュース JSONL から日付ごとの注目キーワード集合を派生させることもできます。</p>
          <div className="field-grid">
            <label className="field">
              <span>注目キーワード JSON / JSONL ファイル</span>
              <input type="file" accept=".json,.jsonl" onChange={(event) => readFile(event.target.files?.[0], loadEntityText)} />
            </label>
            <label className="field">
              <span>対象日</span>
              <select value={selectedDate} onChange={(event) => updatePipeline({ selectedDate: event.target.value })}>
                {newsDates.length ? newsDates.map((date) => <option key={date} value={date}>{date}</option>) : <option>選択肢なし</option>}
              </select>
            </label>
          </div>
          <label className="field">
            <span>注目キーワード JSON 手動貼り付け</span>
            <textarea rows="8" value={entityTextarea} onChange={(event) => setEntityTextarea(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button className="button primary" onClick={() => {
              const derived = deriveEntitiesFromNews(newsByDate, selectedDate);
              setEntities((current) => ({ ...current, [selectedDate]: derived }));
              setEntityTextarea(JSON.stringify(derived, null, 2));
            }}>ニュースから派生</button>
            <button className="button secondary" onClick={saveEntityText}>テキストを保存</button>
            <button className="button ghost" onClick={() => {
              const next = { ...entities };
              delete next[selectedDate];
              setEntities(next);
              setEntityTextarea("");
            }}>対象日の保存を削除</button>
          </div>
          <pre className="detail-box">{status.entity.detail}</pre>
        </PhaseCard>

        <PhaseCard number="Phase 5" title="市場データ入力" badge={status.market}>
          <p className="phase-text">
            <code>market_data_all.csv</code> と <code>market_data_requested_dates.csv</code>、補助として <code>fetch_report.json</code> を読み込みます。
          </p>
          <div className="field-grid">
            <label className="field">
              <span>市場データ CSV</span>
              <input type="file" accept=".csv" onChange={(event) => readFile(event.target.files?.[0], loadMarketCsv)} />
            </label>
            <label className="field">
              <span>補助 JSON</span>
              <input type="file" accept=".json" onChange={(event) => readFile(event.target.files?.[0], loadFetchReport)} />
            </label>
            <div className="field repo-loader">
              <span>リポジトリ内サンプル</span>
              <button className="button ghost" onClick={() => loadRepoSample("market")}>market_data_all.csv を試す</button>
            </div>
          </div>
          <label className="field">
            <span>市場データ CSV 手動貼り付け</span>
            <textarea rows="8" value={marketTextarea} onChange={(event) => setMarketTextarea(event.target.value)} />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>対象ティッカー</span>
              <select value={selectedTicker} onChange={(event) => updatePipeline({ selectedTicker: event.target.value })}>
                {tickers.length ? tickers.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>) : <option>選択肢なし</option>}
              </select>
            </label>
            <label className="field">
              <span>対象日</span>
              <select value={selectedMarketDate} onChange={(event) => updatePipeline({ selectedDate: compactDateId(event.target.value) })}>
                {marketDates.length ? marketDates.map((date) => <option key={date} value={date}>{date}</option>) : <option>選択肢なし</option>}
              </select>
            </label>
          </div>
          <div className="inline-actions">
            <button className="button secondary" onClick={() => loadMarketCsv(marketTextarea, "textarea")}>テキストから読込</button>
            <button className="button ghost" onClick={() => setMarketData({ rows: [], fetchReport: null })}>市場データをクリア</button>
          </div>
          <pre className="detail-box">{status.market.detail}</pre>
        </PhaseCard>

        <PhaseCard number="Phase 6" title="類似日計算" badge={status.similarity}>
          <p className="phase-text">注目キーワード集合、ニュース集約特徴量、市場特徴量、保存済みセンチメントがあればその特徴量も使って簡易スコアを出します。</p>
          <div className="field-grid">
            <label className="field">
              <span>重み: センチメント</span>
              <input type="number" step="0.1" value={weights.sentiment} onChange={(event) => setWeights((current) => ({ ...current, sentiment: Number(event.target.value) }))} />
            </label>
            <label className="field">
              <span>重み: 注目キーワード</span>
              <input type="number" step="0.1" value={weights.entity} onChange={(event) => setWeights((current) => ({ ...current, entity: Number(event.target.value) }))} />
            </label>
            <label className="field">
              <span>重み: 市場</span>
              <input type="number" step="0.1" value={weights.market} onChange={(event) => setWeights((current) => ({ ...current, market: Number(event.target.value) }))} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button primary" onClick={runSimilarity}>類似日を計算</button>
            <button className="button ghost" onClick={() => setPrediction(null)}>予測結果を削除</button>
          </div>
          <pre className="detail-box">{status.similarity.detail}</pre>
        </PhaseCard>

        <PhaseCard number="Phase 7" title="予測出力表示" badge={status.output}>
          <p className="phase-text">類似日の翌営業日の値動きを基に、対象日の予測方向と予測変化率を表示します。</p>
          {!prediction ? (
            <div className="prediction-panel empty">まだ予測結果はありません。</div>
          ) : (
            <div className="prediction-panel">
              <div className="prediction-metrics">
                <Metric label="対象日" value={prediction.targetDate} />
                <Metric label="ティッカー" value={prediction.ticker} />
                <Metric label="予測方向" value={prediction.predictionDirection} />
                <Metric label="予測変化率" value={formatPercent(prediction.predictionPct)} />
                <Metric label="最類似日" value={prediction.bestCandidate?.date || "-"} />
                <Metric label="翌営業日" value={prediction.nextTradeDate || "-"} />
              </div>
              <p>{prediction.rationale}</p>
              <ul className="candidate-list">
                {prediction.candidates.map((candidate) => (
                  <li key={candidate.date}>
                    <strong>{candidate.date}</strong>
                    {" "}
                    総合 {candidate.totalScore.toFixed(3)}
                    {" / "}
                    センチメント {candidate.sentimentScore.toFixed(3)}
                    {" / "}
                    注目キーワード {candidate.entityScore.toFixed(3)}
                    {" / "}
                    市場 {candidate.marketScore.toFixed(3)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PhaseCard>
      </main>

      <dialog ref={dialogRef} className="modal">
        <form method="dialog" className="modal-card">
          <div className="modal-head">
            <h2>Gemini API Key</h2>
            <button className="button ghost">閉じる</button>
          </div>
          <p className="modal-text">
            このキーはブラウザの <code>localStorage</code> に保存されます。ローカル検証・限定公開デモ専用であり、本番では非推奨です。
          </p>
          <label className="field">
            <span>Gemini API Key</span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder="AIza..." />
          </label>
          <div className="inline-actions">
            <button className="button primary">保存</button>
            <button className="button ghost" onClick={(event) => {
              event.preventDefault();
              setApiKey("");
            }}>削除</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function buildMarketVector(row) {
  if (!row) {
    return [0, 0, 0, 0, 0];
  }
  const open = Number(row.open) || 0;
  const high = Number(row.high) || 0;
  const low = Number(row.low) || 0;
  return [
    Number(row.day_change_pct) || 0,
    Number(row.prev_close_change_pct) || 0,
    open ? (high - low) / open : 0,
    Number(row.volume) || 0,
    Number(row.close) || 0
  ];
}

function PhaseCard({ number, title, badge, children }) {
  return (
    <section className="phase-card">
      <div className="phase-head">
        <div>
          <p className="phase-number">{number}</p>
          <h2>{title}</h2>
        </div>
        <span className={`badge ${badge.kind}`}>{badge.text}</span>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="prediction-card">
      <p>{label}</p>
      <p>{value}</p>
    </div>
  );
}

export default App;
