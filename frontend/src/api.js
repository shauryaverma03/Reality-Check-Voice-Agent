// Thin fetch wrapper — one file to point at a different backend URL later.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
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

export const api = {
  createTask: (payload) => request('/tasks', json(payload)),
  listTasks: () => request('/tasks'),
  getTask: (id) => request(`/tasks/${id}`),
  submitClaim: (id, rawText) => request(`/tasks/${id}/claim`, json({ raw_text: rawText })),
  uploadEvidence: (id, role, file) => {
    const form = new FormData();
    form.append('role', role);
    form.append('file', file);
    return request(`/tasks/${id}/evidence`, { method: 'POST', body: form });
  },
  verify: (id) => request(`/tasks/${id}/verify`, { method: 'POST' }),
  getReport: (id) => request(`/tasks/${id}/report`),
};
