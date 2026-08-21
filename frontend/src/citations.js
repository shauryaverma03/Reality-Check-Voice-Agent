// Shared formatting for a RAG citation object — used by FieldBreakdown,
// TechnicianView, and TaskDetail so all three render the same "Source:
// <title>, Type: Web/PDF, Page: <page>, URL: <url>" shape consistently.

/** "Carrier 24VNA6/25VNA4 Service Manual — page 8, Compressor Operation" */
export function citationLabel(c) {
  const parts = [c.document_title];
  const locationBits = [];
  if (c.page) locationBits.push(`page ${c.page}`);
  if (c.section) locationBits.push(c.section);
  if (locationBits.length) parts.push(locationBits.join(', '));
  return parts.join(' — ');
}

/** "Carrier 24VNA6/25VNA4" or null if neither is known. */
export function citationEquipment(c) {
  return [c.manufacturer, c.model].filter(Boolean).join(' ') || null;
}
