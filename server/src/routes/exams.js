import { Router } from 'express';
import multer from 'multer';
import { listExams, getExam, createExam, updateExam, deleteExam } from '../services/registry.js';
import { addExemplar, removeExemplarsForExam } from '../services/ragStore.js';
import { launchTuning, listJobs, refreshJob } from '../services/tuning.js';
import { parseDocument } from '../services/parse.js';
import { runBenchmark, getLatestBenchmark } from '../services/benchmark.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const router = Router();

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

router.get('/', wrap(async (req, res) => res.json(await listExams())));

router.post('/', wrap(async (req, res) => res.status(201).json(await createExam(req.body))));

router.get('/:id', wrap(async (req, res) => {
  const exam = await getExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  res.json(exam);
}));

router.put('/:id', wrap(async (req, res) => {
  const updated = await updateExam(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Exam not found' });
  res.json(updated);
}));

router.delete('/:id', wrap(async (req, res) => {
  await removeExemplarsForExam(req.params.id);
  const ok = await deleteExam(req.params.id);
  res.json({ deleted: ok });
}));

// ── Training data (exemplars) ─────────────────────────────────────────
router.post('/:id/exemplars', wrap(async (req, res) => {
  const exam = await getExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
  const added = [];
  for (const item of items) {
    if (!item.stem) continue;
    added.push(await addExemplar(exam.id, item));
  }
  res.status(201).json({ added: added.length });
}));

router.post('/:id/exemplars/upload', upload.array('files', 20), wrap(async (req, res) => {
  const exam = await getExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const verdict = req.body.verdict === 'rejected' ? 'rejected' : 'approved';
  let totalAdded = 0;
  let totalParsed = 0;
  for (const file of files) {
    const { questions } = await parseDocument({ buffer: file.buffer, filename: file.originalname });
    for (const q of questions) {
      await addExemplar(exam.id, { ...q, verdict });
      totalAdded++;
    }
    totalParsed += questions.length;
  }
  res.status(201).json({ added: totalAdded, parsed: totalParsed, files: files.length });
}));

router.delete('/:id/exemplars', wrap(async (req, res) => {
  const removed = await removeExemplarsForExam(req.params.id);
  res.json({ removed });
}));

// ── Fine-tuning ───────────────────────────────────────────────────────
router.post('/:id/tune', wrap(async (req, res) => {
  const job = await launchTuning(req.params.id);
  res.status(201).json(job);
}));

router.get('/:id/jobs', wrap(async (req, res) => res.json(await listJobs(req.params.id))));

router.post('/:id/jobs/:jobId/refresh', wrap(async (req, res) => {
  const job = await refreshJob(req.params.jobId);
  res.json(job);
}));

// ── Benchmark ────────────────────────────────────────────────────
router.get('/:id/benchmark', wrap(async (req, res) => {
  const result = await getLatestBenchmark(req.params.id);
  res.json(result);
}));

router.post('/:id/benchmark', wrap(async (req, res) => {
  const exam = await getExam(req.params.id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const deep = req.query.deep === 'true' || req.body.deep === true;
  const result = await runBenchmark(exam.id, { deep });
  res.status(201).json(result);
}));

export default router;
