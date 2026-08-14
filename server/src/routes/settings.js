import { Router } from 'express';
import { getCredentialsMasked, updateCredentials } from '../services/credentials.js';
import { capabilitySummary } from '../config.js';

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
  res.json({ credentials, capabilities: capabilitySummary() });
}));

export default router;
