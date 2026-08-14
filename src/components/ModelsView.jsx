import React, { useState, useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  BrainCircuit, Plus, Trash2, Save, UploadCloud, Rocket, RefreshCw, Database,
  Loader2, Sparkles, Bot, CheckCircle2, Clock, XCircle, BookOpen, Activity,
  TrendingUp, Zap, Target,
} from 'lucide-react';
import { api } from '../api';
import { Empty, Banner, Modal, useToast, scoreColor } from './ui';

const STATUS_META = {
  untrained: { label: 'Untrained', icon: Clock, color: 'var(--text-3)' },
  queued: { label: 'Queued', icon: Clock, color: 'var(--review)' },
  running: { label: 'Training', icon: Loader2, color: 'var(--info)' },
  succeeded: { label: 'Tuned', icon: CheckCircle2, color: 'var(--pass)' },
  trained: { label: 'Tuned', icon: CheckCircle2, color: 'var(--pass)' },
  failed: { label: 'Failed', icon: XCircle, color: 'var(--fail)' },
};

function useChartTheme() {
  const isLight = document.documentElement.classList.contains('light');
  return {
    text: isLight ? '#4b5563' : '#a5acbb',
    grid: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)',
    tipBg: isLight ? '#ffffff' : '#1a1d26',
    tipBorder: isLight ? '#e5e7eb' : '#33384a',
  };
}

function JobProgress({ progress, status }) {
  if (!progress) return null;
  const done = status === 'succeeded' || status === 'trained';
  const tokens = progress.totalTokens;
  const epochs = progress.totalEpochs;
  let timeLabel = null;
  if (done && progress.startTime && progress.endTime) {
    const mins = Math.round((new Date(progress.endTime) - new Date(progress.startTime)) / 60000);
    timeLabel = mins < 60 ? `${mins}m total` : `${Math.floor(mins / 60)}h ${mins % 60}m total`;
  } else if (progress.elapsedMinutes != null) {
    const m = progress.elapsedMinutes;
    timeLabel = m < 60 ? `${m}m elapsed` : `${Math.floor(m / 60)}h ${m % 60}m elapsed`;
  }
  return (
    <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
      {timeLabel && <span className="chip">{timeLabel}</span>}
      {epochs && <span className="chip">{epochs} epochs</span>}
      {tokens > 0 && <span className="chip">{(tokens / 1000).toFixed(0)}k tokens</span>}
      {progress.exampleCount > 0 && <span className="chip">{progress.exampleCount} examples</span>}
      {done && progress.tunedModel && <span className="chip" style={{ color: 'var(--pass)' }}>model ready</span>}
    </div>
  );
}

