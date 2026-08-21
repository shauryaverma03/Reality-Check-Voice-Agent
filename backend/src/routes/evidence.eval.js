// Regression test for the evidence-upload directory bug — npm run eval:uploads
// (from backend/). Zero-dependency, same house style as verifier.eval.js.
//
// The bug: UPLOAD_DIR was only ever created once, at module-import time.
// Deleting backend/data (a normal thing to do between manual test runs)
// while the server process kept running left multer writing into a
// directory that no longer existed -> every upload failed with ENOENT
// (and, for a request in flight when this happened, sometimes surfaced to
// the browser as a generic "Load failed" instead). The fix makes
// resolveUploadDestination() (routes/evidence.js) recreate UPLOAD_DIR right
// before every write, so it's self-healing regardless of when it went
// missing.

import fs from 'node:fs';
import { UPLOAD_DIR, resolveUploadDestination } from './evidence.js';

const cases = [];
function testCase(def) {
  cases.push(def);
}

testCase({
  name: 'UPLOAD_DIR exists after normal module import (baseline)',
  run: () => fs.existsSync(UPLOAD_DIR),
});

testCase({
  name: 'Deleting UPLOAD_DIR after startup, then resolving a destination, recreates it (the actual bug scenario)',
  run: () => {
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    if (fs.existsSync(UPLOAD_DIR)) return false; // sanity: deletion must have actually happened

    let resolvedDir = null;
    let resolvedErr = 'not called';
    resolveUploadDestination(null, null, (err, dir) => {
      resolvedErr = err;
      resolvedDir = dir;
    });

    return resolvedErr === null && resolvedDir === UPLOAD_DIR && fs.existsSync(UPLOAD_DIR);
  },
});

testCase({
  name: 'Directory is actually writable after self-healing (not just present)',
  run: () => {
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    resolveUploadDestination(null, null, () => {});
    const testFile = `${UPLOAD_DIR}/.regression-write-test`;
    try {
      fs.writeFileSync(testFile, 'ok');
      const readBack = fs.readFileSync(testFile, 'utf8');
      fs.unlinkSync(testFile);
      return readBack === 'ok';
    } catch {
      return false;
    }
  },
});

function main() {
  console.log(`\nRealityCheck evidence-upload eval — ${cases.length} cases\n`);
  let passed = 0;
  cases.forEach((def, i) => {
    const num = String(i + 1).padStart(2, '0');
    let ok = false;
    let error = null;
    try {
      ok = def.run();
    } catch (err) {
      error = err.message;
    }
    if (ok) {
      passed += 1;
      console.log(`  PASS ${num}  ${def.name}`);
    } else {
      console.log(`  FAIL ${num}  ${def.name}${error ? ` — threw: ${error}` : ''}`);
    }
  });

  // Leave UPLOAD_DIR present and writable for whatever runs next.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const total = cases.length;
  console.log(`\n${passed}/${total} passed (${Math.round((passed / total) * 100)}%)\n`);
  if (passed !== total) process.exitCode = 1;
}

main();
