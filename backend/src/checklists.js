// Default checklists, keyed by task_type.
//
// A checklist is an array of field definitions. Each field has:
//   key      — the field name, matched against claim.data / evidence[].data keys
//   label    — human-readable name, used in messages and follow-up questions
//   type     — 'id' | 'number' | 'photo' | 'text'
//   required — whether the field must be present for VERIFIED
//   unit     — (number fields only) unit string, for display in messages
//   tolerance— (number fields only) { min, max } acceptable range
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

export const CHECKLISTS_BY_TASK_TYPE = {
  'ac-service': AC_SERVICE_CHECKLIST,
};

export function getChecklist(taskType) {
  const checklist = CHECKLISTS_BY_TASK_TYPE[taskType];
  if (!checklist) {
    throw new Error(`No checklist defined for task_type "${taskType}"`);
  }
  return checklist;
}
