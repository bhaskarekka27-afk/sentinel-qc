import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, capabilitySummary, refreshCapabilities } from './config.js';
import { seedDefaults } from './services/registry.js';
import { loadStoredCredentials } from './services/credentials.js';
import examsRouter from './routes/exams.js';
import contentRouter from './routes/content.js';
import settingsRouter from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(null, true);
    },
  }),
);
app.use(express.json({ limit: '20mb' }));

// API routes
app.use('/api/exams', examsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', contentRouter);

// Serve built frontend in production
const distDir = path.resolve(__dirname, '../../dist');
app.use(express.static(distDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

async function start() {
  loadStoredCredentials();
  await seedDefaults();
  await refreshCapabilities();
  app.listen(config.port, () => {
    const caps = capabilitySummary();
    console.log(`\n  Content QC server → http://localhost:${config.port}`);
    console.log(`  LLAMA service: ${config.llama.serviceUrl} (${caps.llama ? 'connected' : 'not running'})`);
    console.log('');
  });
}

start();
