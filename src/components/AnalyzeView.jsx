import React, { useState, useRef } from 'react';
import {
  UploadCloud, FileText, X, Play, Loader2, FileSearch, RotateCcw,
  CheckCircle2, ScanSearch, AlertTriangle, Files,
} from 'lucide-react';
import { api } from '../api';
import { Empty, Banner, useToast, Stat, scoreColor } from './ui';
import ReportView from './ReportView';

const ACCEPT = '.pdf,.txt,.json,.csv';
function extOk(name) { return /\.(pdf|txt|json|csv)$/i.test(name); }

export default function AnalyzeView({ exams, capabilities, refreshAnalyses, onNavigate }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const idRef = useRef(0);

  const [entries, setEntries] = useState([]);
  const [examId, setExamId] = useState(exams[0]?.id || '');
  const [drag, setDrag] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [singleReport, setSingleReport] = useState(null);
  const [batchResult, setBatchResult] = useState(null);

  const reset = () => {
    setEntries([]); setSingleReport(null); setBatchResult(null);
  };

  const onPick = async (fileList) => {
    const newFiles = Array.from(fileList || []).filter((f) => extOk(f.name));
    if (newFiles.length === 0) {
      toast.err('No supported files found. Use PDF, TXT, JSON or CSV.');
      return;
    }

    setSingleReport(null);
    setBatchResult(null);

    const newEntries = newFiles.map((f) => ({
      id: ++idRef.current,
      file: f,
      status: 'parsing',
      preview: null,
      error: '',
    }));
    setEntries((prev) => [...prev, ...newEntries]);

    for (const entry of newEntries) {
      try {
        const parsed = await api.parse(entry.file);
        const ok = parsed.questions.length > 0;
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id
              ? { ...e, status: ok ? 'ready' : 'error', preview: parsed, error: ok ? '' : 'No questions found' }
              : e,
          ),
        );
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, status: 'error', error: err.message } : e)),
        );
      }
    }
  };

  const removeEntry = (id) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const readyEntries = entries.filter((e) => e.status === 'ready');
  const totalQuestions = readyEntries.reduce((s, e) => s + (e.preview?.questions?.length || 0), 0);

  const run = async () => {
    if (readyEntries.length === 0 || !examId) return;
    setAnalyzing(true);
    setProgress({ done: 0, total: readyEntries.length });

    const results = [];
    for (let i = 0; i < readyEntries.length; i++) {
      try {
        const entry = readyEntries[i];
        const rec = await api.analyzeFile(examId, entry.file, entry.file.name);
        results.push(rec);
      } catch (e) {
        toast.err(`Failed: ${readyEntries[i].file.name} — ${e.message}`);
      }
      setProgress({ done: i + 1, total: readyEntries.length });
    }

    await refreshAnalyses();

    if (results.length === 1) {
      setSingleReport(results[0]);
      toast.ok(`Audited ${results[0].questionCount} questions.`);
    } else if (results.length > 1) {
      setBatchResult({
        total: results.length,
        totalQuestions: results.reduce((s, r) => s + r.questionCount, 0),
        avgQuality: Math.round(results.reduce((s, r) => s + r.summary.avgQuality, 0) / results.length),
        reports: results.map((r) => ({
          id: r.id,
          fileName: r.fileName,
          questionCount: r.questionCount,
          avgQuality: r.summary.avgQuality,
          passRate: r.summary.passRate,
          needsReview: r.summary.needsReview,
        })),
      });
      toast.ok(`Audited ${results.length} files — ${results.reduce((s, r) => s + r.questionCount, 0)} questions total.`);
    } else {
      toast.err('No files were successfully analyzed.');
    }

    setAnalyzing(false);
  };

  // ── Single report view ─────────────────────────────────────────
  if (singleReport) {
    return (
      <div className="stack">
        <div className="row-between">
          <div className="row" style={{ gap: 10 }}>
            <span className="badge badge-brand">{singleReport.examName}</span>
            <span className="muted" style={{ fontSize: 13 }}>{singleReport.fileName}</span>
            <span className="chip">{singleReport.mode}</span>
            {singleReport.usedTunedModel && <span className="chip engine-llama"><CheckCircle2 size={12} /> LoRA tuned</span>}
          </div>
          <button className="btn btn-ghost" onClick={reset}><RotateCcw size={15} /> New analysis</button>
        </div>
        <ReportView record={singleReport} />
      </div>
    );
  }

  // ── Batch result summary ───────────────────────────────────────
  if (batchResult) {
    return (
      <div className="stack">
        <div className="row-between">
          <div className="card-title"><CheckCircle2 size={17} /> Batch analysis complete</div>
          <button className="btn btn-ghost" onClick={reset}><RotateCcw size={15} /> New analysis</button>
        </div>

        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Stat label="Files analyzed" value={batchResult.total} icon={Files} />
          <Stat label="Total questions" value={batchResult.totalQuestions} icon={FileSearch} />
          <Stat label="Avg quality" value={`${batchResult.avgQuality}%`} icon={CheckCircle2} accent={batchResult.avgQuality >= 80 ? 'pass' : batchResult.avgQuality >= 60 ? 'review' : 'fail'} />
        </div>

        <div className="card">
          <div className="card-title" style={{ fontSize: 14, marginBottom: 12 }}>Individual results</div>
          <div className="stack" style={{ gap: 8 }}>
            {batchResult.reports.map((r) => (
              <div key={r.id} className="qblock">
                <div className="row-between">
                  <div className="row" style={{ gap: 8 }}>
                    <FileText size={14} className="muted-3" />
                    <span style={{ fontSize: 13 }}>{r.fileName}</span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="badge">{r.questionCount} Qs</span>
                    <span className="badge" style={{ color: scoreColor(r.avgQuality) }}>{r.avgQuality}%</span>
                    <span className="badge">{r.passRate}% pass</span>
                    {r.needsReview > 0 && <span className="flag warn"><AlertTriangle size={10} /> {r.needsReview} review</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => onNavigate('dashboard')}>
            View all in Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Upload flow ────────────────────────────────────────────────
  return (
    <div className="stack">
      {!capabilities?.llama && (
        <Banner kind="info">
          No LLM engine running — analysis will run deterministic structural + key checks only. Start the LLAMA service for full QC.
        </Banner>
      )}

      <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title"><UploadCloud size={17} /> Upload content</div>
            {entries.length > 1 && <span className="badge">{entries.length} files</span>}
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Content vertical (model)</label>
            <select className="select" value={examId} onChange={(e) => setExamId(e.target.value)}>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}{e.loraAdapter ? ' · LoRA tuned' : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files); }}
          >
            <div className="dz-icon"><UploadCloud size={22} /></div>
            <h4>Drop papers, DPPs or mocks here</h4>
            <p>PDF, TXT, JSON or CSV &middot; up to 40&nbsp;MB each &middot; multiple files supported</p>
            <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
          </div>

          {entries.length > 0 && (
            <div className="stack" style={{ gap: 6, marginTop: 14 }}>
              {entries.map((entry) => (
                <div key={entry.id} className="file-row">
                  <FileText size={15} className="file-ico" />
                  <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {entry.file.name}
                  </span>
                  {entry.status === 'parsing' && <Loader2 size={14} className="spin muted" />}
                  {entry.status === 'ready' && <span className="badge" style={{ fontSize: 11 }}>{entry.preview?.questions?.length} Qs</span>}
                  {entry.status === 'error' && <span className="flag warn" style={{ fontSize: 11 }}>{entry.error}</span>}
                  <button className="icon-btn" style={{ width: 24, height: 24, flexShrink: 0 }} onClick={() => removeEntry(entry.id)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {analyzing && (
            <div style={{ marginTop: 12 }}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Analyzing file {progress.done + 1} of {progress.total}…</span>
                <span className="muted" style={{ fontSize: 12 }}>{Math.round((progress.done / progress.total) * 100)}%</span>
              </div>
              <div className="progress"><span style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 16 }}
            disabled={readyEntries.length === 0 || analyzing}
            onClick={run}
          >
            {analyzing
              ? <><Loader2 size={16} className="spin" /> Auditing {progress.done}/{progress.total}…</>
              : <><Play size={16} /> Run QC audit{readyEntries.length > 1 ? ` on ${readyEntries.length} files` : ''} ({totalQuestions} questions)</>}
          </button>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title"><FileSearch size={17} /> Parse preview</div>
            {readyEntries.length > 0 && <span className="badge">{totalQuestions} questions total</span>}
          </div>

          {entries.length === 0 && (
            <Empty icon={ScanSearch} title="Nothing parsed yet">Upload documents to preview the extracted questions before auditing.</Empty>
          )}

          {entries.length > 0 && readyEntries.length === 0 && entries.every((e) => e.status === 'parsing') && (
            <Empty icon={Loader2} title="Parsing…">Extracting text and structuring questions.</Empty>
          )}

          {readyEntries.length > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              {readyEntries.map((entry) => {
                const preview = entry.preview;
                return (
                  <div key={entry.id}>
                    <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                      <FileText size={13} className="muted-3" />
                      <b style={{ fontSize: 12.5 }}>{entry.file.name}</b>
                      <span className="chip" style={{ fontSize: 11 }}>{preview.meta?.format?.toUpperCase()}</span>
                      {preview.meta?.pageCount != null && <span className="chip" style={{ fontSize: 11 }}>{preview.meta.pageCount} pages</span>}
                      {preview.meta?.hasAnswerKey && <span className="chip" style={{ fontSize: 11 }}><CheckCircle2 size={10} /> key</span>}
                      <span className="badge" style={{ fontSize: 11 }}>{preview.questions.length} Qs</span>
                    </div>
                    <div className="split-list" style={{ maxHeight: entries.length === 1 ? 460 : 180 }}>
                      {preview.questions.slice(0, entries.length === 1 ? 60 : 10).map((q, i) => (
                        <div key={q.id} className="qblock">
                          <div className="row-between" style={{ marginBottom: 4 }}>
                            <span className="stat-foot">Q{q.number || i + 1}</span>
                            <div className="row" style={{ gap: 6 }}>
                              <span className="badge">{q.options.length} opts</span>
                              {q.answerKey ? <span className="badge badge-brand">key {q.answerKey}</span> : <span className="flag warn">no key</span>}
                            </div>
                          </div>
                          <p style={{ fontSize: 12.5, margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {q.passage ? <span className="muted-3">[passage] </span> : null}{q.stem}
                          </p>
                        </div>
                      ))}
                      {entries.length === 1 && preview.questions.length > 60 && (
                        <p className="muted-3" style={{ fontSize: 12, textAlign: 'center' }}>+{preview.questions.length - 60} more…</p>
                      )}
                      {entries.length > 1 && preview.questions.length > 10 && (
                        <p className="muted-3" style={{ fontSize: 12, textAlign: 'center' }}>+{preview.questions.length - 10} more…</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
