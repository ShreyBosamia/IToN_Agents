/* eslint-env node */
import './env.js';
import cors from 'cors';
import express from 'express';

import { runPipeline } from '../../pipeline/runPipeline.ts';

const app = express();
app.use(cors());
app.use(express.json());

let pipelines = [];

//Retrieve REST API requests (Post)
app.post('/api/pipelines', async (req, res) => {
  try {
    const { city, state, category, maxQueries, maxUrls } = req.body || {};

    // basic validation
    if (!city || !state) {
      return res.status(400).json({ error: 'city and state are required' });
    }

    const mq = maxQueries == null ? null : Number(maxQueries);
    const mu = maxUrls == null ? null : Number(maxUrls);

    if (mq != null && (!Number.isFinite(mq) || mq < 0)) {
      return res.status(400).json({ error: 'maxQueries must be a non-negative number' });
    }
    if (mu != null && (!Number.isFinite(mu) || mu < 0)) {
      return res.status(400).json({ error: 'maxUrls must be a non-negative number' });
    }

    // run the pipeline with variables
    const output = await runPipeline({
      city: String(city).trim(),
      state: String(state).trim(),
      category: String(category).trim(),
      maxQueries: mq,
      maxUrls: mu,
    });

    // store result in memory
    const stored = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      inputs: {
        city: String(city).trim(),
        state: String(state).trim(),
        maxQueries: mq,
        maxUrls: mu,
      },
      output, // <-- pipeline output JSON stored here
    };

    pipelines.push(stored);

    res.status(201).json({
      message: 'Pipeline stored succcessfully',
      id: stored.id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Pipeline failed', details: err?.message });
  }
});
app.get('/', (req, res) => {
  res.send('OK');
});

app.get('/api/pipelines', (req, res) => {
  res.json(pipelines);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
