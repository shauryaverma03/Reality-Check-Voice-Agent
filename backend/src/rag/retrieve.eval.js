// Real-corpus RAG evaluation — npm run eval:rag (from backend/)
//
// Unlike verifier.eval.js (pure, fixture-based, always offline), these
// cases query the REAL ingested knowledge base via retrieve() — real PDFs,
// real fetched web pages, real TF-IDF math over that real text. This is the
// only way to prove retrieval actually works against a messy real corpus,
// not just hand-crafted fixtures. It needs `npm run ingest:knowledge` to
// have been run first (this file checks for that and fails with a clear
// instruction, rather than a wall of confusing failures, if it hasn't).
//
// The one exception is the conflict-detection case, which is fixture-based
// on purpose: the real curated corpus doesn't happen to contain two sources
// that genuinely disagree on a spec, and the mechanism itself doesn't need
// real documents to prove correct — see rag/retrieve.js's own doc comment.

import { retrieve, buildFieldQuery, detectRangeConflict } from './retrieve.js';
import { RO_SERVICE_CHECKLIST } from '../checklists.js';
import { db } from '../db/index.js';

const cases = [];
function testCase(def) {
  cases.push(def);
}

function documentMeta(documentId) {
  return db.prepare('SELECT task_type, title FROM knowledge_documents WHERE id = ?').get(documentId);
}

// ---------------------------------------------------------------------------
// AC
// ---------------------------------------------------------------------------

testCase({
  name: 'AC: service-specific retrieval surfaces AC content for a pressure-sensor claim (demo case 1)',
  taskType: 'ac-service',
  query: 'ac-service pressure sensor reading checked service complete high pressure switch',
  expect: { minResults: 1, allFromService: 'ac-service', topTitleContains: 'Carrier' },
});

testCase({
  name: 'AC: model-specific retrieval — a Carrier 24VNA6 claim ranks the model-specific manual to the top',
  taskType: 'ac-service',
  query: 'ac-service Carrier 24VNA6 unit identification model service',
  expect: { minResults: 1, allFromService: 'ac-service', topTitleContains: 'Carrier 24VNA6' },
});

// ---------------------------------------------------------------------------
// RO
// ---------------------------------------------------------------------------

testCase({
  name: 'RO: troubleshooting retrieval surfaces the RO manual',
  taskType: 'ro-service',
  query: 'ro-service troubleshooting problem fault reverse osmosis system',
  expect: { minResults: 1, allFromService: 'ro-service', topTitleContains: 'RO Installation' },
});

testCase({
  name: 'RO: measurement/specification retrieval surfaces TDS guidance, including the EPA web source (demo case 2)',
  taskType: 'ro-service',
  query: buildFieldQuery({
    taskType: 'ro-service',
    field: RO_SERVICE_CHECKLIST.find((f) => f.key === 'tds_output'),
    extractedValue: 180,
    rawText: 'RO filter replaced and TDS is 180 ppm',
  }),
  expect: { minResults: 1, allFromService: 'ro-service', anyTitleContains: 'Secondary Drinking Water Standards' },
});

// ---------------------------------------------------------------------------
// Refrigerator
// ---------------------------------------------------------------------------

testCase({
  name: 'Refrigerator: error/troubleshooting retrieval surfaces the refrigerator manual',
  taskType: 'fridge-service',
  query: 'fridge-service temperature too warm not cooling troubleshooting',
  expect: { minResults: 1, allFromService: 'fridge-service', topTitleContains: 'Refrigerator' },
});

// ---------------------------------------------------------------------------
// Washing machine
// ---------------------------------------------------------------------------

testCase({
  name: 'Washing machine: error-code/troubleshooting retrieval surfaces the Whirlpool error-code page',
  taskType: 'washer-service',
  query: 'washer-service error code display drain problem front load washer',
  expect: { minResults: 1, allFromService: 'washer-service', topTitleContains: 'Error Codes' },
});

// ---------------------------------------------------------------------------
// Cross-service isolation (demo case 4)
// ---------------------------------------------------------------------------

testCase({
  name: 'Cross-service: an AC-scoped query, even one full of RO/water vocabulary, never returns RO content',
  taskType: 'ac-service',
  query: 'ac-service water filter TDS reverse osmosis membrane',
  expect: { minResults: 1, allFromService: 'ac-service' },
});

testCase({
  name: 'Cross-service: an RO-scoped query, even one full of cooling vocabulary, never returns refrigerator content',
  taskType: 'ro-service',
  query: 'ro-service cooling temperature compressor refrigerant leak',
  expect: { allFromService: 'ro-service' }, // may legitimately return 0 results — the assertion that matters is "never fridge"
});

// ---------------------------------------------------------------------------
// No source available (demo case 3)
// ---------------------------------------------------------------------------

