// Regression test for claim extraction — npm run eval:extraction (from
// backend/). Zero-dependency, same house style as verifier.eval.js.
//
// Deliberately clears ANTHROPIC_API_KEY before importing anything, so this
// suite always exercises the heuristic fallback path deterministically,
// regardless of what's in the ambient environment — the same guarantee
// verifier.eval.js and retrieve.eval.js already make (offline, repeatable).
//
// The bug this suite pins down: genericNumberPattern() (extraction/extract.js)
// used to build its regex trigger from a checklist field's ENTIRE key
// ('internal_temperature' -> requires the literal word "internal" before
// "temperature"), so a natural claim like "temperature is 8 degrees" never
// matched for any field whose key has a qualifying prefix word a technician
// wouldn't actually say. Fixed to trigger on any individual word of the key.

delete process.env.ANTHROPIC_API_KEY;

const { extractClaimFromVoice } = await import('./extract.js');
const { verifyTask } = await import('../verifier.js');
const {
  AC_SERVICE_CHECKLIST,
  RO_SERVICE_CHECKLIST,
  FRIDGE_SERVICE_CHECKLIST,
} = await import('../checklists.js');

const cases = [];
function testCase(def) {
  cases.push(def);
}

// ---------------------------------------------------------------------------
// Claim extraction, per service
// ---------------------------------------------------------------------------

testCase({
  name: 'AC: machine_id + pressure + temperature all extract from natural phrasing (regression — must never break)',
  checklist: AC_SERVICE_CHECKLIST,
  rawText: 'Machine 27 maintenance complete I have pressure 4.2 bar temperature 82° Hai',
  expectData: { machine_id: '27', pressure: 4.2, temperature: 82 },
});

testCase({
  name: 'Fridge: internal_temperature extracts from plain "temperature is 8" (the reported bug)',
  checklist: FRIDGE_SERVICE_CHECKLIST,
  rawText: 'Machine 27 maintenance complete. Pressure is 4.2 bar. Temperature is 8 degrees Celsius.',
  expectData: { machine_id: '27', internal_temperature: 8 },
  // 'pressure' is correctly absent: the fridge checklist has no pressure
  // field at all, so it's never attempted — not a bug, by design.
  expectAbsent: ['pressure'],
});

testCase({
  name: 'RO: tds_output extracts from plain "TDS is 180" (same class of fix)',
  checklist: RO_SERVICE_CHECKLIST,
  rawText: 'RO filter replaced and TDS is 180 ppm',
  expectData: { machine_id: undefined, tds_output: 180 }, // no machine id spoken here
});

// ---------------------------------------------------------------------------
// Unit parsing — the checklist's unit is honestly carried through into the
// verifier's own messages (units are never embedded in extracted_json
// itself; they come from checklist metadata, by design)
// ---------------------------------------------------------------------------

testCase({
  name: 'Unit parsing: an out-of-range fridge temperature reading names the correct unit (°C) in its message',
  run: () => {
    const result = verifyTask({
      checklist: FRIDGE_SERVICE_CHECKLIST,
      claim: { data: { machine_id: '27', internal_temperature: 15, cooling_verified: 'yes' } },
      evidence: [{ role: 'serial_photo' }, { role: 'cooling_photo' }],
    });
    const field = result.fields.find((f) => f.key === 'internal_temperature');
    return field.status === 'out_of_range' && field.message.includes('°C');
  },
});

testCase({
  name: 'Unit parsing: an out-of-range AC pressure reading names the correct unit (bar) in its message',
  run: () => {
    const result = verifyTask({
      checklist: AC_SERVICE_CHECKLIST,
      claim: { data: { machine_id: '27', pressure: 9, temperature: 80 } },
      evidence: [{ role: 'serial_photo' }, { role: 'final_photo' }],
    });
    const field = result.fields.find((f) => f.key === 'pressure');
    return field.status === 'out_of_range' && field.message.includes('bar');
  },
});

// ---------------------------------------------------------------------------
// Missing evidence stays honest — extraction fixes must never cause a false
// VERIFIED when required evidence/fields are genuinely still missing
// ---------------------------------------------------------------------------

testCase({
  name: 'Missing evidence: fridge claim with fields extracted but no photos/cooling_verified -> NEED_MORE_EVIDENCE or worse, never a false VERIFIED',
  run: () => {
    const result = verifyTask({
      checklist: FRIDGE_SERVICE_CHECKLIST,
      claim: { data: { machine_id: '27', internal_temperature: 8 } }, // cooling_verified not spoken
      evidence: [], // no photos uploaded
    });
    return result.decision !== 'VERIFIED';
  },
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runCase(def) {
  if (def.run) {
    return { pass: await def.run(), failures: [] };
  }
  const { data } = await extractClaimFromVoice({ rawText: def.rawText, checklist: def.checklist });
  const failures = [];
  for (const [key, expected] of Object.entries(def.expectData || {})) {
    if (expected === undefined) {
      if (Object.prototype.hasOwnProperty.call(data, key)) failures.push(`expected "${key}" to be absent, got ${data[key]}`);
      continue;
    }
    if (data[key] !== expected) failures.push(`"${key}": expected ${expected}, got ${data[key]}`);
  }
  for (const key of def.expectAbsent || []) {
    if (Object.prototype.hasOwnProperty.call(data, key)) failures.push(`expected "${key}" to be absent, got ${data[key]}`);
  }
  return { pass: failures.length === 0, failures };
}

async function main() {
  console.log(`\nRealityCheck claim-extraction eval — ${cases.length} cases (heuristic path, ANTHROPIC_API_KEY cleared)\n`);
  let passed = 0;
  for (const [i, def] of cases.entries()) {
    const num = String(i + 1).padStart(2, '0');
    const { pass, failures } = await runCase(def);
    if (pass) {
      passed += 1;
      console.log(`  PASS ${num}  ${def.name}`);
    } else {
      console.log(`  FAIL ${num}  ${def.name}`);
      for (const f of failures) console.log(`         - ${f}`);
    }
  }
  const total = cases.length;
  console.log(`\n${passed}/${total} passed (${Math.round((passed / total) * 100)}%)\n`);
  if (passed !== total) process.exitCode = 1;
}

main();
