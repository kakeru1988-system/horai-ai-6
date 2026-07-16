"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Home, Briefcase, Car, TrendingUp, Users, Bell, Settings, Send,
  Sparkles, Check, Search, ChevronRight, X, Loader2, Circle,
  CalendarDays, Menu, ArrowUpRight, ArrowDownRight, ChevronLeft, AlertTriangle
} from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";
import { mockInterpret } from "../lib/mockNlu";

/* ------------------------------------------------------------------ */
/*  tokens                                                              */
/* ------------------------------------------------------------------ */

const NAVY = "#0B1F3D";
const NAVY_SOFT = "#16305A";
const SKY = "#4C8DFF";
const OK = "#2FB380";
const WARN = "#E3A008";
const DANGER = "#E36A6A";

function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById("horai-fonts")) return;
    const link = document.createElement("link");
    link.id = "horai-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
}

/* ------------------------------------------------------------------ */
/*  date helpers (Japan time)                                           */
/* ------------------------------------------------------------------ */

function getJapanDateString() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// "2026-07-14" -> "7/14"
function md(dateStr) {
  if (!dateStr) return "-";
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

// slash range for confirmed bookings, e.g. "7/14〜7/18" (or "7/14" for a single day)
function formatSlashRange(start, end) {
  if (!start || !end) return "未指定";
  const s = md(start);
  const e = md(end);
  return s === e ? s : `${s}〜${e}`;
}

// natural-language range for conflict messages, e.g. "7月14日から18日まで"
function formatJPRange(start, end) {
  const [, ms, ds] = start.split("-").map(Number);
  const [, me, de] = end.split("-").map(Number);
  if (start === end) return `${ms}月${ds}日`;
  if (ms === me) return `${ms}月${ds}日から${de}日まで`;
  return `${ms}月${ds}日から${me}月${de}日まで`;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && aEnd >= bStart;
}

/* ------------------------------------------------------------------ */
/*  seed data                                                           */
/* ------------------------------------------------------------------ */

const SALES_REPS = ["西出", "小町", "久保", "村井", "田中", "アオキ"];
const MANAGERS = ["池田", "吉田", "前川", "北村", "中田", "若林"];
const CURRENT_USER = "西出"; // demo persona — the person typing into the assistant
const ALLOWED_STATUSES = ["見積中", "商談中", "受注", "契約更新"];

const SEED_TODAY = getJapanDateString();

const SEED_CASES = [
  { id: "c1", name: "テクノポート", owner: "小町", status: "受注", sales: 4200000, profit: 1050000, deadline: addDays(SEED_TODAY, 4) },
  { id: "c2", name: "アイリス", owner: "久保", status: "商談中", sales: 1800000, profit: 420000, deadline: addDays(SEED_TODAY, 20) },
  { id: "c3", name: "イチボ", owner: "村井", status: "見積中", sales: 950000, profit: 190000, deadline: addDays(SEED_TODAY, 16) },
  { id: "c4", name: "テルメ", owner: "田中", status: "受注", sales: 3300000, profit: 810000, deadline: addDays(SEED_TODAY, 28) },
  { id: "c5", name: "ダイワ通信", owner: "西出", status: "契約更新", sales: 5600000, profit: 1340000, deadline: addDays(SEED_TODAY, 45) },
  { id: "c6", name: "○○ホテル", owner: "小町", status: "見積中", sales: 1200000, profit: 260000, deadline: addDays(SEED_TODAY, 5) },
  { id: "c7", name: "△△薬局", owner: "久保", status: "見積中", sales: 680000, profit: 140000, deadline: addDays(SEED_TODAY, 6) },
];

const SEED_VEHICLES = [
  { id: "v1", name: "プリウス", plate: "品川 300 あ 12-34", bookings: [{ id: "b1", startDate: addDays(SEED_TODAY, 3), endDate: addDays(SEED_TODAY, 4), who: "田中" }] },
  { id: "v2", name: "ハイエース", plate: "品川 400 い 56-78", bookings: [{ id: "b2", startDate: addDays(SEED_TODAY, 8), endDate: addDays(SEED_TODAY, 10), who: "久保" }] },
  { id: "v3", name: "フリード", plate: "品川 500 う 90-12", bookings: [] },
  { id: "v4", name: "N-BOX", plate: "品川 100 え 34-56", bookings: [] },
];

const EMPLOYEES = [
  ...SALES_REPS.map((n, i) => ({ id: `e-s-${i}`, name: n, dept: "営業部", role: "営業担当", cases: 3 + (i % 4) })),
  ...MANAGERS.map((n, i) => ({ id: `e-m-${i}`, name: n, dept: "管理部", role: "監理担当", cases: 2 + (i % 3) })),
];

const SALES_BY_REP = SALES_REPS.map((name, i) => ({
  name,
  売上: [3200000, 4600000, 2100000, 3900000, 5100000, 2800000][i],
  粗利: [780000, 1120000, 480000, 940000, 1260000, 690000][i],
}));

const PIE_COLORS = [SKY, NAVY_SOFT, OK, WARN, "#8B6FE8"];

const TABS = [
  { key: "home", label: "ホーム", icon: Home },
  { key: "cases", label: "案件", icon: Briefcase },
  { key: "vehicles", label: "車両", icon: Car },
  { key: "sales", label: "売上", icon: TrendingUp },
  { key: "more", label: "もっと", icon: Menu },
];

const MORE_ITEMS = [
  { key: "employees", label: "社員一覧", icon: Users },
  { key: "notifications", label: "通知", icon: Bell },
  { key: "settings", label: "設定", icon: Settings },
];

const STATUS_COLOR = { 受注: OK, 商談中: SKY, 見積中: WARN, 契約更新: "#8B6FE8" };

const yen = (n) => `¥${Number(n || 0).toLocaleString("ja-JP")}`;

function CountUp({ to, format }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const dur = 800;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span>{format ? format(val) : val.toLocaleString("ja-JP")}</span>;
}

const STORAGE_KEY = "horai-app-state-v3";

/* ------------------------------------------------------------------ */
/*  server call — /api/ai (Anthropic key never touches the browser)     */
/* ------------------------------------------------------------------ */

async function interpretRequest(userText, { cases, vehicles }) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userText,
      today: getJapanDateString(),
      currentUser: CURRENT_USER,
      salesReps: SALES_REPS,
      managers: MANAGERS,
      // 最小限のデータのみ送信する（案件は名前と期限のみ、車両は名前のみ）
      cases: cases.map((c) => ({ name: c.name, deadline: c.deadline })),
      vehicles: vehicles.map((v) => ({ name: v.name })),
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    const message = (data && data.error) || "AIとの通信中にエラーが発生しました。";
    throw new Error(message);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/*  root                                                                 */
/* ------------------------------------------------------------------ */

export default function Page() {
  useGoogleFonts();

  const [screen, setScreen] = useState("home");
  const [moreOpen, setMoreOpen] = useState(false);
  const [subScreen, setSubScreen] = useState(null);

  const [cases, setCases] = useState(SEED_CASES);
  const [vehicles, setVehicles] = useState(SEED_VEHICLES);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [flashCaseId, setFlashCaseId] = useState(null);
  const [flashBookingId, setFlashBookingId] = useState(null);
  const [salesReady, setSalesReady] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  const [chatLog, setChatLog] = useState([
    { id: "sys0", type: "text", role: "ai", text: "こんにちは。業務内容を自然な文章で入力してください。車両予約、案件登録、見積期限の確認、通知依頼、売上の集計に対応します。" },
  ]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [mockMode, setMockMode] = useState(null); // null = 未確認, true/false = 判明済み
  const [presentationMode, setPresentationMode] = useState(false); // true = 外部通信なしで確実に動作させる
  const [googleStatus, setGoogleStatus] = useState({ calendarConfigured: false, sheetsConfigured: false });
  const [autoExportSheets, setAutoExportSheets] = useState(false);
  const [sheetsExport, setSheetsExport] = useState({ status: "idle", message: "", time: null }); // idle | loading | success | error

  const logEndRef = useRef(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatLog]);

  /* ---- check which Google integrations are configured on the server ---- */
