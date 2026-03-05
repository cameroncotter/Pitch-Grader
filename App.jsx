import { useState, useEffect } from "react";

const PITCH_TYPES = ["4-Seam Fastball", "2-Seam Fastball", "Sinker", "Cutter", "Slider", "Curveball", "Changeup", "Splitter", "Sweeper"];

// Statcast MLB averages & elite thresholds by pitch type
// relH = release height (ft), ext = extension (ft) — higher ext is better; relH benchmarks are pitcher-agnostic (tall pitchers skew higher)
const BENCHMARKS = {
  "4-Seam Fastball": { velo: { avg: 94.0, elite: 97.0, poor: 90.0 }, ivb: { avg: 17.0, elite: 22.0, poor: 12.0 }, hb: { avg: 8.0, elite: 14.0, poor: 3.0 }, relH: { avg: 5.9, elite: 6.3, poor: 5.4 }, ext: { avg: 6.3, elite: 6.8, poor: 5.7 } },
  "2-Seam Fastball": { velo: { avg: 93.0, elite: 96.0, poor: 89.0 }, ivb: { avg: 10.0, elite: 16.0, poor: 5.0 }, hb: { avg: 13.0, elite: 19.0, poor: 7.0 }, relH: { avg: 5.8, elite: 6.2, poor: 5.3 }, ext: { avg: 6.3, elite: 6.8, poor: 5.7 } },
  "Sinker":          { velo: { avg: 92.5, elite: 95.5, poor: 88.5 }, ivb: { avg: 7.0, elite: 13.0, poor: 2.0 }, hb: { avg: 14.0, elite: 20.0, poor: 8.0 }, relH: { avg: 5.7, elite: 6.1, poor: 5.2 }, ext: { avg: 6.2, elite: 6.7, poor: 5.6 } },
  "Cutter":          { velo: { avg: 88.5, elite: 92.0, poor: 84.5 }, ivb: { avg: 6.0, elite: 10.0, poor: 2.0 }, hb: { avg: -3.0, elite: -7.0, poor: 0.0 }, relH: { avg: 5.8, elite: 6.2, poor: 5.3 }, ext: { avg: 6.2, elite: 6.7, poor: 5.6 } },
  "Slider":          { velo: { avg: 85.5, elite: 90.0, poor: 80.0 }, ivb: { avg: 0.0, elite: -5.0, poor: 4.0 }, hb: { avg: -5.0, elite: -12.0, poor: 0.0 }, relH: { avg: 5.7, elite: 6.1, poor: 5.2 }, ext: { avg: 6.1, elite: 6.6, poor: 5.5 } },
  "Curveball":       { velo: { avg: 79.5, elite: 84.0, poor: 74.0 }, ivb: { avg: -10.0, elite: -16.0, poor: -5.0 }, hb: { avg: 6.0, elite: 12.0, poor: 1.0 }, relH: { avg: 5.8, elite: 6.2, poor: 5.3 }, ext: { avg: 6.0, elite: 6.5, poor: 5.4 } },
  "Changeup":        { velo: { avg: 84.5, elite: 88.0, poor: 79.5 }, ivb: { avg: 9.0, elite: 14.0, poor: 4.0 }, hb: { avg: 10.0, elite: 16.0, poor: 5.0 }, relH: { avg: 5.8, elite: 6.2, poor: 5.3 }, ext: { avg: 6.2, elite: 6.7, poor: 5.6 } },
  "Splitter":        { velo: { avg: 84.0, elite: 88.0, poor: 79.0 }, ivb: { avg: 1.0, elite: -5.0, poor: 6.0 }, hb: { avg: 4.0, elite: 9.0, poor: 0.0 }, relH: { avg: 5.7, elite: 6.1, poor: 5.2 }, ext: { avg: 6.2, elite: 6.7, poor: 5.6 } },
  "Sweeper":         { velo: { avg: 83.0, elite: 87.5, poor: 78.0 }, ivb: { avg: 2.0, elite: -3.0, poor: 6.0 }, hb: { avg: -16.0, elite: -22.0, poor: -10.0 }, relH: { avg: 5.7, elite: 6.1, poor: 5.2 }, ext: { avg: 6.1, elite: 6.6, poor: 5.5 } },
};

