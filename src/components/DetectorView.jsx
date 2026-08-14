import React, { useState, useRef } from 'react';
import { Bot, User, Loader2, Sparkles, AlertTriangle, CheckCircle2, Wand2, UploadCloud, FileText, X } from 'lucide-react';
import { api } from '../api';
import { Empty, Banner, EngineChip, useToast } from './ui';

function verdictTone(likelihood) {
  if (likelihood >= 55) return { color: 'var(--fail)', bg: 'var(--fail-soft)' };
  if (likelihood >= 41) return { color: 'var(--review)', bg: 'var(--review-soft)' };
  return { color: 'var(--pass)', bg: 'var(--pass-soft)' };
}

const SAMPLE = `The mitochondrion is often described as the powerhouse of the cell. Furthermore, it plays a crucial role in energy production. Moreover, it is important to note that these organelles are essential for cellular respiration. In conclusion, mitochondria are a testament to the intricate tapestry of cellular biology.`;

export default function DetectorView({ capabilities }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState('');

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setResult(null);
    try { setResult(await api.detect(text)); }
    catch (e) { toast.err(e.message); }
    finally { setBusy(false); }
  };

  const onFile = async (file) => {
    if (!file) return;
    if (!/\.(pdf|txt|csv|json)$/i.test(file.name)) {
      toast.err('Supported formats: PDF, TXT, CSV, JSON');
      return;
    }
    setExtracting(true); setResult(null); setFileName(file.name);
    try {
      const { text: extracted } = await api.extractText(file);
      if (!extracted?.trim()) {
        toast.err('No text could be extracted from this file.');
        setFileName('');
      } else {
        setText(extracted);
        toast.ok(`Extracted ${extracted.trim().split(/\s+/).length} words from ${file.name}`);
      }
    } catch (e) {
      toast.err(e.message);
      setFileName('');
    } finally {
      setExtracting(false);
    }
  };

  const clearFile = () => { setFileName(''); setText(''); setResult(null); };

  const tone = result ? verdictTone(result.aiLikelihood) : null;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="stack">
      {!capabilities?.gemini && !capabilities?.claude && (
        <Banner kind="info">No LLM engine configured — detection uses linguistic heuristics (burstiness, lexical diversity, AI-phrase markers). Add a key in Settings to add LLM forensics.</Banner>
      )}

      <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title"><Wand2 size={17} /> Text to analyse</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-subtle btn-sm" onClick={() => fileRef.current?.click()} disabled={extracting}>
                {extracting ? <Loader2 size={13} className="spin" /> : <UploadCloud size={13} />} Upload file
              </button>
              <button className="btn btn-subtle btn-sm" onClick={() => { setText(SAMPLE); setFileName(''); setResult(null); }}>Load sample</button>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.csv,.json" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>

          {fileName && (
            <div className="file-row" style={{ marginBottom: 10 }}>
              <FileText size={14} className="file-ico" />
              <span className="grow" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
              <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={clearFile}><X size={13} /></button>
            </div>
          )}

          <textarea
            className="textarea"
            style={{ minHeight: 280 }}
            placeholder="Paste a passage, question stem, explanation or any content submitted by a vendor — or upload a PDF above…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row-between" style={{ marginTop: 12 }}>
            <span className="muted-3" style={{ fontSize: 12 }}>{wordCount} words</span>
            <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={run}>
              {busy ? <><Loader2 size={16} className="spin" /> Analysing…</> : <><Sparkles size={16} /> Detect origin</>}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title"><Bot size={17} /> Forensic verdict</div>{result && <span className="chip">{result.mode}</span>}</div>

          {!result && !busy && <Empty icon={Bot} title="Awaiting analysis">Paste text or upload a PDF and run detection to see the AI-vs-human verdict and evidence.</Empty>}
          {busy && <Empty icon={Loader2} title="Running forensics…" />}

          {result && (
            <div className="stack" style={{ gap: 18 }}>
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 44, fontWeight: 800, color: tone.color, lineHeight: 1 }}>{result.aiLikelihood}%</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>likelihood AI-generated</div>
                <div style={{ display: 'inline-flex', marginTop: 12, padding: '6px 16px', borderRadius: 20, background: tone.bg, color: tone.color, fontWeight: 700, fontSize: 14, alignItems: 'center', gap: 7 }}>
                  {result.aiLikelihood >= 55 ? <Bot size={16} /> : <User size={16} />} {result.verdict}
                </div>
              </div>

              <div className="meter"><span style={{ width: `${result.aiLikelihood}%`, background: tone.color }} /></div>
              <div className="row-between" style={{ fontSize: 12 }} >
                <span className="muted-3">Human</span>
                <span className="muted">confidence {result.confidence}%</span>
                <span className="muted-3">AI</span>
              </div>

              {result.metrics && (
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="chip">burstiness {result.metrics.burstiness}</span>
                  <span className="chip">lexical diversity {result.metrics.ttr}%</span>
                  <span className="chip">{result.metrics.sentences} sentences</span>
                </div>
              )}

              {result.signals?.length > 0 && (
                <div>
                  <div className="stat-foot" style={{ marginBottom: 6 }}>AI signals</div>
                  <ul className="stack" style={{ gap: 6, listStyle: 'none' }}>
                    {result.signals.map((s, i) => <li key={i} className="opt flagged"><AlertTriangle size={13} color="var(--review)" style={{ flexShrink: 0, marginTop: 2 }} /><span style={{ fontSize: 12.5 }}>{s}</span></li>)}
                  </ul>
                </div>
              )}
              {result.humanSignals?.length > 0 && (
                <div>
                  <div className="stat-foot" style={{ marginBottom: 6 }}>Human signals</div>
                  <ul className="stack" style={{ gap: 6, listStyle: 'none' }}>
                    {result.humanSignals.map((s, i) => <li key={i} className="opt"><CheckCircle2 size={13} color="var(--pass)" style={{ flexShrink: 0, marginTop: 2 }} /><span style={{ fontSize: 12.5 }}>{s}</span></li>)}
                  </ul>
                </div>
              )}

              <div>
                <div className="stat-foot" style={{ marginBottom: 8 }}>Engine breakdown</div>
                <div className="stack" style={{ gap: 8 }}>
                  {result.engines.map((e) => (
                    <div key={e.engine} className="qblock">
                      <div className="row-between"><EngineChip engine={e.engine} /><b style={{ color: verdictTone(e.aiLikelihood).color }}>{e.aiLikelihood}% · {e.verdict}</b></div>
                      {e.rationale && <p className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{e.rationale}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
