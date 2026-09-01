import { Router } from 'express';
import { getCredentialsMasked, updateCredentials } from '../services/credentials.js';
import { capabilitySummary, refreshCapabilities } from '../config.js';
import { llamaEngine } from '../services/llama.js';

const router = Router();
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

router.get('/credentials', wrap(async (req, res) => {
  res.json(getCredentialsMasked());
}));

router.put('/credentials', wrap(async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Expected an object of key-value pairs.' });
  }
  const credentials = updateCredentials(updates);
  await refreshCapabilities();
  res.json({ credentials, capabilities: capabilitySummary() });
}));

router.get('/llama-status', wrap(async (req, res) => {
  const status = await llamaEngine.status();
  await refreshCapabilities();
  res.json({ status, capabilities: capabilitySummary() });
}));

export default router;