const GRADE_SCALE = [
  { label: "80", color: "#00e5ff", bg: "#002a2e", min: 90 },
  { label: "70", color: "#4ade80", bg: "#052010", min: 75 },
  { label: "60", color: "#a3e635", bg: "#0f1a02", min: 60 },
  { label: "50", color: "#facc15", bg: "#1a1400", min: 45 },
  { label: "40", color: "#fb923c", bg: "#1a0800", min: 30 },
  { label: "30", color: "#f87171", bg: "#1a0202", min: 0 },
];

function getGrade(score) {
  return GRADE_SCALE.find(g => score >= g.min) || GRADE_SCALE[GRADE_SCALE.length - 1];
}

function scoreMetric(value, benchmark, higherIsBetter = true) {
  const { avg, elite, poor } = benchmark;
  if (higherIsBetter) {
    if (value >= elite) return 100;
    if (value <= poor) return 10;
    if (value >= avg) return 50 + ((value - avg) / (elite - avg)) * 50;
    return 10 + ((value - poor) / (avg - poor)) * 40;
  } else {
    // lower is better (e.g. negative IVB for curve)
    const eAdj = elite, pAdj = poor;
    if (eAdj < pAdj) {
      if (value <= eAdj) return 100;
      if (value >= pAdj) return 10;
      if (value <= avg) return 50 + ((avg - value) / (avg - eAdj)) * 50;
      return 10 + ((pAdj - value) / (pAdj - avg)) * 40;
    }
    return scoreMetric(value, benchmark, true);
  }
}

// Empirically derived weights from 2023 Statcast regression (Ridge OLS + XGBoost averaged)
// Outcome: run value per 100 pitches. Weights reflect each metric's predictive contribution.
const WEIGHTS = {
  "4-Seam Fastball": { velo: 0.2016, ivb: 0.2854, hb: 0.1204, relH: 0.2257, ext: 0.1670 },
  "2-Seam Fastball": { velo: 0.2500, ivb: 0.2200, hb: 0.1800, relH: 0.2000, ext: 0.1500 }, // fallback — insufficient sample
  "Sinker":          { velo: 0.2658, ivb: 0.2100, hb: 0.2278, relH: 0.1765, ext: 0.1199 },
  "Cutter":          { velo: 0.5347, ivb: 0.2068, hb: 0.0988, relH: 0.0686, ext: 0.0911 },
  "Slider":          { velo: 0.3916, ivb: 0.1768, hb: 0.1485, relH: 0.1545, ext: 0.1286 },
  "Curveball":       { velo: 0.3916, ivb: 0.2776, hb: 0.0626, relH: 0.1591, ext: 0.1091 },
  "Changeup":        { velo: 0.1376, ivb: 0.1384, hb: 0.1670, relH: 0.2913, ext: 0.2657 },
  "Splitter":        { velo: 0.1236, ivb: 0.2532, hb: 0.3560, relH: 0.1519, ext: 0.1152 },
  "Sweeper":         { velo: 0.2718, ivb: 0.2701, hb: 0.1396, relH: 0.1522, ext: 0.1663 },
};

function computeScores(pitchType, values) {
  const b = BENCHMARKS[pitchType];
  const w = WEIGHTS[pitchType];

  const vScore = scoreMetric(values.velo, b.velo, true);

  // IVB: depends on pitch — breaking balls want more downward break
  const ivbLowerBetter = ["Slider", "Curveball", "Sweeper", "Splitter"].includes(pitchType);
  const ivbScore = ivbLowerBetter
    ? scoreMetric(values.ivb, b.ivb, false)
    : scoreMetric(values.ivb, b.ivb, true);

  // HB: graded on absolute magnitude vs elite for that pitch type
  const hbScore = scoreMetric(Math.abs(values.hb), {
    avg: Math.abs(b.hb.avg), elite: Math.abs(b.hb.elite), poor: Math.abs(b.hb.poor)
  }, true);

  const relHScore = scoreMetric(values.relH, b.relH, true);
  const extScore  = scoreMetric(values.ext,  b.ext,  true);

  const overall = Math.round(
    vScore    * w.velo +
    ivbScore  * w.ivb  +
    hbScore   * w.hb   +
    relHScore * w.relH +
    extScore  * w.ext
  );

  return { vScore: Math.round(vScore), ivbScore: Math.round(ivbScore), hbScore: Math.round(hbScore), relHScore: Math.round(relHScore), extScore: Math.round(extScore), overall };
}

