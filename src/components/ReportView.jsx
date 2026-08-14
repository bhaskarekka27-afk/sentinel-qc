import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  ClipboardCheck, KeyRound, ListChecks, Wrench, AlertTriangle,
  CheckCircle2, ScrollText, GitCompareArrows, Target, BookOpen,
  BarChart3, Gauge, Eye, Lightbulb, ShieldCheck, ShieldAlert,
  Layers, TrendingUp, Tag, FileWarning, Zap, ArrowRight,
} from 'lucide-react';
import { Stat, VerdictPill, MetricRow, EngineChip, Empty, Banner, scoreColor } from './ui';

const VERDICT_COLOR = { pass: '#22c55e', review: '#f59e0b', fail: '#ef4444' };

function useChartTheme() {
  const isLight = document.documentElement.classList.contains('light');
  return {
    text: isLight ? '#4b5563' : '#a5acbb',
    grid: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)',
    tipBg: isLight ? '#ffffff' : '#1a1d26',
    tipBorder: isLight ? '#e5e7eb' : '#33384a',
  };
}

function VerdictDonut({ counts }) {
  const t = useChartTheme();
  const total = (counts.pass || 0) + (counts.review || 0) + (counts.fail || 0);
  const data = [
    { value: counts.pass || 0, name: 'Pass', itemStyle: { color: VERDICT_COLOR.pass } },
    { value: counts.review || 0, name: 'Review', itemStyle: { color: VERDICT_COLOR.review } },
    { value: counts.fail || 0, name: 'Fail', itemStyle: { color: VERDICT_COLOR.fail } },
  ];
  return (
    <ReactECharts
      style={{ height: 200 }}
      option={{
        tooltip: { trigger: 'item', backgroundColor: t.tipBg, borderColor: t.tipBorder, textStyle: { color: t.text }, formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, textStyle: { color: t.text, fontSize: 11 }, itemWidth: 10, itemHeight: 10, itemGap: 14 },
        graphic: [{
          type: 'group', left: 'center', top: '38%',
          children: [
            { type: 'text', style: { text: `${total}`, fill: t.text, fontSize: 22, fontWeight: 800, fontFamily: 'Reddit Sans', textAlign: 'center' }, left: 'center' },
            { type: 'text', style: { text: 'total', fill: t.text, fontSize: 10, fontWeight: 500, fontFamily: 'Reddit Sans', textAlign: 'center', opacity: 0.5 }, left: 'center', top: 26 },
          ],
        }],
        series: [{
          type: 'pie', radius: ['62%', '82%'], center: ['50%', '44%'],
          avoidLabelOverlap: false, label: { show: false },
          itemStyle: { borderColor: t.tipBg, borderWidth: 3, borderRadius: 6 },
          emphasis: { scaleSize: 4 },
          data,
        }],
      }}
    />
  );
}

function BarChart({ labels, values, color, gradient }) {
  const t = useChartTheme();
  const itemColor = gradient
    ? { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: gradient[0] }, { offset: 1, color: gradient[1] }] }
    : color;
  return (
    <ReactECharts
      style={{ height: 200 }}
      option={{
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: t.tipBg, borderColor: t.tipBorder, textStyle: { color: t.text } },
        grid: { left: 8, right: 24, top: 8, bottom: 4, containLabel: true },
        xAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid, type: 'dashed' } }, axisLabel: { color: t.text, fontSize: 11 }, axisLine: { show: false } },
        yAxis: { type: 'category', data: labels, axisLabel: { color: t.text, fontSize: 11, width: 100, overflow: 'truncate' }, axisLine: { show: false }, axisTick: { show: false } },
        series: [{ type: 'bar', data: values, barMaxWidth: 18, itemStyle: { borderRadius: [0, 6, 6, 0], color: itemColor }, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' } } }],
      }}
    />
  );
}

function ScoreRing({ value, size = 44, strokeWidth = 5, color }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  const c = color || scoreColor(value);
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c} strokeWidth={strokeWidth}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: size * 0.28, fontWeight: 700, fill: 'var(--text)', fontFamily: 'Reddit Sans' }}>
        {value}
      </text>
    </svg>
  );
}

