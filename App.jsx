import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, Pencil, Trash2, Users, Loader2, BookOpen, Printer, Download, Upload, Save, ChevronLeft, ChevronRight, CalendarDays, LogOut, Lock } from "lucide-react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAYS = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};
const GRADES = ["6", "7", "8", "9"];
const PERIODS = [
  { id: "p1", label: "Period 1", time: "7:30 – 9:30", type: "class" },
  { id: "b1", label: "Break", time: "9:30 – 9:45", type: "break" },
  { id: "p2", label: "Period 2", time: "9:45 – 11:45", type: "class" },
  { id: "lunch", label: "Lunch", time: "11:45 – 2:00", type: "break" },
  { id: "p3", label: "Period 3", time: "2:00 – 4:00", type: "class" },
];

// ---- Week helpers: every schedule slot belongs to a specific Mon–Sat week,
// identified by that week's Monday date (ISO "YYYY-MM-DD"). ----
function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function isoToDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function getMondayISO(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun ... 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}
function addDaysISO(iso, n) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function shiftWeekISO(iso, deltaWeeks) {
  return addDaysISO(iso, deltaWeeks * 7);
}
function dateForDayInWeek(weekStartISO, dayAbbrev) {
  return isoToDate(addDaysISO(weekStartISO, DAYS.indexOf(dayAbbrev)));
}
function formatWeekRangeLabel(weekStartISO) {
  const start = isoToDate(weekStartISO);
  const end = isoToDate(addDaysISO(weekStartISO, 5));
  const startStr = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

const cellKey = (weekStart, day, grade, periodId) => `${weekStart}|${day}-${grade}-${periodId}`;
// Matches the OLD key format (before weeks existed), so existing saved
// schedules migrate forward instead of disappearing.
const LEGACY_KEY_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat)-(6|7|8|9)-(p1|b1|p2|lunch|p3)$/;
function migrateLegacyKeys(raw, fallbackWeekStart) {
  const next = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    if (LEGACY_KEY_RE.test(key)) {
      next[`${fallbackWeekStart}|${key}`] = value;
    } else {
      next[key] = value;
    }
  });
  return next;
}

const STORAGE_KEY = "schedule-entries-v1";
const GH_TOKEN_KEY = "schedule-ledger-gh-token";

// Your repo details — update these three if you ever rename/move the repo.
const GH_OWNER = "Wunders149";
const GH_REPO = "SchedulePlanner4MiddleSchool";
const GH_BRANCH = "main";
const GH_FILE_PATH = "public/schedule-data.json";

// Safely base64-encode a unicode JSON string for GitHub's API.
function toBase64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

// Fetches the file's current sha (needed to update it) and pushes new
// content as a commit directly to the branch via GitHub's REST API.
async function saveScheduleToGitHub(token, entriesObj) {
  const contentStr = JSON.stringify(entriesObj, null, 2);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  let sha;
  const getRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE_PATH}?ref=${GH_BRANCH}`,
    { headers }
  );
  if (getRes.ok) {
    const data = await getRes.json();
    sha = data.sha;
  } else if (getRes.status !== 404) {
    const errData = await getRes.json().catch(() => ({}));
    throw new Error(errData.message || `Couldn't reach the repo (status ${getRes.status}).`);
  }

  const putRes = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE_PATH}`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Update schedule data — ${new Date().toISOString()}`,
        content: toBase64Utf8(contentStr),
        branch: GH_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    }
  );

  if (!putRes.ok) {
    const errData = await putRes.json().catch(() => ({}));
    if (putRes.status === 401) {
      throw new Error("That token was rejected — it may be invalid or expired.");
    }
    if (putRes.status === 404) {
      throw new Error("Repo or file path not found — check GH_OWNER/GH_REPO/GH_FILE_PATH in the code.");
    }
    throw new Error(errData.message || `GitHub rejected the save (status ${putRes.status}).`);
  }
  return putRes.json();
}

const SUBJECT_COLORS = {};
const PALETTE = ["#D98E2B", "#5B7F73", "#B5563F", "#6C7FB0", "#8A9B4E", "#A0678A", "#3E7C8C"];
function colorFor(name) {
  if (!name) return "#A9BFAE";
  if (!SUBJECT_COLORS[name]) {
    const idx = Object.keys(SUBJECT_COLORS).length % PALETTE.length;
    SUBJECT_COLORS[name] = PALETTE[idx];
  }
  return SUBJECT_COLORS[name];
}

