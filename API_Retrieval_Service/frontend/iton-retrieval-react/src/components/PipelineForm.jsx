function PipelineForm({
  form,
  submitting,
  submitError,
  onInputChange,
  onSubmit,
  onRefreshJobs,
}) {
  return (
    <section className="panel form-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">IToN Retrieval Service</p>
          <h1>Submit pipeline jobs</h1>
        </div>
        <button type="button" className="secondary-button" onClick={onRefreshJobs}>
          Refresh jobs
        </button>
      </div>

      <form className="pipeline-form" onSubmit={onSubmit}>
        <label>
          <span>City</span>
          <input name="city" value={form.city} onChange={onInputChange} placeholder="Corvallis" />
        </label>
        <label>
          <span>State</span>
          <input name="state" value={form.state} onChange={onInputChange} placeholder="OR" />
        </label>
        <label>
          <span>Category</span>
          <input
            name="category"
            value={form.category}
            onChange={onInputChange}
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
            onChange={onInputChange}
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
            onChange={onInputChange}
            placeholder="3"
          />
        </label>

        {submitError ? <p className="error-text">{submitError}</p> : null}

        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Queue pipeline job'}
        </button>
      </form>
    </section>
  );
}

export default PipelineForm;
