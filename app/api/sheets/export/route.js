import { getSheetsClient, isSheetsConfigured } from "../../../../lib/googleClient";

export const runtime = "nodejs";

const TAB_CASES = "案件";
const TAB_BOOKINGS = "車両予約";
const TAB_NOTIFICATIONS = "通知";

async function ensureSheetExists(sheets, spreadsheetId, existingTitles, tabName) {
  if (existingTitles.includes(tabName)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  existingTitles.push(tabName);
}

async function writeSheet(sheets, spreadsheetId, tabName, rows) {
  // 重複を避けるため、書き込み前にタブ全体をクリアしてから全量を書き込む（追記ではなく置き換え）
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A1:Z10000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export async function POST(req) {
  if (!isSheetsConfigured()) {
    return Response.json({ error: "Googleスプレッドシート連携が設定されていません。" }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: "入力内容が空です。" }, { status: 400 });
  }

  const cases = Array.isArray(body.cases) ? body.cases : [];
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles : [];
  const notifications = Array.isArray(body.notifications) ? body.notifications : [];

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  let sheets;
  try {
    sheets = getSheetsClient();
  } catch (err) {
    console.error("HORAI AI: failed to build sheets client ->", err);
    return Response.json({ error: "Googleスプレッドシートへの接続設定に問題があります。" }, { status: 500 });
  }

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTitles = (meta.data.sheets || []).map((s) => s.properties.title);

    await ensureSheetExists(sheets, spreadsheetId, existingTitles, TAB_CASES);
    await ensureSheetExists(sheets, spreadsheetId, existingTitles, TAB_BOOKINGS);
    await ensureSheetExists(sheets, spreadsheetId, existingTitles, TAB_NOTIFICATIONS);

    const caseRows = [
      ["案件名", "担当", "ステータス", "売上", "粗利", "見積期限"],
      ...cases.map((c) => [c.name ?? "", c.owner ?? "", c.status ?? "", c.sales ?? 0, c.profit ?? 0, c.deadline ?? ""]),
    ];

    const bookingRows = [["車両名", "開始日", "終了日", "担当"]];
    vehicles.forEach((v) => {
      (v.bookings || []).forEach((b) => {
        bookingRows.push([v.name ?? "", b.startDate ?? "", b.endDate ?? "", b.who ?? ""]);
      });
    });

    const notifRows = [
      ["宛先", "内容", "登録"],
      ...notifications.map((n) => [n.to ?? "", n.text ?? "", n.time ?? ""]),
    ];

    await writeSheet(sheets, spreadsheetId, TAB_CASES, caseRows);
    await writeSheet(sheets, spreadsheetId, TAB_BOOKINGS, bookingRows);
    await writeSheet(sheets, spreadsheetId, TAB_NOTIFICATIONS, notifRows);
  } catch (err) {
    console.error("HORAI AI: Google Sheets export failed ->", err);
    return Response.json({ error: "スプレッドシートへの書き出しに失敗しました。" }, { status: 502 });
  }

  return Response.json({ ok: true, exportedAt: new Date().toISOString() });
}
