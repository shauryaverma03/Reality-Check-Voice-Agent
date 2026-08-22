// Thin fetch wrapper over the REST API — one file to point at a different
// backend URL later. Mirrors the resource structure in
// backend/src/routes: tasks, and its sub-resources claims/evidence/verifications.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const API = `${API_BASE_URL}/api/v1`;

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the status text
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

export const api = {
  createTask: (payload) => request('/tasks', json(payload)),
  listTasks: (params) => request(`/tasks${toQuery(params)}`), // -> { data, pagination }
  getTask: (id) => request(`/tasks/${id}`),
  updateTask: (id, payload) => request(`/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  submitClaim: (id, rawText) => request(`/tasks/${id}/claims`, json({ raw_text: rawText })),
  listClaims: (id) => request(`/tasks/${id}/claims`),

  uploadEvidence: (id, role, file) => {
    const form = new FormData();
    form.append('role', role);
    form.append('file', file);
    return request(`/tasks/${id}/evidence`, { method: 'POST', body: form });
  },
  listEvidence: (id) => request(`/tasks/${id}/evidence`),

  verify: (id) => request(`/tasks/${id}/verifications`, { method: 'POST' }),
  listVerifications: (id) => request(`/tasks/${id}/verifications`),

  getReport: (id) => request(`/tasks/${id}/report`),

  listChecklists: () => request('/checklists'),
  getChecklist: (taskType) => request(`/checklists/${taskType}`),

  // Reference knowledge base — deliberately separate from task evidence
  // above. task_type omitted/empty = a "general" doc that applies to every service.
  uploadKnowledgeDoc: ({ title, taskType, file }) => {
    const form = new FormData();
    if (title) form.append('title', title);
    if (taskType) form.append('task_type', taskType);
    form.append('file', file);
    return request('/knowledge', { method: 'POST', body: form });
  },
  listKnowledgeDocs: (taskType) => request(`/knowledge${toQuery({ task_type: taskType })}`),

  // Supervisor reporting — daily (pass `date`) or custom range (`from`/`to`).
  getReportSummary: (params) => request(`/reports/summary${toQuery(params)}`),
  // Not a `request()` call — this is downloaded directly by the browser via
  // a plain link/window.open, not fetched+parsed as JSON.
  reportCsvUrl: (params) => `${API}/reports/export.csv${toQuery(params)}`,

  // Observability — token/cost totals, latency percentiles, prompt versions.
  getObservabilitySummary: (params) => request(`/observability/summary${toQuery(params)}`),
  listAgentRuns: (params) => request(`/observability/runs${toQuery(params)}`),
};
