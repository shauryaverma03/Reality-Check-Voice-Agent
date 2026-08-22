import express from 'express';
import cors from 'cors';
import tasksRouter from './routes/tasks.js';
import checklistsRouter from './routes/checklists.js';
import knowledgeRouter from './routes/knowledge.js';
import { UPLOAD_DIR } from './routes/evidence.js'; // same DATA_DIR-overridable dir evidence.js writes into
import './db/index.js'; // side effect: creates + seeds the SQLite schema

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/uploads', express.static(UPLOAD_DIR)); // file serving, not an API resource — unversioned

app.get('/health', (req, res) => {
  res.json({ ok: true, extraction: process.env.ANTHROPIC_API_KEY ? 'claude' : 'heuristic-fallback' });
});

// REST API, versioned. Resource nouns only — POST-to-collection creates,
// GET reads/lists, PATCH updates. See README's "API surface" table.
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/checklists', checklistsRouter);
app.use('/api/v1/knowledge', knowledgeRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`RealityCheck backend listening on http://localhost:${PORT}`);
  console.log(`Extraction mode: ${process.env.ANTHROPIC_API_KEY ? 'Claude API' : 'heuristic fallback (no ANTHROPIC_API_KEY set)'}`);
});
