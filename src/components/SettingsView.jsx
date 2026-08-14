import React, { useState, useEffect } from 'react';
import {
  Sparkles, Bot, FlaskConical, Cloud, CheckCircle2, XCircle, RefreshCw,
  Loader2, Server, KeyRound, Eye, EyeOff, Save, Trash2, ExternalLink,
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

const CRED_FIELDS = [
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini API Key',
    sensitive: true,
    hint: 'Free tier available — get a key at aistudio.google.com/apikey',
    badge: 'Free',
    badgeColor: 'var(--pass)',
    links: [
      { label: 'Get API key', url: 'https://aistudio.google.com/apikey' },
      { label: 'Manage billing', url: 'https://aistudio.google.com/plan' },
    ],
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Claude API Key',
    sensitive: true,
    hint: 'Requires billing — get a key at console.anthropic.com',
    links: [
      { label: 'Get API key', url: 'https://console.anthropic.com/settings/keys' },
      { label: 'Manage billing', url: 'https://console.anthropic.com/settings/billing' },
    ],
  },
  {
    key: 'GCP_PROJECT_ID',
    label: 'GCP Project ID',
    sensitive: false,
    hint: 'Google Cloud project for Vertex AI fine-tuning',
    group: 'vertex',
  },
  {
    key: 'GOOGLE_APPLICATION_CREDENTIALS',
    label: 'Service Account JSON Path',
    sensitive: false,
    hint: 'Path to a service-account JSON file with Vertex AI User role',
    group: 'vertex',
  },
  {
    key: 'GCS_BUCKET',
    label: 'GCS Bucket',
    sensitive: false,
    hint: 'Bucket name for storing tuning datasets',
    group: 'vertex',
  },
];

