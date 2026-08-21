// Onboarding tour config + small localStorage helpers. Kept separate from
// the component so the step list is easy to scan/edit on its own.

const STORAGE_KEY = 'realitycheck:tour-completed';

export function isTourCompleted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourCompleted() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* localStorage unavailable — tour just re-shows next visit, harmless */
  }
}

// Each step optionally names a `path` it needs to be on (the tour will
// navigate there) and a `selector` to spotlight. A step with no selector is
// shown centered, with a plain dimmed backdrop and no spotlight cutout.
export const TOUR_STEPS = [
  {
    path: '/',
    selector: null,
    title: 'Welcome to RealityCheck',
    body: "A quick 10-step tour of how a job goes from a technician's spoken claim to a verified, evidence-backed decision. Skip any time — you can replay this from the Guide page later.",
  },
  {
    path: '/',
    selector: '[data-tour="nav-technician"]',
    title: 'Technician',
    body: 'Where a technician starts a job, states their claim, and uploads evidence.',
  },
  {
    path: '/',
    selector: '[data-tour="nav-supervisor"]',
    title: 'Supervisor',
    body: 'A live dashboard of every job — status, evidence score, and a full per-field breakdown for anything flagged for human review.',
  },
  {
    path: '/',
    selector: '[data-tour="nav-guide"]',
    title: 'Guide',
    body: "A reference page covering all four services, what each decision means, and how retrieval-backed verification works. You're one click from it any time.",
  },
  {
    path: '/',
    selector: '[data-tour="nav-theme"]',
    title: 'Light, dark, and palette',
    body: 'Switch light/dark mode or the color palette here — your choice is saved and respected on your next visit.',
  },
  {
    path: '/technician',
    selector: '[data-tour="service-select"]',
    title: 'Choose a service',
    body: 'RealityCheck supports four service types today — AC, RO/water purifier, refrigerator, and washing machine — each with its own checklist of what needs to be verified.',
  },
  {
    path: '/technician',
    selector: '[data-tour="claim-section"]',
    title: 'State your claim',
    body: 'Speak (or type) what you did, in your own words — task, machine ID, and any readings. RealityCheck extracts the structured fields automatically.',
  },
  {
    path: '/technician',
    selector: '[data-tour="evidence-section"]',
    title: 'Provide evidence',
    body: 'Upload the photos (and documents, for some services) the checklist requires. Each card shows whether it is required and whether it has been provided yet.',
  },
  {
    path: '/technician',
    selector: '[data-tour="verify-section"]',
    title: 'Run verification',
    body: 'RealityCheck cross-checks your claim against your evidence and, where relevant, retrieved reference knowledge — then returns one of four honest decisions, never a guess.',
  },
  {
    path: '/technician',
    selector: null,
    title: "You're ready",
    body: 'That\'s the full loop. Head to the Guide page any time for the complete reference, including what each decision means and how the reference-knowledge retrieval works.',
  },
];