function KeyIntegrityRow({ q }) {
  const ki = q.keyIntegrity;
  const mismatch = !ki.agreesWithKey;
  const Icon = mismatch ? ShieldAlert : ShieldCheck;
  return (
    <div className="qblock" style={{ borderColor: mismatch ? 'rgba(245,158,11,0.4)' : undefined }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="card-title" style={{ fontSize: 13, whiteSpace: 'nowrap' }}><Icon size={15} /> Answer-Key Integrity</span>
        {mismatch
          ? <span className="pill fail dot">Mismatch</span>
          : <span className="pill pass dot">Verified</span>}
      </div>
      <div className="ki-grid">
        <div className="ki-cell">
          <div className="stat-foot">Marked key</div>
          <span className="ki-key">{ki.markedKey || '—'}</span>
        </div>
        <ArrowRight size={14} className="muted-3" style={{ alignSelf: 'end', marginBottom: 11 }} />
        <div className="ki-cell">
          <div className="stat-foot">Model answer</div>
          <span className="ki-key" style={{ color: mismatch ? 'var(--fail)' : 'var(--pass)' }}>{ki.modelAnswer || '—'}</span>
        </div>
        <div className="ki-cell" style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="stat-foot">Confidence</div>
          <ScoreRing value={ki.confidence} size={40} strokeWidth={4} />
        </div>
      </div>
      {ki.rationale && <p className="muted" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.6 }}>{ki.rationale}</p>}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <div className="metric-card">
      <div className="metric-card-head">
        <Icon size={13} />
        <span>{label}</span>
        <b style={{ marginLeft: 'auto', color: scoreColor(v) }}>{v}%</b>
      </div>
      <div className="scorebar"><span style={{ width: `${v}%`, background: scoreColor(v) }} /></div>
    </div>
  );
}

