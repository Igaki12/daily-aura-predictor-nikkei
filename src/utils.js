export const STORAGE_KEYS = {
  apiKey: "gemini_api_key",
  pipeline: "app_state_pipeline",
  sentiments: "daily_sentiment_representation",
  entities: "entity_extraction_result",
  market: "market_similarity_input",
  newsRaw: "news_input_raw",
  newsMetadata: "news_input_metadata",
  prediction: "prediction_result",
};

const baseUrl = import.meta.env.BASE_URL || "./";

export const REPO_SAMPLE_PATHS = {
  news: `${baseUrl}news_full_mcq3_type9_entities_novectors.jsonl`,
  market: `${baseUrl}market_data/2025-06-22_2025-06-28/market_data_all.csv`,
  fetchReport: `${baseUrl}market_data/2025-06-22_2025-06-28/fetch_report.json`,
};

export const DEFAULT_SENTIMENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    trade_date: { type: "STRING" },
    market_regime: { type: "STRING" },
    overall_bias: { type: "NUMBER" },
    confidence: { type: "NUMBER" },
    dimensions: {
      type: "OBJECT",
      properties: {
        macro_tightening_pressure: { type: "NUMBER" },
        domestic_policy_uncertainty: { type: "NUMBER" },
        exporter_tailwind: { type: "NUMBER" },
        semiconductor_momentum: { type: "NUMBER" },
        consumer_strength: { type: "NUMBER" },
        inflation_concern: { type: "NUMBER" },
        yen_appreciation_pressure: { type: "NUMBER" },
        energy_supply_risk: { type: "NUMBER" },
        ai_theme_strength: { type: "NUMBER" },
        financial_sector_support: { type: "NUMBER" }
      },
      required: [
        "macro_tightening_pressure",
        "domestic_policy_uncertainty",
        "exporter_tailwind",
        "semiconductor_momentum",
        "consumer_strength",
        "inflation_concern",
        "yen_appreciation_pressure",
        "energy_supply_risk",
        "ai_theme_strength",
        "financial_sector_support"
      ]
    },
    dominant_themes: { type: "ARRAY", items: { type: "STRING" } },
    bullish_sectors: { type: "ARRAY", items: { type: "STRING" } },
    bearish_sectors: { type: "ARRAY", items: { type: "STRING" } },
    short_rationale: { type: "STRING" }
  },
  required: [
    "trade_date",
    "market_regime",
    "overall_bias",
    "confidence",
    "dimensions",
    "dominant_themes",
    "bullish_sectors",
    "bearish_sectors",
    "short_rationale"
  ]
};

