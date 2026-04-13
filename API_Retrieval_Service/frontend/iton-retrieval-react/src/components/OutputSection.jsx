import DetailRow from './DetailRow';
import ServiceCard from './ServiceCard';
import { formatDate, normalizeJobOutput, prettyJson } from '../utils/formatters';

function OutputSection({ output }) {
  const { pipelineOutput, services } = normalizeJobOutput(output);

  if (!output) {
    return <p className="muted-text">No output yet for this job.</p>;
  }

  if (!services.length) {
    return <pre className="json-block">{prettyJson(output)}</pre>;
  }

  return (
    <div className="output-stack">
      <div className="output-summary-grid">
        <DetailRow label="Services found" value={services.length} />
        <DetailRow label="Generated" value={formatDate(pipelineOutput?.generated_at)} />
        <DetailRow label="Category" value={pipelineOutput?.category || '-'} />
        <DetailRow label="Output file" value={output?.outputFile || '-'} />
        <DetailRow label="Sanity file" value={output?.sanityFile || pipelineOutput?.sanity_file || '-'} />
        <DetailRow
          label="URLs searched"
          value={Array.isArray(pipelineOutput?.urls) ? pipelineOutput.urls.length : 0}
        />
      </div>

      <div className="service-list">
        {services.map((service, index) => (
          <ServiceCard
            key={`${service?.name || 'service'}-${service?.sourceUrl || index}`}
            service={service}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

export default OutputSection;
