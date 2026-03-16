import { startTransition, useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
const STAFF_LOGO = 'https://www.figma.com/api/mcp/asset/d7efa972-2548-4b25-bb06-ee66437da185';
const ICON_COMPOSE = 'https://www.figma.com/api/mcp/asset/c3d48aef-aca6-40a8-b507-70bcc2e552c2';
const ICON_SEARCH = 'https://www.figma.com/api/mcp/asset/864c01f3-089c-4037-8d91-32b912f1bf2f';
const ICON_FOLDER_ADD = 'https://www.figma.com/api/mcp/asset/02bdc168-b9fc-4506-8ebe-a11852c89e9a';
const ICON_FOLDER = 'https://www.figma.com/api/mcp/asset/46bc8ae4-c669-4443-9a59-07d5c779bdb7';

const EMPTY_FORM = {
  city: '',
  state: '',
  category: '',
  perQuery: '',
  maxUrls: '',
};

const EMPTY_PROVIDER_DRAFT = {
  name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  serviceTypes: '',
  latitude: '',
  longitude: '',
  description: '',
  hours: '',
};

function formatSnakeCase(value) {
  if (!value) return 'Unknown';
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value) {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'null' && normalized !== 'undefined';
  }
  return true;
}

function plainTextFromPortableText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .flatMap((block) => (Array.isArray(block?.children) ? block.children : []))
    .map((child) => child?.text || '')
    .join(' ')
    .trim();
}

function jobLabel(job) {
  if (!job?.input) return 'Untitled job';
  return `${job.input.city || ''} ${job.input.state || ''} ${formatSnakeCase(job.input.category)}`.trim();
}

function truncateLabel(value, maxLength = 28) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function statusLabel(status) {
  if (!status) return 'No job selected';
  if (status === 'queued' || status === 'running') return 'Job Processing';
  if (status === 'ready_for_review') return 'Review Ready';
  if (status === 'approved') return 'Approved';
  if (status === 'denied') return 'Denied';
  if (status === 'failed') return 'Failed';
  if (status === 'canceled') return 'Canceled';
  return formatSnakeCase(status);
}

function statusTone(status) {
  if (status === 'queued' || status === 'running') return 'processing';
  if (status === 'ready_for_review' || status === 'approved') return 'ready';
  if (status === 'denied' || status === 'failed' || status === 'canceled') return 'danger';
  return 'neutral';
}

function getHostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function serializeProvider(record) {
  const serviceTypes = Array.isArray(record?.serviceTypes)
    ? record.serviceTypes.map((item) => item?._id).filter(Boolean).join(', ')
    : '';
  const hours = Array.isArray(record?.hoursOfOperation?.weekdayText)
    ? record.hoursOfOperation.weekdayText.join('\n')
    : '';

  return {
    name: hasMeaningfulValue(record?.name) ? record.name : '',
    address: hasMeaningfulValue(record?.address) ? record.address : '',
    phone: hasMeaningfulValue(record?.contact?.phone) ? record.contact.phone : '',
    email: hasMeaningfulValue(record?.contact?.email) ? record.contact.email : '',
    website: hasMeaningfulValue(record?.contact?.website) ? record.contact.website : '',
    serviceTypes,
    latitude: hasMeaningfulValue(record?.location?.latitude) ? String(record.location.latitude) : '',
    longitude: hasMeaningfulValue(record?.location?.longitude) ? String(record.location.longitude) : '',
    description: plainTextFromPortableText(record?.description),
    hours,
  };
}

function deserializeProvider(draft, existingRecord) {
  const latitude = draft.latitude.trim() === '' ? null : Number(draft.latitude);
  const longitude = draft.longitude.trim() === '' ? null : Number(draft.longitude);
  const serviceTypes = draft.serviceTypes
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ _id: item }));
  const hours = draft.hours
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    ...existingRecord,
    name: draft.name.trim() || null,
    address: draft.address.trim() || null,
    description: [
      {
        _type: 'block',
        children: [{ _type: 'span', text: draft.description.trim() || 'No description added.' }],
        markDefs: [],
        style: 'normal',
      },
    ],
    location: {
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
    },
    serviceTypes,
    hoursOfOperation: {
      periods: existingRecord?.hoursOfOperation?.periods || [],
      weekdayText: hours,
    },
    contact: {
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      website: draft.website.trim() || null,
    },
  };
}

