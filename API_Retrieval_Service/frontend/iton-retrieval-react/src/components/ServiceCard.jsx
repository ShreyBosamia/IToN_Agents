import { useState } from 'react';
import DetailRow from './DetailRow';
import { getDescriptionText } from '../utils/formatters';

function ServiceCard({ service, index }) {
  const [isOpen, setIsOpen] = useState(index === 0);
  const description = getDescriptionText(service.description);
  const weekdayText = Array.isArray(service?.hoursOfOperation?.weekdayText)
    ? service.hoursOfOperation.weekdayText.filter(Boolean)
    : [];
  const periods = Array.isArray(service?.hoursOfOperation?.periods)
    ? service.hoursOfOperation.periods
    : [];
  const serviceTypes = Array.isArray(service?.serviceTypes) ? service.serviceTypes : [];
  const coordinates =
    service?.location?.latitude != null || service?.location?.longitude != null
      ? `${service?.location?.latitude ?? '-'}, ${service?.location?.longitude ?? '-'}`
      : '-';
  const typeText = serviceTypes.length
    ? serviceTypes.map((type) => type?._id).filter(Boolean).join(', ')
    : '-';

  return (
    <article className="service-card">
      <button
        type="button"
        className="service-toggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <div>
          <p className="service-index">Service {index + 1}</p>
          <h4>{service?.name || 'Unnamed service'}</h4>
          <p className="service-toggle-meta">
            {service?.address || service?.contact?.website || 'No address or website'}
          </p>
        </div>
        <div className="service-toggle-actions">
          {service?.extractionMethod ? (
            <span className={`method-badge method-${service.extractionMethod}`}>
              {service.extractionMethod}
            </span>
          ) : null}
        </div>
      </button>

      {isOpen ? (
        <div className="service-card-body">
          <div className="service-detail-grid">
            <DetailRow label="Address" value={service?.address || '-'} />
            <DetailRow label="Website" value={service?.contact?.website || '-'} />
            <DetailRow label="Phone" value={service?.contact?.phone || '-'} />
            <DetailRow label="Email" value={service?.contact?.email || '-'} />
            <DetailRow label="Coordinates" value={coordinates} />
            <DetailRow label="Service types" value={typeText} />
          </div>

          {description ? (
            <div className="service-section">
              <h5>Description</h5>
              <p className="service-description">{description}</p>
            </div>
          ) : null}

          <div className="service-section">
            <h5>Hours</h5>
            {weekdayText.length ? (
              <ul className="hours-list">
                {weekdayText.map((entry, entryIndex) => (
                  <li key={`${service?.name || 'service'}-hours-${entryIndex}`}>{entry}</li>
                ))}
              </ul>
            ) : periods.length ? (
              <ul className="hours-list">
                {periods.map((period, periodIndex) => (
                  <li key={`${service?.name || 'service'}-period-${periodIndex}`}>
                    Open day {period?.open?.day ?? '-'} at {period?.open?.time ?? '-'}, close day{' '}
                    {period?.close?.day ?? '-'} at {period?.close?.time ?? '-'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-inline">No hours found for this service.</p>
            )}
          </div>

          {service?.sourceUrl ? (
            <div className="service-section">
              <h5>Source</h5>
              <a
                className="service-link"
                href={service.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {service.sourceUrl}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default ServiceCard;