// Turn a description into a clean array of bullet items, whatever shape
// it happens to be in (old saved data stored it as a single string).
function toDescriptionList(description) {
  if (Array.isArray(description)) return description.filter((x) => x && x.trim());
  if (typeof description === "string" && description.trim()) {
    return description
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

// Migrate old entries (which used `activity` instead of `title`, and a plain
// string `description`) so existing saved data keeps working.
function normalizeEntries(raw) {
  const next = {};
  Object.entries(raw || {}).forEach(([key, entry]) => {
    next[key] = {
      title: entry.title ?? entry.activity ?? "",
      description: toDescriptionList(entry.description),
      teachers: entry.teachers ?? [],
    };
  });
  return next;
}

export default function ScheduleLedger() {
  // --- Auth state ---
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  const [entries, setEntries] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getMondayISO(new Date()));
  const [activeDay, setActiveDay] = useState("Mon");
  const [editing, setEditing] = useState(null); // {day, grade, periodId}
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescriptionText, setDraftDescriptionText] = useState("");
  const [draftTeachers, setDraftTeachers] = useState([]);
  const [teacherInput, setTeacherInput] = useState("");
  const [error, setError] = useState("");
  const [printGrade, setPrintGrade] = useState(null);
  const [importMessage, setImportMessage] = useState("");
  const [ghSaving, setGhSaving] = useState(false);
  const [ghMessage, setGhMessage] = useState(null); // {type: 'ok'|'error', text}
  const [showTokenPrompt, setShowTokenPrompt] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [hasUnsyncedChanges, setHasUnsyncedChanges] = useState(false);
  const printTimeout = useRef(null);
  const fileInputRef = useRef(null);
  const lastSyncedSnapshot = useRef("{}");

  const thisRealWeek = getMondayISO(new Date());

  // Listen for sign-in/sign-out. This is what makes the app "remember" you
  // across visits on the same device, and lets any device recognize you the
  // moment you log in.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoginSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginPassword("");
    } catch (err) {
      setLoginError("Couldn't sign in — check your email and password and try again.");
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  // Once logged in, fetch this account's saved GitHub token from Firestore
  // (if any) so "Save to GitHub" works right away on a brand new device,
  // with no re-typing needed.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "tokens", user.uid));
        if (snap.exists() && snap.data().githubToken) {
          window.localStorage.setItem(GH_TOKEN_KEY, snap.data().githubToken);
        }
      } catch (e) {
        // Firestore unreachable — the local/cached token (if any) still works
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      // 1) Read whatever's cached in this browser.
      let localRaw = {};
      try {
        const rawStr = window.localStorage.getItem(STORAGE_KEY);
        if (rawStr) localRaw = JSON.parse(rawStr);
      } catch (e) {
        // no local cache yet — fine
      }

      // 2) Try fetching the shared copy published to the site (this is what
      // makes the schedule visible across devices — it reflects whatever was
      // last sent with "Save to GitHub").
      let remoteRaw = {};
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}schedule-data.json`, { cache: "no-store" });
        if (res.ok) remoteRaw = await res.json();
      } catch (e) {
        // offline, or nothing published yet — that's fine, local still works
      }

      const migratedLocal = normalizeEntries(migrateLegacyKeys(localRaw, thisRealWeek));
      const migratedRemote = normalizeEntries(migrateLegacyKeys(remoteRaw, thisRealWeek));

      // 3) Merge: local edits always win on conflicts (so nothing you've
      // typed here ever silently vanishes), but any slot only the shared
      // copy knows about (e.g. saved from another device) fills in too.
      const merged = { ...migratedRemote, ...migratedLocal };

      setEntries(merged);
      lastSyncedSnapshot.current = JSON.stringify(migratedRemote);
      setHasUnsyncedChanges(JSON.stringify(merged) !== lastSyncedSnapshot.current);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch (e) {
        // ignore — nothing else to do if storage is unavailable
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next) => {
    setSaving(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      setError("Couldn't save — your change is only visible in this session.");
    } finally {
      setSaving(false);
    }
    setHasUnsyncedChanges(JSON.stringify(next) !== lastSyncedSnapshot.current);
  }, []);

  // Downloads the current schedule as a JSON file. Upload this file to
  // /public/schedule-data.json in the repo to make it the permanent,
  // shipped-with-the-site starting point for anyone visiting fresh.
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schedule-data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const triggerImport = () => fileInputRef.current?.click();

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const normalized = normalizeEntries(parsed);
        setEntries(normalized);
        persist(normalized);
        setImportMessage(`Imported ${Object.keys(normalized).length} class${Object.keys(normalized).length === 1 ? "" : "es"}.`);
      } catch (err) {
        setImportMessage("That file couldn't be read — make sure it's a JSON export from this app.");
      }
    };
    reader.readAsText(file);
    // reset so selecting the same file again still fires onChange
    e.target.value = "";
  };

  const runGitHubSave = async (token) => {
    setGhSaving(true);
    setGhMessage(null);
    try {
      await saveScheduleToGitHub(token, entries);
      window.localStorage.setItem(GH_TOKEN_KEY, token);
      if (user) {
        try {
          await setDoc(doc(db, "tokens", user.uid), { githubToken: token });
        } catch (e) {
          // Token still works locally even if this sync fails
        }
      }
      lastSyncedSnapshot.current = JSON.stringify(entries);
      setHasUnsyncedChanges(false);
      setGhMessage({ type: "ok", text: "Saved to GitHub — your site will redeploy shortly." });
    } catch (err) {
      setGhMessage({ type: "error", text: err.message || "Something went wrong saving to GitHub." });
    } finally {
      setGhSaving(false);
    }
  };

  const handleSaveToGitHub = () => {
    const existingToken = window.localStorage.getItem(GH_TOKEN_KEY);
    if (existingToken) {
      runGitHubSave(existingToken);
    } else {
      setTokenInput("");
      setShowTokenPrompt(true);
    }
  };

  const confirmTokenAndSave = () => {
    const token = tokenInput.trim();
    if (!token) return;
    setShowTokenPrompt(false);
    runGitHubSave(token);
  };

  const forgetToken = () => {
    window.localStorage.removeItem(GH_TOKEN_KEY);
    setGhMessage({ type: "ok", text: "Token forgotten. You'll be asked to paste it again next save." });
  };

  // Print handling: render the printable sheet, then trigger the browser
  // print dialog once it's painted, and clear it again afterward.
  useEffect(() => {
    if (printGrade) {
      const triggerPrint = () => {
        // Two animation frames ensures the browser has actually painted
        // the newly-mounted print sheet before we grab it for printing.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            printTimeout.current = setTimeout(() => window.print(), 250);
          });
        });
      };
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(triggerPrint);
      } else {
        triggerPrint();
      }
      // NOTE: we deliberately do NOT auto-hide the print sheet on the
      // 'afterprint' event. On Android, that event tends to fire as soon as
      // the print preview opens — well before the PDF is actually generated
      // in the background. If we unmount the print content at that point,
      // the async PDF render captures an empty page. Instead, the person
      // closes the print view manually with the button once they're done.
      return () => clearTimeout(printTimeout.current);
    }
  }, [printGrade]);

  const openEditor = (day, grade, periodId) => {
    const key = cellKey(currentWeekStart, day, grade, periodId);
    const existing = entries[key];
    setEditing({ weekStart: currentWeekStart, day, grade, periodId });
    setDraftTitle(existing?.title || "");
    setDraftDescriptionText((existing?.description || []).join("\n"));
    setDraftTeachers(existing?.teachers || []);
    setTeacherInput("");
    setError("");
  };

  const closeEditor = () => {
    setEditing(null);
    setDraftTitle("");
    setDraftDescriptionText("");
    setDraftTeachers([]);
    setTeacherInput("");
  };

  const addTeacher = () => {
    const t = teacherInput.trim();
    if (t && !draftTeachers.includes(t)) {
      setDraftTeachers([...draftTeachers, t]);
    }
    setTeacherInput("");
  };

  const removeTeacher = (t) => {
    setDraftTeachers(draftTeachers.filter((x) => x !== t));
  };

  const saveEntry = () => {
    if (!draftTitle.trim()) {
      setError("Give this class a title first.");
      return;
    }
    const key = cellKey(editing.weekStart, editing.day, editing.grade, editing.periodId);
    const next = {
      ...entries,
      [key]: {
        title: draftTitle.trim(),
        description: toDescriptionList(draftDescriptionText),
        teachers: draftTeachers,
      },
    };
    setEntries(next);
    persist(next);
    closeEditor();
  };

  const deleteEntry = () => {
    const key = cellKey(editing.weekStart, editing.day, editing.grade, editing.periodId);
    const next = { ...entries };
    delete next[key];
    setEntries(next);
    persist(next);
    closeEditor();
  };

  const activePeriod = editing ? PERIODS.find((p) => p.id === editing.periodId) : null;

  const authStyles = `
    html, body { margin: 0; padding: 0; }
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
    .lp-body { font-family: 'Inter', sans-serif; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2E4034",
        }}
      >
        <style>{authStyles}</style>
        <Loader2 color="#D98E2B" size={26} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2E4034",
          padding: 20,
          fontFamily: "'Fraunces', Georgia, serif",
        }}
      >
        <style>{authStyles}</style>
        <form
          onSubmit={handleLogin}
          style={{
            background: "#FFFDF8",
            borderRadius: 14,
            width: "100%",
            maxWidth: 360,
            padding: 28,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Lock size={18} color="#D98E2B" />
            <span
              className="lp-body"
              style={{ fontSize: 11, letterSpacing: "0.1em", color: "#8A9B8A", textTransform: "uppercase" }}
            >
              Admin sign-in
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 18px", color: "#243229" }}>Schedule Ledger</h1>

          <label
            className="lp-body"
            style={{ fontSize: 12, fontWeight: 600, color: "#5B6B5B", display: "block", marginBottom: 6 }}
          >
            Email
          </label>
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            required
            className="lp-body"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #D8D2C2",
              fontSize: 14,
              boxSizing: "border-box",
              marginBottom: 14,
            }}
          />

          <label
            className="lp-body"
            style={{ fontSize: 12, fontWeight: 600, color: "#5B6B5B", display: "block", marginBottom: 6 }}
          >
            Password
          </label>
          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            required
            className="lp-body"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #D8D2C2",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />

          {loginError && (
            <div className="lp-body" style={{ color: "#C1584A", fontSize: 12.5, marginTop: 12 }}>
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={loginSubmitting}
            className="lp-body"
            style={{
              width: "100%",
              marginTop: 20,
              background: "#D98E2B",
              border: "none",
              borderRadius: 8,
              padding: "11px 16px",
              cursor: loginSubmitting ? "default" : "pointer",
              opacity: loginSubmitting ? 0.7 : 1,
              fontSize: 14,
              fontWeight: 700,
              color: "#2E2410",
            }}
          >
            {loginSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "'Fraunces', Georgia, serif",
        background: "#F6F3EA",
        minHeight: "100vh",
        color: "#243229",
        padding: "0",
      }}
    >
      <style>{`
        html, body { margin: 0; padding: 0; }
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .lp-body { font-family: 'Inter', sans-serif; }
        .lp-mono { font-family: 'IBM Plex Mono', monospace; }
        .lp-tab { transition: all 0.15s ease; }
        .lp-cell { transition: background 0.12s ease, transform 0.12s ease; cursor: pointer; }
        .lp-cell:hover { transform: translateY(-1px); }
        .lp-scrollbar::-webkit-scrollbar { height: 8px; }
        .lp-scrollbar::-webkit-scrollbar-thumb { background: #D8D2C2; border-radius: 4px; }
        input:focus, textarea:focus { outline: 2px solid #D98E2B; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid #D98E2B; outline-offset: 2px; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .print-sheet { display: none; }

        @media print {
          html, body { margin: 0; padding: 0; }
          .app-shell { display: none !important; }
          .print-sheet {
            display: block !important;
            width: 100%;
          }
          .print-content-pad { padding: 0 !important; }
          .print-table td, .print-table th { page-break-inside: avoid; }
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 4mm; }
        }
      `}</style>

      {/* ===== Printable sheet (only visible when printing) ===== */}
      {/* Landscape A4, one page, day columns x period rows so the whole
          current week for this grade fills the available space. */}
      {printGrade && (
        <div className="print-sheet lp-body" style={{ color: "#111", background: "#fff" }}>
          <div
            className="no-print"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "10px 14px",
              background: "#EDE8D8",
              borderBottom: "1px solid #D8D2C2",
            }}
          >
            <button
              onClick={() => setPrintGrade(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#2E4034",
                color: "#F6F3EA",
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <X size={14} />
              Close print view
            </button>
          </div>
          <div className="print-content-pad" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, margin: 0 }}>
              Grade {printGrade} — Weekly Schedule
            </h1>
            <span style={{ fontSize: 10.5, color: "#666" }}>Week of {formatWeekRangeLabel(currentWeekStart)}</span>
          </div>
          <table
            className="print-table"
            style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12.5 }}
          >
            <colgroup>
              <col style={{ width: "11%" }} />
              {DAYS.map((d) => (
                <col key={d} style={{ width: `${89 / DAYS.length}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={{ border: "1px solid #999", padding: "5px 6px", background: "#EFEBDD", textAlign: "left" }}>
                  Time
                </th>
                {DAYS.map((d) => (
                  <th
                    key={d}
                    style={{ border: "1px solid #999", padding: "5px 6px", background: "#EFEBDD", textAlign: "left" }}
                  >
                    {FULL_DAYS[d]}
                    <div style={{ fontWeight: 400, color: "#777", fontSize: 10.5 }}>
                      {dateForDayInWeek(currentWeekStart, d).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODS.map((period) => {
                if (period.type === "break") {
                  return (
                    <tr key={period.id}>
                      <td
                        colSpan={DAYS.length + 1}
                        style={{
                          border: "1px solid #999",
                          padding: "4px 6px",
                          color: "#777",
                          fontStyle: "italic",
                          background: "#F7F5EE",
                        }}
                      >
                        {period.label} · {period.time}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={period.id}>
                    <td style={{ border: "1px solid #999", padding: "6px", verticalAlign: "top" }}>
                      <div style={{ fontWeight: 700 }}>{period.label}</div>
                      <div style={{ color: "#666" }}>{period.time}</div>
                    </td>
                    {DAYS.map((day) => {
                      const key = cellKey(currentWeekStart, day, printGrade, period.id);
                      const entry = entries[key];
                      return (
                        <td key={key} style={{ border: "1px solid #999", padding: "6px", verticalAlign: "top" }}>
                          {entry ? (
                            <>
                              <div style={{ fontWeight: 700 }}>{entry.title}</div>
                              {entry.description.length > 0 && (
                                <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
                                  {entry.description.map((item, i) => (
                                    <li key={i} style={{ marginBottom: 1 }}>
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {entry.teachers.length > 0 && (
                                <div style={{ color: "#555", marginTop: 3 }}>{entry.teachers.join(", ")}</div>
                              )}
                            </>
                          ) : (
                            <span style={{ color: "#bbb" }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ===== App UI (hidden when printing) ===== */}
      <div className="app-shell">
        {/* Header */}
        <div style={{ background: "#2E4034", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <BookOpen size={22} color="#D98E2B" />
              <span
                className="lp-mono"
                style={{ color: "#A9BFAE", fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}
              >
                Admin Console
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="lp-body"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(255,255,255,0.08)",
                border: "none",
                borderRadius: 7,
                padding: "6px 11px",
                fontSize: 11.5,
                fontWeight: 600,
                color: "#C8D3C6",
                cursor: "pointer",
              }}
            >
              <LogOut size={12} />
              Sign out
            </button>
          </div>
          <h1 style={{ color: "#F6F3EA", fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
            Schedule Ledger
          </h1>
          <p className="lp-body" style={{ color: "#C8D3C6", fontSize: 14, margin: "6px 0 0" }}>
            Middle school timetable · Grades 6–9 · one class per grade
          </p>
        </div>

        {/* Week navigator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 24px",
            background: "#1F3229",
            borderBottom: "1px solid #17251E",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setCurrentWeekStart(shiftWeekISO(currentWeekStart, -1))}
              aria-label="Previous week"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "none",
                borderRadius: 7,
                padding: 7,
                cursor: "pointer",
                color: "#E8E4D6",
                display: "flex",
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="lp-body" style={{ display: "flex", alignItems: "center", gap: 7, color: "#F6F3EA" }}>
              <CalendarDays size={14} color="#D98E2B" />
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{formatWeekRangeLabel(currentWeekStart)}</span>
            </div>
            <button
              onClick={() => setCurrentWeekStart(shiftWeekISO(currentWeekStart, 1))}
              aria-label="Next week"
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "none",
                borderRadius: 7,
                padding: 7,
                cursor: "pointer",
                color: "#E8E4D6",
                display: "flex",
              }}
            >
              <ChevronRight size={16} />
            </button>
            {currentWeekStart !== thisRealWeek && (
              <button
                onClick={() => setCurrentWeekStart(thisRealWeek)}
                className="lp-body"
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 7,
                  padding: "5px 10px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#C8D3C6",
                  cursor: "pointer",
                }}
              >
                This week
              </button>
            )}
          </div>
          {hasUnsyncedChanges && (
            <span className="lp-mono" style={{ fontSize: 10.5, color: "#E0B15A", letterSpacing: "0.03em" }}>
              Unsaved changes — tap "Save to GitHub" to sync
            </span>
          )}
        </div>

        {/* Print bar */}
        <div
          className="lp-scrollbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 24px",
            background: "#EDE8D8",
            borderBottom: "1px solid #D8D2C2",
            overflowX: "auto",
          }}
        >
          <span
            className="lp-mono"
            style={{ fontSize: 11, color: "#6B7A6B", letterSpacing: "0.06em", whiteSpace: "nowrap" }}
          >
            PRINT SCHEDULE:
          </span>
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setPrintGrade(g)}
              className="lp-body"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#FFFDF8",
                border: "1px solid #D8D2C2",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#243229",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Printer size={13} />
              Grade {g}
            </button>
          ))}
        </div>

        {/* Data backup bar */}
        <div
          className="lp-scrollbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 24px",
            background: "#F6F3EA",
            borderBottom: "1px solid #D8D2C2",
            overflowX: "auto",
          }}
        >
          <span
            className="lp-mono"
            style={{ fontSize: 11, color: "#8A9B8A", letterSpacing: "0.06em", whiteSpace: "nowrap" }}
          >
            BACKUP:
          </span>
          <button
            onClick={handleSaveToGitHub}
            disabled={ghSaving}
            className="lp-body"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#2E4034",
              border: "none",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              color: "#F6F3EA",
              cursor: ghSaving ? "default" : "pointer",
              opacity: ghSaving ? 0.7 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {ghSaving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={13} />}
            {ghSaving ? "Saving…" : "Save to GitHub"}
          </button>
          <button
            onClick={exportJSON}
            className="lp-body"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "1px solid #D8D2C2",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#5B6B5B",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Download size={13} />
            Export JSON
          </button>
          <button
            onClick={triggerImport}
            className="lp-body"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "1px solid #D8D2C2",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#5B6B5B",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Upload size={13} />
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
          {importMessage && (
            <span className="lp-body" style={{ fontSize: 12, color: "#5B7F73" }}>
              {importMessage}
            </span>
          )}
          {ghMessage && (
            <span
              className="lp-body"
              style={{ fontSize: 12, color: ghMessage.type === "error" ? "#C1584A" : "#5B7F73" }}
            >
              {ghMessage.text}
            </span>
          )}
          {window.localStorage.getItem(GH_TOKEN_KEY) && (
            <button
              onClick={forgetToken}
              className="lp-body"
              style={{
                background: "none",
                border: "none",
                color: "#A0A895",
                fontSize: 11,
                textDecoration: "underline",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Forget saved token
            </button>
          )}
        </div>

        {/* Token prompt modal */}
        {showTokenPrompt && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(36, 50, 41, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 60,
              padding: 20,
            }}
            onClick={() => setShowTokenPrompt(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="lp-body"
              style={{
                background: "#FFFDF8",
                borderRadius: 14,
                width: "100%",
                maxWidth: 400,
                padding: 24,
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              }}
            >
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 8px", color: "#243229" }}>
                Connect to GitHub
              </h2>
              <p style={{ fontSize: 13, color: "#5B6B5B", lineHeight: 1.5, margin: "0 0 14px" }}>
                Paste a GitHub personal access token with write access to your repo. It's saved only in
                this browser — never in the site's code.
              </p>
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="github_pat_..."
                autoFocus
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #D8D2C2",
                  fontSize: 14,
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                <button
                  onClick={() => setShowTokenPrompt(false)}
                  style={{
                    background: "none",
                    border: "1px solid #D8D2C2",
                    borderRadius: 8,
                    padding: "9px 16px",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5B6B5B",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmTokenAndSave}
                  disabled={!tokenInput.trim()}
                  style={{
                    background: "#D98E2B",
                    border: "none",
                    borderRadius: 8,
                    padding: "9px 16px",
                    cursor: tokenInput.trim() ? "pointer" : "default",
                    opacity: tokenInput.trim() ? 1 : 0.6,
                    fontSize: 13,
                    fontWeight: 700,
                    color: "#2E2410",
                  }}
                >
                  Save & connect
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Day tabs */}
        <div
          className="lp-scrollbar"
          style={{
            display: "flex",
            gap: 2,
            padding: "0 24px",
            background: "#243229",
            overflowX: "auto",
          }}
        >
          {DAYS.map((day) => {
            const isActive = activeDay === day;
            const dateLabel = dateForDayInWeek(currentWeekStart, day).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            return (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className="lp-tab lp-body"
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "8px 20px 10px",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  background: isActive ? "#F6F3EA" : "transparent",
                  color: isActive ? "#243229" : "#9CAC9C",
                  borderRadius: isActive ? "8px 8px 0 0" : "0",
                  whiteSpace: "nowrap",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <span>{day}</span>
                <span
                  className="lp-mono"
                  style={{ fontSize: 10, opacity: 0.75, color: isActive ? "#5B6B5B" : "#7A8A7A" }}
                >
                  {dateLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grid */}
        <div style={{ padding: "24px 24px 40px" }}>
          {!loaded ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5B7F73", padding: 40 }}>
              <Loader2 className="lp-body" size={18} style={{ animation: "spin 1s linear infinite" }} />
              <span className="lp-body">Loading schedule…</span>
            </div>
          ) : (
            <div
              className="lp-scrollbar"
              style={{
                overflowX: "auto",
                border: "1px solid #D8D2C2",
                borderRadius: 10,
                background: "#FFFDF8",
              }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th
                      className="lp-mono"
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontSize: 11,
                        letterSpacing: "0.08em",
                        color: "#8A9B8A",
                        borderBottom: "2px solid #D8D2C2",
                        width: 150,
                      }}
                    >
                      TIME
                    </th>
                    {GRADES.map((g) => (
                      <th
                        key={g}
                        className="lp-body"
                        style={{
                          textAlign: "left",
                          padding: "12px 16px",
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#243229",
                          borderBottom: "2px solid #D8D2C2",
                          borderLeft: "1px solid #EEE9DC",
                        }}
                      >
                        Grade {g}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERIODS.map((period) => {
                    if (period.type === "break") {
                      return (
                        <tr key={period.id}>
                          <td
                            colSpan={GRADES.length + 1}
                            style={{
                              padding: "8px 16px",
                              background:
                                "repeating-linear-gradient(135deg, #F0ECDF, #F0ECDF 6px, #E8E2D0 6px, #E8E2D0 12px)",
                              borderBottom: "1px solid #D8D2C2",
                            }}
                          >
                            <span
                              className="lp-mono"
                              style={{ fontSize: 11, color: "#8A7B5E", letterSpacing: "0.06em" }}
                            >
                              {period.label.toUpperCase()} · {period.time}
                            </span>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={period.id}>
                        <td
                          style={{
                            padding: "14px 16px",
                            borderBottom: "1px solid #EEE9DC",
                            verticalAlign: "top",
                          }}
                        >
                          <div className="lp-body" style={{ fontWeight: 600, fontSize: 13, color: "#243229" }}>
                            {period.label}
                          </div>
                          <div className="lp-mono" style={{ fontSize: 11, color: "#8A9B8A", marginTop: 2 }}>
                            {period.time}
                          </div>
                        </td>
                        {GRADES.map((grade) => {
                          const key = cellKey(currentWeekStart, activeDay, grade, period.id);
                          const entry = entries[key];
                          return (
                            <td
                              key={key}
                              style={{
                                padding: 8,
                                borderBottom: "1px solid #EEE9DC",
                                borderLeft: "1px solid #EEE9DC",
                                verticalAlign: "top",
                              }}
                            >
                              <div
                                onClick={() => openEditor(activeDay, grade, period.id)}
                                className="lp-cell lp-body"
                                style={{
                                  minHeight: 64,
                                  borderRadius: 8,
                                  padding: "10px 12px",
                                  background: entry ? `${colorFor(entry.title)}14` : "#F6F3EA",
                                  border: entry ? `1px solid ${colorFor(entry.title)}55` : "1px dashed #D8D2C2",
                                }}
                              >
                                {entry ? (
                                  <>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        fontSize: 13.5,
                                        color: colorFor(entry.title),
                                        marginBottom: 4,
                                      }}
                                    >
                                      {entry.title}
                                    </div>
                                    {entry.description.length > 0 && (
                                      <ul
                                        style={{
                                          margin: "0 0 4px",
                                          paddingLeft: 16,
                                          fontSize: 11.5,
                                          color: "#6B6558",
                                          lineHeight: 1.35,
                                        }}
                                      >
                                        {entry.description.map((item, i) => (
                                          <li key={i}>{item}</li>
                                        ))}
                                      </ul>
                                    )}
                                    {entry.teachers.length > 0 && (
                                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                                        <Users size={11} color="#7A8A7A" />
                                        <span style={{ fontSize: 11.5, color: "#5B6B5B" }}>
                                          {entry.teachers.join(", ")}
                                        </span>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      color: "#B9B2A0",
                                      fontSize: 12.5,
                                      height: "100%",
                                    }}
                                  >
                                    <Plus size={13} />
                                    Add class
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {saving && (
            <div className="lp-mono" style={{ fontSize: 11, color: "#8A9B8A", marginTop: 10 }}>
              Saving…
            </div>
          )}
        </div>

        {/* Editor modal */}
        {editing && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(36, 50, 41, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
              padding: 20,
            }}
            onClick={closeEditor}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#FFFDF8",
                borderRadius: 14,
                width: "100%",
                maxWidth: 420,
                padding: 24,
                boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                <div>
                  <div className="lp-mono" style={{ fontSize: 11, color: "#8A9B8A", letterSpacing: "0.06em" }}>
                    {FULL_DAYS[editing.day].toUpperCase()}{" "}
                    {dateForDayInWeek(editing.weekStart, editing.day).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · GRADE {editing.grade} · {activePeriod.time}
                  </div>
                  <h2 className="lp-body" style={{ fontSize: 18, fontWeight: 700, margin: "4px 0 0", color: "#243229" }}>
                    Edit class
                  </h2>
                </div>
                <button
                  onClick={closeEditor}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#8A9B8A", padding: 4 }}
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="lp-body" style={{ marginTop: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#5B6B5B", display: "block", marginBottom: 6 }}>
                  Title
                </label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="e.g. Mathematics, Science Lab, Assembly"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #D8D2C2",
                    fontSize: 14,
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                  }}
                />

                <label style={{ fontSize: 12, fontWeight: 600, color: "#5B6B5B", display: "block", margin: "16px 0 6px" }}>
                  Description <span style={{ fontWeight: 400, color: "#A0A895" }}>(one item per line)</span>
                </label>
                <textarea
                  value={draftDescriptionText}
                  onChange={(e) => setDraftDescriptionText(e.target.value)}
                  placeholder={"Chapter 4 review\nBring calculators\nQuiz on Friday"}
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #D8D2C2",
                    fontSize: 14,
                    fontFamily: "inherit",
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
                <div style={{ fontSize: 11, color: "#A0A895", marginTop: 4 }}>
                  Each line becomes its own bullet point.
                </div>

                <label style={{ fontSize: 12, fontWeight: 600, color: "#5B6B5B", display: "block", margin: "16px 0 6px" }}>
                  Teacher(s)
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={teacherInput}
                    onChange={(e) => setTeacherInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTeacher();
                      }
                    }}
                    placeholder="Type a name, press Enter"
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid #D8D2C2",
                      fontSize: 14,
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    onClick={addTeacher}
                    style={{
                      background: "#2E4034",
                      color: "#F6F3EA",
                      border: "none",
                      borderRadius: 8,
                      padding: "0 14px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Add
                  </button>
                </div>

                {draftTeachers.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {draftTeachers.map((t) => (
                      <span
                        key={t}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: "#E9E4D3",
                          borderRadius: 999,
                          padding: "4px 8px 4px 10px",
                          fontSize: 12.5,
                          color: "#243229",
                        }}
                      >
                        {t}
                        <X size={12} style={{ cursor: "pointer" }} onClick={() => removeTeacher(t)} />
                      </span>
                    ))}
                  </div>
                )}

                {error && <div style={{ color: "#C1584A", fontSize: 12.5, marginTop: 12 }}>{error}</div>}

                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22 }}>
                  <button
                    onClick={deleteEntry}
                    disabled={!entries[cellKey(editing.weekStart, editing.day, editing.grade, editing.periodId)]}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      color: entries[cellKey(editing.weekStart, editing.day, editing.grade, editing.periodId)] ? "#C1584A" : "#D8D2C2",
                      cursor: entries[cellKey(editing.weekStart, editing.day, editing.grade, editing.periodId)] ? "pointer" : "default",
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "8px 4px",
                    }}
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={closeEditor}
                      style={{
                        background: "none",
                        border: "1px solid #D8D2C2",
                        borderRadius: 8,
                        padding: "9px 16px",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#5B6B5B",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEntry}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "#D98E2B",
                        border: "none",
                        borderRadius: 8,
                        padding: "9px 16px",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#2E2410",
                      }}
                    >
                      <Pencil size={13} />
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
