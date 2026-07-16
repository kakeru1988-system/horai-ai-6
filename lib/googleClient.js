import { google } from "googleapis";

// サービスアカウント方式（ユーザーのログインを介さないサーバー間連携）。
// GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY が
// 両方設定されている場合のみ、Google連携が有効になります。

function getCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  // .env.local に貼り付けた際、改行が \n という2文字のまま保存されることが多いため変換する
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return { email, privateKey };
}

export function isGoogleAuthConfigured() {
  return !!getCredentials();
}

export function isCalendarConfigured() {
  return isGoogleAuthConfigured() && !!process.env.GOOGLE_CALENDAR_ID;
}

export function isSheetsConfigured() {
  return isGoogleAuthConfigured() && !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
}

function getAuth(scopes) {
  const creds = getCredentials();
  if (!creds) {
    throw new Error("Google連携用の環境変数が設定されていません。");
  }
  return new google.auth.JWT({
    email: creds.email,
    key: creds.privateKey,
    scopes,
  });
}

export function getCalendarClient() {
  const auth = getAuth(["https://www.googleapis.com/auth/calendar.events"]);
  return google.calendar({ version: "v3", auth });
}

export function getSheetsClient() {
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}
