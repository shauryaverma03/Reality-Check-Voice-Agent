import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import FieldBreakdown from '../components/FieldBreakdown.jsx';

const SpeechRecognitionAPI =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const PHOTO_ROLES = [
  { key: 'serial_photo', label: 'Serial number / nameplate photo' },
  { key: 'final_photo', label: 'Final condition photo' },
];

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function TechnicianView() {
  const [unitId, setUnitId] = useState('');
  const [technician, setTechnician] = useState('');
  const [task, setTask] = useState(null);
  const [creating, setCreating] = useState(false);

  const [claimText, setClaimText] = useState('');
  const [listening, setListening] = useState(false);
  const [submittingClaim, setSubmittingClaim] = useState(false);

  const [uploaded, setUploaded] = useState({ serial_photo: null, final_photo: null });
  const [uploadingRole, setUploadingRole] = useState(null);

  const [verification, setVerification] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const threadEndRef = useRef(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function pushMessage(role, text) {
    setMessages((prev) => [...prev, { role, text, at: nowLabel() }]);
  }

  async function handleCreateTask(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createTask({ task_type: 'ac-service', unit_id: unitId, technician });
      setTask(created);
      setMessages([]);
      pushMessage('system', `New job started for unit ${unitId || '(unspecified)'}. Speak or type your claim, then upload both evidence photos.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function toggleListening() {
    if (!SpeechRecognitionAPI) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      }
      if (finalTranscript) {
        setClaimText((prev) => (prev ? `${prev} ${finalTranscript}` : finalTranscript).trim());
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function handleSubmitClaim(e) {
    e.preventDefault();
    if (!task || !claimText.trim()) return;
    setError(null);
    setSubmittingClaim(true);
    pushMessage('technician', claimText.trim());
    try {
      const claim = await api.submitClaim(task.id, claimText.trim());
      const fields = Object.entries(claim.extracted)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      pushMessage(
        'system',
        fields
          ? `Got it. Extracted: ${fields} (via ${claim.extraction_source}).`
          : `Heard you, but couldn't extract any structured fields from that — try including the machine ID and readings explicitly.`
      );
      setClaimText('');
    } catch (err) {
      setError(err.message);
      pushMessage('system', `Couldn't record that claim: ${err.message}`);
    } finally {
      setSubmittingClaim(false);
    }
  }

  async function handleUploadPhoto(role, file) {
    if (!task || !file) return;
    setError(null);
    setUploadingRole(role);
    try {
      const evidence = await api.uploadEvidence(task.id, role, file);
      setUploaded((prev) => ({ ...prev, [role]: evidence }));
      const label = PHOTO_ROLES.find((r) => r.key === role)?.label || role;
      const extractedKeys = Object.keys(evidence.extracted || {});
      pushMessage(
        'system',
        `Uploaded ${label} ✅${extractedKeys.length ? ` (read: ${extractedKeys.map((k) => `${k}=${evidence.extracted[k]}`).join(', ')})` : ''}`
      );
    } catch (err) {
      setError(err.message);
      pushMessage('system', `Upload failed for ${role}: ${err.message}`);
    } finally {
      setUploadingRole(null);
    }
  }

  async function handleVerify() {
    if (!task) return;
    setError(null);
    setVerifying(true);
    try {
      const result = await api.verify(task.id);
      setVerification(result);
      setTask((prev) => ({
        ...prev,
        status: { VERIFIED: 'verified', NEED_MORE_EVIDENCE: 'need_more_evidence', CONFLICT_HUMAN_REVIEW: 'conflict' }[result.decision],
      }));
      if (result.decision === 'VERIFIED') {
        pushMessage('system', `✅ VERIFIED — evidence score ${result.evidence_score}/100.`);
      } else if (result.decision === 'NEED_MORE_EVIDENCE') {
        pushMessage('system', `❓ ${result.follow_up_question}`);
      } else {
        const bad = result.fields.filter((f) => f.status === 'contradiction' || f.status === 'out_of_range');
        pushMessage(
          'system',
          `🚩 CONFLICT — needs human review. ${bad.map((f) => f.message).join(' ')}`
        );
      }
    } catch (err) {
      setError(err.message);
      pushMessage('system', `Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  }

  if (!task) {
    return (
      <div className="card narrow">
        <h1>Start a job</h1>
        <p className="muted">AC / RO annual maintenance — speak your claim, upload evidence, get verified.</p>
        <form onSubmit={handleCreateTask} className="form">
          <label>
            Unit / machine ID
            <input value={unitId} onChange={(e) => setUnitId(e.target.value)} placeholder="e.g. 27" />
          </label>
          <label>
            Technician name
            <input value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="e.g. Rakesh" />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn primary" disabled={creating}>
            {creating ? 'Starting…' : 'Start Job'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="technician-layout">
      <div className="card">
        <div className="task-header">
          <div>
            <h1>Job — Unit {task.unit_id || '—'}</h1>
            <p className="muted">Technician: {task.technician || '—'} · Task ID: {task.id.slice(0, 8)}</p>
          </div>
          <StatusPill status={task.status} />
        </div>

        <section className="section">
          <h2>1. Speak your claim</h2>
          <form onSubmit={handleSubmitClaim} className="claim-form">
            <textarea
              value={claimText}
              onChange={(e) => setClaimText(e.target.value)}
              placeholder='e.g. "Machine 27 ka maintenance complete kar diya, pressure 4.2 bar hai, temperature 82 degree hai"'
              rows={3}
            />
            <div className="claim-actions">
              {SpeechRecognitionAPI ? (
                <button type="button" className={`btn ${listening ? 'danger' : 'secondary'}`} onClick={toggleListening}>
                  {listening ? '⏹ Stop recording' : '🎤 Record claim'}
                </button>
              ) : (
                <span className="muted small">Speech recognition not supported in this browser — type your claim.</span>
              )}
              <button type="submit" className="btn primary" disabled={submittingClaim || !claimText.trim()}>
                {submittingClaim ? 'Submitting…' : 'Submit claim'}
              </button>
            </div>
          </form>
        </section>

        <section className="section">
          <h2>2. Upload evidence photos</h2>
          <div className="photo-grid">
            {PHOTO_ROLES.map(({ key, label }) => (
              <div key={key} className="photo-slot">
                <label className="photo-label">{label}</label>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingRole === key}
                  onChange={(e) => e.target.files[0] && handleUploadPhoto(key, e.target.files[0])}
                />
                {uploadingRole === key && <span className="muted small">Uploading…</span>}
                {uploaded[key] && uploadingRole !== key && <span className="upload-check">✅ uploaded</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2>3. Verify</h2>
          <button className="btn primary large" onClick={handleVerify} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Run Verification'}
          </button>
          {verification && (
            <div className={`status-card status-card-${verification.decision}`}>
              <div className="status-card-heading">
                <StatusPill status={{ VERIFIED: 'verified', NEED_MORE_EVIDENCE: 'need_more_evidence', CONFLICT_HUMAN_REVIEW: 'conflict' }[verification.decision]} />
                <span className="score">Evidence score: {verification.evidence_score}/100</span>
              </div>
              {verification.follow_up_question && (
                <p className="follow-up">Follow-up: {verification.follow_up_question}</p>
              )}
              <FieldBreakdown fields={verification.fields} />
            </div>
          )}
        </section>
      </div>

      <div className="card thread-card">
        <h2>RealityCheck</h2>
        <div className="thread">
          {messages.map((m, i) => (
            <div key={i} className={`bubble bubble-${m.role}`}>
              <div className="bubble-text">{m.text}</div>
              <div className="bubble-time">{m.at}</div>
            </div>
          ))}
          <div ref={threadEndRef} />
        </div>
      </div>
    </div>
  );
}