export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return [];
  }
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function formatDateId(dateId) {
  const raw = String(dateId || "").trim();
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

export function compactDateId(value) {
  return String(value || "").replaceAll("-", "");
}

export function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function cosineSimilarity(a, b) {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) {
    return 0;
  }
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

export function jaccardSimilarity(a, b) {
  if (!a.size && !b.size) {
    return 1;
  }
  const intersection = new Set([...a].filter((item) => b.has(item)));
  const union = new Set([...a, ...b]);
  return union.size ? intersection.size / union.size : 0;
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(3)}%`;
}

export function maskKey(key) {
  if (!key) {
    return "未設定";
  }
  if (key.length < 8) {
    return "****";
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function buildNewsByDate(records) {
  return records.reduce((accumulator, record) => {
    const dateId = String(record.date_id || "").trim();
    if (!dateId) {
      return accumulator;
    }
    if (!accumulator[dateId]) {
      accumulator[dateId] = [];
    }
    accumulator[dateId].push(record);
    return accumulator;
  }, {});
}

export function normalizeNewsRecord(record) {
  return {
    ...record,
    date_id: compactDateId(record.date_id || record.trade_date || ""),
    named_entities: ensureArray(record.named_entities),
    questions: ensureArray(record.questions)
  };
}

export function buildNewsAggregate(records) {
  const contentLengths = records.map((record) => (record.content || "").length);
  const entityCount = records.reduce(
    (count, record) => count + ensureArray(record.named_entities).length,
    0
  );
  return {
    articleCount: records.length,
    uniqueEntityCount: new Set(
      records.flatMap((record) => ensureArray(record.named_entities))
    ).size,
    averageContentLength: average(contentLengths),
    averageEntitiesPerArticle: records.length ? entityCount / records.length : 0,
    questionCount: records.reduce(
      (count, record) => count + ensureArray(record.questions).length,
      0
    )
  };
}

export function normalizeEntityPayload(payload) {
  const dateId = compactDateId(payload.date_id || payload.trade_date || "");
  if (!dateId) {
    throw new Error("date_id または trade_date が必要です");
  }
  return {
    ...payload,
    date_id: dateId,
    trade_date: payload.trade_date || formatDateId(dateId),
    named_entities: ensureArray(payload.named_entities)
      .map((item) => String(item).trim())
      .filter(Boolean)
  };
}

export function deriveEntitiesFromNews(newsByDate, dateId) {
  const records = newsByDate[dateId] || [];
  const entities = new Set();
  records.forEach((record) => {
    ensureArray(record.named_entities).forEach((item) => {
      const value = String(item || "").trim();
      if (value) {
        entities.add(value);
      }
    });
  });
  return {
    date_id: dateId,
    trade_date: formatDateId(dateId),
    named_entities: [...entities].sort((a, b) => a.localeCompare(b, "ja")),
    source: "derived_from_news"
  };
}

export function sentimentToVector(sentiment) {
  const dimensions = sentiment?.dimensions || {};
  return [
    Number(sentiment?.overall_bias) || 0,
    Number(sentiment?.confidence) || 0,
    Number(dimensions.macro_tightening_pressure) || 0,
    Number(dimensions.domestic_policy_uncertainty) || 0,
    Number(dimensions.exporter_tailwind) || 0,
    Number(dimensions.semiconductor_momentum) || 0,
    Number(dimensions.consumer_strength) || 0,
    Number(dimensions.inflation_concern) || 0,
    Number(dimensions.yen_appreciation_pressure) || 0,
    Number(dimensions.energy_supply_risk) || 0,
    Number(dimensions.ai_theme_strength) || 0,
    Number(dimensions.financial_sector_support) || 0
  ];
}

export function validateSentiment(sentiment) {
  DEFAULT_SENTIMENT_SCHEMA.required.forEach((key) => {
    if (!(key in sentiment)) {
      throw new Error(`必須キー ${key} がありません`);
    }
  });
  if (typeof sentiment.dimensions !== "object") {
    throw new Error("dimensions は object である必要があります");
  }
}

export function buildSentimentPrompt(dateId, records) {
  const articles = records.slice(0, 60).map((record, index) => ({
    index: index + 1,
    headline: record.headline,
    sub_headline: record.sub_headline,
    source: record.provider_id,
    date_time: record.date_time || record.this_revision_created,
    named_entities: ensureArray(record.named_entities).slice(0, 20),
    content: String(record.content || "").slice(0, 1800)
  }));

  return [
    "あなたは日本株市場向けの日次センチメント構造化分析器です。",
    "以下のニュース群から、その日の市場心理・材料・圧力構造を JSON で返してください。",
    "自由文ではなく、指定したスキーマに従う JSON のみを返してください。",
    `対象 date_id: ${dateId}`,
    `対象 trade_date: ${formatDateId(dateId)}`,
    "overall_bias と dimensions は -1.0 から 1.0、confidence は 0.0 から 1.0 の範囲で返してください。",
    JSON.stringify(articles, null, 2)
  ].join("\n");
}

export function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
  return {
    sentiment: Math.max(weights.sentiment, 0) / total,
    entity: Math.max(weights.entity, 0) / total,
    market: Math.max(weights.market, 0) / total
  };
}
