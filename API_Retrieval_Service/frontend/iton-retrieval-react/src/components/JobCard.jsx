import StatusBadge from './StatusBadge';
import { formatDate } from '../utils/formatters';

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

export default JobCard;
