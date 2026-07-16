import React, { useState, useEffect, useCallback, useRef } from "react";
import { Plus, X, Pencil, Trash2, Users, Loader2, BookOpen, Printer } from "lucide-react";

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

const cellKey = (day, grade, periodId) => `${day}-${grade}-${periodId}`;
const STORAGE_KEY = "schedule-entries-v1";

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

// Migrate old entries (which used `activity` instead of `title`) so existing
// saved data keeps working after this update.
function normalizeEntries(raw) {
  const next = {};
  Object.entries(raw || {}).forEach(([key, entry]) => {
    next[key] = {
      title: entry.title ?? entry.activity ?? "",
      description: entry.description ?? "",
      teachers: entry.teachers ?? [],
    };
  });
  return next;
}

export default function ScheduleLedger() {
  const [entries, setEntries] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeDay, setActiveDay] = useState("Mon");
  const [editing, setEditing] = useState(null); // {day, grade, periodId}
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTeachers, setDraftTeachers] = useState([]);
  const [teacherInput, setTeacherInput] = useState("");
  const [error, setError] = useState("");
  const [printGrade, setPrintGrade] = useState(null);
  const printTimeout = useRef(null);

  useEffect(() => {
    try {
      const rawStr = window.localStorage.getItem(STORAGE_KEY);
      if (rawStr) setEntries(normalizeEntries(JSON.parse(rawStr)));
    } catch (e) {
      // no existing data yet — that's fine
    } finally {
      setLoaded(true);
    }
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
  }, []);

  // Print handling: render the printable sheet, then trigger the browser
  // print dialog once it's painted, and clear it again afterward.
  useEffect(() => {
    if (printGrade) {
      printTimeout.current = setTimeout(() => window.print(), 80);
      const handleAfterPrint = () => setPrintGrade(null);
      window.addEventListener("afterprint", handleAfterPrint);
      return () => {
        clearTimeout(printTimeout.current);
        window.removeEventListener("afterprint", handleAfterPrint);
      };
    }
  }, [printGrade]);

  const openEditor = (day, grade, periodId) => {
    const key = cellKey(day, grade, periodId);
    const existing = entries[key];
    setEditing({ day, grade, periodId });
    setDraftTitle(existing?.title || "");
    setDraftDescription(existing?.description || "");
    setDraftTeachers(existing?.teachers || []);
    setTeacherInput("");
    setError("");
  };

  const closeEditor = () => {
    setEditing(null);
    setDraftTitle("");
    setDraftDescription("");
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
    const key = cellKey(editing.day, editing.grade, editing.periodId);
    const next = {
      ...entries,
      [key]: {
        title: draftTitle.trim(),
        description: draftDescription.trim(),
        teachers: draftTeachers,
      },
    };
    setEntries(next);
    persist(next);
    closeEditor();
  };

  const deleteEntry = () => {
    const key = cellKey(editing.day, editing.grade, editing.periodId);
    const next = { ...entries };
    delete next[key];
    setEntries(next);
    persist(next);
    closeEditor();
  };

  const activePeriod = editing ? PERIODS.find((p) => p.id === editing.periodId) : null;

  return (
    <div
      style={{
        fontFamily: "'Fraunces', Georgia, serif",
        background: "#F6F3EA",
        minHeight: "100%",
        color: "#243229",
        padding: "0",
      }}
    >
      <style>{`
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
          .app-shell { display: none !important; }
          .print-sheet { display: block !important; }
          @page { margin: 16mm; }
        }
      `}</style>

      {/* ===== Printable sheet (only visible when printing) ===== */}
      {printGrade && (
        <div className="print-sheet lp-body" style={{ color: "#111", background: "#fff" }}>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, margin: "0 0 2px" }}>
            Grade {printGrade} — Weekly Schedule
          </h1>
          <p style={{ fontSize: 12, color: "#555", margin: "0 0 18px" }}>
            Middle school timetable, Monday–Saturday
          </p>
          {DAYS.map((day) => (
            <div key={day} style={{ marginBottom: 16, breakInside: "avoid" }}>
              <h2
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  margin: "0 0 6px",
                  paddingBottom: 4,
                  borderBottom: "1.5px solid #222",
                }}
              >
                {FULL_DAYS[day]}
              </h2>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <tbody>
                  {PERIODS.map((period) => {
                    if (period.type === "break") {
                      return (
                        <tr key={period.id}>
                          <td
                            colSpan={2}
                            style={{
                              padding: "4px 6px",
                              color: "#777",
                              fontStyle: "italic",
                              borderBottom: "1px solid #ddd",
                            }}
                          >
                            {period.label} · {period.time}
                          </td>
                        </tr>
                      );
                    }
                    const key = cellKey(day, printGrade, period.id);
                    const entry = entries[key];
                    return (
                      <tr key={period.id}>
                        <td
                          style={{
                            padding: "6px 8px 6px 0",
                            width: 130,
                            verticalAlign: "top",
                            borderBottom: "1px solid #ddd",
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{period.label}</div>
                          <div style={{ color: "#666" }}>{period.time}</div>
                        </td>
                        <td style={{ padding: "6px 0", verticalAlign: "top", borderBottom: "1px solid #ddd" }}>
                          {entry ? (
                            <>
                              <div style={{ fontWeight: 700 }}>{entry.title}</div>
                              {entry.description && (
                                <div style={{ color: "#444", margin: "2px 0" }}>{entry.description}</div>
                              )}
                              {entry.teachers.length > 0 && (
                                <div style={{ color: "#555" }}>
                                  Teacher{entry.teachers.length > 1 ? "s" : ""}: {entry.teachers.join(", ")}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ color: "#999" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ===== App UI (hidden when printing) ===== */}
      <div className="app-shell">
        {/* Header */}
        <div style={{ background: "#2E4034", padding: "28px 32px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <BookOpen size={22} color="#D98E2B" />
            <span
              className="lp-mono"
              style={{ color: "#A9BFAE", fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}
            >
              Admin Console
            </span>
          </div>
          <h1 style={{ color: "#F6F3EA", fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>
            Schedule Ledger
          </h1>
          <p className="lp-body" style={{ color: "#C8D3C6", fontSize: 14, margin: "6px 0 0" }}>
            Middle school timetable · Grades 6–9 · one class per grade
          </p>
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
            return (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className="lp-tab lp-body"
                style={{
                  border: "none",
                  cursor: "pointer",
                  padding: "10px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  background: isActive ? "#F6F3EA" : "transparent",
                  color: isActive ? "#243229" : "#9CAC9C",
                  borderRadius: isActive ? "8px 8px 0 0" : "0",
                  whiteSpace: "nowrap",
                }}
              >
                {day}
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
                          const key = cellKey(activeDay, grade, period.id);
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
                                    {entry.description && (
                                      <div
                                        style={{
                                          fontSize: 11.5,
                                          color: "#6B6558",
                                          marginBottom: 4,
                                          lineHeight: 1.3,
                                        }}
                                      >
                                        {entry.description}
                                      </div>
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
                    {editing.day.toUpperCase()} · GRADE {editing.grade} · {activePeriod.time}
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
                  Description <span style={{ fontWeight: 400, color: "#A0A895" }}>(optional)</span>
                </label>
                <textarea
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="e.g. Chapter 4 review, bring calculators"
                  rows={3}
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
                    disabled={!entries[cellKey(editing.day, editing.grade, editing.periodId)]}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      color: entries[cellKey(editing.day, editing.grade, editing.periodId)] ? "#C1584A" : "#D8D2C2",
                      cursor: entries[cellKey(editing.day, editing.grade, editing.periodId)] ? "pointer" : "default",
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
