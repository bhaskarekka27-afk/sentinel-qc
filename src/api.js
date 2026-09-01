// Thin API client for the Content QC backend. All calls go through the Vite
// dev proxy (/api -> backend), so no base URL or CORS handling is needed.

async function handle(res) {
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (body && body.error) || (typeof body === 'string' ? body : 'Request failed');
    throw new Error(message);
  }
  return body;
}

const json = (method, url, data) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  }).then(handle);

export const api = {
  // System
  system: () => fetch('/api/system').then(handle),

  // Exams / models
  listExams: () => fetch('/api/exams').then(handle),
  getExam: (id) => fetch(`/api/exams/${id}`).then(handle),
  createExam: (data) => json('POST', '/api/exams', data),
  updateExam: (id, data) => json('PUT', `/api/exams/${id}`, data),
  deleteExam: (id) => json('DELETE', `/api/exams/${id}`),

  // Training data
  addExemplars: (id, items) => json('POST', `/api/exams/${id}/exemplars`, { items }),
  uploadExemplars: (id, files, verdict = 'approved') => {
    const fd = new FormData();
    const list = files instanceof FileList || Array.isArray(files) ? [...files] : [files];
    for (const f of list) fd.append('files', f);
    fd.append('verdict', verdict);
    return fetch(`/api/exams/${id}/exemplars/upload`, { method: 'POST', body: fd }).then(handle);
  },
  clearExemplars: (id) => json('DELETE', `/api/exams/${id}/exemplars`),

  // Fine-tuning
  tune: (id) => json('POST', `/api/exams/${id}/tune`),
  listJobs: (id) => fetch(`/api/exams/${id}/jobs`).then(handle),
  refreshJob: (id, jobId) => json('POST', `/api/exams/${id}/jobs/${jobId}/refresh`),

  // Content
  parse: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/parse', { method: 'POST', body: fd }).then(handle);
  },
  analyzeFile: (examId, file, fileName) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('examId', examId);
    if (fileName) fd.append('fileName', fileName);
    return fetch('/api/analyze', { method: 'POST', body: fd }).then(handle);
  },
  analyzeQuestions: (examId, questions, fileName) =>
    json('POST', '/api/analyze', { examId, questions, fileName }),
  listAnalyses: () => fetch('/api/analyses').then(handle),
  getAnalysis: (id) => fetch(`/api/analyses/${id}`).then(handle),
  deleteAnalysis: (id) => json('DELETE', `/api/analyses/${id}`),

  // Settings
  getCredentials: () => fetch('/api/settings/credentials').then(handle),
  updateCredentials: (updates) => json('PUT', '/api/settings/credentials', updates),
  llamaStatus: () => fetch('/api/settings/llama-status').then(handle),

  // Text extraction (for detector)
  extractText: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/extract-text', { method: 'POST', body: fd }).then(handle);
  },

  // Benchmark
  runBenchmark: (id, deep = false) =>
    json('POST', `/api/exams/${id}/benchmark${deep ? '?deep=true' : ''}`),
  getBenchmark: (id) => fetch(`/api/exams/${id}/benchmark`).then(handle),

  // Detection
  detect: (text) => json('POST', '/api/detect', { text }),
};
