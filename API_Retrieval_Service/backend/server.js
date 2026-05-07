/* eslint-env node */

//Run npx tsx server.js

import './env.js';

import cors from 'cors';
import express from 'express';

import {
  formatPipelineValidationError,
  validatePipelineRequest,
} from '../../pipeline/validatePipelineRequest.ts';

const app = express();
app.use(cors());
app.use(express.json());

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res
      .status(400)
      .json(
        formatPipelineValidationError([
          { field: 'body', message: 'request body must contain valid JSON.' },
        ])
      );
  }

  return next(err);
});

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_JOBS ?? 2);
const jobs = new Map();
let runningCount = 0;
const queue = [];

function pumpQueue() {
  while (runningCount < MAX_CONCURRENT && queue.length > 0) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job || job.status !== 'queued') continue;
    runJob(jobId).catch(() => {});
  }
}
async function runJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  runningCount++;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  jobs.set(jobId, job);

  try {
    // IMPORTANT: dynamic import so env is loaded before pipeline chain
    const { runPipeline } = await import('../../pipeline/runPipeline.ts');

    const output = await runPipeline(job.inputs);

    job.status = 'done';
    job.output = output;
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    job.status = 'error';
    job.error =
      err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    job.finishedAt = new Date().toISOString();
  } finally {
    runningCount--;
    jobs.set(jobId, job);
    pumpQueue();
  }
}
// Submit a new job (returns immediately)
app.post('/api/pipelines', (req, res) => {
  const validation = validatePipelineRequest(req.body);
  if (!validation.ok) {
    return res.status(400).json(formatPipelineValidationError(validation.errors));
  }

  const jobId = Date.now().toString() + '-' + Math.random().toString(16).slice(2);

  const job = {
    id: jobId,
    status: 'queued', // queued | running | done | error
    createdAt: new Date().toISOString(),
    inputs: validation.value,
    startedAt: null,
    finishedAt: null,
    output: null,
    error: null,
  };

  jobs.set(jobId, job);
  queue.push(jobId);
  pumpQueue();

  return res.status(202).json({ message: 'Job queued', id: jobId, status: job.status });
});

app.get('/', (req, res) => {
  res.send('OK');
});

app.get('/api/pipelines', (req, res) => {
  res.json(Array.from(jobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
});
app.get('/api/pipelines/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
