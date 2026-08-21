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
];

export const RO_SERVICE_CHECKLIST = [
  {
    key: 'machine_id',
    label: 'Machine ID',
    type: 'id',
    required: true,
  },
  {
    key: 'tds_output',
    label: 'Output TDS reading',
    type: 'number',
    unit: 'ppm',
    tolerance: { min: 50, max: 150 },
    required: true,
    needsReference: true,
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
];

export const FRIDGE_SERVICE_CHECKLIST = [
  {
    key: 'machine_id',
    label: 'Machine ID',
    type: 'id',
    required: true,
  },
  {
    key: 'internal_temperature',
    label: 'Internal cabinet temperature',
    type: 'number',
    unit: '°C',
    tolerance: { min: 2, max: 8 },
    required: true,
    needsReference: true,
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
