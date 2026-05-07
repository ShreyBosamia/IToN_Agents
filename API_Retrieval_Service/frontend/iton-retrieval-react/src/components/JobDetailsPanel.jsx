import DetailRow from './DetailRow';
import OutputSection from './OutputSection';
import StatusBadge from './StatusBadge';
import { formatDate, prettyJson } from '../utils/formatters';

function JobDetailsPanel({ selectedJobId, selectedJob, loadingJobDetail }) {
  return (
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
        <p className="muted-text">Loading job detail...</p>
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
              <DetailRow label="Max queries" value={selectedJob.inputs?.maxQueries ?? '-'} />
              <DetailRow label="Max URLs" value={selectedJob.inputs?.maxUrls ?? '-'} />
              <DetailRow label="Created" value={formatDate(selectedJob.createdAt)} />
              <DetailRow label="Started" value={formatDate(selectedJob.startedAt)} />
              <DetailRow label="Finished" value={formatDate(selectedJob.finishedAt)} />
            </div>
          </div>

          <div className="detail-section">
            <h3>Output</h3>
            <OutputSection output={selectedJob.output} />
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
  );
}

export default JobDetailsPanel;
