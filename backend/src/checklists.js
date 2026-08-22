// Default checklists, keyed by task_type.
//
// A checklist is an array of field definitions. Each field has:
//   key           — the field name, matched against claim.data / evidence[].data keys
//   label         — human-readable name, used in messages and follow-up questions
//   type          — 'id' | 'number' | 'text' | 'photo' | 'document'
//   required      — whether the field must be present for VERIFIED
//   unit          — (number fields only) unit string, for display in messages
//   tolerance     — (number fields only) { min, max } acceptable range
//   needsReference— (number fields only, optional) if true, this field also
//                    needs its tolerance backed by a retrieved knowledge-base
//                    chunk before it can VERIFY — see rag/retrieve.js and
//                    verifier.js. Absent/false means "trust the checklist's
//                    own tolerance," which is how every existing field
//                    (including all of AC) behaves today.
//   functional    — (optional) if true, this field is evidence the machine is
//                    ACTUALLY WORKING after the repair, not merely evidence
//                    that a procedure was followed. See the note below.
//   evidenceStrength — (functional fields only) 'measured' | 'self_reported'.
//                    A number checked against a spec range is measured proof;
//                    a technician typing "yes, it works" is an assertion. The
//                    verifier reports these differently and never presents an
//                    assertion as if it were a measurement.
//
// ---------------------------------------------------------------------------
// COMPLIANCE vs. FUNCTION — the distinction this file encodes
// ---------------------------------------------------------------------------
// Most checklist fields prove COMPLIANCE: the right procedure was followed,
// the right paperwork exists, the readings taken are inside spec. That is
// genuinely useful, but it is NOT the same claim as "the appliance is
// physically working again." A technician can hit every compliance field on
// an AC job — correct machine ID, gas pressure in range, both photos — and
// the unit can still not be cooling the room.
//
// Fields marked `functional: true` are the ones that speak to post-repair
// OUTCOME: a measurement that can only be in range if the machine is
// actually doing its job (an AC's return-vs-supply air temperature split, an
// RO's output water quality and flow, a fridge's cabinet temperature after a
// real stabilization period, a washer's completed test cycle).
//
// The verifier evaluates these as a SEPARATE axis from compliance and labels
// the result accordingly, so a report never silently upgrades "the evidence
// is consistent" into "the machine works". Where the only available proof is
// the technician's own word (evidenceStrength: 'self_reported'), the result
// says so explicitly rather than counting it as demonstrated function.
//
// 'photo' and 'document' are both evidence-presence types: they're satisfied
// by an uploaded evidence item whose `role` matches the field key. 'document'
// exists for technician-submitted paperwork (job card, invoice, warranty
// slip) — it is NOT for manufacturer manuals/SOPs. Those are reference
// knowledge, live only in the separate knowledge_documents/knowledge_chunks
// tables (see rag/), and are never a checklist evidence field.
//
// This is the seed data for the `checklists` DB table (see db/seed.js). It's
// kept here as plain JS so the verifier and its eval harness can import it
// directly with zero DB dependency.

export const AC_SERVICE_CHECKLIST = [
  {
    key: 'machine_id',
    label: 'Machine ID',
    type: 'id',
    required: true,
  },
  {
    key: 'pressure',
    label: 'Gas pressure',
    type: 'number',
    unit: 'bar',
    tolerance: { min: 3.8, max: 4.5 },
    required: true,
  },
  {
    key: 'temperature',
    label: 'Outlet temperature',
    type: 'number',
    unit: '°C',
    tolerance: { min: 70, max: 85 },
    required: true,
  },
  {
    key: 'serial_photo',
    label: 'Serial number / nameplate photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'final_photo',
    label: 'Final condition photo',
    type: 'photo',
    required: true,
  },
  // FUNCTIONAL: the standard HVAC "delta T" test — return-air temperature
  // minus supply-air temperature at the vent. Gas pressure being in range
  // says the refrigerant circuit looks right; only this says the unit is
  // actually removing heat from the room. A healthy split AC pulls roughly
  // 8-14°C; a unit that is "serviced" but not cooling reads far lower.
  {
    key: 'cooling_delta',
    label: 'Cooling performance (return-air minus supply-air temperature)',
    type: 'number',
    unit: '°C',
    tolerance: { min: 8, max: 14 },
    required: false,
    functional: true,
    evidenceStrength: 'measured',
  },
];

