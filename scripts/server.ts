import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';

import { randomUUID } from 'node:crypto';
import { runPipeline, type PipelineOutput } from '../pipeline/runPipeline.ts';

type JobStatus = 'queued' | 'running' | 'ready_for_review' | 'approved' | 'denied' | 'failed';

type PipelineJob = {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  input: {
    city: string;
    state: string;
    category: string;
    perQuery?: number;
    maxUrls?: number;
  };
  output?: PipelineOutput;
  outputFile?: string;
  sanityFile?: string;
  error?: string;
  approvedAt?: string;
  deniedAt?: string;
  reviewer?: string;
};

const jobs = new Map<string, PipelineJob>();

function nowIso(): string {
  return new Date().toISOString();
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getJobIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] !== 'jobs') return null;
  return parts[1] || null;
}

function setJobStatus(job: PipelineJob, status: JobStatus): void {
  job.status = status;
  job.updatedAt = nowIso();
}

async function startPipeline(job: PipelineJob): Promise<void> {
  setJobStatus(job, 'running');
  try {
    const result = await runPipeline({
      city: job.input.city,
      state: job.input.state,
      category: job.input.category,
      perQuery: job.input.perQuery,
      maxUrls: job.input.maxUrls,
    });
    job.output = result.output;
    job.outputFile = result.outputFile;
    job.sanityFile = result.sanityFile;
    setJobStatus(job, 'ready_for_review');
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
    setJobStatus(job, 'failed');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = (req.method || 'GET').toUpperCase();

  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true, timestamp: nowIso() });
    return;
  }

  if (url.pathname === '/jobs' && method === 'POST') {
    try {
      const body = (await parseBody(req)) as Record<string, unknown>;
      const city = typeof body.city === 'string' ? body.city.trim() : '';
      const state = typeof body.state === 'string' ? body.state.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim() : '';

      if (!city || !state || !category) {
        sendJson(res, 400, { error: 'city, state, and category are required.' });
        return;
      }

      const perQuery =
        typeof body.perQuery === 'number' && Number.isFinite(body.perQuery)
          ? body.perQuery
          : undefined;
      const maxUrls =
        typeof body.maxUrls === 'number' && Number.isFinite(body.maxUrls) ? body.maxUrls : undefined;

      const job: PipelineJob = {
        id: randomUUID(),
        status: 'queued',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        input: { city, state, category, perQuery, maxUrls },
      };
      jobs.set(job.id, job);
      sendJson(res, 202, job);
      void startPipeline(job);
      return;
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body.' });
      return;
    }
  }

  if (url.pathname.startsWith('/jobs/') && method === 'GET') {
    const jobId = getJobIdFromPath(url.pathname);
    if (!jobId || !jobs.has(jobId)) {
      sendJson(res, 404, { error: 'Job not found.' });
      return;
    }
    sendJson(res, 200, jobs.get(jobId));
    return;
  }

  if (url.pathname.endsWith('/approve') && method === 'POST') {
    const jobId = getJobIdFromPath(url.pathname.replace(/\/approve$/, ''));
    const job = jobId ? jobs.get(jobId) : undefined;
    if (!job) {
      sendJson(res, 404, { error: 'Job not found.' });
      return;
    }
    const body = (await parseBody(req)) as Record<string, unknown>;
    job.reviewer = typeof body.reviewer === 'string' ? body.reviewer : job.reviewer;
    job.approvedAt = nowIso();
    setJobStatus(job, 'approved');
    sendJson(res, 200, job);
    return;
  }

  if (url.pathname.endsWith('/deny') && method === 'POST') {
    const jobId = getJobIdFromPath(url.pathname.replace(/\/deny$/, ''));
    const job = jobId ? jobs.get(jobId) : undefined;
    if (!job) {
      sendJson(res, 404, { error: 'Job not found.' });
      return;
    }
    const body = (await parseBody(req)) as Record<string, unknown>;
    job.reviewer = typeof body.reviewer === 'string' ? body.reviewer : job.reviewer;
    job.deniedAt = nowIso();
    setJobStatus(job, 'denied');
    sendJson(res, 200, job);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Pipeline server running on http://localhost:${port}`);
});