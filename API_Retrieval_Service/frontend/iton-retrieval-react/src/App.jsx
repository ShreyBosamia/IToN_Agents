import { useEffect, useMemo, useState } from 'react';
import './App.css';
import JobDetailsPanel from './components/JobDetailsPanel';
import JobsPanel from './components/JobsPanel';
import PipelineForm from './components/PipelineForm';

const API_BASE = 'http://localhost:4000';
const EMPTY_FORM = {
  city: '',
  state: '',
  category: '',
  perQuery: '',
  maxUrls: '',
};

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
    };
    if (form.perQuery !== '') payload.perQuery = Number(form.perQuery);
    if (form.maxUrls !== '') payload.maxUrls = Number(form.maxUrls);

    try {
      const response = await fetch(`${API_BASE}/api/pipelines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        const fieldErrors = Array.isArray(data?.errors)
          ? data.errors.map((item) => item.message).join(' ')
          : '';
        throw new Error(fieldErrors || data?.error || 'Request failed');
      }

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
      <PipelineForm
        form={form}
        submitting={submitting}
        submitError={submitError}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        onRefreshJobs={fetchJobs}
      />

      <section className="content-grid">
        <JobsPanel
          jobs={jobs}
          loadingJobs={loadingJobs}
          jobsError={jobsError}
          selectedJobId={selectedJobId}
          onOpenJob={setSelectedJobId}
        />

        <JobDetailsPanel
          selectedJobId={selectedJobId}
          selectedJob={selectedJob}
          loadingJobDetail={loadingJobDetail}
        />
      </section>
    </div>
  );
}

export default App;
