
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { getScanHistory, predictMRI } from "./services/api";
import "./Dashboard.css";

const NAV = [
  ["Overview", "⌂"],
  ["MRI Analysis", "◎"],
  ["Patient History", "▤"],
  ["Analytics", "▥"],
];

const COLORS = {
  blue: "#3869e8",
  green: "#0e9f6e",
  red: "#e05260",
  amber: "#d99019",
};

function getRecords(payload) {
  if (Array.isArray(payload)) return payload;

  for (const key of ["history", "records", "scans", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  return [];
}

function getPrediction(record) {
  return String(
    record?.prediction ??
    record?.result ??
    record?.diagnosis ??
    record?.label ??
    record?.predicted_class ??
    ""
  ).toLowerCase();
}

function isPositive(record) {
  const result = getPrediction(record);

  return (
    result.includes("parkinson") ||
    result.includes("positive") ||
    result === "pd" ||
    result.includes("detected")
  );
}

function isNegative(record) {
  const result = getPrediction(record);

  return (
    result.includes("negative") ||
    result.includes("healthy") ||
    result.includes("normal") ||
    result === "hc" ||
    result.includes("not detected")
  );
}

function getConfidence(record) {
  const value = Number(
    record?.confidence ??
    record?.confidence_score ??
    record?.probability ??
    record?.model_confidence
  );

  if (!Number.isFinite(value)) return null;

  // Accommodate backends that return 0–1 probabilities.
  return value >= 0 && value <= 1 ? value * 100 : value;
}

function getDate(record) {
  const value =
    record?.created_at ??
    record?.timestamp ??
    record?.date ??
    record?.analysis_date;

  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getPatientId(record) {
  return String(
    record?.patient_id ??
    record?.patientId ??
    record?.patient ??
    "Not provided"
  );
}

function getFileName(record) {
  return String(
    record?.filename ??
    record?.file_name ??
    record?.image_name ??
    record?.original_filename ??
    "MRI scan"
  );
}

function getStatus(record) {
  const status = String(record?.status ?? "").toLowerCase();

  if (
    status.includes("pending") ||
    status.includes("processing") ||
    status.includes("review")
  ) {
    return "Pending";
  }

  if (isPositive(record) || isNegative(record)) {
    return "Completed";
  }

  return status === "completed" ? "Completed" : "Unknown";
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function NotificationCenter({ items, onDismiss, onClear }) {
  return (
    <section className="nv-panel nv-notification-panel">
      <div className="nv-panel-heading">
        <div>
          <span className="nv-eyebrow">ACTIVITY CENTER</span>
          <h2>Notifications</h2>
        </div>
        {items.length > 0 && (
          <button className="nv-text-button" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="nv-empty">
          <span className="nv-empty-icon">♧</span>
          <p>You're all caught up.</p>
          <span>Upload a scan to see activity here.</span>
        </div>
      ) : (
        <div className="nv-notification-list">
          {items.map((item) => (
            <div
              className={`nv-notification nv-notification-${item.type}`}
              key={item.id}
            >
              <span className="nv-notification-dot" />
              <div className="nv-notification-copy">
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{item.time}</small>
              </div>
              <button
                className="nv-dismiss"
                onClick={() => onDismiss(item.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MetricCard({ label, value, caption, icon, tone }) {
  return (
    <article className="nv-metric-card">
      <div className={`nv-metric-icon nv-tone-${tone}`}>{icon}</div>
      <span className="nv-metric-label">{label}</span>
      <strong className="nv-metric-value">{value}</strong>
      <span className="nv-metric-caption">{caption}</span>
    </article>
  );
}

export default function Dashboard() {
  const [activePage, setActivePage] = useState("Overview");
  const [records, setRecords] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [patientId, setPatientId] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [historyError, setHistoryError] = useState("");
  const [latestResult, setLatestResult] = useState(null);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef(null);
  const notificationId = useRef(0);

  const notify = useCallback((type, title, message) => {
    const id = ++notificationId.current;

    setNotifications((current) =>
      [
        {
          id,
          type,
          title,
          message,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
        ...current,
      ].slice(0, 30)
    );
  }, []);

  const refreshHistory = useCallback(async (quiet = false) => {
    try {
      const payload = await getScanHistory();
      const nextRecords = getRecords(payload);

      setRecords(nextRecords);
      setHistoryError("");
      setLastUpdated(new Date());

      return nextRecords;
    } catch (error) {
      setHistoryError(getErrorMessage(error));

      if (!quiet) {
        notify(
          "error",
          "Backend connection failed",
          getErrorMessage(error)
        );
      }

      return null;
    } finally {
      setLoadingHistory(false);
    }
  }, [notify]);

  useEffect(() => {
    refreshHistory();

    // Periodically sync changes made outside this browser session.
    const timer = window.setInterval(() => {
      refreshHistory(true);
    }, 30000);

    return () => window.clearInterval(timer);
  }, [refreshHistory]);

  const stats = useMemo(() => {
    const positive = records.filter(isPositive).length;
    const negative = records.filter(isNegative).length;
    const pending = records.filter(
      (record) => getStatus(record) === "Pending"
    ).length;

    const confidences = records
      .map(getConfidence)
      .filter(
        (value) => value !== null && value >= 0 && value <= 100
      );

    const averageConfidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) /
        confidences.length
      : null;

    return {
      total: records.length,
      positive,
      negative,
      pending,
      averageConfidence,
    };
  }, [records]);

  const trendData = useMemo(() => {
    const days = new Map();

    records.forEach((record) => {
      const date = getDate(record);
      if (!date) return;

      const key = date.toLocaleDateString("en-CA");

      if (!days.has(key)) {
        days.set(key, { date: key, scans: 0, positive: 0, negative: 0 });
      }

      const item = days.get(key);
      item.scans += 1;

      if (isPositive(record)) item.positive += 1;
      if (isNegative(record)) item.negative += 1;
    });

    return [...days.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
      .map((item) => ({
        ...item,
        date: item.date.slice(5),
      }));
  }, [records]);

  const resultData = useMemo(
    () => [
      { name: "Positive", value: stats.positive, color: COLORS.red },
      { name: "Negative", value: stats.negative, color: COLORS.green },
      {
        name: "Unclassified",
        value: Math.max(
          0,
          stats.total - stats.positive - stats.negative
        ),
        color: "#a6b2c5",
      },
    ].filter((item) => item.value > 0),
    [stats]
  );

  const confidenceData = useMemo(() => {
    const ranges = [
      { range: "0–49%", min: 0, max: 50, scans: 0 },
      { range: "50–69%", min: 50, max: 70, scans: 0 },
      { range: "70–89%", min: 70, max: 90, scans: 0 },
      { range: "90–100%", min: 90, max: 101, scans: 0 },
    ];

    records.forEach((record) => {
      const confidence = getConfidence(record);
      if (confidence === null || confidence < 0 || confidence > 100) return;

      const bucket = ranges.find(
        (range) => confidence >= range.min && confidence < range.max
      );

      if (bucket) bucket.scans += 1;
    });

    return ranges;
  }, [records]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const matchesSearch =
        !query ||
        getPatientId(record).toLowerCase().includes(query) ||
        getFileName(record).toLowerCase().includes(query) ||
        getPrediction(record).includes(query);

      const date = getDate(record);
      const matchesDate =
        !dateFilter ||
        (date && date.toISOString().slice(0, 10) === dateFilter);

      return matchesSearch && matchesDate;
    });
  }, [records, search, dateFilter]);

  function acceptFiles(fileList) {
    const allowed = /\.(jpe?g|png|dcm|dicom)$/i;
    const files = Array.from(fileList || []);
    const valid = files.filter((file) => allowed.test(file.name));

    if (valid.length !== files.length) {
      notify(
        "error",
        "Unsupported file format",
        "Choose JPG, PNG, DCM, or DICOM files."
      );
    }

    if (valid.length) {
      setSelectedFiles((current) => [...current, ...valid]);
      notify(
        "success",
        "Files added",
        `${valid.length} MRI file(s) are ready for analysis.`
      );
    }
  }

  async function handleAnalyze(event) {
    event?.preventDefault();

    if (!selectedFiles.length) {
      notify("error", "No MRI selected", "Choose at least one MRI file first.");
      return;
    }

    setAnalyzing(true);
    setLatestResult(null);

    let succeeded = 0;
    let failed = 0;

    for (const file of selectedFiles) {
      try {
        notify("info", "Analysis started", `Processing ${file.name}.`);

        const result = await predictMRI(file, patientId);
        succeeded += 1;

        setLatestResult({
          fileName: file.name,
          patientId: patientId || "Not provided",
          result,
        });

        notify(
          "success",
          "Analysis completed",
          `${file.name} was processed successfully.`
        );
      } catch (error) {
        failed += 1;
        notify(
          "error",
          "Analysis failed",
          `${file.name}: ${getErrorMessage(error)}`
        );
      }
    }

    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";

    // The displayed metrics and charts are recalculated from this response.
    const updatedRecords = await refreshHistory(true);

    if (updatedRecords === null) {
      notify(
        "error",
        "History refresh failed",
        "Predictions may have completed, but the dashboard could not retrieve updated records."
      );
    } else {
      notify(
        "success",
        "Dashboard synchronized",
        `${updatedRecords.length} scan record(s) loaded from the backend.`
      );
    }

    if (succeeded && !failed) {
      setActivePage("Overview");
    }

    setAnalyzing(false);
  }

  function exportReport(record) {
    const confidence = getConfidence(record);
    const date = getDate(record);

    const lines = [
      "NEUROVISTA - MRI ANALYSIS REPORT",
      "Research and review support; not a standalone clinical diagnosis.",
      "",
      `Patient ID: ${getPatientId(record)}`,
      `File: ${getFileName(record)}`,
      `Prediction: ${getPrediction(record) || "Not available"}`,
      `Confidence: ${confidence === null ? "Not provided" : `${confidence.toFixed(1)}%`}`,
      `Date: ${date ? date.toLocaleString() : "Not provided"}`,
      "",
      "Interpretation must be reviewed by a qualified clinician.",
    ];

    const blob = new Blob([lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `neurovista-${getPatientId(record)}-report.txt`;
    link.click();
    URL.revokeObjectURL(url);

    notify(
      "success",
      "Report exported",
      "A text summary was downloaded. This is not a PDF medical report."
    );
  }

  const pageTitle = activePage;

  return (
    <div className="nv-app">
      <aside className="nv-sidebar">
        <a className="nv-brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="nv-brand-mark">N</span>
          <span>
            <strong>NeuroVista</strong>
            <small>MRI INSIGHTS PLATFORM</small>
          </span>
        </a>

        <div className="nv-sidebar-label">WORKSPACE</div>

        <nav className="nv-navigation">
          {NAV.map(([name, icon]) => (
            <button
              key={name}
              className={`nv-nav-item ${activePage === name ? "active" : ""}`}
              onClick={() => setActivePage(name)}
            >
              <span className="nv-nav-icon">{icon}</span>
              {name}
              {name === "MRI Analysis" && <span className="nv-nav-plus">+</span>}
            </button>
          ))}
        </nav>

        <div className="nv-sidebar-bottom">
          <div className="nv-connection">
            <span className={`nv-connection-dot ${historyError ? "offline" : ""}`} />
            <div>
              <strong>{historyError ? "Connection issue" : "API connection"}</strong>
              <small>{historyError ? "Check Flask backend" : "History endpoint checked"}</small>
            </div>
          </div>
          <div className="nv-sidebar-foot">NEUROVISTA · MRI WORKSPACE</div>
        </div>
      </aside>

      <main className="nv-main">
        <header className="nv-topbar">
          <div className="nv-breadcrumb">
            <span>NeuroVista</span>
            <span>/</span>
            <strong>{pageTitle}</strong>
          </div>

          <div className="nv-topbar-actions">
            <span className={`nv-status-pill ${historyError ? "offline" : ""}`}>
              <span />
              {historyError ? "API offline" : "Workspace"}
            </span>
            <button
              className="nv-icon-button"
              title="Refresh backend records"
              onClick={() => refreshHistory()}
              disabled={loadingHistory}
            >
              ↻
            </button>
            <button
              className="nv-notification-button"
              onClick={() => {
                document.getElementById("nv-notifications")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              aria-label="View notifications"
            >
              ♧
              {notifications.length > 0 && (
                <span className="nv-notification-count">
                  {Math.min(notifications.length, 99)}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="nv-content">
          <section className="nv-page-heading">
            <div>
              <span className="nv-eyebrow">NEUROVISTA / MRI WORKSPACE</span>
              <h1>{pageTitle}</h1>
              <p>
                {activePage === "Overview"
                  ? "Monitor scan records and review your analysis workflow at a glance."
                  : activePage === "MRI Analysis"
                  ? "Upload brain MRI scans and send them to the prediction backend."
                  : activePage === "Patient History"
                  ? "Search, filter, and review records retrieved from the backend."
                  : "Explore scan volume, prediction distribution, and model confidence."}
              </p>
            </div>
            <button
              className="nv-primary-button"
              onClick={() => setActivePage("MRI Analysis")}
            >
              <span>＋</span> New MRI Analysis
            </button>
          </section>

          {historyError && (
            <div className="nv-banner nv-banner-error">
              <strong>Unable to refresh backend data.</strong>
              <span>{historyError}</span>
              <button onClick={() => refreshHistory()}>Retry</button>
            </div>
          )}

          {activePage === "MRI Analysis" && (
            <section className="nv-analysis-layout">
              <form className="nv-panel nv-upload-panel" onSubmit={handleAnalyze}>
                <div className="nv-panel-heading">
                  <div>
                    <span className="nv-eyebrow">SCAN WORKFLOW</span>
                    <h2>New MRI analysis</h2>
                  </div>
                  <span className="nv-step-pill">Step 01 / Upload</span>
                </div>

                <label className="nv-field">
                  <span>Patient ID <small>(optional)</small></span>
                  <input
                    value={patientId}
                    onChange={(event) => setPatientId(event.target.value)}
                    placeholder="e.g. P-10024"
                  />
                </label>

                <div
                  className={`nv-dropzone ${dragging ? "dragging" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    acceptFiles(event.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <span className="nv-upload-icon">↑</span>
                  <strong>Drop MRI images here</strong>
                  <span>or browse files from your device</span>
                  <small>JPG · PNG · DCM · DICOM · Multiple files supported</small>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.dcm,.dicom"
                    multiple
                    hidden
                    onChange={(event) => acceptFiles(event.target.files)}
                  />
                </div>

                {selectedFiles.length > 0 && (
                  <div className="nv-selected-files">
                    <div className="nv-panel-heading">
                      <strong>{selectedFiles.length} selected file(s)</strong>
                      <button
                        type="button"
                        className="nv-text-button"
                        onClick={() => setSelectedFiles([])}
                      >
                        Remove all
                      </button>
                    </div>
                    {selectedFiles.map((file, index) => (
                      <div className="nv-file-row" key={`${file.name}-${index}`}>
                        <span className="nv-file-icon">▧</span>
                        <span className="nv-file-name">{file.name}</span>
                        <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
                        <button
                          type="button"
                          className="nv-dismiss"
                          onClick={() =>
                            setSelectedFiles((current) =>
                              current.filter((_, i) => i !== index)
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {analyzing && (
                  <div className="nv-progress-wrap">
                    <div className="nv-progress-copy">
                      <span>Processing MRI scans…</span>
                      <span>Please wait</span>
                    </div>
                    <div className="nv-progress-track">
                      <div className="nv-progress-bar" />
                    </div>
                  </div>
                )}

                <button
                  className="nv-primary-button nv-submit-button"
                  type="submit"
                  disabled={analyzing || !selectedFiles.length}
                >
                  {analyzing ? "Analyzing…" : "Run MRI analysis →"}
                </button>

                <p className="nv-disclaimer">
                  Only upload data you are authorized to process. Do not use
                  model output as a standalone clinical diagnosis.
                </p>
              </form>

              <div className="nv-analysis-side">
                <section className="nv-panel">
                  <span className="nv-eyebrow">WORKFLOW</span>
                  <h2>From scan to insight</h2>
                  <div className="nv-workflow-step">
                    <span>01</span>
                    <div><strong>Upload MRI</strong><p>Select supported image files.</p></div>
                  </div>
                  <div className="nv-workflow-step">
                    <span>02</span>
                    <div><strong>Model processing</strong><p>Flask receives the scan and runs the model.</p></div>
                  </div>
                  <div className="nv-workflow-step">
                    <span>03</span>
                    <div><strong>Review the result</strong><p>Check prediction, confidence, and saved history.</p></div>
                  </div>
                </section>

                {latestResult && (
                  <section className="nv-panel nv-result-panel">
                    <span className="nv-eyebrow">LATEST RESPONSE</span>
                    <h2>Analysis response</h2>
                    <p><strong>File:</strong> {latestResult.fileName}</p>
                    <p><strong>Patient ID:</strong> {latestResult.patientId}</p>
                    <pre className="nv-result-json">
                      {JSON.stringify(latestResult.result, null, 2)}
                    </pre>
                    <p className="nv-disclaimer">
                      Confirm that the response matches your trained model's
                      output schema before clinical or research interpretation.
                    </p>
                  </section>
                )}
              </div>
            </section>
          )}

          {activePage === "Overview" && (
            <>
              <section className="nv-welcome-banner">
                <div>
                  <span className="nv-eyebrow">RESEARCH WORKSPACE</span>
                  <h2>Good to see you</h2>
                  <p>Monitor MRI scan records and review your analysis workflow in one place.</p>
                  <button
                    className="nv-light-button"
                    onClick={() => setActivePage("MRI Analysis")}
                  >
                    + New MRI Analysis
                  </button>
                </div>
                <div className="nv-welcome-art" aria-hidden="true">
                  <div className="nv-orbit nv-orbit-one" />
                  <div className="nv-orbit nv-orbit-two" />
                  <div className="nv-brain-symbol">◉</div>
                  <span className="nv-art-label">MRI / AI</span>
                </div>
              </section>

              <section className="nv-metric-grid">
                <MetricCard
                  label="Total MRI scans"
                  value={loadingHistory ? "…" : stats.total}
                  caption="Records retrieved from backend"
                  icon="▧"
                  tone="blue"
                />
                <MetricCard
                  label="Positive cases"
                  value={loadingHistory ? "…" : stats.positive}
                  caption="Flagged by model output"
                  icon="!"
                  tone="red"
                />
                <MetricCard
                  label="Negative cases"
                  value={loadingHistory ? "…" : stats.negative}
                  caption="Classified as negative"
                  icon="✓"
                  tone="green"
                />
                <MetricCard
                  label="Pending review"
                  value={loadingHistory ? "…" : stats.pending}
                  caption="Pending/processing records"
                  icon="◷"
                  tone="amber"
                />
              </section>

              <section className="nv-chart-grid">
                <div className="nv-panel nv-chart-panel">
                  <div className="nv-panel-heading">
                    <div>
                      <span className="nv-eyebrow">ACTIVITY</span>
                      <h2>Scan volume</h2>
                    </div>
                    <span className="nv-muted-pill">Last 14 active dates</span>
                  </div>
                  {trendData.length ? (
                    <div className="nv-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData}>
                          <defs>
                            <linearGradient id="nvScanGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={COLORS.blue} stopOpacity={0.22} />
                              <stop offset="95%" stopColor={COLORS.blue} stopOpacity={0.01} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="#edf1f7" vertical={false} />
                          <XAxis dataKey="date" tickLine={false} axisLine={false} />
                          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                          <Tooltip />
                          <Area
                            type="monotone"
                            dataKey="scans"
                            name="Scans"
                            stroke={COLORS.blue}
                            strokeWidth={2.5}
                            fill="url(#nvScanGradient)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="nv-chart-empty">
                      <span>▥</span>
                      <strong>No dated scan records yet</strong>
                      <p>The chart appears when the backend returns records with timestamps.</p>
                    </div>
                  )}
                </div>

                <div className="nv-panel nv-chart-panel">
                  <div className="nv-panel-heading">
                    <div>
                      <span className="nv-eyebrow">DISTRIBUTION</span>
                      <h2>Prediction summary</h2>
                    </div>
                  </div>
                  {resultData.length ? (
                    <>
                      <div className="nv-donut-wrap">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={resultData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={65}
                              outerRadius={94}
                              paddingAngle={4}
                              stroke="none"
                            >
                              {resultData.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="nv-donut-center">
                          <strong>{stats.total}</strong>
                          <span>Total scans</span>
                        </div>
                      </div>
                      <div className="nv-chart-legend">
                        {resultData.map((item) => (
                          <div key={item.name}>
                            <span>
                              <i style={{ background: item.color }} />
                              {item.name}
                            </span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="nv-chart-empty">
                      <span>◉</span>
                      <strong>No predictions to display</strong>
                      <p>Run an analysis to populate this chart.</p>
                    </div>
                  )}
                </div>
              </section>

              <section className="nv-bottom-grid">
                <div className="nv-panel">
                  <div className="nv-panel-heading">
                    <div>
                      <span className="nv-eyebrow">RECENT ACTIVITY</span>
                      <h2>Latest scan records</h2>
                    </div>
                    <button
                      className="nv-text-button"
                      onClick={() => setActivePage("Patient History")}
                    >
                      View history →
                    </button>
                  </div>
                  <ScanTable
                    records={records.slice(0, 5)}
                    loading={loadingHistory}
                    onExport={exportReport}
                  />
                </div>

                <div id="nv-notifications">
                  <NotificationCenter
                    items={notifications.slice(0, 8)}
                    onDismiss={(id) =>
                      setNotifications((items) => items.filter((item) => item.id !== id))
                    }
                    onClear={() => setNotifications([])}
                  />
                </div>
              </section>
            </>
          )}

          {activePage === "Analytics" && (
            <>
              <section className="nv-metric-grid">
                <MetricCard label="Total scans" value={stats.total} caption="Backend records" icon="▧" tone="blue" />
                <MetricCard label="Positive" value={stats.positive} caption="Model-positive labels" icon="!" tone="red" />
                <MetricCard label="Negative" value={stats.negative} caption="Model-negative labels" icon="✓" tone="green" />
                <MetricCard
                  label="Average confidence"
                  value={stats.averageConfidence === null ? "N/A" : `${stats.averageConfidence.toFixed(1)}%`}
                  caption="Only records with confidence values"
                  icon="◉"
                  tone="amber"
                />
              </section>

              <section className="nv-chart-grid">
                <div className="nv-panel nv-chart-panel">
                  <div className="nv-panel-heading">
                    <div><span className="nv-eyebrow">MODEL OUTPUT</span><h2>Positive vs. negative by date</h2></div>
                  </div>
                  {trendData.length ? (
                    <div className="nv-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={trendData}>
                          <CartesianGrid stroke="#edf1f7" vertical={false} />
                          <XAxis dataKey="date" tickLine={false} axisLine={false} />
                          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="positive" name="Positive" fill={COLORS.red} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="negative" name="Negative" fill={COLORS.green} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="nv-chart-empty"><strong>No dated records available</strong></div>
                  )}
                </div>

                <div className="nv-panel nv-chart-panel">
                  <div className="nv-panel-heading">
                    <div><span className="nv-eyebrow">CONFIDENCE</span><h2>Model confidence distribution</h2></div>
                  </div>
                  {records.some((record) => getConfidence(record) !== null) ? (
                    <div className="nv-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={confidenceData}>
                          <CartesianGrid stroke="#edf1f7" vertical={false} />
                          <XAxis dataKey="range" tickLine={false} axisLine={false} />
                          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                          <Tooltip />
                          <Bar dataKey="scans" name="Scans" fill={COLORS.blue} radius={[5, 5, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="nv-chart-empty">
                      <strong>Confidence values unavailable</strong>
                      <p>Return confidence or confidence_score from your backend.</p>
                    </div>
                  )}
                </div>
              </section>

              <div className="nv-panel nv-analytics-note">
                <strong>How to interpret these charts</strong>
                <p>
                  These visualizations summarize stored model outputs. They do
                  not calculate diagnostic accuracy because that requires
                  verified ground-truth labels. Disease progression analysis
                  also requires longitudinal, patient-linked measurements.
                </p>
              </div>
            </>
          )}

          {activePage === "Patient History" && (
            <section className="nv-panel">
              <div className="nv-panel-heading">
                <div>
                  <span className="nv-eyebrow">RECORD MANAGEMENT</span>
                  <h2>Patient scan history</h2>
                  <p className="nv-subtitle">
                    {filteredRecords.length} matching record(s) from the backend
                  </p>
                </div>
                <button
                  className="nv-secondary-button"
                  onClick={() => refreshHistory()}
                >
                  ↻ Refresh
                </button>
              </div>

              <div className="nv-filters">
                <label className="nv-search-field">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search patient ID, file, or prediction…"
                  />
                </label>
                <input
                  className="nv-date-filter"
                  type="date"
                  value={dateFilter}
                  onChange={(event) => setDateFilter(event.target.value)}
                  aria-label="Filter by analysis date"
                />
                <button
                  className="nv-secondary-button"
                  onClick={() => {
                    setSearch("");
                    setDateFilter("");
                  }}
                >
                  Clear filters
                </button>
              </div>

              <ScanTable
                records={filteredRecords}
                loading={loadingHistory}
                onExport={exportReport}
              />
            </section>
          )}

          <footer className="nv-footer">
            <span>NEUROVISTA · MRI INSIGHTS PLATFORM</span>
            <span>
              {lastUpdated
                ? `Last synchronized ${lastUpdated.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "Waiting for backend data"}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function ScanTable({ records, loading, onExport }) {
  if (loading && !records.length) {
    return <div className="nv-table-empty">Loading records from backend…</div>;
  }

  if (!records.length) {
    return (
      <div className="nv-table-empty">
        <span>▤</span>
        <strong>No scan records found</strong>
        <p>Records will appear here after the backend stores completed analyses.</p>
      </div>
    );
  }

  return (
    <div className="nv-table-scroll">
      <table className="nv-table">
        <thead>
          <tr>
            <th>Patient ID</th>
            <th>MRI file</th>
            <th>Prediction</th>
            <th>Confidence</th>
            <th>Date</th>
            <th>Status</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => {
            const prediction = getPrediction(record);
            const confidence = getConfidence(record);
            const date = getDate(record);
            const positive = isPositive(record);
            const negative = isNegative(record);

            return (
              <tr key={record.id ?? record.scan_id ?? `${getFileName(record)}-${index}`}>
                <td><strong>{getPatientId(record)}</strong></td>
                <td className="nv-table-filename">{getFileName(record)}</td>
                <td>
                  {positive ? (
                    <span className="nv-result-badge positive">Positive</span>
                  ) : negative ? (
                    <span className="nv-result-badge negative">Negative</span>
                  ) : (
                    <span className="nv-result-badge unknown">
                      {prediction || "Unknown"}
                    </span>
                  )}
                </td>
                <td>{confidence === null ? "N/A" : `${confidence.toFixed(1)}%`}</td>
                <td>{date ? date.toLocaleDateString() : "N/A"}</td>
                <td>
                  <span className={`nv-status-text ${getStatus(record) === "Completed" ? "done" : ""}`}>
                    {getStatus(record)}
                  </span>
                </td>
                <td>
                  <button
                    className="nv-text-button"
                    onClick={() => onExport(record)}
                  >
                    Export
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
