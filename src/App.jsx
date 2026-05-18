import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, onValue, set, query, limitToLast } from "firebase/database";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Droplets,
  Thermometer,
  Activity,
  Fish,
  Wifi,
  Waves,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ArrowDownCircle,
  ArrowUpCircle,
  Cpu,
  Settings2,
  LineChart as ChartIcon,
  Sparkles,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// WATER LEVEL CALCULATION
// Distance ≥ 30 cm → 0%  (tank empty)
// Distance ≤ 16 cm → 100% (tank full)
// Linear scale between 16–30 cm
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

const Dashboard = () => {
  const [currentData, setCurrentData] = useState({
    waterLevel: { value: 0, cm: 0 },
    ph: { value: 0 },
    temp: { value: 0 },
    tds: { value: 0 },
  });

  const [pumps, setPumps] = useState({ pump1: false, pump2: false });
  const [historyData, setHistoryData] = useState([]);
  const [isFeeding, setIsFeeding] = useState(false);

  // autoMode is now synced from Firebase — admin writes it
  const [autoMode, setAutoMode] = useState(false);

  const [demoMode, setDemoMode] = useState(false);

  // 1. Firebase demoMode listener
  useEffect(() => {
    const demoRef = ref(db, "demoMode");
    const unsub = onValue(demoRef, (snap) => {
      setDemoMode(snap.val() || false);
    });
    return () => unsub();
  }, []);

  // 2. Firebase autoMode listener (two-way sync with admin)
  useEffect(() => {
    const autoRef = ref(db, "autoMode");
    const unsub = onValue(autoRef, (snap) => {
      setAutoMode(snap.val() || false);
    });
    return () => unsub();
  }, []);

  // 3. Sensor data (ph, temp, tds only) — switches between /fake and /sensor based on demoMode
  //    waterLevel is intentionally excluded here — handled by the dedicated listener below
  useEffect(() => {
    const targetNode = demoMode ? "fake" : "sensor";
    const sensorRef = ref(db, targetNode);

    const unsub = onValue(sensorRef, (snap) => {
      const data = snap.val();
      if (data) {
        setCurrentData((prev) => ({
          ...prev,
          // waterLevel deliberately excluded — real sensor listener below always wins
          ph: { value: data.ph ? parseFloat(data.ph).toFixed(2) : 0 },
          temp: { value: data.temp ? parseFloat(data.temp).toFixed(1) : 0 },
          tds: { value: data.tds || 0 },
        }));
      }
    });

    return () => unsub();
  }, [demoMode]);

  // 4. Water level — ALWAYS from real /sensor, uses new 16–30 cm scale
  useEffect(() => {
    const realRef = ref(db, "sensor");
    const unsub = onValue(realRef, (snap) => {
      const data = snap.val();
      if (data && data.waterLevel !== undefined) {
        const { pct, cm } = calcWaterLevel(data.waterLevel);
        setCurrentData((prev) => ({
          ...prev,
          waterLevel: { value: pct, cm },
        }));
      }
    });
    return () => unsub();
  }, []); // no dependency — always runs regardless of demoMode

  // 5. Pumps & history
  useEffect(() => {
    const pumpsRef = ref(db, "pumps");
    const unsubPumps = onValue(pumpsRef, (snap) => {
      const data = snap.val();
      if (data) {
        setPumps({ pump1: data.pump1 || false, pump2: data.pump2 || false });
      }
    });

    const historyRef = query(ref(db, "history"), limitToLast(20));
    const unsubHistory = onValue(historyRef, (snap) => {
      const data = snap.val();
      if (data) {
        const formattedData = Object.values(data).map((item) => {
          const dateObj = new Date(item.timestamp);
          const timeString = dateObj.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          });
          return {
            time: timeString,
            temp: item.temp ? parseFloat(item.temp).toFixed(1) : 0,
            ph: item.ph ? parseFloat(item.ph).toFixed(2) : 0,
			tds: item.tds || 0,
            level: item.level || 0,
          };
        });
        setHistoryData(formattedData);
      }
    });

    return () => {
      unsubPumps();
      unsubHistory();
    };
  }, []);

  // NOTE: TDS auto-pump useEffect removed — admin panel owns pump logic via Firebase

  const togglePump = async (pumpName) => {
    const newState = !pumps[pumpName];
    await set(ref(db, `pumps/${pumpName}`), newState);
  };

  const handleFeed = async () => {
    setIsFeeding(true);
    try {
      await set(ref(db, "servoTrigger"), true);
      setTimeout(async () => {
        await set(ref(db, "servoTrigger"), false);
        setIsFeeding(false);
      }, 3000);
    } catch (error) {
      console.error("Error triggering servo:", error);
      setIsFeeding(false);
    }
  };

  const calculateHealth = () => {
    let score = 100;
    let issues = [];
    const { ph, temp, tds, waterLevel } = currentData;

    if (ph.value < 6.5 || ph.value > 8.5) {
      score -= 20;
      issues.push("পানির পিএইচ (pH) মাত্রা মাছের জন্য ঠিক নেই");
    }
    if (temp.value < 22 || temp.value > 35) {
      score -= 20;
      issues.push("পানির তাপমাত্রা স্বাভাবিকের চেয়ে ভিন্ন");
    }
    if (tds.value > 800) {
      score -= 15;
      issues.push("পানিতে ময়লার পরিমাণ (TDS) বেশি, পানি বদলানো প্রয়োজন");
    }
    if (waterLevel.value < 30) {
      score -= 15;
      issues.push("ট্যাংকে পানির পরিমাণ খুব কমে গেছে");
    }

    let status = "মাছের পরিবেশ খুব ভালো আছে";
    let color = "text-green-400";
    let icon = <CheckCircle2 size={36} className="text-green-400" />;

    if (score < 75) {
      status = "সতর্কতা প্রয়োজন! পরিবেশ কিছুটা খারাপ";
      color = "text-orange-400";
      icon = <AlertCircle size={36} className="text-orange-400" />;
    }
    if (score < 50) {
      status = "বিপজ্জনক অবস্থা! দ্রুত ব্যবস্থা নিন";
      color = "text-red-400";
      icon = <AlertCircle size={36} className="text-red-400" />;
    }

    return { issues, status, color, icon };
  };

  const health = calculateHealth();

  return (
    <div className="min-h-screen relative font-sans text-white pb-10">
      <div className="fixed inset-0 z-0">
        <img
          src="https://www.scidev.net/asia-pacific/wp-content/uploads/sites/4/bangla_fish_Main2.jpg"
          alt="Fish Farm Background"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/30"></div>
      </div>

      <div className="relative z-10 p-3 sm:p-6 lg:p-8 max-w-screen-xl mx-auto">
        {/* Header */}
        <header className="bg-black/60 backdrop-blur-lg rounded-2xl p-5 mb-6 shadow-2xl border border-white/20 flex flex-col lg:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-blue-500/20 p-3 rounded-full border border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)]">
              <ShieldCheck size={36} />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-200 drop-shadow-lg">
                অ্যাকোয়াশিল্ড
              </h1>
              <p className="text-gray-200 text-sm font-medium tracking-wider">
                আধুনিক মাছ চাষের স্মার্ট সিস্টেম
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-center">
            <div className="flex items-center gap-2 bg-black/60 px-4 py-2.5 rounded-xl border border-blue-500/30 shadow-md">
              <Cpu size={20} className="text-blue-400 animate-pulse" />
              <span className="text-blue-100 font-bold text-sm">
                ESP32 কানেক্টেড
              </span>
            </div>
            <div className="flex items-center gap-2 bg-black/60 px-4 py-2.5 rounded-xl border border-green-500/30 shadow-md">
              <Wifi size={20} className="text-green-400 animate-pulse" />
              <span className="text-green-100 font-bold text-sm">
                অনলাইন সিস্টেম চালু
              </span>
            </div>
          </div>
        </header>

        {/* Tank Health Status */}
        <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-6 mb-6 shadow-2xl border border-white/20">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="bg-black/60 p-4 rounded-full shadow-inner border border-white/10">
              {health.icon}
            </div>
            <div>
              <h2 className="text-xl text-gray-200 font-semibold">
                প্রজেক্টের বর্তমান অবস্থা:
              </h2>
              <h3
                className={`text-2xl sm:text-3xl font-bold drop-shadow-lg mt-1 ${health.color}`}
              >
                {health.status}
              </h3>
            </div>
          </div>

          {health.issues.length > 0 && (
            <div className="mt-5 bg-red-900/60 border border-red-500/50 backdrop-blur-md rounded-xl p-5 shadow-inner">
              <p className="text-red-300 font-bold mb-3 text-xl border-b border-red-500/30 pb-2">
                যে সমস্যাগুলো দ্রুত সমাধান করা দরকার:
              </p>
              <ul className="list-disc list-inside space-y-2">
                {health.issues.map((issue, i) => (
                  <li key={i} className="text-red-100 font-semibold text-lg">
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Sensor Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 text-center flex flex-col items-center hover:bg-black/80 transition-all">
            <div className="bg-blue-500/20 p-4 rounded-full border border-blue-500/40 mb-3 text-blue-400">
              <Waves size={32} />
            </div>
            <p className="text-gray-200 text-base font-bold mb-1">
              পানির পরিমাণ
            </p>
            <div className="flex items-baseline gap-1">
              <h2 className="text-4xl font-extrabold text-white">
                {currentData.waterLevel.value}
              </h2>
              <span className="text-blue-300 font-bold text-xl">%</span>
            </div>
          </div>

          <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 text-center flex flex-col items-center hover:bg-black/80 transition-all">
            <div className="bg-purple-500/20 p-4 rounded-full border border-purple-500/40 mb-3 text-purple-400">
              <Activity size={32} />
            </div>
            <p className="text-gray-200 text-base font-bold mb-1">
              পানির গুণমান (pH)
            </p>
            <h2 className="text-4xl font-extrabold text-white">
              {currentData.ph.value}
            </h2>
          </div>

          <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 text-center flex flex-col items-center hover:bg-black/80 transition-all">
            <div className="bg-orange-500/20 p-4 rounded-full border border-orange-500/40 mb-3 text-orange-400">
              <Thermometer size={32} />
            </div>
            <p className="text-gray-200 text-base font-bold mb-1">তাপমাত্রা</p>
            <div className="flex items-baseline gap-1">
              <h2 className="text-4xl font-extrabold text-white">
                {currentData.temp.value}
              </h2>
              <span className="text-orange-400 font-bold text-2xl">°C</span>
            </div>
          </div>

          <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-6 shadow-xl border border-white/20 text-center flex flex-col items-center hover:bg-black/80 transition-all relative">
            {autoMode && currentData.tds.value > 800 && (
              <span className="absolute -top-3 -right-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-bounce">
                অটো চেঞ্জ চালু!
              </span>
            )}
            <div className="bg-teal-500/20 p-4 rounded-full border border-teal-500/40 mb-3 text-teal-400">
              <Droplets size={32} />
            </div>
            <p className="text-gray-200 text-base font-bold mb-1">
              পানিতে ময়লা (TDS)
            </p>
            <div className="flex items-baseline gap-1">
              <h2 className="text-4xl font-extrabold text-white">
                {currentData.tds.value}
              </h2>
              <span className="text-teal-400 font-bold text-xl ml-1">ppm</span>
            </div>
          </div>
        </div>

        {/* History Graph */}
        <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-5 lg:p-7 shadow-2xl border border-white/20 mb-6">
          <h3 className="text-2xl font-bold text-white mb-6 border-b border-white/20 pb-3 flex items-center gap-3">
            <ChartIcon size={28} className="text-purple-400" />
            সেন্সরের হিস্ট্রি গ্রাফ (তাপমাত্রা ও pH)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={historyData}
                margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#fb923c"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#c084fc"
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    borderColor: "#374151",
                    color: "#fff",
                    borderRadius: "8px",
                  }}
                  itemStyle={{ fontWeight: "bold" }}
                />
                <Legend wrapperStyle={{ paddingTop: "10px" }} />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="temp"
                  stroke="#fb923c"
                  strokeWidth={3}
                  name="তাপমাত্রা (°C)"
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="ph"
                  stroke="#c084fc"
                  strokeWidth={3}
                  name="pH লেভেল"
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
				 <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="ph"
                  stroke="#c084fc"
                  strokeWidth={3}
                  name="pH লেভেল"
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
				 <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="tds"
                  stroke="#10b981"
                  strokeWidth={3}
                  name="TDS লেভেল"
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pump Controls */}
          <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-7 shadow-2xl border border-white/20">
            <h3 className="text-2xl font-bold text-white mb-6 border-b border-white/20 pb-3 flex items-center gap-3">
              <Cpu size={28} className="text-blue-400" />
              পাম্প ও মোটর নিয়ন্ত্রণ
            </h3>

            {/* Smart Auto Mode Banner */}
            <div className="bg-indigo-900/40 border border-indigo-500/40 p-5 rounded-2xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-inner">
              <div className="flex items-start gap-3">
                <Settings2
                  className={`text-indigo-400 mt-1 ${autoMode ? "animate-spin-slow" : ""}`}
                  size={24}
                />
                <div>
                  <h4 className="text-lg font-bold text-indigo-200">
                    স্মার্ট অটো-ওয়াটার চেঞ্জ
                  </h4>
                  <p className="text-sm text-indigo-100/80 mt-1">
                    অন থাকলে: পানিতে ময়লার পরিমাণ (TDS) বেড়ে গেলে সিস্টেম নিজে
                    থেকেই পাম্পগুলো কন্ট্রোল করবে।
                  </p>
                </div>
              </div>
              <button
                onClick={async () => {
                  await set(ref(db, "autoMode"), !autoMode);
                  // State updates via Firebase listener above
                }}
                className={`px-6 py-2 rounded-xl font-bold text-white shadow-lg transition-all whitespace-nowrap border ${autoMode ? "bg-green-500/90 hover:bg-green-600 border-green-400 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-gray-600/90 hover:bg-gray-500 border-gray-400"}`}
              >
                {autoMode ? "অটো চালু" : "অটো বন্ধ"}
              </button>
            </div>

            <div className="space-y-5">
              {/* Pump 1 */}
              <div
                className={`flex flex-col sm:flex-row justify-between items-center bg-black/50 p-5 rounded-2xl border ${pumps.pump1 ? "border-cyan-500/50" : "border-white/10"} hover:bg-black/70 transition-all gap-4`}
              >
                <div className="flex items-center gap-4 text-center sm:text-left">
                  <div
                    className={`p-4 rounded-full border ${pumps.pump1 ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/50 shadow-[0_0_20px_rgba(34,211,238,0.4)]" : "bg-white/5 text-gray-400 border-white/10"}`}
                  >
                    <ArrowDownCircle
                      size={32}
                      className={pumps.pump1 ? "animate-bounce" : ""}
                    />
                  </div>
                  <div>
                    <p className="font-bold text-white text-xl">
                      নতুন পানি দেওয়ার পাম্প
                    </p>
                    <p className="text-sm text-cyan-200 mt-1">
                      ফ্রেশ পানি ট্যাংকে প্রবেশ করবে
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => togglePump("pump1")}
                  disabled={autoMode}
                  className={`w-full sm:w-auto px-8 py-4 rounded-xl font-bold text-white shadow-xl transition-all text-lg border disabled:opacity-50 disabled:cursor-not-allowed ${pumps.pump1 ? "bg-red-500/90 hover:bg-red-600 border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.5)]" : "bg-cyan-600/90 hover:bg-cyan-500 border-cyan-400"}`}
                >
                  {pumps.pump1 ? "বন্ধ করুন" : "চালু করুন"}
                </button>
              </div>

              {/* Pump 2 */}
              <div
                className={`flex flex-col sm:flex-row justify-between items-center bg-black/50 p-5 rounded-2xl border ${pumps.pump2 ? "border-blue-500/50" : "border-white/10"} hover:bg-black/70 transition-all gap-4`}
              >
                <div className="flex items-center gap-4 text-center sm:text-left">
                  <div
                    className={`p-4 rounded-full border ${pumps.pump2 ? "bg-blue-500/20 text-blue-400 border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-white/5 text-gray-400 border-white/10"}`}
                  >
                    <ArrowUpCircle
                      size={32}
                      className={pumps.pump2 ? "animate-bounce" : ""}
                    />
                  </div>
                  <div>
                    <p className="font-bold text-white text-xl">
                      ময়লা পানি ফেলার পাম্প
                    </p>
                    <p className="text-sm text-blue-200 mt-1">
                      ট্যাংক থেকে দূষিত পানি বের করে দিবে
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => togglePump("pump2")}
                  disabled={autoMode}
                  className={`w-full sm:w-auto px-8 py-4 rounded-xl font-bold text-white shadow-xl transition-all text-lg border disabled:opacity-50 disabled:cursor-not-allowed ${pumps.pump2 ? "bg-red-500/90 hover:bg-red-600 border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.5)]" : "bg-blue-600/90 hover:bg-blue-500 border-blue-400"}`}
                >
                  {pumps.pump2 ? "বন্ধ করুন" : "চালু করুন"}
                </button>
              </div>
            </div>
          </div>

          {/* Feeder */}
          <div className="bg-black/60 backdrop-blur-lg rounded-2xl p-7 shadow-2xl flex flex-col justify-center border border-white/20">
            <div className="text-center mb-8">
              <div className="bg-orange-500/20 p-5 rounded-full inline-block border border-orange-500/40 text-orange-400 shadow-[0_0_30px_rgba(249,115,22,0.3)] mb-5">
                <Fish size={48} />
              </div>
              <h3 className="text-3xl font-bold text-white drop-shadow-md">
                স্মার্ট অটো ফিডার
              </h3>
              <p className="text-gray-300 mt-3 text-lg">
                নিচের বাটনে চাপ দিলে অটোমেটিক ট্যাংকে খাবার পড়বে
              </p>
            </div>

            <button
              onClick={handleFeed}
              disabled={isFeeding}
              className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:from-gray-700 disabled:to-gray-800 text-white font-bold text-2xl py-6 rounded-2xl shadow-[0_0_25px_rgba(249,115,22,0.5)] flex justify-center items-center gap-4 transition-all border border-orange-300/50"
            >
              {isFeeding ? (
                <>
                  <Loader2 size={32} className="animate-spin" />
                  খাবার দেওয়া হচ্ছে...
                </>
              ) : (
                <>
                  <Fish size={32} />
                  এখনই খাবার দিন
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