function NavRow({ icon, label, active = false, onClick, collapsed = false }) {
  return (
    <button
      type="button"
      className={`nav-row ${collapsed ? 'nav-row-collapsed' : ''} ${active ? 'nav-row-active' : ''}`}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <img src={icon} alt="" aria-hidden="true" className="nav-icon" />
      {!collapsed ? <span>{label}</span> : null}
    </button>
  );
}

function JobNavRow({ job, active, onSelect }) {
  return (
    <button
      type="button"
      className={`job-nav-row ${active ? 'job-nav-row-active' : ''}`}
      onClick={() => onSelect(job.id)}
    >
      <span>{truncateLabel(jobLabel(job), 30)}</span>
    </button>
  );
}

function ProjectNavRow({ project, active, collapsed, onSelect }) {
  return (
    <button
      type="button"
      className={`project-nav-row ${collapsed ? 'project-nav-row-collapsed' : ''} ${active ? 'project-nav-row-active' : ''}`}
      onClick={() => onSelect(project.id)}
      title={collapsed ? project.name : undefined}
    >
      <img src={ICON_FOLDER} alt="" aria-hidden="true" className="nav-icon" />
      {!collapsed ? <span>{project.name}</span> : null}
    </button>
  );
}

function ProviderListRow({ provider, active, onSelect }) {
  const name = hasMeaningfulValue(provider?.name) ? provider.name : 'Unnamed provider';
  const address = hasMeaningfulValue(provider?.address) ? provider.address : 'Address unavailable';

  return (
    <button
      type="button"
      className={`provider-row ${active ? 'provider-row-active' : ''}`}
      onClick={onSelect}
    >
      <strong>{name}</strong>
      <span>{truncateLabel(address, 46)}</span>
    </button>
  );
}

function DetailField({ label, name, value, onChange, multiline = false }) {
  return (
    <label className={`detail-field ${multiline ? 'detail-field-multiline' : ''}`}>
      <span>{label}</span>
      {multiline ? (
        <textarea name={name} value={value} onChange={onChange} />
      ) : (
        <input name={name} value={value} onChange={onChange} />
      )}
    </label>
  );
}