testCase({
  name: 'No-source: a query about something the knowledge base has nothing on returns zero results, never a forced match',
  taskType: 'ro-service',
  query: 'purple dragon spaceship intergalactic wizard tournament',
  expect: { minResults: 0, maxResults: 0 },
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runRetrievalCase(def) {
  const results = retrieve({ taskType: def.taskType, query: def.query, k: def.k ?? 4 });
  const failures = [];

  if (def.expect.minResults !== undefined && results.length < def.expect.minResults) {
    failures.push(`expected at least ${def.expect.minResults} result(s), got ${results.length}`);
  }
  if (def.expect.maxResults !== undefined && results.length > def.expect.maxResults) {
    failures.push(`expected at most ${def.expect.maxResults} result(s), got ${results.length}`);
  }
  if (def.expect.allFromService) {
    for (const r of results) {
      const meta = documentMeta(r.documentId);
      if (meta.task_type !== null && meta.task_type !== def.expect.allFromService) {
        failures.push(`result "${meta.title}" belongs to task_type "${meta.task_type}", expected only "${def.expect.allFromService}" (or general/null)`);
      }
    }
  }
  if (def.expect.topTitleContains && results.length > 0) {
    const meta = documentMeta(results[0].documentId);
    if (!meta.title.includes(def.expect.topTitleContains)) {
      failures.push(`top result title "${meta.title}" does not contain "${def.expect.topTitleContains}"`);
    }
  }
  if (def.expect.anyTitleContains) {
    const found = results.some((r) => documentMeta(r.documentId).title.includes(def.expect.anyTitleContains));
    if (!found) {
      failures.push(`no result's title contains "${def.expect.anyTitleContains}" (got: ${results.map((r) => documentMeta(r.documentId).title).join(', ') || 'none'})`);
    }
  }

  return { pass: failures.length === 0, failures, results };
}

function runConflictCase() {
  const conflictingResults = [
    { documentId: 'fixture-a', documentTitle: 'Vendor A RO Manual', text: 'The normal output TDS reading should be between 50 and 150 ppm after filter change.', score: 0.4 },
    { documentId: 'fixture-b', documentTitle: 'Vendor B RO Manual', text: 'Acceptable output TDS range is 200 to 300 ppm for this membrane type.', score: 0.35 },
  ];
  const conflict = detectRangeConflict(conflictingResults);
  const failures = [];
  if (!conflict) failures.push('expected a conflict between two genuinely disagreeing ranges, got none');
  if (conflict && conflict.a.documentId !== 'fixture-a') failures.push('picked the wrong "a" side');

  // Also confirm it does NOT just prefer the higher-scoring source (a=0.4 > b=0.35, but they should both be preserved, not silently resolved to a).
  const notFlagged = detectRangeConflict([
    { documentId: 'fixture-c', documentTitle: 'Overlap A', text: 'TDS should be 50 to 150 ppm.', score: 0.4 },
    { documentId: 'fixture-d', documentTitle: 'Overlap B', text: 'Output reading between 100 and 160 ppm is acceptable.', score: 0.3 },
  ]);
  if (notFlagged) failures.push('overlapping ranges were incorrectly flagged as a conflict');

  return { pass: failures.length === 0, failures, results: conflict ? [conflict.a, conflict.b] : [] };
}

function main() {
  const chunkCount = db.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks').get().n;
  if (chunkCount === 0) {
    console.error('\n[eval:rag] Knowledge base is empty — run `npm run ingest:knowledge` first, then re-run `npm run eval:rag`.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\nRealityCheck RAG retrieval eval — ${cases.length + 1} cases (against the real, ingested knowledge base)\n`);

  let passed = 0;
  const total = cases.length + 1;

  cases.forEach((def, i) => {
    const { pass, failures } = runRetrievalCase(def);
    const num = String(i + 1).padStart(2, '0');
    if (pass) {
      passed += 1;
      console.log(`  PASS ${num}  ${def.name}`);
    } else {
      console.log(`  FAIL ${num}  ${def.name}`);
      for (const f of failures) console.log(`         - ${f}`);
    }
  });

  const conflictResult = runConflictCase();
  const num = String(total).padStart(2, '0');
  if (conflictResult.pass) {
    passed += 1;
    console.log(`  PASS ${num}  Conflict: two sources with genuinely disagreeing ranges -> flagged, neither silently preferred`);
  } else {
    console.log(`  FAIL ${num}  Conflict: two sources with genuinely disagreeing ranges`);
    for (const f of conflictResult.failures) console.log(`         - ${f}`);
  }

  const pct = Math.round((passed / total) * 100);
  console.log(`\n${passed}/${total} passed (${pct}%)\n`);
  if (passed !== total) process.exitCode = 1;
}

main();
