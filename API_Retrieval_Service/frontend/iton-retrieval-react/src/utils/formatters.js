export function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getDescriptionText(description) {
  if (isNonEmptyString(description)) return description.trim();
  if (!Array.isArray(description)) return '';

  return description
    .flatMap((block) => (Array.isArray(block?.children) ? block.children : []))
    .map((child) => (isNonEmptyString(child?.text) ? child.text.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}

export function normalizeJobOutput(jobOutput) {
  const pipelineOutput = jobOutput?.output ?? jobOutput;
  const services = Array.isArray(pipelineOutput?.sanity) ? pipelineOutput.sanity : [];
  const extracted = Array.isArray(pipelineOutput?.extracted) ? pipelineOutput.extracted : [];

  return {
    pipelineOutput,
    services: services.map((service, index) => {
      const extraction = extracted[index];
      return {
        ...service,
        extractionMethod: extraction?.method ?? null,
        sourceUrl: extraction?.url ?? service?.contact?.website ?? '',
      };
    }),
  };
}