function CredField({ field, cred, value, onChange, onClear }) {
  const [show, setShow] = useState(false);
  const isSet = cred?.set;
  const placeholder = isSet
    ? (field.sensitive ? `${cred.masked} (configured)` : `${cred.value} (configured)`)
    : 'Not configured';

  return (
    <div className="field" style={{ marginBottom: 2 }}>
      <div className="row-between" style={{ marginBottom: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {field.label}
          <code className="muted-3" style={{ fontSize: 10.5 }}>{field.key}</code>
          {field.badge && (
            <span className="pill" style={{ fontSize: 10, padding: '1px 7px', color: field.badgeColor, background: 'var(--pass-soft)' }}>{field.badge}</span>
          )}
        </label>
        {isSet && <span className="pill pass dot" style={{ fontSize: 10.5 }}>Set</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          type={field.sensitive && !show ? 'password' : 'text'}
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        {field.sensitive && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShow(!show)} type="button" title={show ? 'Hide' : 'Show'}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {isSet && (
          <button className="btn btn-ghost btn-sm" onClick={onClear} type="button" title="Clear this credential">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {field.hint && <span className="muted-3" style={{ fontSize: 11, marginTop: 3, display: 'block' }}>{field.hint}</span>}
      {field.links?.length > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 5 }}>
          {field.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="link-sm">
              <ExternalLink size={11} /> {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsView({ capabilities: initial }) {
  const toast = useToast();
  const [caps, setCaps] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState(null);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getCredentials().then(setCreds).catch(() => {});
  }, []);

  const recheck = async () => {
    setBusy(true);
    try {
      const [sys, cr] = await Promise.all([api.system(), api.getCredentials()]);
      setCaps(sys.capabilities);
      setCreds(cr);
      toast.ok('Status refreshed.');
    } catch { toast.err('Server not reachable.'); }
    finally { setBusy(false); }
  };

  const setEdit = (key, value) => setEdits((prev) => ({ ...prev, [key]: value }));

  const hasEdits = Object.values(edits).some((v) => v);

  const save = async () => {
    const updates = {};
    for (const [key, value] of Object.entries(edits)) {
      if (value) updates[key] = value;
    }
    if (Object.keys(updates).length === 0) { toast.err('Enter at least one key.'); return; }
    setSaving(true);
    try {
      const result = await api.updateCredentials(updates);
      setCreds(result.credentials);
      setCaps(result.capabilities);
      setEdits({});
      toast.ok('Credentials saved — engines will use new keys immediately.');
    } catch (e) { toast.err(e.message); }
    finally { setSaving(false); }
  };

  const clear = async (key) => {
    try {
      const result = await api.updateCredentials({ [key]: '' });
      setCreds(result.credentials);
      setCaps(result.capabilities);
      setEdits((prev) => { const n = { ...prev }; delete n[key]; return n; });
      toast.ok(`${key} cleared.`);
    } catch (e) { toast.err(e.message); }
  };

  const engineFields = CRED_FIELDS.filter((f) => !f.group);
  const vertexFields = CRED_FIELDS.filter((f) => f.group === 'vertex');

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">Engine status and credential management. Keys are stored server-side and never leave the backend.</p>
        <button className="btn btn-ghost" onClick={recheck} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Re-check</button>
      </div>

      <div className="stat-grid">
        <CapCard icon={Sparkles} title="Gemini engine" on={caps?.gemini} offNote="Add a Gemini API key below to enable inference, embeddings and AI detection. Free tier available.">
          Live for QC analysis, embeddings and AI detection.
        </CapCard>
        <CapCard icon={Bot} title="Claude engine" on={caps?.claude} offNote="Add an Anthropic API key below to enable Claude analysis with per-exam RAG adaptation.">
          Live with per-exam retrieval-augmented adaptation.
        </CapCard>
        <CapCard icon={Cloud} title="Vertex fine-tuning" on={caps?.vertexTuning} offNote="Add GCP Project ID, service-account path and GCS bucket below for real supervised tuning.">
          Real per-vertical supervised fine-tuning is available.
        </CapCard>
        <CapCard icon={FlaskConical} title="Ensemble mode" on={caps?.ensemble} offNote="Enable BOTH Gemini and Claude to cross-check every verdict and surface disagreements.">
          Both engines run and results are reconciled for higher accuracy.
        </CapCard>
      </div>

      {!caps?.ensemble && (
        <Banner kind="info">
          The tool is fully usable now — deterministic structural checks and heuristic AI-detection always run. Adding engine keys progressively unlocks LLM auditing and the dual-engine ensemble.
        </Banner>
      )}

      <div className="card">
        <div className="card-head">
          <div className="card-title"><KeyRound size={16} /> API Keys</div>
          {hasEdits && (
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save
            </button>
          )}
        </div>
        <Banner kind="info" style={{ marginBottom: 16 }}>
          Start with a <b>free Gemini API key</b> — it unlocks LLM analysis, embeddings and AI detection at no cost.
          Add Claude for dual-engine cross-checking. Keys are applied immediately without restarting.
        </Banner>

        {creds && (
          <div className="stack" style={{ gap: 16 }}>
            {engineFields.map((f) => (
              <CredField
                key={f.key}
                field={f}
                cred={creds[f.key]}
                value={edits[f.key]}
                onChange={(v) => setEdit(f.key, v)}
                onClear={() => clear(f.key)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><Cloud size={16} /> Vertex AI (optional)</div>
          {hasEdits && (
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Save
            </button>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
          Only needed for real Gemini supervised fine-tuning. The tool works fully without these — Claude RAG adaptation and Gemini base models are always available.
        </p>

        {creds && (
          <div className="stack" style={{ gap: 16 }}>
            {vertexFields.map((f) => (
              <CredField
                key={f.key}
                field={f}
                cred={creds[f.key]}
                value={edits[f.key]}
                onChange={(v) => setEdit(f.key, v)}
                onClear={() => clear(f.key)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}><Server size={16} /> How the models work</div>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
          <li>Each content vertical owns its <b>own model</b>: a Gemini fine-tuned model ID and a Claude RAG exemplar store.</li>
          <li>Every audit runs available engines in parallel and a reconciler merges scores, votes on answer-key integrity, and flags disagreement as a review signal.</li>
          <li>Uploading <b>approved</b> content improves both engines — as Gemini training pairs and Claude retrieval exemplars.</li>
          <li>PDF, TXT, JSON and CSV are parsed server-side with coordinate-aware extraction for multi-column papers and separate answer keys.</li>
          <li><b>Gemini free tier</b> provides generous quotas for analysis, detection and embeddings — no billing required.</li>
        </ul>
      </div>
    </div>
  );
}
