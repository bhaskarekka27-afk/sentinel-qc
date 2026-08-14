import React, { useState } from 'react';
import { Files, ListChecks, AlertTriangle, GaugeCircle, Plus, RotateCcw, Trash2, ScanSearch } from 'lucide-react';
import { api } from '../api';
import { Stat, Empty, Banner, VerdictPill, useToast } from './ui';
import ReportView from './ReportView';

export default function Dashboard({ analyses, capabilities, refreshAnalyses, onNavigate }) {
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(false);

  const openReport = async (id) => {
    setLoading(true);
    try { setOpen(await api.getAnalysis(id)); }
    catch (e) { toast.err(e.message); }
    finally { setLoading(false); }
  };

  const del = async (id, e) => {
    e.stopPropagation();
    await api.deleteAnalysis(id);
    await refreshAnalyses();
    toast.ok('Analysis deleted.');
  };

  if (open) {
    return (
      <div className="stack">
        <div className="row-between">
          <div className="row" style={{ gap: 10 }}>
            <span className="badge badge-brand">{open.examName}</span>
            <span className="muted" style={{ fontSize: 13 }}>{open.fileName}</span>
          </div>
          <button className="btn btn-ghost" onClick={() => setOpen(null)}><RotateCcw size={15} /> Back to dashboard</button>
        </div>
        <ReportView record={open} />
      </div>
    );
  }

  const totalQ = analyses.reduce((a, x) => a + (x.questionCount || 0), 0);
  const needsReview = analyses.reduce((a, x) => a + (x.summary?.needsReview || 0), 0);
  const avgQuality = analyses.length ? Math.round(analyses.reduce((a, x) => a + (x.summary?.avgQuality || 0), 0) / analyses.length) : 0;

  return (
    <div className="stack">
      {!capabilities?.ensemble && (
        <Banner kind="info">
          <strong>Running in {capabilities?.gemini || capabilities?.claude ? 'single-engine' : 'fallback'} mode.</strong>{' '}
          {capabilities?.gemini || capabilities?.claude
            ? 'Enable both Gemini and Claude in Settings for the full dual-engine ensemble.'
            : 'Add a Gemini or Claude API key in Settings to activate LLM auditing. Structural checks work now.'}
        </Banner>
      )}

      <div className="row-between">
        <div className="stat-grid grow" style={{ marginRight: 12 }}>
          <Stat label="Documents audited" value={analyses.length} icon={Files} accent="info" />
          <Stat label="Questions checked" value={totalQ} icon={ListChecks} />
          <Stat label="Avg quality" value={`${avgQuality}%`} icon={GaugeCircle} accent={avgQuality >= 80 ? 'pass' : avgQuality >= 60 ? 'review' : 'fail'} />
          <Stat label="Items needing review" value={needsReview} icon={AlertTriangle} accent="review" />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><Files size={17} /> Recent analyses</div>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('analyze')}><Plus size={15} /> Analyze content</button>
        </div>

        {analyses.length === 0 ? (
          <Empty icon={ScanSearch} title="No analyses yet">
            Upload a paper in <b>Analyze Content</b> to run your first QC audit.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Document</th><th>Vertical</th><th>Questions</th><th>Quality</th>
                  <th>Verdicts</th><th>Mode</th><th>Date</th><th></th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((a) => {
                  const vc = a.summary?.verdictCounts || {};
                  return (
                    <tr key={a.id} onClick={() => openReport(a.id)}>
                      <td style={{ fontWeight: 600 }}>{a.fileName}</td>
                      <td><span className="badge badge-brand">{a.examName}</span></td>
                      <td>{a.questionCount}</td>
                      <td><b style={{ color: (a.summary?.avgQuality || 0) >= 80 ? 'var(--pass)' : (a.summary?.avgQuality || 0) >= 60 ? 'var(--review)' : 'var(--fail)' }}>{a.summary?.avgQuality ?? '—'}%</b></td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          {vc.pass ? <VerdictPill status="pass">{vc.pass}</VerdictPill> : null}
                          {vc.review ? <VerdictPill status="review">{vc.review}</VerdictPill> : null}
                          {vc.fail ? <VerdictPill status="fail">{vc.fail}</VerdictPill> : null}
                        </div>
                      </td>
                      <td><span className="chip">{a.mode}</span></td>
                      <td className="muted-3">{(a.createdAt || '').slice(0, 10)}</td>
                      <td><button className="icon-btn" style={{ width: 30, height: 30 }} onClick={(e) => del(a.id, e)}><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {loading && <Banner kind="info">Loading report…</Banner>}
    </div>
  );
}
