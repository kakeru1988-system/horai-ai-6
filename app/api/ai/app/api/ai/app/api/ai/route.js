import Anthropic from "@anthropic-ai/sdk";
import { mockInterpret } from "../../../lib/mockNlu";

// このAPI RouteはNode専用SDK(@anthropic-ai/sdk)を使うため、Edge Runtimeではなく
// 明示的にNode.js Runtimeを指定する。
export const runtime = "nodejs";

// このファイルはサーバー上でのみ実行されます。
// ANTHROPIC_API_KEY はここでしか参照されず、ブラウザへ返る応答には一切含めません。

const ALLOWED_INTENTS = [
  "book_vehicle",
  "create_case",
  "list_deadline_cases",
  "notify",
  "sales_summary",
  "list_cases",
  "list_vehicles",
  "other",
];

const ALLOWED_STATUSES = ["見積中", "商談中", "受注", "契約更新"];

// 外部の公開Anthropic APIで現在利用できるモデル。
// 環境変数 ANTHROPIC_MODEL が未設定の場合のフォールバック。
const DEFAULT_MODEL = "claude-sonnet-5";

const MAX_INPUT_LENGTH = 2000;

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

function getJapanDateString() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildSystemPrompt({ today, currentUser, salesReps, managers, cases, vehicles }) {
  const vehicleNames = vehicles.map((v) => v && v.name).filter(Boolean).join("、") || "（登録なし）";
  const caseNames = cases.map((c) => c && c.name).filter(Boolean).join("、") || "（登録なし）";
  const salesRepNames = salesReps.filter((s) => typeof s === "string").join("、");
  const managerNames = managers.filter((m) => typeof m === "string").join("、");

  return `あなたは社内システム「HORAI AI」の自然言語ルーターです。社員が入力した業務依頼を読み取り、必ず以下のJSON形式のみで出力してください。説明文やコードブロックの記号（\`\`\`）は一切含めないでください。

# 現在の状況
- 今日の日付（日本時間）: ${today}
- 依頼者（既定の担当者）: ${currentUser}
- 登録済み車両: ${vehicleNames}
- 営業担当: ${salesRepNames}
- 監理担当: ${managerNames}
- 登録済み案件: ${caseNames}

# 出力JSONスキーマ
{
  "intent": "book_vehicle" | "create_case" | "list_deadline_cases" | "notify" | "sales_summary" | "list_cases" | "list_vehicles" | "other",
  "vehicle_name": string | null,
  "start_date": string | null,
  "end_date": string | null,
  "case_name": string | null,
  "status": string | null,
  "owner": string | null,
  "assignee": string | null,
  "message": string | null,
  "reply": string
}

# フィールドの説明
- start_date / end_date: book_vehicleのとき使用。"YYYY-MM-DD"形式。「明日」「来週月曜」「明日から2日間」などの相対表現は、今日の日付（${today}）を基準に計算する。単日の依頼はstart_dateとend_dateを同じ値にする。
- case_name: create_caseのとき、依頼文から読み取れる案件名。読み取れない場合は必ずnullのままにする（推測で埋めない）。
- status: create_caseのとき「見積中」「商談中」「受注」「契約更新」のいずれか。指定がなければnull。
- owner: 担当営業の氏名。指定がなければnull。
- assignee: notifyのとき通知の宛先氏名。読み取れない場合は必ずnullのままにする。
- message: notifyのとき通知本文の要約。読み取れない場合は必ずnullのままにする。
- reply: ユーザーへの返答。丁寧だが簡潔なビジネス日本語で1〜2文。

# 重要なルール
- あなたはまだ何も実行していません。「予約しました」「登録しました」「送信しました」のような完了・成功を断定する表現は絶対に使わないでください。実際の処理は、あなたの回答を受け取った後にシステム側が行います。
- reply では「〜の依頼として受け付けました」「〜の内容として理解しました」のように、解析結果を伝える表現にとどめてください。
- 依頼内容がどの業務にも当てはまらない場合は intent を "other" にし、reply でこのデモが対応できる業務（車両予約・案件登録・見積期限の確認・通知依頼・売上集計）を案内する。
- 車両名や担当者名は、登録済みリストの中から最も自然に一致するものを選ぶ。リストにない名前は無理に一致させない。
- JSON以外の文字は絶対に出力しない。`;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonError("入力内容が空です。", 400);
  }

  if (!body || typeof body !== "object") {
    return jsonError("入力内容が空です。", 400);
  }

  const { userText, today, currentUser, salesReps, managers, cases, vehicles } = body;

  // ---- 入力検証 ----
  if (typeof userText !== "string" || userText.trim().length === 0) {
    return jsonError("入力内容が空です。", 400);
  }
  if (userText.length > MAX_INPUT_LENGTH) {
    return jsonError("入力内容が長すぎます。", 400);
  }

  const safeCases = Array.isArray(cases) ? cases.slice(0, 200) : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles.slice(0, 100) : [];
  const safeSalesReps = Array.isArray(salesReps) ? salesReps.slice(0, 50) : [];
  const safeManagers = Array.isArray(managers) ? managers.slice(0, 50) : [];
  const safeToday = isValidDateString(today) ? today : getJapanDateString();
  const safeCurrentUser = typeof currentUser === "string" && currentUser.trim() ? currentUser.trim() : "利用者";

  // ---- モックモード判定 ----
  // APIキーが未設定、またはMOCK_MODE=trueが明示されている場合は、
  // Anthropic APIを呼ばずルールベースの簡易解析で応答する（デモ・動作確認用）。
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const forceMock = process.env.MOCK_MODE === "true";
  const useMock = forceMock || !apiKey;

  if (useMock) {
    const parsed = mockInterpret(
      userText,
      {
        today: safeToday,
        salesReps: safeSalesReps,
        managers: safeManagers,
        cases: safeCases,
        vehicles: safeVehicles,
      }
    );
    if (!ALLOWED_INTENTS.includes(parsed.intent)) parsed.intent = "other";
    if (parsed.status && !ALLOWED_STATUSES.includes(parsed.status)) parsed.status = null;
    return Response.json({ ...parsed, _mock: true });
  }

  const anthropic = new Anthropic({ apiKey });
  const model =
    typeof process.env.ANTHROPIC_MODEL === "string" && process.env.ANTHROPIC_MODEL.trim()
      ? process.env.ANTHROPIC_MODEL.trim()
      : DEFAULT_MODEL;

  const system = buildSystemPrompt({
    today: safeToday,
    currentUser: safeCurrentUser,
    salesReps: safeSalesReps,
    managers: safeManagers,
    cases: safeCases,
    vehicles: safeVehicles,
  });

  // ---- Anthropic API 呼び出し ----
  let msg;
  try {
    msg = await anthropic.messages.create({
      model,
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: userText }],
    });
  } catch (err) {
    console.error("HORAI AI: Anthropic API call failed ->", err);
    const status = err && (err.status || err.statusCode);
    if (status === 401) {
      return jsonError("AIサービスの認証設定に問題があります。", 401);
    }
    if (status === 429) {
      return jsonError("AIの利用上限に達しました。少し時間を空けて再度お試しください。", 429);
    }
    return jsonError("AIとの通信中にエラーが発生しました。", 500);
  }

  // ---- 応答からJSONを抽出 ----
  const raw = (msg.content || [])
    .map((block) => (block && block.type === "text" ? block.text : ""))
    .join("");

  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("HORAI AI: failed to parse model output ->", raw);
    return jsonError("AIの回答を正しく読み取れませんでした。", 502);
  }

  // ---- intent のホワイトリスト検証 ----
  if (!ALLOWED_INTENTS.includes(parsed.intent)) {
    parsed.intent = "other";
  }
  if (parsed.status && !ALLOWED_STATUSES.includes(parsed.status)) {
    parsed.status = null;
  }
  if (parsed.start_date && !isValidDateString(parsed.start_date)) {
    parsed.start_date = null;
  }
  if (parsed.end_date && !isValidDateString(parsed.end_date)) {
    parsed.end_date = null;
  }
  if (typeof parsed.reply !== "string") {
    parsed.reply = "";
  }

  return Response.json({ ...parsed, _mock: false });
}
