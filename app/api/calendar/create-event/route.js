import { getCalendarClient, isCalendarConfigured } from "../../../../lib/googleClient";

export const runtime = "nodejs";

function addOneDay(dateStr) {
  // Google CalendarのAll-dayイベントは end.date が「翌日扱い（exclusive）」のため、
  // 予約の終了日をそのまま渡すと1日短く表示されてしまう。ここで1日繰り上げる。
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function isValidDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(req) {
  if (!isCalendarConfigured()) {
    return Response.json({ error: "Googleカレンダー連携が設定されていません。" }, { status: 500 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: "入力内容が空です。" }, { status: 400 });
  }

  const { vehicleName, startDate, endDate, who } = body || {};

  if (typeof vehicleName !== "string" || !vehicleName.trim()) {
    return Response.json({ error: "車両名が指定されていません。" }, { status: 400 });
  }
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return Response.json({ error: "日付の形式が正しくありません。" }, { status: 400 });
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  let calendar;
  try {
    calendar = getCalendarClient();
  } catch (err) {
    console.error("HORAI AI: failed to build calendar client ->", err);
    return Response.json({ error: "Googleカレンダーへの接続設定に問題があります。" }, { status: 500 });
  }

  try {
    const res = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `【車両予約】${vehicleName.trim()}（${who ? who.trim() : "担当未定"}）`,
        description: "HORAI AIから自動登録された車両予約です。",
        start: { date: startDate },
        end: { date: addOneDay(endDate) },
      },
    });
    return Response.json({ eventId: res.data.id, htmlLink: res.data.htmlLink || null });
  } catch (err) {
    console.error("HORAI AI: Google Calendar event creation failed ->", err);
    return Response.json({ error: "Googleカレンダーへの登録に失敗しました。" }, { status: 502 });
  }
}