export const RO_SERVICE_CHECKLIST = [
  {
    key: 'machine_id',
    label: 'Machine ID',
    type: 'id',
    required: true,
  },
  // FUNCTIONAL: output water quality is the whole point of an RO unit — a
  // reading inside spec can only happen if the membrane and filters are
  // actually working post-service, which is why this one field is both a
  // compliance check and genuine functional proof.
  {
    key: 'tds_output',
    label: 'Output TDS',
    type: 'number',
    unit: 'ppm',
    tolerance: { min: 50, max: 150 },
    required: true,
    needsReference: true,
    functional: true,
    evidenceStrength: 'measured',
  },
  {
    key: 'filter_replaced',
    label: 'Filter replacement status',
    type: 'text',
    required: true,
  },
  {
    key: 'serial_photo',
    label: 'Serial number / nameplate photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'filter_photo',
    label: 'Replaced filter photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'job_card',
    label: 'Job card / service report',
    type: 'document',
    required: false,
  },
  // FUNCTIONAL: clean water that barely trickles is still a broken unit.
  // Domestic RO systems deliver roughly 8-20 L/hr at the tap; a clogged
  // membrane or a failing pump shows up here and nowhere else on this list.
  {
    key: 'water_flow_rate',
    label: 'Output water flow rate',
    type: 'number',
    unit: 'L/hr',
    tolerance: { min: 8, max: 20 },
    required: false,
    functional: true,
    evidenceStrength: 'measured',
  },
];

export const FRIDGE_SERVICE_CHECKLIST = [
  {
    key: 'machine_id',
    label: 'Machine ID',
    type: 'id',
    required: true,
  },
  // FUNCTIONAL: a cabinet that holds 2-8°C is, by definition, refrigerating.
  // Only meaningful alongside stabilization_minutes below — a reading taken
  // sixty seconds after the door closed proves nothing.
  {
    key: 'internal_temperature',
    label: 'Internal cabinet temperature',
    type: 'number',
    unit: '°C',
    tolerance: { min: 2, max: 8 },
    required: true,
    needsReference: true,
    functional: true,
    evidenceStrength: 'measured',
  },
  {
    key: 'cooling_verified',
    label: 'Cooling verification',
    type: 'text',
    required: true,
  },
  {
    key: 'serial_photo',
    label: 'Serial number / nameplate photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'cooling_photo',
    label: 'Cooling/thermometer photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'job_card',
    label: 'Job card / service report',
    type: 'document',
    required: false,
  },
  // FUNCTIONAL QUALIFIER: how long the unit actually ran before the cabinet
  // temperature above was read. Without this, an in-range reading could just
  // be residual cold from before the service call. 15 minutes is the floor
  // for a reading to mean anything; 240 caps obvious data-entry errors.
  {
    key: 'stabilization_minutes',
    label: 'Run time before temperature reading',
    type: 'number',
    unit: 'min',
    tolerance: { min: 15, max: 240 },
    required: false,
    functional: true,
    evidenceStrength: 'measured',
  },
];

export const WASHER_SERVICE_CHECKLIST = [
  {
    key: 'machine_id',
    label: 'Machine ID',
    type: 'id',
    required: true,
  },
  {
    key: 'drainage_check',
    label: 'Drainage check',
    type: 'text',
    required: true,
  },
  {
    key: 'vibration_check',
    label: 'Vibration/noise check',
    type: 'text',
    required: true,
  },
  {
    key: 'serial_photo',
    label: 'Serial number / nameplate photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'error_code_photo',
    label: 'Error code / display photo',
    type: 'photo',
    required: true,
  },
  {
    key: 'job_card',
    label: 'Job card / service report',
    type: 'document',
    required: false,
  },
  // FUNCTIONAL: a full test cycle completing without re-throwing the fault is
  // the only thing on this list that shows the machine actually runs. Marked
  // self_reported deliberately — this is the technician's assertion, not a
  // measurement, and the verifier presents it as exactly that rather than
  // dressing an assertion up as proof.
  {
    key: 'test_cycle_completed',
    label: 'Post-repair test cycle completed without fault',
    type: 'text',
    required: false,
    functional: true,
    evidenceStrength: 'self_reported',
  },
];

export const CHECKLISTS_BY_TASK_TYPE = {
  'ac-service': AC_SERVICE_CHECKLIST,
  'ro-service': RO_SERVICE_CHECKLIST,
  'fridge-service': FRIDGE_SERVICE_CHECKLIST,
  'washer-service': WASHER_SERVICE_CHECKLIST,
};

export function getChecklist(taskType) {
  const checklist = CHECKLISTS_BY_TASK_TYPE[taskType];
  if (!checklist) {
    throw new Error(`No checklist defined for task_type "${taskType}"`);
  }
  return checklist;
}
