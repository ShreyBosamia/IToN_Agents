import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function getLastModified(url: string): Promise<string | null> {
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
    });

    if (!res.ok || !res.headers.get('Last-Modified')) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
      });
    }

    return res.headers.get('Last-Modified');
  } catch {
    return null;
  }
}

async function run() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sitesPath = path.resolve(__dirname, '../data/websites.txt');
  const text = await readFile(sitesPath, 'utf8');
  const urls = text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  for (const url of urls) {
    const lastMod = await getLastModified(url);
    console.log(`${url} -> ${lastMod}`);
  }
}

run();