function QuestionDetail({ q }) {
  const [tab, setTab] = useState('overview');
  const tabs = [
    ['overview', 'Overview', Eye],
    ['options', 'Options', Layers],
    ['fixes', 'Fixes', Wrench],
    ['engines', 'Engines', Zap],
  ];
  const overallScore = q.verdict.score;
  return (
    <div className="card audit-detail">
      <div className="audit-header">
        <div className="row" style={{ gap: 10 }}>
          <ScoreRing value={overallScore} size={48} strokeWidth={5} />
          <div>
            <div className="card-title" style={{ fontSize: 14 }}>Q{q.number} audit</div>
            <span className="muted-3" style={{ fontSize: 11.5 }}>{q.alignment.topic || 'Unclassified'}{q.alignment.subtopic ? ` / ${q.alignment.subtopic}` : ''}</span>
          </div>
        </div>
        <VerdictPill status={q.verdict.status} />
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {tabs.map(([id, label, Icon]) => (
          <div key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            <Icon size={13} style={{ marginRight: 5, verticalAlign: -1 }} />{label}
          </div>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="stack" style={{ gap: 14 }}>
          {q.disagreements?.length > 0 && (
            <Banner kind="warn" icon={GitCompareArrows}>
              <strong>Engine disagreement.</strong> {q.disagreements.join(' ')}
            </Banner>
          )}
          {q.reviewReasons?.length > 0 && (
            <div className="review-reasons">
              <div className="stat-foot" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Eye size={12} /> What to review
              </div>
              <ul style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
                {q.reviewReasons.map((r, i) => (
                  <li key={i} style={{ color: r.type === 'critical' ? 'var(--fail)' : r.type === 'disagreement' ? 'var(--review)' : 'var(--text-2)' }}>
                    {r.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <KeyIntegrityRow q={q} />
          <div>
            <div className="stat-foot" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><BarChart3 size={12} /> Quality metrics</div>
            <div className="stack" style={{ gap: 6 }}>
              <MetricCard icon={BookOpen} label="Wording clarity" value={q.scores.clarity} />
              <MetricCard icon={Target} label="Distractor strength" value={q.scores.distractors} />
              <MetricCard icon={TrendingUp} label="Syllabus alignment" value={q.scores.alignment} />
            </div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="chip"><Gauge size={12} /> {q.difficulty.level}</span>
            {q.alignment.topic && <span className="chip"><Tag size={12} /> {q.alignment.topic}</span>}
          </div>
          {q.flags?.length > 0 && (
            <div>
              <div className="stat-foot" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><FileWarning size={12} /> Flags</div>
              <div className="row wrap" style={{ gap: 6 }}>
                {q.flags.map((f) => <span key={f} className="flag"><AlertTriangle size={11} /> {f}</span>)}
              </div>
            </div>
          )}
          {q.structure.issues?.length > 0 && (
            <div>
              <div className="stat-foot" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><Lightbulb size={12} /> Structural notes</div>
              <ul style={{ paddingLeft: 18, fontSize: 12.5 }} className="muted">
                {q.structure.issues.map((i, idx) => <li key={idx} style={{ marginBottom: 3 }}>{i}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'options' && (
        <div className="stack" style={{ gap: 14 }}>
          {q.passage && (
            <div className="qblock passage-block">
              <div className="stat-foot" style={{ marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={12} /> Passage / context</div>
              <p style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{q.passage}</p>
            </div>
          )}
          <div className="qblock">
            <div className="stat-foot" style={{ marginBottom: 5 }}>Stem</div>
            <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{q.stem}</p>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {q.options.map((o) => {
              const detail = (q.distractorDetail || []).find((d) => d.key === o.key);
              const isKey = o.key === (q.keyIntegrity.modelAnswer || q.answerKey);
              return (
                <div key={o.key} className={`opt ${isKey ? 'correct' : ''}`}>
                  <span className="opt-key">{o.key}</span>
                  <div className="grow">
                    <div>{o.text}</div>
                    {detail && (
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        <span className={`role-tag role-${detail.role}`}>{detail.role}</span>
                        {detail.note && <span className="muted" style={{ fontSize: 12 }}>{detail.note}</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'fixes' && (
        q.fixes?.length > 0 ? (
          <ul className="stack" style={{ gap: 10, listStyle: 'none' }}>
            {q.fixes.map((f, idx) => (
              <li key={idx} className="opt"><Wrench size={14} className="muted-3" style={{ marginTop: 2, flexShrink: 0 }} /><span>{f}</span></li>
            ))}
          </ul>
        ) : <Empty icon={CheckCircle2} title="No fixes suggested">This item passed without recommended edits.</Empty>
      )}

      {tab === 'engines' && (
        <div className="stack" style={{ gap: 10 }}>
          {q.engines?.length === 0 && !q.engineErrors?.length && <Banner kind="info">Structural-only mode — no LLM engine ran. Add an API key in Settings to enable Gemini / Claude.</Banner>}
          {q.engines?.map((e) => (
            <div key={e.engine} className="qblock">
              <div className="row-between">
                <EngineChip engine={e.engine} suffix={`answer ${e.modelAnswer || '?'}`} />
                <VerdictPill status={e.status} />
              </div>
              {e.summary && <p className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>{e.summary}</p>}
            </div>
          ))}
          {q.engineErrors?.map((e) => (
            <Banner key={e.engine} kind="warn"><strong>{e.engine} error:</strong> {e.error}</Banner>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportView({ record }) {
  const results = record.results || [];
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(results[0]?.questionId || null);

  const filtered = useMemo(
    () => (filter === 'all' ? results : results.filter((r) => r.verdict.status === filter)),
    [filter, results],
  );
  const selected = results.find((r) => r.questionId === selectedId) || filtered[0] || results[0];

  const s = record.summary;
  const topFlags = Object.entries(s.flagTally || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="stack">
      {record.mode === 'structural-only' && (
        <Banner kind="info">
          <strong>Structural-only analysis.</strong> No LLM engine is configured, so results reflect deterministic structure &amp; key checks. Add Gemini and/or Claude keys in Settings to unlock the dual-engine audit.
        </Banner>
      )}
      {record.mode === 'single-engine' && (
        <Banner kind="info"><strong>Single-engine mode.</strong> Only one LLM engine responded — enable both Gemini and Claude for cross-checked ensemble verdicts.</Banner>
      )}

      <div className="stat-grid">
        <Stat label="Overall quality" value={`${s.avgQuality}%`} foot={`${record.questionCount} questions audited`} icon={ClipboardCheck} accent={s.avgQuality >= 80 ? 'pass' : s.avgQuality >= 60 ? 'review' : 'fail'} />
        <Stat label="Pass rate" value={`${s.passRate}%`} foot={`${s.verdictCounts.pass} passed`} icon={CheckCircle2} accent="pass" />
        <Stat label="Needs review" value={s.needsReview} foot={`${s.verdictCounts.review} review · ${s.verdictCounts.fail} fail`} icon={AlertTriangle} accent="review" />
        <Stat label="Key mismatches" value={s.keyMismatches} foot="answer key vs. model" icon={KeyRound} accent={s.keyMismatches ? 'fail' : 'pass'} />
      </div>

      <div className="chart-grid">
        <div className="card chart-card">
          <div className="chart-title"><div className="chart-icon" style={{ background: 'var(--pass-soft)', color: 'var(--pass)' }}><CheckCircle2 size={14} /></div> Verdict split</div>
          <VerdictDonut counts={s.verdictCounts} />
        </div>
        <div className="card chart-card">
          <div className="chart-title"><div className="chart-icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><BarChart3 size={14} /></div> Difficulty mix</div>
          <BarChart labels={['Easy', 'Medium', 'Hard']} values={[s.difficulty.Easy || 0, s.difficulty.Medium || 0, s.difficulty.Hard || 0]} gradient={['#818cf8', '#6366f1']} />
        </div>
        <div className="card chart-card">
          <div className="chart-title"><div className="chart-icon" style={{ background: 'var(--review-soft)', color: 'var(--review)' }}><AlertTriangle size={14} /></div> Top defect flags</div>
          {topFlags.length ? (
            <BarChart labels={topFlags.map((f) => f[0])} values={topFlags.map((f) => f[1])} gradient={['#fbbf24', '#f59e0b']} />
          ) : <Empty icon={CheckCircle2} title="No defects flagged" />}
        </div>
      </div>

      <div className="split">
        <div className="card card-pad-0" style={{ padding: 16 }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div className="card-title" style={{ fontSize: 14 }}><ListChecks size={16} /> Questions</div>
            <div className="seg">
              {['all', 'pass', 'review', 'fail'].map((f) => (
                <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="split-list">
            {filtered.map((q) => (
              <div
                key={q.questionId}
                className={`q-item ${selected?.questionId === q.questionId ? 'q-item-active' : ''}`}
                onClick={() => setSelectedId(q.questionId)}
              >
                <div className="q-item-left" style={{ borderLeftColor: VERDICT_COLOR[q.verdict.status] }}>
                  <div className="row-between" style={{ marginBottom: 4 }}>
                    <span className="q-item-num">Q{q.number}</span>
                    <div className="row" style={{ gap: 6 }}>
                      {!q.keyIntegrity.agreesWithKey && <span className="flag warn" style={{ fontSize: 10, padding: '1px 6px' }}><KeyRound size={9} /></span>}
                      <span className="badge" style={{ color: scoreColor(q.verdict.score), fontSize: 11, padding: '2px 7px' }}>{q.verdict.score}%</span>
                      <VerdictPill status={q.verdict.status} />
                    </div>
                  </div>
                  <span className="q-item-topic">{q.alignment.topic || 'Unclassified'}</span>
                  <p className="q-item-stem">{q.stem}</p>
                  {q.reviewReasons?.length > 0 && (
                    <span className="q-item-reason"><Eye size={10} /> {q.reviewReasons[0].message}</span>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <Empty icon={ListChecks} title="Nothing here">No questions with this verdict.</Empty>}
          </div>
        </div>

        {selected ? <QuestionDetail q={selected} /> : <div className="card"><Empty icon={ScrollText} title="Select a question" /></div>}
      </div>
    </div>
  );
}