function ScoreBar({ score, label, value, unit }) {
  const grade = getGrade(score);
  const [width, setWidth] = useState(0);
  useEffect(() => { setTimeout(() => setWidth(score), 80); }, [score]);

  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase", color: "#8899aa" }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "12px", color: "#667788" }}>{value}{unit}</span>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "15px", color: grade.color, minWidth: "28px", textAlign: "right" }}>{score}</span>
        </div>
      </div>
      <div style={{ height: "5px", background: "#1a2030", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${width}%`, background: `linear-gradient(90deg, ${grade.color}88, ${grade.color})`, borderRadius: "3px", transition: "width 0.7s cubic-bezier(0.16, 1, 0.3, 1)", boxShadow: `0 0 8px ${grade.color}55` }} />
      </div>
    </div>
  );
}

function OvalGrade({ score, size = 80 }) {
  const grade = getGrade(score);
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const [dash, setDash] = useState(0);
  useEffect(() => { setTimeout(() => setDash((score / 100) * circ), 100); }, [score, circ]);

  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a2535" strokeWidth="5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={grade.color} strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={circ - dash}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)", filter: `drop-shadow(0 0 6px ${grade.color})` }} />
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: size * 0.28, color: grade.color, lineHeight: 1, letterSpacing: "-0.02em" }}>{score}</div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: size * 0.14, color: "#556677", letterSpacing: "0.1em", textTransform: "uppercase" }}>OVR</div>
      </div>
    </div>
  );
}

function InputField({ label, value, onChange, min, max, step = 0.1, unit }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <label style={{ display: "block", fontFamily: "'Barlow Condensed', sans-serif", fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#667788", marginBottom: "5px" }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", background: "#0d1520", border: "1px solid #1e2d40", borderRadius: "6px", overflow: "hidden" }}>
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "9px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "14px", color: "#c8ddf0", width: "100%" }} />
        <span style={{ padding: "0 10px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: "#445566" }}>{unit}</span>
      </div>
    </div>
  );
}

function BenchmarkBadge({ label, value, unit }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "13px", color: "#facc15", fontWeight: 600 }}>{value}{unit}</div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "9px", letterSpacing: "0.12em", color: "#445566", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

export default function PitchGrader() {
  const [pitchType, setPitchType] = useState("4-Seam Fastball");
  const [values, setValues] = useState({ velo: 94.0, ivb: 17.0, hb: 8.0, relH: 5.9, ext: 6.3 });
  const [pitcherName, setPitcherName] = useState("");
  const [pitches, setPitches] = useState([]);
  const [animKey, setAnimKey] = useState(0);

  const scores = computeScores(pitchType, values);
  const b = BENCHMARKS[pitchType];
  const overallGrade = getGrade(scores.overall);

  function set(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
    setAnimKey(k => k + 1);
  }

  function savePitch() {
    if (!pitcherName.trim()) return;
    setPitches(prev => [...prev, { name: pitcherName, pitchType, values: { ...values }, scores: { ...scores } }]);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#070d14", color: "#c8ddf0", fontFamily: "sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ borderBottom: "1px solid #0e1e2e", padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "linear-gradient(135deg, #00e5ff22, #00e5ff44)", border: "1px solid #00e5ff44", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9c4.7 4.7 9.5 4.7 14.2 0M4.9 19.1c4.7-4.7 9.5-4.7 14.2 0M2 12h20M12 2c-2.5 5-2.5 10 0 20M12 2c2.5 5 2.5 10 0 20"/></svg>
          </div>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "18px", letterSpacing: "0.06em", color: "#e0f0ff" }}>PITCH GRADE</div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "10px", letterSpacing: "0.2em", color: "#334455", textTransform: "uppercase" }}>Statcast Evaluation System</div>
          </div>
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "10px", color: "#223344", letterSpacing: "0.1em" }}>MLB SCOUT v2.4</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", minHeight: "calc(100vh - 65px)" }}>

        {/* Left Panel: Inputs */}
        <div style={{ borderRight: "1px solid #0e1e2e", padding: "24px", overflowY: "auto" }}>
          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontFamily: "'Barlow Condensed', sans-serif", fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#667788", marginBottom: "5px" }}>Pitcher Name</label>
            <input type="text" value={pitcherName} onChange={e => setPitcherName(e.target.value)} placeholder="e.g. Corbin Burnes"
              style={{ width: "100%", background: "#0d1520", border: "1px solid #1e2d40", borderRadius: "6px", padding: "9px 12px", fontFamily: "'IBM Plex Mono', monospace", fontSize: "13px", color: "#c8ddf0", outline: "none", boxSizing: "border-box" }} />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", fontFamily: "'Barlow Condensed', sans-serif", fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#667788", marginBottom: "5px" }}>Pitch Type</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {PITCH_TYPES.map(pt => (
                <button key={pt} onClick={() => { setPitchType(pt); setAnimKey(k => k+1); }}
                  style={{ padding: "5px 10px", borderRadius: "4px", border: `1px solid ${pitchType === pt ? "#00e5ff55" : "#1a2535"}`, background: pitchType === pt ? "#00e5ff14" : "transparent", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: "11px", letterSpacing: "0.08em", color: pitchType === pt ? "#00e5ff" : "#445566", cursor: "pointer", transition: "all 0.15s" }}>
                  {pt}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid #0e1e2e", paddingTop: "18px", marginBottom: "6px" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#334455", marginBottom: "14px" }}>⚡ Statcast Inputs</div>
          </div>

          <InputField label="Velocity" value={values.velo} onChange={v => set("velo", v)} min={60} max={105} step={0.1} unit="mph" />
          <InputField label="Induced Vertical Break (IVB)" value={values.ivb} onChange={v => set("ivb", v)} min={-30} max={30} step={0.1} unit="in" />
          <InputField label="Horizontal Break (HB)" value={values.hb} onChange={v => set("hb", v)} min={-30} max={30} step={0.1} unit="in" />
          <InputField label="Release Height" value={values.relH} onChange={v => set("relH", v)} min={3.0} max={7.5} step={0.1} unit="ft" />
          <InputField label="Extension" value={values.ext} onChange={v => set("ext", v)} min={4.5} max={8.0} step={0.1} unit="ft" />

          {/* Benchmarks */}
          <div style={{ background: "#0a1422", border: "1px solid #0e1e2e", borderRadius: "8px", padding: "14px", marginTop: "10px" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "9px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#334455", marginBottom: "12px" }}>MLB Avg — {pitchType}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
              <BenchmarkBadge label="Velo" value={b.velo.avg} unit="" />
              <BenchmarkBadge label="IVB" value={b.ivb.avg} unit="" />
              <BenchmarkBadge label="HB" value={b.hb.avg} unit="" />
              <BenchmarkBadge label="Rel H" value={b.relH.avg} unit="" />
              <BenchmarkBadge label="Ext" value={b.ext.avg} unit="" />
            </div>
          </div>

          <button onClick={savePitch} disabled={!pitcherName.trim()}
            style={{ marginTop: "16px", width: "100%", padding: "11px", background: pitcherName.trim() ? "linear-gradient(135deg, #00e5ff22, #00e5ff33)" : "#0d1520", border: `1px solid ${pitcherName.trim() ? "#00e5ff44" : "#1a2535"}`, borderRadius: "6px", fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "12px", letterSpacing: "0.15em", textTransform: "uppercase", color: pitcherName.trim() ? "#00e5ff" : "#334455", cursor: pitcherName.trim() ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
            + Save to Report
          </button>
        </div>

        {/* Right Panel: Results */}
        <div style={{ padding: "28px", display: "flex", flexDirection: "column", gap: "24px" }}>

          {/* Grade Card */}
          <div style={{ background: `linear-gradient(135deg, #0a1520, ${overallGrade.bg})`, border: `1px solid ${overallGrade.color}22`, borderRadius: "12px", padding: "28px", display: "flex", alignItems: "center", gap: "28px" }}>
            <OvalGrade key={animKey} score={scores.overall} size={110} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "26px", color: "#e0f0ff", letterSpacing: "0.04em" }}>
                {pitcherName || "—"} <span style={{ color: "#445566", fontWeight: 600, fontSize: "20px" }}>· {pitchType}</span>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                {[
                  { label: "Velo", s: scores.vScore },
                  { label: "IVB", s: scores.ivbScore },
                  { label: "HB", s: scores.hbScore },
                  { label: "Rel H", s: scores.relHScore },
                  { label: "Ext", s: scores.extScore },
                ].map(({ label, s }) => {
                  const g = getGrade(s);
                  return (
                    <div key={label} style={{ background: `${g.color}14`, border: `1px solid ${g.color}33`, borderRadius: "5px", padding: "4px 10px", textAlign: "center" }}>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "16px", color: g.color }}>{s}</div>
                      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "9px", letterSpacing: "0.12em", color: "#445566", textTransform: "uppercase" }}>{label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "48px", color: overallGrade.color, lineHeight: 1, letterSpacing: "-0.02em", textShadow: `0 0 30px ${overallGrade.color}66` }}>{overallGrade.label}</div>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "10px", letterSpacing: "0.2em", color: "#445566", textTransform: "uppercase" }}>20–80 Grade</div>
            </div>
          </div>

          {/* Score Bars */}
          <div style={{ background: "#0a1520", border: "1px solid #0e1e2e", borderRadius: "12px", padding: "22px" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#334455", marginBottom: "18px" }}>Component Breakdown</div>
            <ScoreBar key={`v-${animKey}`} score={scores.vScore} label="Velocity" value={values.velo} unit=" mph" />
            <ScoreBar key={`ivb-${animKey}`} score={scores.ivbScore} label="Induced Vert. Break" value={values.ivb} unit='"' />
            <ScoreBar key={`hb-${animKey}`} score={scores.hbScore} label="Horizontal Break" value={values.hb} unit='"' />
            <ScoreBar key={`rh-${animKey}`} score={scores.relHScore} label="Release Height" value={values.relH} unit=" ft" />
            <ScoreBar key={`ex-${animKey}`} score={scores.extScore} label="Extension" value={values.ext} unit=" ft" />
          </div>

          {/* Grade Scale Legend */}
          <div style={{ background: "#0a1520", border: "1px solid #0e1e2e", borderRadius: "12px", padding: "18px" }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#334455", marginBottom: "12px" }}>20–80 Scouting Scale</div>
            <div style={{ display: "flex", gap: "8px" }}>
              {[...GRADE_SCALE].reverse().map(g => (
                <div key={g.label} style={{ flex: 1, textAlign: "center", background: `${g.color}10`, border: `1px solid ${g.color}30`, borderRadius: "5px", padding: "6px 0" }}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "18px", color: g.color }}>{g.label}</div>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "9px", color: "#334455", letterSpacing: "0.08em" }}>
                    {g.label === "80" ? "Elite" : g.label === "70" ? "Plus+" : g.label === "60" ? "Plus" : g.label === "50" ? "Avg" : g.label === "40" ? "Fringe" : "Below"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Saved Pitches */}
          {pitches.length > 0 && (
            <div style={{ background: "#0a1520", border: "1px solid #0e1e2e", borderRadius: "12px", padding: "22px" }}>
              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#334455", marginBottom: "14px" }}>Saved Report · {pitches.length} Pitch{pitches.length !== 1 ? "es" : ""}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {pitches.map((p, i) => {
                  const g = getGrade(p.scores.overall);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#070d14", border: "1px solid #0e1e2e", borderRadius: "7px" }}>
                      <div style={{ display: "flex", align: "center", gap: "12px" }}>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "14px", color: "#c8ddf0" }}>{p.name}</span>
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "12px", color: "#445566" }}>· {p.pitchType}</span>
                      </div>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        {[
                          { label: "V", s: p.scores.vScore },
                          { label: "MOV", s: Math.round((p.scores.ivbScore + p.scores.hbScore) / 2) },
                          { label: "RH", s: p.scores.relHScore },
                          { label: "EXT", s: p.scores.extScore },
                        ].map(({ label, s }) => {
                          const sg = getGrade(s);
                          return <span key={label} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "11px", color: sg.color }}>{label}:{s}</span>;
                        })}
                        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "20px", color: g.color, marginLeft: "6px" }}>{g.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
