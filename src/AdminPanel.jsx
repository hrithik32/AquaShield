import React, { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { ref, set, update, onValue } from "firebase/database";
import {
  Power,
  Activity,
  AlertTriangle,
  Settings,
  Droplets,
  Thermometer,
  FlaskConical,
  Waves,
  Clock,
  ToggleLeft,
  ToggleRight,
  Eye,
  Cpu,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// SENSOR DEFINITIONS  (waterLevel excluded — always real ESP32)
// ─────────────────────────────────────────────────────────────────────────────
const SENSORS = [
  {
    key: "temp",
    label: "Temperature",
    unit: "°C",
    dec: 1,
    int: false,
    icon: Thermometer,
    color: "orange",
    normal: { min: 15, max: 40, step: 0.5, val: 26 },
    danger: { min: 28, max: 45, step: 0.5, val: 34 },
    recover: { min: 15, max: 35, step: 0.5, val: 27 },
  },
  {
    key: "ph",
    label: "pH Level",
    unit: "pH",
    dec: 1,
    int: false,
    icon: FlaskConical,
    color: "purple",
    normal: { min: 4, max: 10, step: 0.1, val: 7.2 },
    danger: { min: 3, max: 12, step: 0.1, val: 5.1 },
    recover: { min: 5, max: 10, step: 0.1, val: 7.0 },
  },
  {
    key: "tds",
    label: "TDS",
    unit: "ppm",
    dec: 0,
    int: true,
    icon: Droplets,
    color: "teal",
    normal: { min: 50, max: 499, step: 5, val: 220 },
    danger: { min: 501, max: 1500, step: 5, val: 980 },
    recover: { min: 50, max: 600, step: 5, val: 310 },
  },
];

const JIT = { temp: [1.0, 2.0], ph: [0.5, 0.5], tds: [5, 5] };

// ─────────────────────────────────────────────────────────────────────────────
// WATER LEVEL CALCULATION
// Distance ≥ 30 cm → 0%  (tank empty)
// Distance ≤ 16 cm → 100% (tank full)
// ─────────────────────────────────────────────────────────────────────────────
const TANK_EMPTY_CM = 30;
const TANK_FULL_CM = 16;

function calcWaterLevel(distanceCm) {
  if (!distanceCm || distanceCm <= 0) return { pct: 0, cm: distanceCm || 0 };
  if (distanceCm >= TANK_EMPTY_CM) return { pct: 0, cm: distanceCm };
  if (distanceCm <= TANK_FULL_CM) return { pct: 100, cm: distanceCm };
  const pct = Math.round(
    ((TANK_EMPTY_CM - distanceCm) / (TANK_EMPTY_CM - TANK_FULL_CM)) * 100,
  );
  return { pct, cm: distanceCm };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (v, dec, int) =>
  int ? String(Math.round(v)) : Number(v).toFixed(dec);

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

function applyJitter(src) {
  const out = {};
  SENSORS.forEach((s) => {
    const [mn, mx] = JIT[s.key];
    const win = mn + Math.random() * (mx - mn);
    const raw = src[s.key] - win + Math.random() * win * 2;
    out[s.key] = s.int ? Math.round(raw) : +raw.toFixed(s.dec);
  });
  return out;
}

function nowTime() {
  return new Date().toLocaleTimeString("en", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR MAPS
// ─────────────────────────────────────────────────────────────────────────────
const THEME = {
  normal: {
    ring: "ring-emerald-500/40",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    btn: "bg-emerald-500 hover:bg-emerald-400 text-black",
    dot: "bg-emerald-400",
    progress: "bg-emerald-500",
  },
  danger: {
    ring: "ring-red-500/40",
    border: "border-red-500/30",
    text: "text-red-400",
    bg: "bg-red-500/10",
    btn: "bg-red-500 hover:bg-red-400 text-white",
    dot: "bg-red-400",
    progress: "bg-red-500",
  },
  recover: {
    ring: "ring-amber-500/40",
    border: "border-amber-500/30",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    btn: "bg-amber-500 hover:bg-amber-400 text-black",
    dot: "bg-amber-400",
    progress: "bg-amber-500",
  },
};

const SENSOR_COLOR = {
  orange: {
    text: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    thumb: "#f97316",
  },
  purple: {
    text: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
    thumb: "#a855f7",
  },
  teal: {
    text: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/30",
    thumb: "#14b8a6",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [systemOn, setSystemOn] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [profiles, setProfiles] = useState(() => {
    const p = { normal: {}, danger: {}, recover: {} };
    SENSORS.forEach((s) => {
      p.normal[s.key] = s.normal.val;
      p.danger[s.key] = s.danger.val;
      p.recover[s.key] = s.recover.val;
    });
    return p;
  });
  const [liveVals, setLiveVals] = useState(null);
  const [realWaterLevel, setRealWaterLevel] = useState(null);
  const [pump1, setPump1] = useState(false);
  const [pump2, setPump2] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [progress, setProgress] = useState({ danger: 0, recover: 0 });
  const [logs, setLogs] = useState([
    {
      id: 0,
      type: "info",
      msg: "Admin ready. Set profiles → check Auto Mode → press POWER.",
      time: nowTime(),
    },
  ]);

  const anchorRef = useRef({});
  const profilesRef = useRef(profiles);
  const systemOnRef = useRef(false);
  const animatingRef = useRef(false);
  const autoModeRef = useRef(false);
  const realWaterLevelRef = useRef(null);
  const jitterTimer = useRef(null);
  const animTimer = useRef(null);
  const logId = useRef(1);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);
  useEffect(() => {
    systemOnRef.current = systemOn;
  }, [systemOn]);
  useEffect(() => {
    animatingRef.current = animating;
  }, [animating]);
  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);
  useEffect(() => {
    realWaterLevelRef.current = realWaterLevel;
  }, [realWaterLevel]);

  // ── Firebase listeners ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub1 = onValue(ref(db, "/autoMode"), (snap) => {
      setAutoMode(snap.val() || false);
    });
    const unsub2 = onValue(ref(db, "/pumps"), (snap) => {
      const v = snap.val() || {};
      setPump1(!!v.pump1);
      setPump2(!!v.pump2);
    });
    const unsub3 = onValue(ref(db, "/sensor"), (snap) => {
      const v = snap.val();
      if (v && v.waterLevel !== undefined) {
        setRealWaterLevel(calcWaterLevel(v.waterLevel));
      }
    });
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  // ── Log helper ──────────────────────────────────────────────────────────
  const log = useCallback((msg, type = "info") => {
    const entry = { id: logId.current++, type, msg, time: nowTime() };
    setLogs((prev) => {
      const next = [...prev, entry];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

  // ── Firebase writes ─────────────────────────────────────────────────────
  const writeFake = useCallback((v) => {
    set(ref(db, "/fake"), {
      temp: +v.temp.toFixed(2),
      ph: +v.ph.toFixed(3),
      tds: +v.tds.toFixed(1),
    });
  }, []);

  const writePumps = useCallback(
    async (p1, p2) => {
      await update(ref(db, "/pumps"), { pump1: p1, pump2: p2 });
      setPump1(p1);
      setPump2(p2);
      log(
        `Pumps → P1:${p1 ? "ON" : "OFF"}  P2:${p2 ? "ON" : "OFF"}`,
        p1 || p2 ? "ok" : "warn",
      );
    },
    [log],
  );

  // ── Safe pump write — tank safety guards ────────────────────────────────
  const safePumpWrite = useCallback(
    async (p1Requested, p2Requested) => {
      const wl = realWaterLevelRef.current;
      const wlPct = wl ? wl.pct : null;
      let p1Final = p1Requested;
      let p2Final = p2Requested;

      if (p1Requested && wlPct !== null && wlPct >= 100) {
        p1Final = false;
        log(
          "⛔ Pump 1 blocked — tank is FULL (100%). Overflow prevention.",
          "warn",
        );
      }
      if (p2Requested && wlPct !== null && wlPct <= 0) {
        p2Final = false;
        log(
          "⛔ Pump 2 blocked — tank is EMPTY (0%). Dry-run prevention.",
          "warn",
        );
      }

      await writePumps(p1Final, p2Final);
    },
    [writePumps, log],
  );

  // ── Jitter ──────────────────────────────────────────────────────────────
  const stopJitter = useCallback(() => {
    if (jitterTimer.current) {
      clearInterval(jitterTimer.current);
      jitterTimer.current = null;
    }
  }, []);

  const startJitter = useCallback(() => {
    stopJitter();
    jitterTimer.current = setInterval(() => {
      if (!systemOnRef.current || animatingRef.current) return;
      const j = applyJitter(anchorRef.current);
      writeFake(j);
      setLiveVals({ ...j });
    }, 2000);
  }, [stopJitter, writeFake]);

  // ── Animation stop ──────────────────────────────────────────────────────
  const stopAnim = useCallback(() => {
    if (animTimer.current) {
      clearInterval(animTimer.current);
      animTimer.current = null;
    }
  }, []);

  // ── animateDanger — runs full 15 s to danger target, NO early exit ──────
  const animateDanger = useCallback(
    (from, to, durationMs) => {
      return new Promise((resolve) => {
        const steps = Math.max(Math.floor(durationMs / 2000), 1);
        const iv = durationMs / steps;
        let step = 0;

        animTimer.current = setInterval(() => {
          step++;
          const e = easeInOut(step / steps);
          const smooth = {};
          SENSORS.forEach((s) => {
            smooth[s.key] = from[s.key] + (to[s.key] - from[s.key]) * e;
          });

          const j = applyJitter(smooth);
          writeFake(j);
          setLiveVals({ ...j });
          SENSORS.forEach((s) => {
            anchorRef.current[s.key] = smooth[s.key];
          });
          setProgress((p) => ({
            ...p,
            danger: Math.round((step / steps) * 100),
          }));

          if (step >= steps) {
            clearInterval(animTimer.current);
            animTimer.current = null;
            SENSORS.forEach((s) => {
              anchorRef.current[s.key] = to[s.key];
            });
            setProgress((p) => ({ ...p, danger: 0 }));
            log("Danger target reached. Activating pumps now.", "err");
            resolve({ snapshot: { ...to } });
          }
        }, iv);
      });
    },
    [writeFake, log],
  );

  // ── animateRecover — runs full duration to recover target ───────────────
  const animateRecover = useCallback(
    (from, to, durationMs) => {
      return new Promise((resolve) => {
        const steps = Math.max(Math.floor(durationMs / 2000), 1);
        const iv = durationMs / steps;
        let step = 0;

        animTimer.current = setInterval(() => {
          step++;
          const e = easeInOut(step / steps);
          const smooth = {};
          SENSORS.forEach((s) => {
            smooth[s.key] = from[s.key] + (to[s.key] - from[s.key]) * e;
          });

          const j = applyJitter(smooth);
          writeFake(j);
          setLiveVals({ ...j });
          SENSORS.forEach((s) => {
            anchorRef.current[s.key] = smooth[s.key];
          });
          setProgress((p) => ({
            ...p,
            recover: Math.round((step / steps) * 100),
          }));

          if (step >= steps) {
            clearInterval(animTimer.current);
            animTimer.current = null;
            SENSORS.forEach((s) => {
              anchorRef.current[s.key] = to[s.key];
            });
            setProgress((p) => ({ ...p, recover: 0 }));
            log("Recovery target reached. Pumps stopping.", "ok");
            resolve();
          }
        }, iv);
      });
    },
    [writeFake, log],
  );

  // ── POWER TOGGLE ────────────────────────────────────────────────────────
  const togglePower = useCallback(async () => {
    if (!systemOn) {
      setSystemOn(true);
      await set(ref(db, "/demoMode"), true);
      const cur = profilesRef.current;
      SENSORS.forEach((s) => {
        anchorRef.current[s.key] = cur.normal[s.key];
      });
      writeFake(anchorRef.current);
      setLiveVals({ ...anchorRef.current });
      startJitter();
      setPhase("normal");
      log(
        "System ON — demoMode active. Live site reading /fake. Water level stays real.",
        "ok",
      );
    } else {
      stopAnim();
      stopJitter();
      setSystemOn(false);
      setAnimating(false);
      setPhase("idle");
      setProgress({ danger: 0, recover: 0 });
      setLiveVals(null);
      await set(ref(db, "/demoMode"), false);
      await update(ref(db, "/pumps"), { pump1: false, pump2: false });
      setPump1(false);
      setPump2(false);
      log("System OFF — live site back to real ESP32. Pumps cleared.", "warn");
    }
  }, [systemOn, writeFake, startJitter, stopJitter, stopAnim, log]);

  // ── SET NORMAL ──────────────────────────────────────────────────────────
  const runNormal = useCallback(async () => {
    if (!systemOn || animating) return;
    const cur = profilesRef.current;
    SENSORS.forEach((s) => {
      anchorRef.current[s.key] = cur.normal[s.key];
    });
    writeFake(anchorRef.current);
    setLiveVals({ ...anchorRef.current });
    if (!autoModeRef.current) {
      await update(ref(db, "/pumps"), { pump1: false, pump2: false });
      setPump1(false);
      setPump2(false);
    }
    setPhase("normal");
    log("Normal profile applied — jitter running around normal anchors.", "ok");
  }, [systemOn, animating, writeFake, log]);

  // ── START DANGER → PUMPS ON → RECOVER → PUMPS OFF ───────────────────────
  const runDanger = useCallback(async () => {
    if (!systemOn || animating) return;

    if (autoModeRef.current) {
      log(
        "⚠ Auto Mode is ON on live site — it may override pump commands during demo.",
        "warn",
      );
    }

    setAnimating(true);
    stopJitter();
    setPhase("rising");

    const cur = profilesRef.current;
    const fromVals = { ...anchorRef.current };
    const dangerVals = { ...cur.danger };
    const recoverVals = { ...cur.recover };

    log("Danger sequence — rising over 15 sec to danger targets...", "warn");

    // Step 1: animate from normal → danger over 15 seconds (always full duration)
    const { snapshot } = await animateDanger(fromVals, dangerVals, 15000);

    // Step 2: pumps ON now that danger target is fully reached
    if (!autoModeRef.current) {
      await safePumpWrite(true, true);
    } else {
      log(
        "Auto Mode ON — live site will control pumps based on TDS threshold.",
        "info",
      );
    }

    // Step 3: animate from danger → recover (pumps stay ON during this)
    setPhase("recovering");
    log(
      "Recovery started — values falling to recover targets over 45 sec...",
      "warn",
    );
    await animateRecover(snapshot, recoverVals, 45000);

    // Step 4: pumps OFF once recover target is reached
    if (!autoModeRef.current) {
      await writePumps(false, false);
    }

    setAnimating(false);
    setPhase("normal");
    startJitter();
    log("✓ Recovery complete. System stable — jitter resumed.", "ok");
  }, [
    systemOn,
    animating,
    stopJitter,
    startJitter,
    animateDanger,
    animateRecover,
    safePumpWrite,
    writePumps,
    log,
  ]);

  // ── Toggle autoMode ─────────────────────────────────────────────────────
  const toggleAutoMode = useCallback(async () => {
    await set(ref(db, "/autoMode"), !autoModeRef.current);
    log(
      `Auto Mode set to ${!autoModeRef.current ? "ON" : "OFF"} via Firebase.`,
      "info",
    );
  }, [log]);

  // ── Slider change ───────────────────────────────────────────────────────
  const handleSlider = useCallback((profile, key, rawVal, dec, int) => {
    const v = int ? Math.round(rawVal) : +Number(rawVal).toFixed(dec);
    setProfiles((prev) => {
      const next = { ...prev, [profile]: { ...prev[profile], [key]: v } };
      profilesRef.current = next;
      if (profile === "normal") anchorRef.current[key] = v;
      return next;
    });
  }, []);

  const thresholdPct = (sensor) => {
    const cfg = sensor.danger;
    if (sensor.key === "temp")
      return [Math.round(((32 - cfg.min) / (cfg.max - cfg.min)) * 100)];
    if (sensor.key === "tds")
      return [Math.round(((600 - cfg.min) / (cfg.max - cfg.min)) * 100)];
    if (sensor.key === "ph")
      return [
        Math.round(((6 - cfg.min) / (cfg.max - cfg.min)) * 100),
        Math.round(((9 - cfg.min) / (cfg.max - cfg.min)) * 100),
      ];
    return [];
  };

  // ── Water level color ───────────────────────────────────────────────────
  const waterLevelColor = (pct) => {
    if (pct >= 100) return "text-cyan-400";
    if (pct <= 0) return "text-red-400";
    if (pct < 30) return "text-orange-400";
    return "text-blue-400";
  };

  // ── Phase style ─────────────────────────────────────────────────────────
  const PHASE_STYLE = {
    idle: {
      label: "IDLE",
      cls: "text-slate-400 border-slate-600",
      dot: "bg-slate-500",
    },
    normal: {
      label: "NORMAL",
      cls: "text-emerald-400 border-emerald-600",
      dot: "bg-emerald-400 animate-pulse",
    },
    rising: {
      label: "RISING",
      cls: "text-red-400 border-red-600",
      dot: "bg-red-400 animate-pulse",
    },
    recovering: {
      label: "RECOVERING",
      cls: "text-amber-400 border-amber-600",
      dot: "bg-amber-400 animate-pulse",
    },
  };
  const phaseInfo = PHASE_STYLE[phase] || PHASE_STYLE.idle;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white font-mono pb-16">
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(56,189,248,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,.15) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-6 space-y-6">
        {/* ── HEADER ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Cpu className="text-sky-400" size={28} />
            <h1 className="text-2xl font-bold tracking-widest text-sky-300">
              AQUAGUARD ADMIN
            </h1>
          </div>
          <div
            className={`flex items-center gap-2 border rounded-full px-4 py-1 text-sm font-bold ${phaseInfo.cls}`}
          >
            <span className={`w-2 h-2 rounded-full ${phaseInfo.dot}`} />
            {phaseInfo.label}
          </div>
        </div>

        {/* ── POWER + AUTO MODE + WATER LEVEL ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Power */}
          <button
            onClick={togglePower}
            className={`flex items-center justify-center gap-3 rounded-xl py-5 font-bold text-lg border transition-all ${
              systemOn
                ? "bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30"
                : "bg-emerald-500/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30"
            }`}
          >
            <Power size={22} />
            {systemOn ? "POWER OFF" : "POWER ON"}
          </button>

          {/* Auto Mode */}
          <button
            onClick={toggleAutoMode}
            className={`flex items-center justify-center gap-3 rounded-xl py-5 font-bold text-lg border transition-all ${
              autoMode
                ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/30"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
            }`}
          >
            {autoMode ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
            AUTO MODE {autoMode ? "ON" : "OFF"}
          </button>

          {/* Real Water Level */}
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-5 py-4 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-2">
              <Waves size={16} className="text-blue-400" />
              <span className="text-xs text-slate-400 uppercase tracking-wider">
                Tank Level (Real ESP32)
              </span>
            </div>
            {realWaterLevel ? (
              <>
                <div
                  className={`text-3xl font-bold ${waterLevelColor(realWaterLevel.pct)}`}
                >
                  {realWaterLevel.pct}%
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {realWaterLevel.cm} cm from sensor
                  {realWaterLevel.pct >= 100 && (
                    <span className="ml-2 text-cyan-400 font-bold">● FULL</span>
                  )}
                  {realWaterLevel.pct <= 0 && (
                    <span className="ml-2 text-red-400 font-bold">● EMPTY</span>
                  )}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      realWaterLevel.pct >= 100
                        ? "bg-cyan-400"
                        : realWaterLevel.pct <= 0
                          ? "bg-red-500"
                          : realWaterLevel.pct < 30
                            ? "bg-orange-400"
                            : "bg-blue-500"
                    }`}
                    style={{ width: `${realWaterLevel.pct}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="text-slate-500 text-sm">Waiting for ESP32…</div>
            )}
          </div>
        </div>

        {/* ── PUMP SAFETY NOTICE ── */}
        {realWaterLevel &&
          (realWaterLevel.pct >= 100 || realWaterLevel.pct <= 0) && (
            <div
              className={`rounded-xl border px-5 py-3 text-sm font-bold flex items-center gap-3 ${
                realWaterLevel.pct >= 100
                  ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-300"
                  : "bg-red-500/10 border-red-500/40 text-red-300"
              }`}
            >
              <AlertTriangle size={18} />
              {realWaterLevel.pct >= 100
                ? "Tank FULL — Pump 1 (water-in) is locked out to prevent overflow."
                : "Tank EMPTY — Pump 2 (water-out) is locked out to prevent dry-run damage."}
            </div>
          )}

        {/* ── DEMO SEQUENCE BUTTONS ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={runNormal}
            disabled={!systemOn || animating}
            className={`rounded-xl py-4 font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${THEME.normal.btn} ${THEME.normal.border}`}
          >
            ▶ SET NORMAL
          </button>
          <button
            onClick={runDanger}
            disabled={!systemOn || animating}
            className={`rounded-xl py-4 font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${THEME.danger.btn} ${THEME.danger.border}`}
          >
            ⚠ START DANGER
          </button>
          <button
            onClick={() => {
              stopAnim();
              stopJitter();
              setAnimating(false);
              setProgress({ danger: 0, recover: 0 });
              log("Animation manually stopped.", "warn");
            }}
            disabled={!animating}
            className="rounded-xl py-4 font-bold border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ■ STOP ANIM
          </button>
        </div>

        {/* ── PROGRESS BARS ── */}
        {(progress.danger > 0 || progress.recover > 0) && (
          <div className="space-y-2">
            {progress.danger > 0 && (
              <div>
                <div className="text-xs text-red-400 mb-1 flex justify-between">
                  <span>DANGER RISE</span>
                  <span>{progress.danger}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full transition-all"
                    style={{ width: `${progress.danger}%` }}
                  />
                </div>
              </div>
            )}
            {progress.recover > 0 && (
              <div>
                <div className="text-xs text-amber-400 mb-1 flex justify-between">
                  <span>RECOVERY</span>
                  <span>{progress.recover}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all"
                    style={{ width: `${progress.recover}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE VALUES ── */}
        {systemOn && liveVals && (
          <div className="grid grid-cols-3 gap-4">
            {SENSORS.map((s) => {
              const c = SENSOR_COLOR[s.color];
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className={`rounded-xl border ${c.border} ${c.bg} p-4 text-center`}
                >
                  <Icon size={18} className={`${c.text} mx-auto mb-1`} />
                  <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                  <div className={`text-2xl font-bold ${c.text}`}>
                    {fmt(liveVals[s.key], s.dec, s.int)}
                    <span className="text-sm ml-1 text-slate-400">
                      {s.unit}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── PUMP CONTROLS ── */}
        <div className="grid grid-cols-2 gap-4">
          {[
            {
              id: "pump1",
              state: pump1,
              label: "Pump 1 — Water IN",
              desc: "Blocked when tank is 100% full",
              blockedWhen: realWaterLevel?.pct >= 100,
              onColor: "bg-cyan-600 border-cyan-500 text-white",
              offColor: "bg-slate-800 border-slate-600 text-slate-300",
            },
            {
              id: "pump2",
              state: pump2,
              label: "Pump 2 — Water OUT",
              desc: "Blocked when tank is 0% empty",
              blockedWhen: realWaterLevel?.pct <= 0,
              onColor: "bg-blue-600 border-blue-500 text-white",
              offColor: "bg-slate-800 border-slate-600 text-slate-300",
            },
          ].map((pump) => (
            <button
              key={pump.id}
              disabled={autoMode || pump.blockedWhen}
              onClick={() =>
                safePumpWrite(
                  pump.id === "pump1" ? !pump1 : pump1,
                  pump.id === "pump2" ? !pump2 : pump2,
                )
              }
              className={`rounded-xl py-4 px-5 font-bold border transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed ${
                pump.state ? pump.onColor : pump.offColor
              }`}
            >
              <div className="text-sm">{pump.label}</div>
              <div className="text-xs font-normal mt-1 opacity-70">
                {pump.blockedWhen
                  ? `🔒 ${pump.desc}`
                  : pump.state
                    ? "● RUNNING"
                    : "○ STOPPED"}
              </div>
            </button>
          ))}
        </div>

        {/* ── PROFILE SLIDERS ── */}
        {["normal", "danger", "recover"].map((profile) => {
          const T = THEME[profile];
          return (
            <div
              key={profile}
              className={`rounded-2xl border ${T.border} ${T.bg} p-5 ring-1 ${T.ring}`}
            >
              <div className="flex items-center gap-2 mb-4">
                <span className={`w-2 h-2 rounded-full ${T.dot}`} />
                <h3
                  className={`font-bold uppercase tracking-widest text-sm ${T.text}`}
                >
                  {profile} profile
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {SENSORS.map((s) => {
                  const cfg = s[profile];
                  const val = profiles[profile][s.key];
                  const pct = thresholdPct(s);
                  const c = SENSOR_COLOR[s.color];
                  const Icon = s.icon;
                  return (
                    <div key={s.key}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <Icon size={14} className={c.text} />
                          <span className="text-xs text-slate-400">
                            {s.label}
                          </span>
                        </div>
                        <span className={`text-sm font-bold ${c.text}`}>
                          {fmt(val, s.dec, s.int)} {s.unit}
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min={cfg.min}
                          max={cfg.max}
                          step={cfg.step}
                          value={val}
                          onChange={(e) =>
                            handleSlider(
                              profile,
                              s.key,
                              +e.target.value,
                              s.dec,
                              s.int,
                            )
                          }
                          className="w-full accent-current"
                          style={{ accentColor: c.thumb }}
                        />
                        {profile === "danger" &&
                          pct.map((p, idx) => (
                            <div
                              key={idx}
                              className="absolute top-0 h-full flex items-center pointer-events-none"
                              style={{ left: `${p}%` }}
                            >
                              <div
                                className="w-0.5 h-4 bg-red-400 opacity-80 rounded"
                                title="Danger threshold"
                              />
                            </div>
                          ))}
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                        <span>{cfg.min}</span>
                        <span>{cfg.max}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* ── LOG ── */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-slate-400" />
            <span className="text-xs text-slate-400 uppercase tracking-wider">
              Event Log
            </span>
          </div>
          <div className="space-y-1 max-h-52 overflow-y-auto text-xs font-mono">
            {[...logs].reverse().map((l) => (
              <div
                key={l.id}
                className={`flex gap-3 ${
                  l.type === "err"
                    ? "text-red-400"
                    : l.type === "ok"
                      ? "text-emerald-400"
                      : l.type === "warn"
                        ? "text-amber-400"
                        : "text-slate-400"
                }`}
              >
                <span className="text-slate-600 shrink-0">{l.time}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
