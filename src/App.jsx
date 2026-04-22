import { useEffect, useRef, useState } from "react";
import {
  STORAGE_KEYS,
  REPO_SAMPLE_PATHS,
  loadJson,
  saveJson,
  parseJsonl,
  parseCsv,
  ensureArray,
  formatDateId,
  compactDateId,
  formatPercent,
  buildNewsByDate,
  normalizeNewsRecord,
  buildNewsAggregate,
  normalizeEntityPayload,
  sentimentToVector,
  validateSentiment,
  normalizeWeights,
  cosineSimilarity,
  jaccardSimilarity
} from "./utils";
import Phase2NewsNetwork from "./components/Phase2NewsNetwork";

const MARKET_LOOKBACK_DAYS = 5;
const DEFAULT_TICKER = "^N225";
const DEFAULT_SELECTED_DATE = "20250701";
const PREDICTION_TARGET_DATE_IDS = ["20250701", "20250702", "20250703", "20250704"];
const SIMILARITY_CANDIDATE_DATE_IDS = ["20250623", "20250624", "20250625", "20250626", "20250627"];

const initialPipelineState = {
  dataReady: false,
  targetDateConfirmed: false,
  sentimentConfirmed: false,
  entitiesConfirmed: false,
  marketConfirmed: false,
  predictionReady: false,
  selectedDate: DEFAULT_SELECTED_DATE,
  selectedTicker: DEFAULT_TICKER
};