function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [sessionCreatedJobId, setSessionCreatedJobId] = useState(null);
  const [sidebarMode, setSidebarMode] = useState('new');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jobSearch, setJobSearch] = useState('');
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
  const [providerDraft, setProviderDraft] = useState(EMPTY_PROVIDER_DRAFT);
  const [submitError, setSubmitError] = useState('');
  const [jobsError, setJobsError] = useState('');
  const [actionError, setActionError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionPending, setActionPending] = useState('');

  const records = useMemo(
    () => (Array.isArray(selectedJob?.output?.sanity) ? selectedJob.output.sanity : []),
    [selectedJob]
  );
  const extractedEntries = useMemo(
    () => (Array.isArray(selectedJob?.output?.extracted) ? selectedJob.output.extracted : []),
    [selectedJob]
  );
  const filteredJobs = useMemo(() => {
    const query = jobSearch.trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((job) => {
      const label = jobLabel(job).toLowerCase();
      const id = job.id?.toLowerCase?.() || '';
      return label.includes(query) || id.includes(query);
    });
  }, [jobSearch, jobs]);
  const selectedProvider = records[selectedProviderIndex] || null;
  const selectedSourceUrl = extractedEntries[selectedProviderIndex]?.url || selectedJob?.output?.urls?.[selectedProviderIndex] || '';
  const shouldPoll = jobs.some((job) => job.status === 'queued' || job.status === 'running');
  const formLocked = Boolean(selectedJobId || sessionCreatedJobId);
  const currentCardStatus = selectedJobId ? selectedJob?.status : null;
  const currentCardMode = !formLocked
    ? 'default'
    : currentCardStatus === 'queued' || currentCardStatus === 'running' || !currentCardStatus
      ? 'processing'
      : 'finished';
  const currentCardTitle =
    currentCardMode === 'processing'
      ? 'Processing Job'
      : currentCardMode === 'finished'
        ? currentCardStatus === 'failed'
          ? 'Job Failed'
          : currentCardStatus === 'canceled'
            ? 'Job Canceled'
          : 'Job Finished'
        : 'Create Job';
  const displayedFormValues = selectedJobId && selectedJob?.input
    ? {
        city: selectedJob.input.city || '',
        state: selectedJob.input.state || '',
        category: selectedJob.input.category || '',
        perQuery: selectedJob.input.perQuery != null ? String(selectedJob.input.perQuery) : '',
        maxUrls: selectedJob.input.maxUrls != null ? String(selectedJob.input.maxUrls) : '',
      }
    : form;
  const showProviderLoadingState = loadingDetail && !records.length && !selectedJob?.output;

  async function fetchJobs() {
    try {
      setJobsError('');
      const response = await fetch(`${API_BASE}/jobs`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load jobs');
      }

      const nextJobs = Array.isArray(data) ? data : [];
      setJobs(nextJobs);
      setSelectedJobId((current) => (current && nextJobs.some((job) => job.id === current) ? current : null));
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
      setLoadingDetail(true);
      const response = await fetch(`${API_BASE}/jobs/${jobId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load job');
      }
      setSelectedJob(data);
    } catch (error) {
      setActionError(error.message || 'Failed to load job');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void fetchJobs();
  }, []);

  useEffect(() => {
    void fetchJobDetail(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void fetchJobs();
      if (selectedJobId) {
        void fetchJobDetail(selectedJobId);
      }
    }, 2500);

    return () => window.clearInterval(interval);
  }, [selectedJobId, shouldPoll]);

  useEffect(() => {
    if (!records.length) {
      setSelectedProviderIndex(0);
      setProviderDraft(EMPTY_PROVIDER_DRAFT);
      return;
    }

    const nextIndex = Math.min(selectedProviderIndex, records.length - 1);
    setSelectedProviderIndex(nextIndex);
    setProviderDraft(serializeProvider(records[nextIndex]));
  }, [records, selectedProviderIndex]);

  function handleFormChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleNewJobClick() {
    setSidebarMode('new');
    setJobSearch('');
    setActionError('');
    setSaveMessage('');

    if (sessionCreatedJobId) {
      startTransition(() => setSelectedJobId(sessionCreatedJobId));
      return;
    }

    startTransition(() => setSelectedJobId(null));
    setSelectedJob(null);
    setForm(EMPTY_FORM);
  }

  function handleSelectJob(jobId) {
    setSidebarMode('jobs');
    setActionError('');
    setSaveMessage('');
    startTransition(() => setSelectedJobId(jobId));
  }

  function handleCreateProject() {
    const nextProject = {
      id: `project-${Date.now()}`,
      name: `Project ${projects.length + 1}`,
    };
    setProjects((current) => [...current, nextProject]);
    setSelectedProjectId(nextProject.id);
    setSidebarMode('projects');
    setSidebarCollapsed(false);
  }

  function handleDraftChange(event) {
    const { name, value } = event.target;
    setSaveMessage('');
    setProviderDraft((current) => ({ ...current, [name]: value }));
  }

  function handleSelectProvider(index) {
    setSelectedProviderIndex(index);
    setProviderDraft(serializeProvider(records[index]));
    setSaveMessage('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (formLocked) return;
    setSubmitting(true);
    setSubmitError('');

    const payload = {
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      category: form.category.trim().toUpperCase(),
      perQuery: form.perQuery.trim() === '' ? undefined : Number(form.perQuery),
      maxUrls: form.maxUrls.trim() === '' ? undefined : Number(form.maxUrls),
    };

    try {
      const response = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create job');
      }

      if (data?.id) {
        setSessionCreatedJobId(data.id);
      }
      await fetchJobs();
      if (data?.id) {
        setSidebarMode('jobs');
        startTransition(() => setSelectedJobId(data.id));
        await fetchJobDetail(data.id);
      }
    } catch (error) {
      setSubmitError(error.message || 'Failed to create job');
    } finally {
      setSubmitting(false);
    }
  }

  function handleSaveEdits() {
    if (!selectedJob || !selectedProvider) return;

    const updatedRecord = deserializeProvider(providerDraft, selectedProvider);
    const nextRecords = records.map((record, index) => (index === selectedProviderIndex ? updatedRecord : record));

    setSelectedJob((current) => ({
      ...current,
      output: {
        ...current.output,
        sanity: nextRecords,
      },
    }));
    setSaveMessage('Edits saved locally in this review session.');
  }

  async function handleReviewAction(action) {
    if (!selectedJobId) return;

    try {
      setActionPending(action);
      setActionError('');
      const response = await fetch(`${API_BASE}/jobs/${selectedJobId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Failed to ${action} job`);
      }

      setSelectedJob(data);
      await fetchJobs();
    } catch (error) {
      setActionError(error.message || `Failed to ${action} job`);
    } finally {
      setActionPending('');
    }
  }

  async function handleCancelJob() {
    if (!selectedJobId) return;

    try {
      setActionPending('cancel');
      setActionError('');
      const response = await fetch(`${API_BASE}/jobs/${selectedJobId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to cancel job');
      }

      setSelectedJob(data);
      setSessionCreatedJobId(null);
      setSidebarMode('new');
      startTransition(() => setSelectedJobId(null));
      setSelectedJob(null);
      setForm(EMPTY_FORM);
      await fetchJobs();
    } catch (error) {
      setActionError(error.message || 'Failed to cancel job');
    } finally {
      setActionPending('');
    }
  }

  const reviewDecisionLabel =
    selectedJob?.status === 'approved'
      ? 'Approved'
      : selectedJob?.status === 'denied'
        ? 'Denied'
        : selectedJob?.status === 'ready_for_review'
          ? 'Awaiting Review'
          : selectedJob?.status === 'failed'
            ? 'Failed'
            : selectedJob?.status === 'canceled'
              ? 'Canceled'
            : null;

  const reviewDecisionTone =
    selectedJob?.status === 'approved'
      ? 'ready'
      : selectedJob?.status === 'denied' || selectedJob?.status === 'failed'
        ? 'danger'
        : 'neutral';

  return (
    <div className="review-app">
      <aside className={`staff-sidebar ${sidebarCollapsed ? 'staff-sidebar-collapsed' : ''}`}>
        <div className="sidebar-top">
          <img src={STAFF_LOGO} alt="In Time of Need" className="sidebar-logo" />
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <span />
            <span />
          </button>
        </div>

        <div className="sidebar-section">
          <NavRow
            icon={ICON_COMPOSE}
            label="New Job"
            active={sidebarMode === 'new' && !selectedJobId}
            onClick={handleNewJobClick}
            collapsed={sidebarCollapsed}
          />
          <NavRow
            icon={ICON_SEARCH}
            label="Search Jobs"
            active={sidebarMode === 'search'}
            onClick={() => setSidebarMode('search')}
            collapsed={sidebarCollapsed}
          />
          {!sidebarCollapsed && sidebarMode === 'search' ? (
            <label className="sidebar-search">
              <span>Search Jobs</span>
              <input
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="Search by city, category, or job id"
              />
            </label>
          ) : null}
        </div>

        <div className="sidebar-section">
          {!sidebarCollapsed ? <p className="sidebar-title">Projects</p> : null}
          <NavRow
            icon={ICON_FOLDER_ADD}
            label="New Project"
            active={sidebarMode === 'projects' && !selectedProjectId}
            onClick={handleCreateProject}
            collapsed={sidebarCollapsed}
          />
          <div className={`project-nav-list ${sidebarCollapsed ? 'project-nav-list-collapsed' : ''}`}>
            {projects.map((project) => (
              <ProjectNavRow
                key={project.id}
                project={project}
                active={project.id === selectedProjectId}
                collapsed={sidebarCollapsed}
                onSelect={(projectId) => {
                  setSelectedProjectId(projectId);
                  setSidebarMode('projects');
                }}
              />
            ))}
          </div>
        </div>

        <div className="sidebar-section jobs-section">
          {!sidebarCollapsed ? <p className="sidebar-title">Jobs</p> : null}
          {!sidebarCollapsed ? (
            <>
              {loadingJobs ? <p className="sidebar-note">Loading jobs...</p> : null}
              {jobsError ? <p className="sidebar-error">{jobsError}</p> : null}
              {!loadingJobs && !jobs.length ? <p className="sidebar-note">No jobs yet.</p> : null}
              {!loadingJobs && jobs.length && !filteredJobs.length ? (
                <p className="sidebar-note">No jobs match your search.</p>
              ) : null}
              <div className="job-nav-list">
                {filteredJobs.map((job) => (
                  <JobNavRow
                    key={job.id}
                    job={job}
                    active={job.id === selectedJobId}
                    onSelect={handleSelectJob}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">A</div>
          <div>
            <p>Username</p>
            <span>IToN Staff</span>
          </div>
        </div>
      </aside>

      <main className="staff-main">
        <header className="page-heading">
          <h1>Pipeline Review</h1>
          <p>Create and review pipeline jobs</p>
        </header>

        <section className="job-card-shell">
          <div className="panel-kicker">
            <span />
            <h2>{currentCardTitle}</h2>
          </div>

          <form className="create-job-form" onSubmit={handleSubmit}>
            <label>
              <span>City</span>
              <input
                name="city"
                value={displayedFormValues.city}
                onChange={handleFormChange}
                placeholder="Salem"
                autoComplete="off"
                disabled={formLocked}
              />
            </label>
            <label>
              <span>State</span>
              <input
                name="state"
                value={displayedFormValues.state}
                onChange={handleFormChange}
                placeholder="OR"
                autoComplete="off"
                disabled={formLocked}
              />
            </label>
            <label>
              <span>Category</span>
              <input
                name="category"
                value={displayedFormValues.category}
                onChange={handleFormChange}
                placeholder="FOOD_BANK"
                autoComplete="off"
                disabled={formLocked}
              />
            </label>
            <label>
              <span>Per Query</span>
              <input
                name="perQuery"
                value={displayedFormValues.perQuery}
                onChange={handleFormChange}
                placeholder="3"
                autoComplete="off"
                disabled={formLocked}
              />
            </label>
            <label>
              <span>Max URLs</span>
              <input
                name="maxUrls"
                value={displayedFormValues.maxUrls}
                onChange={handleFormChange}
                placeholder="10"
                autoComplete="off"
                disabled={formLocked}
              />
            </label>

            {submitError ? <p className="form-error full-row">{submitError}</p> : null}

            <div className="job-card-actions full-row">
              {currentCardMode === 'default' ? (
                <button type="submit" className="start-job-button" disabled={submitting || formLocked}>
                  {submitting ? 'Starting...' : 'Start Job'}
                </button>
              ) : null}
              {currentCardMode === 'processing' ? (
                <>
                  <div className="status-action status-action-processing">
                    <span>Job Processing</span>
                    <span className="job-spinner" aria-hidden="true" />
                  </div>
                  <button
                    type="button"
                    className="cancel-job-button"
                    onClick={() => void handleCancelJob()}
                    disabled={actionPending !== ''}
                  >
                    {actionPending === 'cancel' ? 'Canceling...' : 'Cancel Job'}
                  </button>
                </>
              ) : null}
              {currentCardMode === 'finished' ? (
                <>
                  <button
                    type="button"
                    className={`status-action status-action-${statusTone(selectedJob.status)}`}
                    disabled
                  >
                    <span>
                      {selectedJob.status === 'failed'
                        ? 'Job Failed'
                        : selectedJob.status === 'canceled'
                          ? 'Job Canceled'
                          : 'Job Finished'}
                    </span>
                    {selectedJob.status !== 'failed' && selectedJob.status !== 'canceled' ? (
                      <span className="job-finished-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </button>
                  {reviewDecisionLabel ? (
                    <span className={`secondary-meta-pill secondary-meta-pill-${reviewDecisionTone}`}>
                      {reviewDecisionLabel}
                    </span>
                  ) : null}
                  <span className="meta-pill">Job: {selectedJob.id}</span>
                  <span className="meta-pill">Updated: {formatDate(selectedJob.updatedAt)}</span>
                </>
              ) : null}
            </div>
          </form>
        </section>

        {actionError ? <p className="top-error">{actionError}</p> : null}

        {selectedJob ? (
          <section className="data-output-layout">
            <aside className="providers-panel">
              <div className="providers-header">
                <h2>Providers</h2>
                <span>{records.length} item(s)</span>
              </div>

              {showProviderLoadingState ? <p className="sidebar-note">Loading provider data...</p> : null}
              {!showProviderLoadingState && !records.length ? (
                <div className="providers-empty">
                  <strong>{statusLabel(selectedJob.status)}</strong>
                  <p>
                    {selectedJob.status === 'queued' || selectedJob.status === 'running'
                      ? 'The pipeline is still working. This panel will fill in when normalized providers are ready.'
                      : 'No normalized provider records are available for this job yet.'}
                  </p>
                </div>
              ) : null}

              <div className="provider-list">
                {records.map((provider, index) => (
                  <ProviderListRow
                    key={`${provider?.name || 'provider'}-${index}`}
                    provider={provider}
                    active={index === selectedProviderIndex}
                    onSelect={() => handleSelectProvider(index)}
                  />
                ))}
              </div>
            </aside>

            <section className="provider-detail-panel">
              <div className="provider-detail-top">
                <div>
                  <h2>{providerDraft.name || jobLabel(selectedJob)}</h2>
                  <p>{selectedSourceUrl || selectedJob.output?.query_file || 'Source link will appear here.'}</p>
                </div>
                <div className="provider-detail-actions">
                  <button
                    type="button"
                    className="approve-button"
                    onClick={() => void handleReviewAction('approve')}
                    disabled={selectedJob.status !== 'ready_for_review' || actionPending !== ''}
                  >
                    {actionPending === 'approve' ? 'Approving...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="deny-button"
                    onClick={() => void handleReviewAction('deny')}
                    disabled={selectedJob.status !== 'ready_for_review' || actionPending !== ''}
                  >
                    {actionPending === 'deny' ? 'Denying...' : 'Deny'}
                  </button>
                  <button type="button" className="save-button" onClick={handleSaveEdits} disabled={!selectedProvider}>
                    Save Edits
                  </button>
                </div>
              </div>

              <div className="detail-divider" />

              {selectedProvider ? (
                <>
                  <div className="detail-grid detail-grid-top">
                    <DetailField label="Name" name="name" value={providerDraft.name} onChange={handleDraftChange} />
                    <DetailField
                      label="Address"
                      name="address"
                      value={providerDraft.address}
                      onChange={handleDraftChange}
                    />
                  </div>

                  <div className="detail-grid detail-grid-triple">
                    <DetailField label="Phone" name="phone" value={providerDraft.phone} onChange={handleDraftChange} />
                    <DetailField label="Email" name="email" value={providerDraft.email} onChange={handleDraftChange} />
                    <DetailField
                      label="Website"
                      name="website"
                      value={providerDraft.website}
                      onChange={handleDraftChange}
                    />
                  </div>

                  <div className="detail-grid detail-grid-triple">
                    <DetailField
                      label="Service types"
                      name="serviceTypes"
                      value={providerDraft.serviceTypes}
                      onChange={handleDraftChange}
                    />
                    <DetailField
                      label="Latitude"
                      name="latitude"
                      value={providerDraft.latitude}
                      onChange={handleDraftChange}
                    />
                    <DetailField
                      label="Longitude"
                      name="longitude"
                      value={providerDraft.longitude}
                      onChange={handleDraftChange}
                    />
                  </div>

                  <DetailField
                    label="Description"
                    name="description"
                    value={providerDraft.description}
                    onChange={handleDraftChange}
                    multiline
                  />

                  <DetailField
                    label="Hours"
                    name="hours"
                    value={providerDraft.hours}
                    onChange={handleDraftChange}
                    multiline
                  />

                  <div className="detail-footer">
                    <span className={`inline-status inline-status-${statusTone(selectedJob.status)}`}>
                      {statusLabel(selectedJob.status)}
                    </span>
                    <span>{selectedSourceUrl ? getHostname(selectedSourceUrl) : 'No source URL'}</span>
                    <span>{formatDate(selectedJob.updatedAt)}</span>
                  </div>
                </>
              ) : (
                <div className="providers-empty provider-detail-empty">
                  <strong>Select a provider</strong>
                  <p>The detail editor will populate when the job produces records.</p>
                </div>
              )}

              {saveMessage ? <p className="save-message">{saveMessage}</p> : null}
            </section>
          </section>
        ) : (
          <section className="empty-output">
            <h2>Data Output</h2>
            <p>Select a job from the left sidebar to review its normalized providers.</p>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
