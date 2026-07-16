// 依存なしの純粋な関数のみで構成。
// サーバー（app/api/ai/route.js）とブラウザ（app/page.jsx のプレゼンモード）
// の両方から読み込まれるため、Node固有・ブラウザ固有のAPIには依存しない。

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function parseYMD(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function shiftDate(d, days) {
  const nd = new Date(d.getTime());
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}

function buildFutureDate(base, month, day) {
  let d = new Date(Date.UTC(base.getUTCFullYear(), month - 1, day));
  if (d < base) d = new Date(Date.UTC(base.getUTCFullYear() + 1, month - 1, day));
  return d;
}

function parseRelativeDateRange(text, todayStr) {
  const base = parseYMD(todayStr);

  const rangeSlash = text.match(/(\d{1,2})\/(\d{1,2})\s*[〜~\-−]\s*(\d{1,2})\/(\d{1,2})/);
  if (rangeSlash) {
    const start = buildFutureDate(base, Number(rangeSlash[1]), Number(rangeSlash[2]));
    const end = buildFutureDate(base, Number(rangeSlash[3]), Number(rangeSlash[4]));
    return { start: toISO(start), end: toISO(end) };
  }

  let start;
  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
  const kanjiMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (slashMatch) {
    start = buildFutureDate(base, Number(slashMatch[1]), Number(slashMatch[2]));
  } else if (kanjiMatch) {
    start = buildFutureDate(base, Number(kanjiMatch[1]), Number(kanjiMatch[2]));
  } else if (text.includes("明後日")) {
    start = shiftDate(base, 2);
  } else if (text.includes("明日")) {
    start = shiftDate(base, 1);
  } else if (text.includes("今日") || text.includes("本日")) {
    start = shiftDate(base, 0);
  } else {
    const wIdx = WEEKDAY_JP.findIndex((w) => text.includes(w + "曜"));
    if (wIdx !== -1) {
      const baseDow = base.getUTCDay();
      let diff = (wIdx - baseDow + 7) % 7;
      if (diff === 0) diff = 7;
      start = shiftDate(base, diff);
    } else if (text.includes("来週")) {
      start = shiftDate(base, 7);
    } else {
      start = shiftDate(base, 1); // フォールバック：明日
    }
  }

  const daysMatch = text.match(/(\d{1,2})\s*日間/);
  const end = daysMatch ? shiftDate(start, Math.max(1, Number(daysMatch[1])) - 1) : start;

  return { start: toISO(start), end: toISO(end) };
}

function extractCaseName(text) {
  const patterns = [
    /新規案件で(.+?)を登録/,
    /案件で(.+?)を登録/,
    /(.+?)を新規案件として登録/,
    /(.+?)の案件を登録/,
    /(.+?)を案件登録/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return null;
}

function extractNotifyMessage(text, caseNames) {
  const mentionedCase = caseNames.find((n) => text.includes(n));
  if (mentionedCase) return `${mentionedCase}の確認をお願いします。`;
  if (/確認|お願い/.test(text)) return "案件の確認をお願いします。";
  return null;
}

/**
 * ルールベースの簡易NLU。Anthropic APIを一切使わない。
 * - サーバー側：APIキー未設定時の自動フォールバック（mockモード）
 * - クライアント側：プレゼンモード（外部通信ゼロで確実に動作させたいとき）
 *
 * @param {string} text 依頼文
 * @param {object} ctx { today, salesReps, managers, cases, vehicles }
 * @param {object} [opts] { silent?: boolean } silent=trueのとき、返答に
 *   「モックモードです」という注記を付けない（プレゼン用の見た目にするため）
 */
export function mockInterpret(text, ctx, opts = {}) {
  const { today, salesReps = [], managers = [], cases = [], vehicles = [] } = ctx;
  const allPeople = [...managers, ...salesReps];
  const caseNames = cases.map((c) => c && c.name).filter(Boolean);
  const empty = { vehicle_name: null, start_date: null, end_date: null, case_name: null, status: null, owner: null, assignee: null, message: null };
  const NOTE = opts.silent ? "" : "（モックモード：APIキー未設定のため簡易ルールで解析しています）";
  const withNote = (s) => (NOTE ? `${s}${NOTE}` : s);

  const matchedVehicle = vehicles.find((v) => v && v.name && text.includes(v.name));
  if (matchedVehicle && /予約|借り|貸して/.test(text)) {
    const { start, end } = parseRelativeDateRange(text, today);
    return { intent: "book_vehicle", ...empty, vehicle_name: matchedVehicle.name, start_date: start, end_date: end, reply: withNote(`${matchedVehicle.name}の予約依頼として受け付けました。`) };
  }

  if (/新規案件|案件.*登録/.test(text)) {
    const caseName = extractCaseName(text);
    return { intent: "create_case", ...empty, case_name: caseName, reply: withNote(caseName ? `「${caseName}」の登録依頼として受け付けました。` : "案件名を読み取れませんでした。") };
  }

  if (/見積期限|期限.*案件|案件.*期限/.test(text)) {
    return { intent: "list_deadline_cases", ...empty, reply: withNote("見積期限が近い案件を確認します。") };
  }

  const matchedPerson = allPeople.find((n) => text.includes(n));
  if (matchedPerson && /依頼|確認|伝えて|連絡/.test(text)) {
    const message = extractNotifyMessage(text, caseNames);
    return { intent: "notify", ...empty, assignee: matchedPerson, message, reply: withNote(message ? `${matchedPerson}さんへの通知依頼として受け付けました。` : "通知内容を読み取れませんでした。") };
  }

  if (/売上/.test(text) && /まとめ|集計|今月/.test(text)) {
    return { intent: "sales_summary", ...empty, reply: withNote("今月の売上をまとめます。") };
  }

  if (/案件/.test(text) && /一覧|見せて|開いて/.test(text)) {
    return { intent: "list_cases", ...empty, reply: withNote("案件一覧を開きます。") };
  }

  if (/車両/.test(text) && /一覧|見せて|開いて/.test(text)) {
    return { intent: "list_vehicles", ...empty, reply: withNote("車両管理を開きます。") };
  }

  return {
    intent: "other",
    ...empty,
    reply: withNote("このデモでは「車両予約」「案件登録」「見積期限の確認」「通知依頼」「売上集計」に対応しています。"),
  };
}
