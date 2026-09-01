import React, { useState, useEffect } from 'react';
import {
  BrainCircuit, CheckCircle2, XCircle, RefreshCw, Loader2, Server,
  Cpu, HardDrive, Zap,
} from 'lucide-react';
import { api } from '../api';
import { Banner, useToast } from './ui';

function CapCard({ icon: Icon, title, on, offNote, children }) {
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="card-title" style={{ fontSize: 14 }}><Icon size={16} /> {title}</div>
        <span className="pill" style={{ background: on ? 'var(--pass-soft)' : 'var(--surface-2)', color: on ? 'var(--pass)' : 'var(--text-3)' }}>
          {on ? <><CheckCircle2 size={13} /> Active</> : <><XCircle size={13} /> Off</>}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{on ? children : offNote}</p>
    </div>
  );
}

export default function SettingsView({ capabilities: initial }) {
  const toast = useToast();
  const [caps, setCaps] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [llamaStatus, setLlamaStatus] = useState(null);
  const [serviceUrl, setServiceUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await api.llamaStatus();
      setLlamaStatus(data.status);
      setCaps(data.capabilities);
    } catch {
      setLlamaStatus(null);
    }
  };

  useEffect(() => {
    api.getCredentials().then((c) => setServiceUrl(c?.LLAMA_SERVICE_URL?.value || 'http://localhost:8788'));
    fetchStatus();
  }, []);

  const recheck = async () => {
    setBusy(true);
    try {
      await fetchStatus();
      toast.ok('Status refreshed.');
    } catch { toast.err('Server not reachable.'); }
    finally { setBusy(false); }
  };

  const saveUrl = async () => {
    if (!serviceUrl.trim()) return;
    setSaving(true);
    try {
      const result = await api.updateCredentials({ LLAMA_SERVICE_URL: serviceUrl.trim() });
      setCaps(result.capabilities);
      await fetchStatus();
      toast.ok('Service URL updated.');
    } catch (e) { toast.err(e.message); }
    finally { setSaving(false); }
  };

  const ready = llamaStatus?.ready === true;

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">LLAMA service status and configuration. All inference and training runs locally — no API keys or cloud costs.</p>
        <button className="btn btn-ghost" onClick={recheck} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Re-check</button>
      </div>

      <div className="stat-grid">
        <CapCard icon={BrainCircuit} title="LLAMA engine" on={caps?.llama} offNote="Start the LLAMA service: python llama_service/app.py">
          Local LLAMA inference is active for QC analysis and AI detection.
        </CapCard>
        <CapCard icon={Zap} title="Embeddings" on={caps?.embeddings} offNote="Embeddings activate automatically when the LLAMA service is running.">
          Sentence-transformer embeddings for per-exam RAG retrieval.
        </CapCard>
      </div>

      {!ready && (
        <Banner kind="warn">
          The LLAMA service is not running. Start it with: <code>cd llama_service && pip install -r requirements.txt && python app.py</code>
          <br />Structural checks and heuristic scoring still work without it.
        </Banner>
      )}

      {ready && (
        <Banner kind="info">
          All engines running locally — zero API costs. Upload training data and fine-tune with LoRA in the Models tab.
        </Banner>
      )}

      <div className="card">
        <div className="card-head">
          <div className="card-title"><Server size={16} /> LLAMA Service</div>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label>Service URL</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" value={serviceUrl} onChange={(e) => setServiceUrl(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" onClick={saveUrl} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : 'Update'}
            </button>
          </div>
          <span className="muted-3" style={{ fontSize: 11, marginTop: 3, display: 'block' }}>Default: http://localhost:8788</span>
        </div>

        {llamaStatus && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="qblock">
              <div className="stat-foot" style={{ marginBottom: 8 }}>Service info</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <BrainCircuit size={14} className="muted-3" />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{llamaStatus.model}</div>
                    <div className="muted-3" style={{ fontSize: 11 }}>Base model</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Cpu size={14} className="muted-3" />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {llamaStatus.gpu_name || llamaStatus.device?.toUpperCase()}
                    </div>
                    <div className="muted-3" style={{ fontSize: 11 }}>
                      {llamaStatus.cuda_available ? 'GPU (CUDA)' : 'CPU'}
                    </div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <HardDrive size={14} className="muted-3" />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{llamaStatus.embed_model}</div>
                    <div className="muted-3" style={{ fontSize: 11 }}>Embedding model</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Zap size={14} className="muted-3" />
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {llamaStatus.adapters?.length || 0} adapters
                    </div>
                    <div className="muted-3" style={{ fontSize: 11 }}>LoRA fine-tuned</div>
                  </div>
                </div>
              </div>
            </div>

            {llamaStatus.adapters?.length > 0 && (
              <div className="qblock">
                <div className="stat-foot" style={{ marginBottom: 6 }}>Loaded LoRA adapters</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {llamaStatus.adapters.map((a) => (
                    <span key={a} className="chip" style={{ color: 'var(--pass)' }}>
                      <CheckCircle2 size={12} /> {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}><Server size={16} /> How it works</div>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
          <li>All inference runs <b>locally</b> via LLAMA (Hugging Face Transformers) — no cloud APIs or costs.</li>
          <li>Each content vertical can be <b>LoRA fine-tuned</b> from its training exemplars for exam-specific quality judgement.</li>
          <li>Embeddings use a local sentence-transformer model for per-exam RAG retrieval.</li>
          <li>Structural checks and heuristic scoring always run, even without the LLAMA service.</li>
          <li>Start the service: <code>cd llama_service && python app.py</code></li>
        </ul>
      </div>
    </div>
  );
}
