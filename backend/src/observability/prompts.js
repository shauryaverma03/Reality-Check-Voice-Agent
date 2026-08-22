// Prompt versioning.
//
// Every prompt this app sends to Claude is built by a registered builder with
// an explicit semantic version. The version — plus a content hash of the
// prompt text actually sent — is recorded on every agent_run, so a change in
// extraction behaviour can be traced back to the exact prompt revision that
// produced it. Without this, "the extractor got worse last Tuesday" is
// unanswerable.
//
// Rules for editing a prompt:
//   1. Change the template.
//   2. Bump its `version` here in the same commit.
//   3. Add a line to its `changelog`.
// The hash catches the case where someone forgets step 2: two different
// hashes under one version number is a visible inconsistency in the
// observability view, not a silent one.

import { createHash } from 'node:crypto';

export const PROMPTS = {
  claim_extraction: {
    version: '1.2.0',
    changelog: [
      '1.0.0 — initial checklist-driven claim extraction',
      '1.1.0 — build field list from the task checklist instead of hardcoded AC keys',
      '1.2.0 — include text-type fields so completion/status statements are extractable',
    ],
  },
  photo_extraction: {
    version: '2.1.0',
    changelog: [
      '1.0.0 — initial per-role photo field extraction',
      '2.0.0 — added readability/quality assessment (readable + quality_issue) before extraction',
      '2.1.0 — added service-aware equipment-identity check (wrong_subject) using the task type',
    ],
  },
};

/** Short, stable fingerprint of the exact prompt text sent. */
export function hashPrompt(text) {
  return createHash('sha256').update(text || '').digest('hex').slice(0, 12);
}

/**
 * @param {keyof PROMPTS} key
 * @param {string} renderedText — the fully-built prompt actually sent
 * @returns {{ prompt_key: string, prompt_version: string, prompt_hash: string }}
 */
export function promptMeta(key, renderedText) {
  const entry = PROMPTS[key];
  return {
    prompt_key: key,
    prompt_version: entry ? entry.version : 'unregistered',
    prompt_hash: hashPrompt(renderedText),
  };
}
