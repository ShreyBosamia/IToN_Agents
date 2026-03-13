/* eslint-env node */

//Run npx tsx server.js

import './env.js';
import cors from 'cors';
import express from 'express';

const app = express();
app.use(cors());
app.use(express.json());

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_JOBS ?? 2);
const jobs = new Map();
let runningCount = 0;
const queue = [];
let pipelines = [];

function pumpQueue() {
  while (runningCount < MAX_CONCURRENT && queue.length > 0) {
    const jobId = queue.shift();
    const job = jobs.get(jobId);
    if (!job || job.status !== "queued") continue;
    runJob(jobId).catch(() => {});
  }
}
async function runJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  runningCount++;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  jobs.set(jobId, job);

  try {
    // IMPORTANT: dynamic import so env is loaded before pipeline chain
    const { runPipeline } = await import("../../pipeline/runPipeline.ts");

    const output = await runPipeline(job.inputs);

    job.status = "done";
    job.output = output;
    job.finishedAt = new Date().toISOString();
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    job.finishedAt = new Date().toISOString();
  } finally {
    runningCount--;
    jobs.set(jobId, job);
    pumpQueue();
  }
}
// Submit a new job (returns immediately)
app.post("/api/pipelines", (req, res) => {
  const { city, state, category, maxQueries, maxUrls } = req.body || {};

  if (!city || !state) {
    return res.status(400).json({ error: "city and state are required" });
  }

  const mq = maxQueries == null ? null : Number(maxQueries);
  const mu = maxUrls == null ? null : Number(maxUrls);

  if (mq != null && (!Number.isFinite(mq) || mq < 0)) {
    return res.status(400).json({ error: "maxQueries must be a non-negative number" });
  }
  if (mu != null && (!Number.isFinite(mu) || mu < 0)) {
    return res.status(400).json({ error: "maxUrls must be a non-negative number" });
  }

  const jobId = Date.now().toString() + "-" + Math.random().toString(16).slice(2);

  const job = {
    id: jobId,
    status: "queued", // queued | running | done | error
    createdAt: new Date().toISOString(),
    inputs: {
      city: String(city).trim(),
      state: String(state).trim(),
      category: String(category).trim(),
      maxQueries: mq,
      maxUrls: mu,
    },
    startedAt: null,
    finishedAt: null,
    output: null,
    error: null,
  };

  jobs.set(jobId, job);
  queue.push(jobId);
  pumpQueue();

  return res.status(202).json({ message: "Job queued", id: jobId, status: job.status });
});

app.get('/', (req, res) => {
  res.send('OK');
});

app.get('/api/pipelines', (req, res) => {
  res.json(Array.from(jobs.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
});
app.get('/api/pipelines/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
