import { Router } from 'express';
import multer from 'multer';
import { parseDocument } from '../services/parse.js';
import { extractPdf } from '../services/pdf.js';
import { analyzeDocument, listAnalyses, getAnalysis, deleteAnalysis } from '../services/analyze.js';
import { detect } from '../services/ensemble.js';
import { capabilitySummary } from '../config.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });
const router = Router();
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

router.get('/system', (req, res) => {
  res.json({ ok: true, capabilities: capabilitySummary() });
});

/** Parse a document into canonical questions (preview, no analysis). */
router.post('/parse', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const parsed = await parseDocument({ buffer: req.file.buffer, filename: req.file.originalname });
  res.json({ fileName: req.file.originalname, ...parsed });
}));

/**
 * Analyse a document. Accepts either a multipart file upload OR a JSON body
 * with already-parsed questions.
 */
router.post('/analyze', upload.single('file'), wrap(async (req, res) => {
  let examId = req.body.examId;
  let fileName = req.body.fileName;
  let questions;
  let meta;
  let format;

  if (req.file) {
    const parsed = await parseDocument({ buffer: req.file.buffer, filename: req.file.originalname });
    questions = parsed.questions;
    meta = parsed.meta;
    format = parsed.meta?.format;
    fileName = fileName || req.file.originalname;
  } else if (req.body.questions) {
    questions = typeof req.body.questions === 'string' ? JSON.parse(req.body.questions) : req.body.questions;
    format = 'manual';
  }

  if (!examId) return res.status(400).json({ error: 'examId is required' });
  if (!questions || questions.length === 0) {
    return res.status(400).json({ error: 'No questions found to analyse.' });
  }

  const record = await analyzeDocument({ examId, fileName, format, questions, meta });
  res.status(201).json(record);
}));

router.get('/analyses', wrap(async (req, res) => res.json(await listAnalyses())));

router.get('/analyses/:id', wrap(async (req, res) => {
  const a = await getAnalysis(req.params.id);
  if (!a) return res.status(404).json({ error: 'Analysis not found' });
  res.json(a);
}));

router.delete('/analyses/:id', wrap(async (req, res) => {
  res.json({ deleted: await deleteAnalysis(req.params.id) });
}));

/** Extract raw text from a PDF or text file (used by the detector). */
router.post('/extract-text', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { buffer, originalname } = req.file;
  if (/\.pdf$/i.test(originalname)) {
    const result = await extractPdf(buffer);
    res.json({ text: result.fullText || '', pageCount: result.pageCount, fileName: originalname });
  } else {
    res.json({ text: buffer.toString('utf-8'), fileName: originalname });
  }
}));

/** AI-vs-human detection on arbitrary text. */
router.post('/detect', wrap(async (req, res) => {
  const text = req.body.text;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
  res.json(await detect(text));
}));

export default router;
