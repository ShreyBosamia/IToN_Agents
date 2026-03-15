import { useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE = 'http://localhost:4000';
const EMPTY_FORM = {
  city: '',
  state: '',
  category: '',
  maxQueries: '',
  maxUrls: '',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-${status || 'unknown'}`}>{status || 'unknown'}</span>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value ?? '—'}</span>
    </div>
  );
}

function JobCard({ job, isActive, onOpen }) {
  return (
    <button
      type="button"
      className={`job-card ${isActive ? 'job-card-active' : ''}`}
      onClick={() => onOpen(job.id)}
    >
      <div className="job-card-header">
        <div>
          <h3>{job.inputs?.category || 'Uncategorized job'}</h3>
          <p>
            {job.inputs?.city}, {job.inputs?.state}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>
      <div className="job-meta-grid">
        <span>
          <strong>Job ID:</strong> {job.id}
        </span>
        <span>
          <strong>Created:</strong> {formatDate(job.createdAt)}
        </span>
      </div>
    </button>
  );
}

function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingJobDetail, setLoadingJobDetail] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [jobsError, setJobsError] = useState('');

  const hasRunningJobs = useMemo(
    () => jobs.some((job) => job.status === 'queued' || job.status === 'running'),
    [jobs]
  );

  async function fetchJobs() {
    try {
      setJobsError('');
      const response = await fetch(`${API_BASE}/api/pipelines`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to fetch jobs');
      setJobs(Array.isArray(data) ? data : []);

      setSelectedJobId((current) => {
        if (current && data.some((job) => job.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch (error) {
      setJobsError(error.message || 'Failed to load jobs');
    } finally {
      setLoadingJobs(false);
    }
  }

  async function fetchJobDetail(jobId) {
    if (!jobId) {
      setSelectedJob(null);
      return;
    }

    try {
      setLoadingJobDetail(true);
      const response = await fetch(`${API_BASE}/api/pipelines/${jobId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to fetch job');
      setSelectedJob(data);
    } catch (error) {
      setSelectedJob({
        id: jobId,
        error: { message: error.message || 'Failed to load job detail' },
      });
    } finally {
      setLoadingJobDetail(false);
    }
  }

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    fetchJobDetail(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!hasRunningJobs) return undefined;

    const interval = setInterval(() => {
      fetchJobs();
      if (selectedJobId) fetchJobDetail(selectedJobId);
    }, 2500);

    return () => clearInterval(interval);
  }, [hasRunningJobs, selectedJobId]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError('');

    const payload = {
      city: form.city.trim(),
      state: form.state.trim(),
      category: form.category.trim(),
      maxQueries: form.maxQueries === '' ? null : Number(form.maxQueries),
      maxUrls: form.maxUrls === '' ? null : Number(form.maxUrls),
    };

    try {
      const response = await fetch(`${API_BASE}/api/pipelines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Request failed');

      setForm(EMPTY_FORM);
      await fetchJobs();
      if (data?.id) {
        setSelectedJobId(data.id);
        await fetchJobDetail(data.id);
      }
    } catch (error) {
      setSubmitError(error.message || 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  }

  function handleInputChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  return (
    <div className="app-shell">
      <section className="panel form-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">IToN Retrieval Service</p>
            <h1>Submit pipeline jobs</h1>
          </div>
          <button type="button" className="secondary-button" onClick={fetchJobs}>
            Refresh jobs
          </button>
        </div>

        <form className="pipeline-form" onSubmit={handleSubmit}>
          <label>
            <span>City</span>
            <input
              name="city"
              value={form.city}
              onChange={handleInputChange}
              placeholder="Corvallis"
            />
          </label>
          <label>
            <span>State</span>
            <input name="state" value={form.state} onChange={handleInputChange} placeholder="OR" />
          </label>
          <label>
            <span>Category</span>
            <input
              name="category"
              value={form.category}
              onChange={handleInputChange}
              placeholder="FOOD_BANK"
            />
          </label>
          <label>
            <span>Per Query</span>
            <input
              name="maxQueries"
              type="number"
              min="0"
              value={form.maxQueries}
              onChange={handleInputChange}
              placeholder="3"
            />
          </label>
          <label>
            <span>Max URLs</span>
            <input
              name="maxUrls"
              type="number"
              min="0"
              value={form.maxUrls}
              onChange={handleInputChange}
              placeholder="3"
            />
          </label>

          {submitError ? <p className="error-text">{submitError}</p> : null}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Queue pipeline job'}
          </button>
        </form>
      </section>

      <section className="content-grid">
        <div className="panel jobs-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Jobs</p>
              <h2>Recent pipeline requests</h2>
            </div>
            <span className="jobs-count">{jobs.length}</span>
          </div>

          {loadingJobs ? <p className="muted-text">Loading jobs…</p> : null}
          {jobsError ? <p className="error-text">{jobsError}</p> : null}
          {!loadingJobs && jobs.length === 0 ? <p className="muted-text">No jobs yet.</p> : null}

          <div className="jobs-list">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isActive={job.id === selectedJobId}
                onOpen={setSelectedJobId}
              />
            ))}
          </div>
        </div>

        <div className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Details</p>
              <h2>{selectedJobId ? `Job ${selectedJobId}` : 'Select a job'}</h2>
            </div>
            {selectedJob?.status ? <StatusBadge status={selectedJob.status} /> : null}
          </div>

          {!selectedJobId ? (
            <p className="muted-text">Choose a job card to inspect its inputs and outputs.</p>
          ) : null}
          {selectedJobId && loadingJobDetail ? (
            <p className="muted-text">Loading job detail…</p>
          ) : null}

          {selectedJob?.error?.message && selectedJob?.status !== 'error' ? (
            <p className="error-text">{selectedJob.error.message}</p>
          ) : null}

          {selectedJobId && selectedJob && !loadingJobDetail ? (
            <div className="job-detail-stack">
              <div className="detail-section">
                <h3>Inputs</h3>
                <div className="detail-grid">
                  <DetailRow label="City" value={selectedJob.inputs?.city} />
                  <DetailRow label="State" value={selectedJob.inputs?.state} />
                  <DetailRow label="Category" value={selectedJob.inputs?.category} />
                  <DetailRow label="Max queries" value={selectedJob.inputs?.maxQueries ?? '—'} />
                  <DetailRow label="Max URLs" value={selectedJob.inputs?.maxUrls ?? '—'} />
                  <DetailRow label="Created" value={formatDate(selectedJob.createdAt)} />
                  <DetailRow label="Started" value={formatDate(selectedJob.startedAt)} />
                  <DetailRow label="Finished" value={formatDate(selectedJob.finishedAt)} />
                </div>
              </div>

              <div className="detail-section">
                <h3>Output</h3>
                {selectedJob.output ? (
                  <pre className="json-block">{prettyJson(selectedJob.output)}</pre>
                ) : (
                  <p className="muted-text">No output yet for this job.</p>
                )}
              </div>

              <div className="detail-section">
                <h3>Error</h3>
                {selectedJob.error ? (
                  <pre className="json-block error-block">{prettyJson(selectedJob.error)}</pre>
                ) : (
                  <p className="muted-text">No error recorded.</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default App;
