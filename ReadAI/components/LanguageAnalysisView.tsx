import React, { useState, useEffect } from 'react';
import { TrendingUp, AlertCircle, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Recording, MetricsHistoryPoint, SlangEntry, RecurringCorrection } from '../types';
import { apiService } from '../services/apiService';

interface Props {
  recording: Recording;
}

// ─── Score Card ──────────────────────────────────────────────────────────────

const ScoreCard: React.FC<{ label: string; value: number | string; unit?: string; accent?: string }> = ({
  label, value, unit, accent = 'text-indigo-400',
}) => (
  <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-2xl p-5 flex flex-col gap-1">
    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">{label}</span>
    <span className={`text-3xl font-black ${accent}`}>
      {value}<span className="text-base font-bold text-zinc-600 ml-1">{unit}</span>
    </span>
  </div>
);

// ─── Inline SVG line chart ────────────────────────────────────────────────────

const LineChart: React.FC<{ data: number[]; label: string; color?: string; isStreak?: boolean }> = ({
  data, label, color = '#6366f1', isStreak = false,
}) => {
  if (data.length < 2) return null;

  const W = 260;
  const H = 60;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x},${y}`;
  });

  const polyline = points.join(' ');

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/40 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</span>
        {isStreak && (
          <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
            On a streak
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <polyline
          points={polyline}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.8"
        />
        {data.map((v, i) => {
          const [x, y] = points[i].split(',').map(Number);
          return (
            <circle key={i} cx={x} cy={y} r="2.5" fill={color} opacity="0.9" />
          );
        })}
      </svg>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-zinc-700">{data[data.length - 1]?.toFixed(2)}</span>
        <span className="text-[9px] text-zinc-700">latest</span>
      </div>
    </div>
  );
};

// ─── Helper: detect 3-session streak (improving) ─────────────────────────────

function hasStreak(data: number[], higherIsBetter: boolean): boolean {
  if (data.length < 3) return false;
  const last3 = data.slice(-3);
  return higherIsBetter
    ? last3[0] < last3[1] && last3[1] < last3[2]
    : last3[0] > last3[1] && last3[1] > last3[2];
}

// ─── Tab 1 — This Session ────────────────────────────────────────────────────

const ThisSessionTab: React.FC<{ recording: Recording }> = ({ recording }) => {
  const a = recording.languageAnalysis!;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  return (
    <div className="space-y-10">
      {/* Score cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ScoreCard label="Overall" value={a.overallScore?.toFixed(1) ?? '—'} unit="/10" accent="text-indigo-400" />
        <ScoreCard label="Fluency" value={a.fluencyScore?.toFixed(1) ?? '—'} unit="/10" accent="text-violet-400" />
        <ScoreCard label="Naturalness" value={a.naturalnessScore?.toFixed(1) ?? '—'} unit="/10" accent="text-sky-400" />
        <ScoreCard label="Filler Words" value={a.fillerRate?.toFixed(1) ?? '—'} unit="/min" accent="text-amber-400" />
      </div>

      {/* Corrections table */}
      {a.corrections.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-5 bg-amber-500 rounded-full" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Corrections</h3>
          </div>
          <div className="rounded-2xl border border-zinc-800/60 overflow-hidden">
            {/* Header */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_1.5fr_80px_80px] gap-4 px-5 py-3 bg-zinc-900/60 border-b border-zinc-800/60">
              {['What you said', 'Say this instead', 'Why', 'Register', 'Recurring?'].map(h => (
                <span key={h} className="text-[8px] font-black uppercase tracking-widest text-zinc-600">{h}</span>
              ))}
            </div>
            {a.corrections.map((c, i) => (
              <div key={i} className="border-b border-zinc-800/40 last:border-0">
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                >
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.5fr_80px_80px] gap-2 md:gap-4 px-5 py-4 hover:bg-zinc-900/30 transition-colors">
                    <span className="text-zinc-300 text-xs font-bold">"{c.whatWasSaid}"</span>
                    <span className="text-emerald-400 text-xs font-bold">"{c.whatToSay}"</span>
                    <span className="text-zinc-500 text-xs">{c.why}</span>
                    <span className="text-zinc-600 text-[10px] font-bold uppercase tracking-wider">{c.register}</span>
                    <span>
                      {c.isRecurring ? (
                        <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 rounded-full">
                          Recurring
                        </span>
                      ) : (
                        <span className="text-zinc-700 text-[10px]">—</span>
                      )}
                    </span>
                  </div>
                </button>
                {expandedRow === i && c.contextSentence && (
                  <div className="px-5 pb-4 pt-1 bg-zinc-900/20 border-t border-zinc-800/30">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mr-2">Context:</span>
                    <span className="text-zinc-400 text-xs italic">"{c.contextSentence}"</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session feedback */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1 h-5 bg-emerald-500 rounded-full" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Session Feedback</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-2xl p-5">
            <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 block mb-4">Strengths</span>
            <ul className="space-y-3">
              {a.strengths.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-zinc-300">
                  <span className="mt-2 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-5">
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 block mb-4">Focus Areas</span>
            <ul className="space-y-3">
              {a.focusAreas.map((f, i) => (
                <li key={i} className="flex gap-3 text-sm text-zinc-300">
                  <span className="mt-2 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {a.progressVsLastSession && (
          <div className="bg-zinc-900/30 border border-zinc-800/40 rounded-2xl p-5">
            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 block mb-3">Progress vs Last Session</span>
            <p className="text-zinc-400 text-sm leading-relaxed">{a.progressVsLastSession}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Tab 2 — Progress ─────────────────────────────────────────────────────────

const ProgressTab: React.FC = () => {
  const [history, setHistory] = useState<MetricsHistoryPoint[]>([]);
  const [recurring, setRecurring] = useState<RecurringCorrection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiService.getMetricsHistory(), apiService.getRecurringCorrections()])
      .then(([h, r]) => { setHistory(h.reverse()); setRecurring(r); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (history.length < 2) {
    return (
      <div className="py-24 text-center">
        <TrendingUp size={32} className="text-zinc-700 mx-auto mb-4" />
        <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest">Need at least 2 sessions to show progress</p>
      </div>
    );
  }

  const charts: { key: keyof MetricsHistoryPoint; label: string; higherIsBetter: boolean; color: string }[] = [
    { key: 'overall_score',       label: 'Overall Score',       higherIsBetter: true,  color: '#6366f1' },
    { key: 'fluency_score',       label: 'Fluency Score',       higherIsBetter: true,  color: '#a78bfa' },
    { key: 'naturalness_score',   label: 'Naturalness Score',   higherIsBetter: true,  color: '#38bdf8' },
    { key: 'filler_rate',         label: 'Filler Rate /min',    higherIsBetter: false, color: '#fbbf24' },
    { key: 'vocabulary_richness', label: 'Vocab Richness',      higherIsBetter: true,  color: '#34d399' },
    { key: 'slang_count',         label: 'Slang Count',         higherIsBetter: true,  color: '#f472b6' },
  ];

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {charts.map(({ key, label, higherIsBetter, color }) => {
          const data = history.map(h => Number(h[key] ?? 0));
          return (
            <LineChart
              key={key}
              data={data}
              label={label}
              color={color}
              isStreak={hasStreak(data, higherIsBetter)}
            />
          );
        })}
      </div>

      {recurring.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <AlertCircle size={14} className="text-red-400" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Watch List — Recurring Mistakes</h3>
          </div>
          <div className="space-y-3">
            {recurring.map((r, i) => (
              <div key={i} className="bg-red-500/5 border border-red-500/15 rounded-2xl px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-zinc-300 text-xs font-bold block mb-1">"{r.what_was_said}"</span>
                    <span className="text-emerald-400 text-xs">→ "{r.what_to_say}"</span>
                  </div>
                  <span className="px-2 py-0.5 text-[8px] font-black uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 rounded-full shrink-0">
                    {r.session_count}× sessions
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Tab 3 — Phrase Bank ──────────────────────────────────────────────────────

const PhraseBankTab: React.FC = () => {
  const [slang, setSlang] = useState<SlangEntry[]>([]);
  const [allCorrections, setAllCorrections] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiService.getSlangBank(),
      fetch(`${(import.meta as any).env?.VITE_API_URL}/api/sessions`)
        .then(r => r.json())
        .then(async (sessions: any[]) => {
          const details = await Promise.all(
            sessions.slice(0, 20).map((s: any) =>
              fetch(`${(import.meta as any).env?.VITE_API_URL}/api/sessions/${s.id}`)
                .then(r => r.json())
            )
          );
          return details.flatMap((d: any) =>
            (d.corrections || []).map((c: any) => ({
              ...c,
              session_date: d.session?.session_date ?? '',
            }))
          );
        }),
    ])
      .then(([s, c]) => { setSlang(s); setAllCorrections(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const filteredCorrections = allCorrections.filter(c =>
    !search ||
    c.what_was_said?.toLowerCase().includes(search.toLowerCase()) ||
    c.what_to_say?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-12">
      {/* Slang bank */}
      {slang.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-5 bg-pink-500 rounded-full" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Slang I've Used</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {slang.map(s => (
              <div key={s.id} className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-4">
                <span className="text-zinc-100 text-sm font-black block mb-1">"{s.term}"</span>
                <span className="text-zinc-600 text-[9px] font-bold uppercase tracking-wider block mb-2">
                  First used {s.first_used_date} · {s.use_count}×
                </span>
                {s.example_sentence && (
                  <p className="text-zinc-500 text-[10px] italic leading-relaxed line-clamp-2">"{s.example_sentence}"</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Corrections library */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-1 h-5 bg-violet-500 rounded-full" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">Corrections Library</h3>
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="bg-zinc-900/50 border border-zinc-800 rounded-xl py-1.5 pl-8 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500/30 placeholder:text-zinc-700"
            />
          </div>
        </div>
        {filteredCorrections.length === 0 ? (
          <p className="text-zinc-700 text-[10px] font-bold uppercase tracking-widest py-8 text-center">No corrections yet</p>
        ) : (
          <div className="rounded-2xl border border-zinc-800/60 overflow-hidden">
            <div className="hidden md:grid grid-cols-[100px_1fr_1fr_80px] gap-4 px-5 py-3 bg-zinc-900/60 border-b border-zinc-800/60">
              {['Date', 'What was said', 'Better version', 'Register'].map(h => (
                <span key={h} className="text-[8px] font-black uppercase tracking-widest text-zinc-600">{h}</span>
              ))}
            </div>
            {filteredCorrections.map((c, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[100px_1fr_1fr_80px] gap-2 md:gap-4 px-5 py-3.5 border-b border-zinc-800/30 last:border-0 hover:bg-zinc-900/20 transition-colors">
                <span className="text-zinc-600 text-[10px] font-bold">{c.session_date}</span>
                <span className="text-zinc-300 text-xs">"{c.what_was_said}"</span>
                <span className="text-emerald-400 text-xs">"{c.what_to_say}"</span>
                <span className="text-zinc-600 text-[10px] font-bold uppercase tracking-wider">{c.register}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const TABS = ['This Session', 'Progress', 'Phrase Bank'] as const;
type Tab = typeof TABS[number];

const LanguageAnalysisView: React.FC<Props> = ({ recording }) => {
  const [activeTab, setActiveTab] = useState<Tab>('This Session');

  return (
    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
      {/* Tab bar */}
      <div className="flex gap-1 mb-8 bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              activeTab === tab
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'This Session' && <ThisSessionTab recording={recording} />}
      {activeTab === 'Progress' && <ProgressTab />}
      {activeTab === 'Phrase Bank' && <PhraseBankTab />}
    </div>
  );
};

export default LanguageAnalysisView;