function JobRow({ examId, job, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[job.status] || STATUS_META.untrained;
  const Icon = meta.icon;
  const refresh = async () => {
    setBusy(true);
    try { await api.refreshJob(examId, job.id); await onChange(); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!job.vertexJobName || !['running', 'queued'].includes(job.status)) return;
    const id = setInterval(() => {
      api.refreshJob(examId, job.id).then(() => onChange()).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [examId, job.id, job.status, job.vertexJobName, onChange]);
  return (
    <div className="qblock">
      <div className="row-between">
        <div className="row" style={{ gap: 8 }}>
          <Icon size={15} color={meta.color} className={job.status === 'running' ? 'spin' : ''} />
          <b style={{ fontSize: 13 }}>{meta.label}</b>
          <span className="badge">{job.exampleCount} examples</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="muted-3" style={{ fontSize: 11 }}>{(job.createdAt || '').slice(0, 16).replace('T', ' ')}</span>
          {job.vertexJobName && !['succeeded', 'failed', 'trained'].includes(job.status) && (
            <button className="btn btn-subtle btn-sm" onClick={refresh} disabled={busy}>
              {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            </button>
          )}
        </div>
      </div>
      {['running', 'succeeded', 'trained'].includes(job.status) && <JobProgress progress={job.progress} status={job.status} />}
      {job.warning && <p style={{ fontSize: 12, color: 'var(--review)', marginTop: 6 }}>{job.warning}</p>}
      {job.error && <p style={{ fontSize: 12, color: 'var(--fail)', marginTop: 6 }}>{job.error}</p>}
      {job.tunedModel && <p className="mono muted" style={{ fontSize: 11, marginTop: 6, wordBreak: 'break-all' }}>{job.tunedModel}</p>}
      {job.logs?.length > 0 && (
        <div className="console" style={{ marginTop: 8, maxHeight: 120 }}>
          {job.logs.map((l, i) => <div key={i} className={l.includes('error') ? 'l-err' : l.includes('queued') ? 'l-warn' : 'l-sys'}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

function BenchmarkTab({ exam, capabilities }) {
  const toast = useToast();
  const t = useChartTheme();
  const [benchmark, setBenchmark] = useState(null);
  const [running, setRunning] = useState(false);
  const [deepRunning, setDeepRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getBenchmark(exam.id).then((b) => { setBenchmark(b); setLoaded(true); }).catch(() => setLoaded(true));
  }, [exam.id]);

  const run = async (deep = false) => {
    deep ? setDeepRunning(true) : setRunning(true);
    try {
      const result = await api.runBenchmark(exam.id, deep);
      setBenchmark(result);
      toast.ok(deep ? 'Deep benchmark complete.' : 'Benchmark complete.');
    } catch (e) { toast.err(e.message); }
    finally { setRunning(false); setDeepRunning(false); }
  };

  const curve = benchmark?.learningCurve || [];
  const retrieval = benchmark?.retrieval;
  const deep = benchmark?.deep;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {exam.exemplarCount < 2 && (
        <Banner kind="info">Add at least 2 training exemplars to run a benchmark.</Banner>
      )}

      <div className="row-between">
        <span className="muted" style={{ fontSize: 13 }}>
          Evaluate retrieval quality and learning progress for this vertical's training data.
        </span>
        <div className="row" style={{ gap: 8 }}>
          {benchmark && (capabilities?.claude || capabilities?.gemini) && (
            <button className="btn btn-ghost btn-sm" onClick={() => run(true)} disabled={deepRunning || running || exam.exemplarCount < 2}>
              {deepRunning ? <Loader2 size={14} className="spin" /> : <Zap size={14} />} Deep benchmark
            </button>
          )}
          <button className="btn btn-primary" onClick={() => run(false)} disabled={running || deepRunning || exam.exemplarCount < 2}>
            {running ? <Loader2 size={15} className="spin" /> : <Activity size={15} />}
            {running ? 'Running…' : 'Run Benchmark'}
          </button>
        </div>
      </div>

      {!loaded && <Empty icon={Loader2} title="Loading…" />}

      {loaded && !benchmark && exam.exemplarCount >= 2 && (
        <Empty icon={Activity} title="No benchmark yet">Run a benchmark to see model capability metrics for this vertical.</Empty>
      )}

      {benchmark && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { value: benchmark.exemplarCount, label: 'Exemplars', sub: `${benchmark.verdictBreakdown.approved} approved`, icon: Database },
              { value: retrieval.avgSimilarity, label: 'Avg Retrieval', sub: 'cosine similarity', icon: Target },
              { value: `${retrieval.coverage}%`, label: 'Coverage', sub: 'items with >0.5 match', icon: TrendingUp },
              { value: deep ? (deep.avgRagLift > 0 ? `+${deep.avgRagLift}` : deep.avgRagLift) : '—', label: 'RAG Lift', sub: deep ? `${deep.sampleSize} samples` : 'run deep benchmark', icon: Zap },
            ].map(({ value, label, sub, icon: Ico }) => (
              <div key={label} className="qblock" style={{ textAlign: 'center', padding: '14px 10px' }}>
                <Ico size={16} className="muted-3" style={{ marginBottom: 6 }} />
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
                <div className="stat-foot" style={{ marginTop: 4 }}>{label}</div>
                <div className="muted-3" style={{ fontSize: 11 }}>{sub}</div>
              </div>
            ))}
          </div>

          {curve.length > 0 && (
            <div className="qblock">
              <div className="stat-foot" style={{ marginBottom: 8 }}>Learning Curve &mdash; retrieval quality vs. training set size</div>
              <ReactECharts
                style={{ height: 240 }}
                option={{
                  tooltip: {
                    trigger: 'axis',
                    backgroundColor: t.tipBg,
                    borderColor: t.tipBorder,
                    textStyle: { color: t.text },
                    formatter: (params) => `${params[0].axisValue} exemplars<br/>Avg retrieval: <b>${params[0].value}</b>`,
                  },
                  grid: { left: 55, right: 20, top: 16, bottom: 36 },
                  xAxis: {
                    type: 'category',
                    data: curve.map((p) => p.size),
                    name: 'Training examples',
                    nameLocation: 'center',
                    nameGap: 22,
                    axisLabel: { color: t.text, fontSize: 11 },
                    axisLine: { lineStyle: { color: t.grid } },
                  },
                  yAxis: {
                    type: 'value',
                    name: 'Retrieval score',
                    min: 0,
                    max: 1,
                    axisLabel: { color: t.text, fontSize: 11 },
                    splitLine: { lineStyle: { color: t.grid } },
                  },
                  series: [{
                    type: 'line',
                    data: curve.map((p) => p.avgRetrievalScore),
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 8,
                    lineStyle: { color: '#6366f1', width: 2.5 },
                    itemStyle: { color: '#6366f1' },
                    areaStyle: { color: 'rgba(99,102,241,0.12)' },
                  }],
                }}
              />
            </div>
          )}

          {deep && (
            <div className="qblock">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <div className="stat-foot">Deep Benchmark &mdash; RAG Lift (with vs. without training data)</div>
                <span className="chip"><Zap size={12} /> {deep.sampleSize} samples evaluated</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                <div className="qblock" style={{ textAlign: 'center', padding: 12, background: 'var(--bg-2)' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: deep.avgRagLift > 0 ? 'var(--pass)' : deep.avgRagLift < 0 ? 'var(--fail)' : 'var(--text-2)' }}>
                    {deep.avgRagLift > 0 ? '+' : ''}{deep.avgRagLift}
                  </div>
                  <div className="stat-foot">Avg score lift</div>
                </div>
                <div className="qblock" style={{ textAlign: 'center', padding: 12, background: 'var(--bg-2)' }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{deep.keyAccuracyWithRag}%</div>
                  <div className="stat-foot">Key accuracy (with RAG)</div>
                </div>
                <div className="qblock" style={{ textAlign: 'center', padding: 12, background: 'var(--bg-2)' }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{deep.keyAccuracyWithoutRag}%</div>
                  <div className="stat-foot">Key accuracy (without)</div>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th style={{ textAlign: 'center' }}>Key</th>
                      <th style={{ textAlign: 'center' }}>With RAG</th>
                      <th style={{ textAlign: 'center' }}>Without RAG</th>
                      <th style={{ textAlign: 'center' }}>Lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deep.perItem.map((r) => (
                      <tr key={r.id}>
                        <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.stem}</td>
                        <td style={{ textAlign: 'center' }}><span className="mono">{r.markedKey || '—'}</span></td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ color: scoreColor(r.withRag.score) }}>{r.withRag.score}%</span>
                          <span className="muted-3" style={{ marginLeft: 4 }}>{r.withRag.modelAnswer}</span>
                          {r.withRag.keyCorrect && <CheckCircle2 size={11} style={{ marginLeft: 3, color: 'var(--pass)' }} />}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ color: scoreColor(r.withoutRag.score) }}>{r.withoutRag.score}%</span>
                          <span className="muted-3" style={{ marginLeft: 4 }}>{r.withoutRag.modelAnswer}</span>
                          {r.withoutRag.keyCorrect && <CheckCircle2 size={11} style={{ marginLeft: 3, color: 'var(--pass)' }} />}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600, color: r.ragLift > 0 ? 'var(--pass)' : r.ragLift < 0 ? 'var(--fail)' : 'var(--text-3)' }}>
                          {r.ragLift > 0 ? '+' : ''}{r.ragLift}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {retrieval.perItem.length > 0 && (
            <div className="qblock">
              <div className="stat-foot" style={{ marginBottom: 8 }}>Per-item retrieval quality</div>
              <div style={{ overflowX: 'auto', maxHeight: 320 }}>
                <table className="tbl" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>Exemplar</th>
                      <th style={{ textAlign: 'center' }}>Verdict</th>
                      <th style={{ textAlign: 'center' }}>Top match</th>
                      <th style={{ textAlign: 'center' }}>Avg (top-4)</th>
                      <th>Similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retrieval.perItem.map((p) => (
                      <tr key={p.id}>
                        <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.stem}</td>
                        <td style={{ textAlign: 'center' }}><span className={`pill ${p.verdict === 'approved' ? 'pass' : 'fail'} dot`}>{p.verdict}</span></td>
                        <td style={{ textAlign: 'center' }}>{p.topSimilarity}</td>
                        <td style={{ textAlign: 'center' }}>{p.avgSimilarity}</td>
                        <td>
                          <div className="scorebar" style={{ width: 80 }}>
                            <div className="scorebar-fill" style={{ width: `${Math.round(p.topSimilarity * 100)}%`, background: p.topSimilarity > 0.7 ? 'var(--pass)' : p.topSimilarity > 0.5 ? 'var(--review)' : 'var(--fail)' }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="muted-3" style={{ fontSize: 11, textAlign: 'right' }}>
            Benchmark ran {benchmark.createdAt?.slice(0, 16).replace('T', ' ')} &middot; {benchmark.exemplarCount} exemplars
          </div>
        </>
      )}
    </div>
  );
}

function ExamDetail({ exam, capabilities, onChange }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [tab, setTab] = useState('rubric');
  const [rubric, setRubric] = useState(exam.rubric || '');
  const [name, setName] = useState(exam.name);
  const [desc, setDesc] = useState(exam.description || '');
  const [saving, setSaving] = useState(false);
  const [verdict, setVerdict] = useState('approved');
  const [jobs, setJobs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [tuning, setTuning] = useState(false);

  useEffect(() => {
    setRubric(exam.rubric || ''); setName(exam.name); setDesc(exam.description || '');
    api.listJobs(exam.id).then(setJobs).catch(() => {});
  }, [exam.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadJobs = async () => { setJobs(await api.listJobs(exam.id)); await onChange(); };

  const save = async () => {
    setSaving(true);
    try { await api.updateExam(exam.id, { name, description: desc, rubric }); await onChange(); toast.ok('Vertical saved.'); }
    catch (e) { toast.err(e.message); }
    finally { setSaving(false); }
  };

  const upload = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const r = await api.uploadExemplars(exam.id, files, verdict);
      await onChange();
      toast.ok(`Added ${r.added} training examples from ${r.files} file${r.files > 1 ? 's' : ''} (${verdict}).`);
    } catch (e) { toast.err(e.message); }
    finally { setUploading(false); }
  };

  const clearData = async () => {
    await api.clearExemplars(exam.id); await onChange();
    toast.ok('Training data cleared.');
  };

  const launchTune = async () => {
    setTuning(true);
    try {
      const job = await api.tune(exam.id);
      await reloadJobs();
      toast.ok(job.status === 'queued' ? 'Job queued (credentials pending).' : 'Fine-tuning launched.');
    } catch (e) { toast.err(e.message); }
    finally { setTuning(false); }
  };

  const meta = STATUS_META[exam.gemini?.status] || STATUS_META.untrained;
  const StatusIcon = meta.icon;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title"><BrainCircuit size={17} /> {exam.name}</div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip" style={{ color: meta.color }}><StatusIcon size={13} /> {meta.label}</span>
          <span className="chip"><Database size={13} /> {exam.exemplarCount} examples</span>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
        <span className="chip engine-gemini"><Sparkles size={12} /> Gemini {exam.gemini?.tunedModel ? 'tuned' : 'base'}</span>
        <span className="chip engine-claude"><Bot size={12} /> Claude RAG &middot; {exam.exemplarCount} exemplars</span>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {[['rubric', 'Rubric & info'], ['data', 'Training data'], ['jobs', 'Fine-tuning'], ['benchmark', 'Benchmark']].map(([id, l]) => (
          <div key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{l}</div>
        ))}
      </div>

      {tab === 'rubric' && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="field"><label>Vertical name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>Description</label><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div className="field">
            <label>QC rubric — injected into both engines to calibrate judgement for this vertical</label>
            <textarea className="textarea" style={{ minHeight: 180 }} value={rubric} onChange={(e) => setRubric(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save</button>
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="stack" style={{ gap: 14 }}>
          <Banner kind="info">Upload <b>approved</b> gold-standard papers to teach this vertical's model. Approved items become Claude retrieval exemplars and Gemini fine-tuning pairs; <b>rejected</b> items teach what to fail. <b>Multiple files</b> supported.</Banner>
          <div className="field">
            <label>Label for uploaded items</label>
            <div className="seg">
              {['approved', 'rejected'].map((v) => <button key={v} className={verdict === v ? 'active' : ''} onClick={() => setVerdict(v)}>{v}</button>)}
            </div>
          </div>
          <div className="dropzone" onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
            <div className="dz-icon">{uploading ? <Loader2 size={20} className="spin" /> : <UploadCloud size={20} />}</div>
            <h4>Add training data</h4>
            <p>PDF, TXT, JSON or CSV &mdash; multiple files supported &mdash; parsed into labelled exemplars</p>
            <input ref={fileRef} type="file" accept=".pdf,.txt,.json,.csv" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
          <div className="row-between">
            <span className="muted" style={{ fontSize: 13 }}><b>{exam.exemplarCount}</b> exemplars stored</span>
            {exam.exemplarCount > 0 && <button className="btn btn-danger btn-sm" onClick={clearData}><Trash2 size={14} /> Clear</button>}
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="stack" style={{ gap: 14 }}>
          {!capabilities?.vertexTuning && (
            <Banner kind="warn">Vertex AI credentials or GCS bucket not configured. Jobs will be <b>queued</b> and activate automatically once creds are added in the server <code>.env</code>. Claude RAG adaptation is already live.</Banner>
          )}
          <div className="row-between">
            <span className="muted" style={{ fontSize: 13 }}>Launch a real Gemini supervised tuning job from this vertical's approved data.</span>
            <button className="btn btn-primary" onClick={launchTune} disabled={tuning || exam.exemplarCount === 0}>
              {tuning ? <Loader2 size={15} className="spin" /> : <Rocket size={15} />} Launch tuning
            </button>
          </div>
          {exam.exemplarCount === 0 && <Banner kind="info">Add training data first — there are no exemplars to tune on.</Banner>}
          {jobs.length === 0 ? <Empty icon={Rocket} title="No jobs yet" /> : jobs.map((j) => <JobRow key={j.id} examId={exam.id} job={j} onChange={reloadJobs} />)}
        </div>
      )}

      {tab === 'benchmark' && <BenchmarkTab exam={exam} capabilities={capabilities} />}
    </div>
  );
}

export default function ModelsView({ exams, capabilities, refreshExams }) {
  const toast = useToast();
  const [selId, setSelId] = useState(exams[0]?.id || null);
  const [showNew, setShowNew] = useState(false);
  const [nn, setNn] = useState({ name: '', description: '', rubric: '' });

  const selected = exams.find((e) => e.id === selId) || exams[0];

  const create = async () => {
    if (!nn.name.trim()) { toast.err('Name is required.'); return; }
    try {
      const created = await api.createExam(nn);
      await refreshExams();
      setSelId(created.id); setShowNew(false); setNn({ name: '', description: '', rubric: '' });
      toast.ok('Vertical created.');
    } catch (e) { toast.err(e.message); }
  };

  const del = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Delete this vertical and all its training data?')) return;
    await api.deleteExam(id); await refreshExams();
    if (selId === id) setSelId(null);
    toast.ok('Vertical deleted.');
  };

  return (
    <div className="stack">
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 340px) 1fr' }}>
        <div className="stack">
          <button className="btn btn-primary btn-block" onClick={() => setShowNew(true)}><Plus size={16} /> New content vertical</button>
          <div className="stack" style={{ gap: 10 }}>
            {exams.map((e) => {
              const meta = STATUS_META[e.gemini?.status] || STATUS_META.untrained;
              const Icon = meta.icon;
              return (
                <div key={e.id} className="qblock" style={{ cursor: 'pointer', borderColor: selected?.id === e.id ? 'var(--brand)' : undefined }} onClick={() => setSelId(e.id)}>
                  <div className="row-between" style={{ marginBottom: 6 }}>
                    <div className="row" style={{ gap: 8 }}><BookOpen size={15} className="muted" /><b style={{ fontSize: 13.5 }}>{e.name}</b></div>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={(ev) => del(ev, e.id)}><Trash2 size={13} /></button>
                  </div>
                  <p className="muted-3" style={{ fontSize: 12, margin: '0 0 8px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.description}</p>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="chip" style={{ color: meta.color }}><Icon size={12} /> {meta.label}</span>
                    <span className="chip"><Database size={12} /> {e.exemplarCount}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {selected ? <ExamDetail exam={selected} capabilities={capabilities} onChange={refreshExams} /> : <div className="card"><Empty icon={BrainCircuit} title="No vertical selected">Create a content vertical to configure its model.</Empty></div>}
      </div>

      {showNew && (
        <Modal title="New content vertical" onClose={() => setShowNew(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button><button className="btn btn-primary" onClick={create}><Plus size={15} /> Create</button></>}>
          <div className="stack" style={{ gap: 14 }}>
            <div className="field"><label>Name</label><input className="input" placeholder="e.g. NEET — Biology" value={nn.name} onChange={(e) => setNn({ ...nn, name: e.target.value })} /></div>
            <div className="field"><label>Description</label><input className="input" placeholder="Short description of the content" value={nn.description} onChange={(e) => setNn({ ...nn, description: e.target.value })} /></div>
            <div className="field"><label>QC rubric (optional)</label><textarea className="textarea" placeholder="Vertical-specific quality rules for the auditor…" value={nn.rubric} onChange={(e) => setNn({ ...nn, rubric: e.target.value })} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