function App() {
  const heroImageUrl = new URL(`${import.meta.env.BASE_URL}image-stock.jpg`, window.location.href).href;
  const architecturePdfUrl = new URL(
    `${import.meta.env.BASE_URL}Glass_Box_Quant_Nikkei_Architecture(1).pdf`,
    window.location.href
  ).href;

  const [pipeline, setPipeline] = useState({ ...initialPipelineState, ...loadJson(STORAGE_KEYS.pipeline, {}) });
  const [newsRecords, setNewsRecords] = useState([]);
  const [newsByDate, setNewsByDate] = useState({});
  const [marketData, setMarketData] = useState({ rows: [], fetchReport: null });
  const [precomputedSentiments, setPrecomputedSentiments] = useState({});
  const [precomputedEntities, setPrecomputedEntities] = useState({});
  const [sentiments, setSentiments] = useState(loadJson(STORAGE_KEYS.sentiments, {}));
  const [entities, setEntities] = useState(loadJson(STORAGE_KEYS.entities, {}));
  const [prediction, setPrediction] = useState(loadJson(STORAGE_KEYS.prediction, null));
  const [weights, setWeights] = useState({ sentiment: 0.4, entity: 0.3, market: 0.3 });
  const [loadState, setLoadState] = useState({
    kind: "busy",
    text: "読込中",
    detail: "ニュース・市場データ・事前生成結果を読み込んでいます。"
  });
  const pdfDialogRef = useRef(null);

  useEffect(() => {
    let active = true;

    async function preloadDemoData() {
      setLoadState({
        kind: "busy",
        text: "読込中",
        detail: "ニュース・市場データ・事前生成結果を読み込んでいます。"
      });

      try {
        const [
          newsResponse,
          manifestResponse,
          marketResponse,
          reportResponse,
          sentimentResponse,
          entityResponse
        ] = await Promise.all([
          fetch(REPO_SAMPLE_PATHS.news),
          fetch(REPO_SAMPLE_PATHS.newsInputsManifest),
          fetch(REPO_SAMPLE_PATHS.market),
          fetch(REPO_SAMPLE_PATHS.fetchReport),
          fetch(REPO_SAMPLE_PATHS.precomputedSentiments),
          fetch(REPO_SAMPLE_PATHS.precomputedEntities)
        ]);

        const failedResponse = [
          newsResponse,
          manifestResponse,
          marketResponse,
          reportResponse,
          sentimentResponse,
          entityResponse
        ].find((response) => !response.ok);

        if (failedResponse) {
          throw new Error(`HTTP ${failedResponse.status}`);
        }

        const [newsText, newsManifest, marketText, fetchReport, rawSentiments, rawEntities] = await Promise.all([
          newsResponse.text(),
          manifestResponse.json(),
          marketResponse.text(),
          reportResponse.json(),
          sentimentResponse.json(),
          entityResponse.json()
        ]);

        const additionalNewsResponses = await Promise.all(
          (newsManifest || []).map((entry) => fetch(new URL(`${import.meta.env.BASE_URL || "./"}${entry.path}`, window.location.href).href))
        );
        const failedAdditional = additionalNewsResponses.find((response) => !response.ok);
        if (failedAdditional) {
          throw new Error(`HTTP ${failedAdditional.status}`);
        }
        const additionalNewsTexts = await Promise.all(additionalNewsResponses.map((response) => response.text()));

        const records = [
          ...parseJsonl(newsText).map(normalizeNewsRecord),
          ...additionalNewsTexts.flatMap((text) => parseJsonl(text).map(normalizeNewsRecord))
        ];
        const byDate = buildNewsByDate(records);
        const rows = parseCsv(marketText);
        const normalizedSentiments = normalizePrecomputedSentiments(rawSentiments);
        const normalizedEntities = normalizePrecomputedEntities(rawEntities);
        const tickers = [...new Set(rows.map((row) => row.ticker))];
        const initialDateIds = buildSelectableDateIds(
          byDate,
          normalizedSentiments,
          normalizedEntities,
          rows,
          tickers[0] || DEFAULT_TICKER,
          PREDICTION_TARGET_DATE_IDS
        );

        if (!active) {
          return;
        }

        setNewsRecords(records);
        setNewsByDate(byDate);
        setMarketData({ rows, fetchReport });
        setPrecomputedSentiments(normalizedSentiments);
        setPrecomputedEntities(normalizedEntities);
        setPipeline((current) => ({
          ...initialPipelineState,
          ...current,
          selectedDate: initialDateIds.includes(current.selectedDate) ? current.selectedDate : initialDateIds[0] || DEFAULT_SELECTED_DATE,
          selectedTicker: tickers.includes(current.selectedTicker) ? current.selectedTicker : tickers[0] || DEFAULT_TICKER
        }));
        setLoadState({
          kind: "ready",
          text: "準備完了",
          detail:
            `ニュース: ${records.length}件\n` +
            `追加入力ファイル: ${additionalNewsTexts.length}件\n` +
            `予測対象日: ${initialDateIds.map(formatDateId).join(", ") || "なし"}\n` +
            `類似日候補: ${SIMILARITY_CANDIDATE_DATE_IDS.map(formatDateId).join(", ")}\n` +
            `市場データ: ${rows.length}行\n` +
            `事前生成センチメント: ${Object.keys(normalizedSentiments).length}日分\n` +
            `事前生成キーワード: ${Object.keys(normalizedEntities).length}日分`
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setLoadState({
          kind: "error",
          text: "失敗",
          detail: `デモ用データの読込に失敗しました: ${error.message}`
        });
      }
    }

    preloadDemoData();
    return () => {
      active = false;
    };
  }, []);

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
    if (prediction) {
      saveJson(STORAGE_KEYS.prediction, prediction);
    } else {
      localStorage.removeItem(STORAGE_KEYS.prediction);
    }
  }, [prediction]);

  const marketRows = marketData.rows || [];
  const tickers = [...new Set(marketRows.map((row) => row.ticker))];
  const selectedTicker = tickers.includes(pipeline.selectedTicker) ? pipeline.selectedTicker : tickers[0] || DEFAULT_TICKER;
  const selectedTickerRows = marketRows
    .filter((row) => row.ticker === selectedTicker)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  const availableTargetDateIds = buildSelectableDateIds(
    newsByDate,
    precomputedSentiments,
    precomputedEntities,
    marketRows,
    selectedTicker,
    PREDICTION_TARGET_DATE_IDS
  );
  const similarityCandidateDateIds = buildSelectableDateIds(
    newsByDate,
    precomputedSentiments,
    precomputedEntities,
    marketRows,
    selectedTicker,
    SIMILARITY_CANDIDATE_DATE_IDS
  );
  const selectedDate = availableTargetDateIds.includes(pipeline.selectedDate)
    ? pipeline.selectedDate
    : availableTargetDateIds[0] || DEFAULT_SELECTED_DATE;
  const selectedTradeDate = formatDateId(selectedDate);
  const selectedRecords = newsByDate[selectedDate] || [];
  const selectedNewsAggregate = buildNewsAggregate(selectedRecords);
  const selectedHeadlines = selectedRecords
    .map((record) => record.headline)
    .filter(Boolean)
    .slice(0, 8);
  const selectedNewsGraph = buildDailyNewsGraph(newsByDate, selectedDate);

  const selectedPrecomputedSentiment = precomputedSentiments[selectedDate] || null;
  const selectedPrecomputedEntities = precomputedEntities[selectedDate] || null;

  const candidateDateIds = similarityCandidateDateIds.filter((dateId) => dateId !== selectedDate);

  const summaryItems = [
    { label: "Data", value: loadState.kind === "ready" ? "準備済み" : loadState.text },
    { label: "Target", value: formatDateId(selectedDate) },
    { label: "Ticker", value: selectedTicker || "-" },
    { label: "Candidates", value: candidateDateIds.length },
    { label: "Sentiment", value: pipeline.sentimentConfirmed ? "確認済み" : "未確認" },
    { label: "Prediction", value: prediction ? prediction.predictionDirection : "未出力" }
  ];

  const phaseStatus = {
    preparation: loadState.kind === "error"
      ? { kind: "error", text: "失敗" }
      : pipeline.dataReady
        ? { kind: "ready", text: "確認済み" }
        : loadState.kind === "ready"
          ? { kind: "busy", text: "確認待ち" }
          : { kind: "busy", text: "読込中" },
    news: !pipeline.dataReady
      ? { kind: "neutral", text: "待機" }
      : pipeline.targetDateConfirmed
        ? { kind: "ready", text: "選択済み" }
        : { kind: "busy", text: "選択待ち" },
    sentiment: !pipeline.targetDateConfirmed
      ? { kind: "neutral", text: "待機" }
      : pipeline.sentimentConfirmed
        ? { kind: "ready", text: "確認済み" }
        : selectedPrecomputedSentiment
          ? { kind: "busy", text: "確認待ち" }
          : { kind: "error", text: "欠損" },
    entity: !pipeline.sentimentConfirmed
      ? { kind: "neutral", text: "待機" }
      : pipeline.entitiesConfirmed
        ? { kind: "ready", text: "確認済み" }
        : selectedPrecomputedEntities
          ? { kind: "busy", text: "確認待ち" }
          : { kind: "error", text: "欠損" },
    market: !pipeline.entitiesConfirmed
      ? { kind: "neutral", text: "待機" }
      : pipeline.marketConfirmed
        ? { kind: "ready", text: "確認済み" }
        : marketRows.length
          ? { kind: "busy", text: "確認待ち" }
          : { kind: "error", text: "欠損" },
    similarity: !pipeline.marketConfirmed
      ? { kind: "neutral", text: "待機" }
      : prediction
        ? { kind: "ready", text: "計算済み" }
        : candidateDateIds.length
          ? { kind: "busy", text: "計算待ち" }
          : { kind: "error", text: "候補不足" },
    output: prediction
      ? { kind: "ready", text: "出力済み" }
      : pipeline.marketConfirmed
        ? { kind: "busy", text: "待機" }
        : { kind: "neutral", text: "待機" }
  };

  function resetAfterDateSelection(nextDate) {
    setPrediction(null);
    setSentiments({});
    setEntities({});
    setPipeline((current) => ({
      ...current,
      selectedDate: nextDate,
      targetDateConfirmed: false,
      sentimentConfirmed: false,
      entitiesConfirmed: false,
      marketConfirmed: false,
      predictionReady: false
    }));
  }

  function confirmPreparation() {
    setPrediction(null);
    setSentiments({});
    setEntities({});
    setPipeline((current) => ({
      ...current,
      dataReady: true,
      targetDateConfirmed: false,
      sentimentConfirmed: false,
      entitiesConfirmed: false,
      marketConfirmed: false,
      predictionReady: false
    }));
  }

  function confirmTargetDate() {
    setPrediction(null);
    setSentiments({});
    setEntities({});
    setPipeline((current) => ({
      ...current,
      targetDateConfirmed: true,
      sentimentConfirmed: false,
      entitiesConfirmed: false,
      marketConfirmed: false,
      predictionReady: false
    }));
  }

  function confirmSentiment() {
    if (!selectedPrecomputedSentiment) {
      return;
    }
    setSentiments({ [selectedDate]: selectedPrecomputedSentiment });
    setPrediction(null);
    setPipeline((current) => ({
      ...current,
      sentimentConfirmed: true,
      entitiesConfirmed: false,
      marketConfirmed: false,
      predictionReady: false
    }));
  }

  function confirmEntities() {
    if (!selectedPrecomputedEntities) {
      return;
    }
    setEntities({ [selectedDate]: selectedPrecomputedEntities });
    setPrediction(null);
    setPipeline((current) => ({
      ...current,
      entitiesConfirmed: true,
      marketConfirmed: false,
      predictionReady: false
    }));
  }

  function confirmMarket() {
    setPrediction(null);
    setPipeline((current) => ({
      ...current,
      marketConfirmed: true,
      predictionReady: false
    }));
  }

  function updateSelectedTicker(ticker) {
    setPrediction(null);
    setPipeline((current) => ({
      ...current,
      selectedTicker: ticker,
      predictionReady: false
    }));
  }

  function resetSessionState() {
    [
      STORAGE_KEYS.pipeline,
      STORAGE_KEYS.sentiments,
      STORAGE_KEYS.entities,
      STORAGE_KEYS.prediction
    ].forEach((key) => localStorage.removeItem(key));

    setPrediction(null);
    setSentiments({});
    setEntities({});
    setPipeline({
      ...initialPipelineState,
      selectedDate: availableTargetDateIds[0] || DEFAULT_SELECTED_DATE,
      selectedTicker
    });
  }

  function runSimilarity() {
    if (!pipeline.marketConfirmed) {
      return;
    }

    const targetSentiment = precomputedSentiments[selectedDate];
    const targetEntityPayload = precomputedEntities[selectedDate];
    const targetDate = formatDateId(selectedDate);

    if (!targetSentiment || !targetEntityPayload || !selectedTicker) {
      return;
    }

    const normalizedWeights = normalizeWeights(weights);

    const scores = candidateDateIds
      .map((dateId) => {
        const candidateTradeDate = formatDateId(dateId);
        const candidateSentiment = precomputedSentiments[dateId];
        const candidateEntityPayload = precomputedEntities[dateId];
        const sentimentScore = cosineSimilarity(
          sentimentToVector(targetSentiment),
          sentimentToVector(candidateSentiment)
        );
        const entityScore = jaccardSimilarity(
          new Set(targetEntityPayload.named_entities),
          new Set(candidateEntityPayload.named_entities)
        );
        const targetVector = buildMarketSequenceVector(
          selectedTickerRows,
          targetDate,
          candidateTradeDate,
          MARKET_LOOKBACK_DAYS
        );
        const candidateVector = buildMarketSequenceVector(
          selectedTickerRows,
          candidateTradeDate,
          targetDate,
          MARKET_LOOKBACK_DAYS
        );
        const marketScore = cosineSimilarity(targetVector, candidateVector);

        return {
          date: candidateTradeDate,
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
      return;
    }

    const bestCandidate = scores[0];
    const tickerDates = [...new Set(selectedTickerRows.map((row) => row.trade_date))].sort();
    const candidateIndex = tickerDates.indexOf(bestCandidate.date);
    const nextTradeDate = candidateIndex >= 0 ? tickerDates[candidateIndex + 1] || null : null;
    const nextTradeRow = marketRows.find(
      (row) => row.ticker === selectedTicker && row.trade_date === nextTradeDate
    );
    const predictionPct = nextTradeRow ? Number(nextTradeRow.day_change_pct) / 100 : null;
    const predictionDirection = predictionPct == null ? "未知" : predictionPct >= 0 ? "上昇" : "下落";
    const candidateEntityPayload = precomputedEntities[compactDateId(bestCandidate.date)];
    const overlap = targetEntityPayload.named_entities.filter((item) => (
      candidateEntityPayload?.named_entities.includes(item)
    ));

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
        ` 事前生成センチメントと注目キーワードの一致が比較的強く、重なった注目語は ${overlap.slice(0, 6).join(" / ") || "限定的"} です。` +
        ` 総合スコアは ${bestCandidate.totalScore.toFixed(3)} でした。` +
        (nextTradeRow
          ? ` 類似日の翌営業日 ${nextTradeRow.trade_date} の実績 day_change_pct は ${formatPercent(Number(nextTradeRow.day_change_pct) / 100)} です。`
          : " 類似日の翌営業日データは見つかりませんでした。")
    });
    setPipeline((current) => ({
      ...current,
      predictionReady: true
    }));
  }

  const preparationDetail = loadState.detail;
  const newsDetail = selectedRecords.length
    ? `対象日: ${selectedTradeDate}\n` +
      `ニュース件数: ${selectedRecords.length}\n` +
      `ユニークキーワード数: ${selectedNewsAggregate.uniqueEntityCount}\n` +
      `平均本文長: ${selectedNewsAggregate.averageContentLength.toFixed(1)}\n` +
      `進行状態: ${pipeline.targetDateConfirmed ? "確定済み" : "未確定"}`
    : "ニュースを準備中です。";
  const sentimentDetail = selectedPrecomputedSentiment
    ? `対象日: ${selectedTradeDate}\n` +
      `市場レジーム: ${selectedPrecomputedSentiment.market_regime}\n` +
      `overall_bias: ${selectedPrecomputedSentiment.overall_bias}\n` +
      `confidence: ${selectedPrecomputedSentiment.confidence}\n` +
      `確認状態: ${pipeline.sentimentConfirmed ? "確認済み" : "未確認"}`
    : "事前生成センチメントがありません。";
  const entityDetail = selectedPrecomputedEntities
    ? `対象日: ${selectedTradeDate}\n` +
      `注目キーワード数: ${selectedPrecomputedEntities.named_entities.length}\n` +
      `先頭例: ${selectedPrecomputedEntities.named_entities.slice(0, 8).join(", ") || "-"}\n` +
      `確認状態: ${pipeline.entitiesConfirmed ? "確認済み" : "未確認"}`
    : "事前生成キーワードがありません。";
  const marketDetail = marketRows.length
    ? `対象ティッカー: ${selectedTicker}\n` +
      `CSV 行数: ${marketRows.length}\n` +
      `比較候補日: ${candidateDateIds.map(formatDateId).join(", ") || "なし"}\n` +
      `履歴範囲: ${marketData.fetchReport?.history_fetch_start || "-"} 〜 ${marketData.fetchReport?.history_fetch_end || "-"}`
    : "市場データを準備中です。";
  const similarityDetail = prediction
    ? `対象日: ${prediction.targetDate}\n` +
      `対象ティッカー: ${prediction.ticker}\n` +
      `最類似日: ${prediction.bestCandidate?.date || "-"}\n` +
      `予測方向: ${prediction.predictionDirection}\n` +
      `予測変化率: ${formatPercent(prediction.predictionPct)}`
    : `比較候補日: ${candidateDateIds.map(formatDateId).join(", ") || "なし"}\n` +
      `重み: センチメント ${weights.sentiment.toFixed(1)} / 注目キーワード ${weights.entity.toFixed(1)} / 市場 ${weights.market.toFixed(1)}`;

  return (
    <div id="app">
      <header
        className="hero"
        style={{ "--hero-image": `url(${heroImageUrl})` }}
      >
        <div className="hero-copy">
          <p className="eyebrow">daily-aura-predictor-nikkei</p>
          <h1>事前生成データで翌営業日の相場傾向を追うデモ</h1>
          <p className="hero-text">
            GitHub Pages 向けの静的フロントエンドとして、同梱済みニュース JSONL・市場データ CSV・事前生成結果 JSON を順番に確認しながら、
            予測表示まで辿るデモ版です。予測対象日は 2025-07-01 から 2025-07-04、類似日候補は 2025-06-23 から 2025-06-27 に固定しています。
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => pdfDialogRef.current?.showModal()}>
              このアプリの概要
            </button>
            <button className="button ghost" onClick={resetSessionState}>
              進行状態をリセット
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
        <PhaseCard number="Phase 1" title="データ準備" badge={phaseStatus.preparation}>
          <p className="phase-text">
            ニュース記事データ、市場データ、事前生成済みの日次センチメント表現と注目キーワード結果を自動で読み込みます。
          </p>
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={confirmPreparation}
              disabled={loadState.kind !== "ready" || pipeline.dataReady}
            >
              {pipeline.dataReady ? "確認済み" : "サンプルデータを確認して始める"}
            </button>
          </div>
          <pre className="detail-box">{preparationDetail}</pre>
        </PhaseCard>

        <PhaseCard number="Phase 2" title="対象日ニュース選択" badge={phaseStatus.news} locked={!pipeline.dataReady}>
          <p className="phase-text">
            予測対象として選べるのは 2025-07-01 から 2025-07-04 のみです。選んだ日付のニュース件数、見出し、上位 40 エンティティの共起ネットワークを確認して次へ進みます。
          </p>
          <div className="field-grid">
            <label className="field">
              <span>対象日</span>
              <select
                value={selectedDate}
                onChange={(event) => resetAfterDateSelection(event.target.value)}
                disabled={!pipeline.dataReady}
              >
                {availableTargetDateIds.map((dateId) => (
                  <option key={dateId} value={dateId}>{formatDateId(dateId)}</option>
                ))}
              </select>
            </label>
          </div>
          <pre className="detail-box">{newsDetail}</pre>
          <div className="phase-graph-panel">
            <div className="phase-graph-head">
              <div>
                <h3>エンティティ共起ネットワーク</h3>
                <p className="phase-graph-description">
                  選択した 1 日分のニュースで同時に登場した 固有表現 を結び、出現頻度の高い上位 40 件の関係を簡易表示します。
                </p>
              </div>
            </div>
            {selectedNewsGraph ? (
              <>
                <Phase2NewsNetwork
                  graph={selectedNewsGraph}
                  selectedDate={selectedDate}
                  onDateChange={resetAfterDateSelection}
                />
                <div className="phase-graph-summary">
                  <div className="phase-graph-summary-group">
                    <p className="phase-graph-summary-label">頻出エンティティ</p>
                    <div className="chip-list">
                      {selectedNewsGraph.topEntities.slice(0, 12).map((item) => (
                        <span className="chip" key={`${selectedNewsGraph.dateId}:${item.name}`}>
                          {item.name}: {item.count}件
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="phase-graph-summary-group">
                    <p className="phase-graph-summary-label">強い共起ペア</p>
                    <div className="chip-list">
                      {selectedNewsGraph.topPairs.length ? selectedNewsGraph.topPairs.slice(0, 10).map((pair) => (
                        <span className="chip" key={`${selectedNewsGraph.dateId}:${pair.source}:${pair.target}`}>
                          {pair.source} × {pair.target}: {pair.count}件
                        </span>
                      )) : (
                        <span className="chip">共起 2 回以上のペアはありません</span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="graph-empty-state">対象日の記事から共起関係を作れませんでした。</div>
            )}
          </div>
          <section className="phase-section">
            <h3>見出しプレビュー</h3>
            <ul className="headline-list">
              {selectedHeadlines.map((headline) => (
                <li className="headline-item" key={headline}>{headline}</li>
              ))}
            </ul>
          </section>
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={confirmTargetDate}
              disabled={!pipeline.dataReady || !selectedRecords.length || pipeline.targetDateConfirmed}
            >
              {pipeline.targetDateConfirmed ? "選択済み" : "この日で進む"}
            </button>
          </div>
        </PhaseCard>

        <PhaseCard number="Phase 3" title="日次センチメント表現表示" badge={phaseStatus.sentiment} locked={!pipeline.targetDateConfirmed}>
          <p className="phase-text">
            このフェーズではアプリ内生成は行わず、あらかじめ用意した日次センチメント表現を表示します。内容を確認すると次のフェーズが有効になります。
          </p>
          <pre className="detail-box">{sentimentDetail}</pre>
          <pre className="detail-box json-view">
            {selectedPrecomputedSentiment ? JSON.stringify(selectedPrecomputedSentiment, null, 2) : "事前生成センチメントがありません。"}
          </pre>
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={confirmSentiment}
              disabled={!pipeline.targetDateConfirmed || !selectedPrecomputedSentiment || pipeline.sentimentConfirmed}
            >
              {pipeline.sentimentConfirmed ? "確認済み" : "確認して次へ"}
            </button>
          </div>
        </PhaseCard>

        <PhaseCard number="Phase 4" title="注目キーワード表示" badge={phaseStatus.entity} locked={!pipeline.sentimentConfirmed}>
          <p className="phase-text">
            選択日の注目キーワード結果を表示します。既存の事前生成結果に加えて、新しい入力ニュースについても表示できるように反映しています。
          </p>
          <pre className="detail-box">{entityDetail}</pre>
          <pre className="detail-box json-view">
            {selectedPrecomputedEntities ? JSON.stringify(selectedPrecomputedEntities, null, 2) : "事前生成キーワードがありません。"}
          </pre>
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={confirmEntities}
              disabled={!pipeline.sentimentConfirmed || !selectedPrecomputedEntities || pipeline.entitiesConfirmed}
            >
              {pipeline.entitiesConfirmed ? "確認済み" : "確認して次へ"}
            </button>
          </div>
        </PhaseCard>

        <PhaseCard number="Phase 5" title="市場データ確認" badge={phaseStatus.market} locked={!pipeline.entitiesConfirmed}>
          <p className="phase-text">
            市場データも静的ファイルから読み込み済みです。ティッカーを選び、今回の比較に使う市場データ範囲を確認して類似日計算へ進みます。
          </p>
          <div className="field-grid">
            <label className="field">
              <span>対象ティッカー</span>
              <select
                value={selectedTicker}
                onChange={(event) => updateSelectedTicker(event.target.value)}
                disabled={!pipeline.entitiesConfirmed}
              >
                {tickers.map((ticker) => <option key={ticker} value={ticker}>{ticker}</option>)}
              </select>
            </label>
          </div>
          <pre className="detail-box">{marketDetail}</pre>
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={confirmMarket}
              disabled={!pipeline.entitiesConfirmed || !marketRows.length || pipeline.marketConfirmed}
            >
              {pipeline.marketConfirmed ? "確認済み" : "市場データを確認して次へ"}
            </button>
          </div>
        </PhaseCard>

        <PhaseCard number="Phase 6" title="類似日計算" badge={phaseStatus.similarity} locked={!pipeline.marketConfirmed}>
          <p className="phase-text">
            事前生成センチメント、事前生成キーワード、市場系列特徴量を合わせて総合スコアを計算します。7月の対象日に対して、比較候補は 2025-06-23 から 2025-06-27 のみを使います。
          </p>
          <div className="field-grid">
            <label className="field">
              <span>重み: センチメント</span>
              <input
                type="number"
                step="0.1"
                value={weights.sentiment}
                onChange={(event) => setWeights((current) => ({ ...current, sentiment: Number(event.target.value) }))}
                disabled={!pipeline.marketConfirmed}
              />
            </label>
            <label className="field">
              <span>重み: 注目キーワード</span>
              <input
                type="number"
                step="0.1"
                value={weights.entity}
                onChange={(event) => setWeights((current) => ({ ...current, entity: Number(event.target.value) }))}
                disabled={!pipeline.marketConfirmed}
              />
            </label>
            <label className="field">
              <span>重み: 市場</span>
              <input
                type="number"
                step="0.1"
                value={weights.market}
                onChange={(event) => setWeights((current) => ({ ...current, market: Number(event.target.value) }))}
                disabled={!pipeline.marketConfirmed}
              />
            </label>
          </div>
          <pre className="detail-box">{similarityDetail}</pre>
          <div className="chip-list">
            {candidateDateIds.map((dateId) => (
              <span className="chip" key={dateId}>{formatDateId(dateId)}</span>
            ))}
          </div>
          <div className="inline-actions">
            <button
              className="button primary"
              onClick={runSimilarity}
              disabled={!pipeline.marketConfirmed || !candidateDateIds.length}
            >
              類似日を計算
            </button>
            <button
              className="button ghost"
              onClick={() => {
                setPrediction(null);
                setPipeline((current) => ({ ...current, predictionReady: false }));
              }}
              disabled={!prediction}
            >
              計算結果をリセット
            </button>
          </div>
        </PhaseCard>

        <PhaseCard number="Phase 7" title="予測出力表示" badge={phaseStatus.output} locked={!pipeline.marketConfirmed}>
          <p className="phase-text">
            類似日の翌営業日の値動きをその日のデモ予測として表示します。ここでは静的データに基づく比較結果を確認できます。
          </p>
          {!prediction ? (
            <div className="prediction-panel empty">Phase 6 で類似日計算を行うと、ここに予測結果を表示します。</div>
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

      <dialog ref={pdfDialogRef} className="modal modal-pdf">
        <div className="modal-card modal-card-pdf">
          <div className="modal-head">
            <h2>このアプリの概要</h2>
            <form method="dialog">
              <button className="icon-button modal-close-button" aria-label="閉じる">
                <span aria-hidden="true">×</span>
              </button>
            </form>
          </div>
          <p className="modal-text">
            <code>今回の株価予測モデル説明PDF</code> をブラウザ内で表示しています。
          </p>
          <div className="pdf-viewer-frame">
            <iframe
              className="pdf-viewer"
              src={architecturePdfUrl}
              title="Glass Box Quant Nikkei Architecture"
            />
          </div>
          <div className="modal-footer-actions">
            <a className="button external-link-button" href={architecturePdfUrl} target="_blank" rel="noreferrer">
              <span className="button-icon" aria-hidden="true">↗</span>
              別タブで開く
            </a>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function buildSelectableDateIds(newsByDate, sentimentsByDate, entitiesByDate, marketRows, ticker, allowedDateIds) {
  const tradeDates = [...new Set(
    (marketRows || [])
      .filter((row) => !ticker || row.ticker === ticker)
      .map((row) => row.trade_date)
  )].sort();

  return allowedDateIds.filter((dateId) => {
      const tradeDate = formatDateId(dateId);
      const currentIndex = tradeDates.indexOf(tradeDate);
      return (
        Boolean(newsByDate[dateId]?.length)
        && Boolean(sentimentsByDate[dateId])
        && Boolean(entitiesByDate[dateId])
        && currentIndex >= 0
        && currentIndex < tradeDates.length - 1
      );
    });
}

function normalizePrecomputedSentiments(payload) {
  return Object.entries(payload || {}).reduce((accumulator, [dateId, sentiment]) => {
    const normalizedDateId = compactDateId(dateId);
    const normalizedSource = unwrapSentimentPayload(sentiment);
    const normalized = {
      ...normalizedSource,
      trade_date: normalizedSource.trade_date || formatDateId(normalizedDateId)
    };
    validateSentiment(normalized);
    accumulator[normalizedDateId] = normalized;
    return accumulator;
  }, {});
}

function unwrapSentimentPayload(sentiment) {
  if (!sentiment || typeof sentiment !== "object") {
    return {};
  }

  if ("response" in sentiment && typeof sentiment.response === "string") {
    try {
      const parsed = JSON.parse(sentiment.response);
      if (Array.isArray(parsed)) {
        return parsed[0] && typeof parsed[0] === "object" ? parsed[0] : {};
      }
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  if (Array.isArray(sentiment)) {
    return sentiment[0] && typeof sentiment[0] === "object" ? sentiment[0] : {};
  }

  return sentiment;
}

function normalizePrecomputedEntities(payload) {
  return Object.entries(payload || {}).reduce((accumulator, [dateId, entityPayload]) => {
    const normalized = normalizeEntityPayload({
      ...entityPayload,
      date_id: compactDateId(dateId)
    });
    accumulator[normalized.date_id] = normalized;
    return accumulator;
  }, {});
}

function buildMarketSequenceVector(rows, anchorDate, comparisonDate, maxLookbackDays) {
  const anchorIndex = rows.findIndex((row) => row.trade_date === anchorDate);
  const comparisonIndex = rows.findIndex((row) => row.trade_date === comparisonDate);
  if (anchorIndex === -1 || comparisonIndex === -1) {
    return [];
  }

  const effectiveLookback = Math.max(
    1,
    Math.min(anchorIndex + 1, comparisonIndex + 1, maxLookbackDays)
  );
  const windowRows = rows.slice(anchorIndex - effectiveLookback + 1, anchorIndex + 1);

  return windowRows.flatMap((row, index) => {
    const open = Number(row.open) || 0;
    const high = Number(row.high) || 0;
    const low = Number(row.low) || 0;
    const close = Number(row.close) || 0;
    const volume = Number(row.volume) || 0;
    const previousRow = index > 0
      ? windowRows[index - 1]
      : rows[rows.findIndex((candidate) => candidate.trade_date === row.trade_date) - 1];
    const previousVolume = Number(previousRow?.volume) || 0;
    const volumeDelta = previousVolume > 0 && volume > 0
      ? Math.log(volume / previousVolume)
      : 0;

    return [
      Number(row.day_change_pct) || 0,
      Number(row.prev_close_change_pct) || 0,
      open ? ((high - low) / open) * 100 : 0,
      open ? ((close - open) / open) * 100 : 0,
      volumeDelta
    ];
  });
}

function buildDailyNewsGraph(newsByDate, dateId) {
  const records = newsByDate[dateId] || [];
  if (!dateId || !records.length) {
    return null;
  }

  const entityCounts = new Map();
  const pairCounts = new Map();
  const entitySubjectCounts = new Map();
  const entitySubjectMatterCounts = new Map();

  records.forEach((record) => {
    const uniqueEntities = [...new Set(
      ensureArray(record.named_entities)
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    )];
    const normalizedSubjects = ensureArray(record.subject_codes)
      .map((entry) => normalizeSubjectEntry(entry))
      .filter((entry) => entry.subject || entry.subjectMatter);

    uniqueEntities.forEach((item) => {
      entityCounts.set(item, (entityCounts.get(item) || 0) + 1);
      normalizedSubjects.forEach((entry) => {
        incrementNestedCount(entitySubjectCounts, item, entry.subject);
        incrementNestedCount(entitySubjectMatterCounts, item, entry.subjectMatter);
      });
    });

    for (let index = 0; index < uniqueEntities.length; index += 1) {
      for (let offset = index + 1; offset < uniqueEntities.length; offset += 1) {
        const source = uniqueEntities[index];
        const target = uniqueEntities[offset];
        const pairKey = [source, target].sort((a, b) => a.localeCompare(b, "ja")).join("::");
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
  });

  const topEntities = [...entityCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], "ja");
    })
    .slice(0, 40)
    .map(([name, count]) => ({ name, count }));

  const topEntitySet = new Set(topEntities.map((item) => item.name));
  const topPairs = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [source, target] = key.split("::");
      return { source, target, count };
    })
    .filter((pair) => topEntitySet.has(pair.source) && topEntitySet.has(pair.target) && pair.count >= 2)
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`, "ja");
    });

  const connectionCounts = new Map();
  topPairs.forEach((pair) => {
    connectionCounts.set(pair.source, (connectionCounts.get(pair.source) || 0) + 1);
    connectionCounts.set(pair.target, (connectionCounts.get(pair.target) || 0) + 1);
  });

  const nodes = topEntities.map((item) => {
    const dominantSubject = pickTopCountKey(entitySubjectCounts.get(item.name));
    const dominantSubjectMatter = pickTopCountKey(entitySubjectMatterCounts.get(item.name));

    return {
      id: `entity:${item.name}`,
      label: item.name,
      group: "entity",
      value: Math.max(12, Math.min(44, 10 + item.count * 1.25)),
      color: buildEntityColor(dominantSubject, dominantSubjectMatter),
      title:
        `${item.name}\n` +
        `出現記事数: ${item.count}\n` +
        `接続ペア数: ${connectionCounts.get(item.name) || 0}\n` +
        `subject: ${dominantSubject || "-"}\n` +
        `subject_matter: ${dominantSubjectMatter || "-"}\n` +
        `対象日記事数: ${records.length}`
    };
  });

  const edges = topPairs.map((pair) => ({
    id: `entity:${pair.source}->entity:${pair.target}`,
    from: `entity:${pair.source}`,
    to: `entity:${pair.target}`,
    value: pair.count,
    width: Math.max(1.4, Math.min(8, 0.8 + pair.count * 0.75)),
    title: `${pair.source} × ${pair.target}\n共起記事数: ${pair.count}`
  }));

  return {
    dateId,
    articleCount: records.length,
    nodes,
    edges,
    topEntities,
    topPairs
  };
}

function normalizeSubjectEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { subject: "", subjectMatter: "" };
  }

  return {
    subject: String(entry.subject || "").trim(),
    subjectMatter: String(entry.subject_matter || "").trim()
  };
}

function incrementNestedCount(store, entityName, code) {
  if (!entityName || !code) {
    return;
  }

  if (!store.has(entityName)) {
    store.set(entityName, new Map());
  }
  const bucket = store.get(entityName);
  bucket.set(code, (bucket.get(code) || 0) + 1);
}

function pickTopCountKey(counter) {
  if (!counter || !counter.size) {
    return "";
  }

  return [...counter.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], "ja");
    })[0]?.[0] || "";
}

function buildEntityColor(subject, subjectMatter) {
  const subjectHue = getSubjectHue(subject);
  const matterOffset = ((hashString(subjectMatter || subject || "default") % 7) - 3) * 5;
  const hue = (subjectHue + matterOffset + 360) % 360;
  const saturation = 46 + (hashString(subjectMatter || "matter") % 10);
  const backgroundLightness = 86 + (hashString(subject || "subject") % 4);
  const borderLightness = 60 + (hashString(subjectMatter || subject || "border") % 6);

  return {
    background: `hsl(${hue} ${saturation}% ${backgroundLightness}%)`,
    border: `hsl(${hue} ${Math.min(saturation + 12, 72)}% ${borderLightness}%)`,
    highlight: {
      background: `hsl(${hue} ${Math.min(saturation + 6, 68)}% ${Math.max(backgroundLightness - 4, 80)}%)`,
      border: `hsl(${hue} ${Math.min(saturation + 14, 76)}% ${Math.max(borderLightness - 6, 50)}%)`
    }
  };
}

function getSubjectHue(subject) {
  const presetHues = {
    "03000000": 205,
    "11000000": 12,
    "15000000": 132,
    "16000000": 28,
    "17000000": 262
  };
  if (subject && subject in presetHues) {
    return presetHues[subject];
  }
  return hashString(subject || "subject") % 360;
}

function hashString(value) {
  const input = String(value || "");
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 2147483647;
  }
  return hash;
}

function PhaseCard({ number, title, badge, children, locked = false }) {
  return (
    <section className={`phase-card${locked ? " locked" : ""}`}>
      <div className="phase-head">
        <div>
          <p className="phase-number">{number}</p>
          <h2>{title}</h2>
        </div>
        <span className={`badge ${badge.kind}`}>{badge.text}</span>
      </div>
      {locked ? <p className="phase-lock-note">前のフェーズを完了すると操作できます。</p> : null}
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
