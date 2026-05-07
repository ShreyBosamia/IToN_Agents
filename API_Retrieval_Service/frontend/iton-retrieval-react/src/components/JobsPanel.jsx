import JobCard from './JobCard';

function JobsPanel({ jobs, loadingJobs, jobsError, selectedJobId, onOpenJob }) {
  return (
    <div className="panel jobs-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Jobs</p>
          <h2>Recent pipeline requests</h2>
        </div>
        <span className="jobs-count">{jobs.length}</span>
      </div>

      {loadingJobs ? <p className="muted-text">Loading jobs...</p> : null}
      {jobsError ? <p className="error-text">{jobsError}</p> : null}
      {!loadingJobs && jobs.length === 0 ? <p className="muted-text">No jobs yet.</p> : null}

      <div className="jobs-list">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} isActive={job.id === selectedJobId} onOpen={onOpenJob} />
        ))}
      </div>
    </div>
  );
}

export default JobsPanel;
