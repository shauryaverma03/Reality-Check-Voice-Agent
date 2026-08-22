import express from 'express';
import cors from 'cors';
import tasksRouter from './routes/tasks.js';
import checklistsRouter from './routes/checklists.js';
import knowledgeRouter from './routes/knowledge.js';
import reportsRouter from './routes/reports.js';
import { UPLOAD_DIR } from './routes/evidence.js'; // same DATA_DIR-overridable dir evidence.js writes into
import './db/index.js'; // side effect: creates + seeds the SQLite schema
import { ingestKnowledge } from './rag/ingest.js';

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
app.use('/api/v1/reports', reportsRouter);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`RealityCheck backend listening on http://localhost:${PORT}`);
  console.log(`Extraction mode: ${process.env.ANTHROPIC_API_KEY ? 'Claude API' : 'heuristic fallback (no ANTHROPIC_API_KEY set)'}`);
});

// Opt-in, off by default (local dev never wants this — node --watch would
// re-run it, and every fetch, on every save). For a host with no
// persistent disk (e.g. Render's free tier), the DB resets on every
// restart, silently emptying the knowledge base; set
// AUTO_INGEST_KNOWLEDGE=true there so it's always freshly seeded.
// Runs after the server is already listening so a slow/unreachable web
// source can never delay or block the app from serving requests.
if (process.env.AUTO_INGEST_KNOWLEDGE === 'true') {
  ingestKnowledge().catch((err) => {
    console.error('[auto-ingest] knowledge ingestion failed (server keeps running):', err.message);
  });
}
