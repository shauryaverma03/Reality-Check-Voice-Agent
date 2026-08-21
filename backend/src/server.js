import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import tasksRouter from './routes/tasks.js';
import './db/index.js'; // side effect: creates + seeds the SQLite schema

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/health', (req, res) => {
  res.json({ ok: true, extraction: process.env.ANTHROPIC_API_KEY ? 'claude' : 'heuristic-fallback' });
});

app.use('/', tasksRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`RealityCheck backend listening on http://localhost:${PORT}`);
  console.log(`Extraction mode: ${process.env.ANTHROPIC_API_KEY ? 'Claude API' : 'heuristic fallback (no ANTHROPIC_API_KEY set)'}`);
});
