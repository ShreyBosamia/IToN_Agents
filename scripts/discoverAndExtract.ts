import { readFile } from 'fs/promises';
import { appendFile } from 'fs/promises';

async function getLastedModified(url: string): Promise<string | null> {
  const nonFeasibleWebsites = 'nonfeasible.txt';
  const feasibleWebsites = 'feasible.txt';
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

    if(res.headers.get('Last-Modified') == null) {
      appendFile(nonFeasibleWebsites, (url + "\n"));
    }
    if(res.headers.get('Last-Modified') != null) {
      appendFile(feasibleWebsites, (url + "\n"));
    }
    return res.headers.get('Last-Modified');
  } catch (err) {
    return null;
  }
}

async function run() {
  const text = await readFile('websites.txt', 'utf8');
  const urls = text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  for (const url of urls) {
    const lastMod = await getLastedModified(url);
    console.log(`${url} -> ${lastMod}`);
  }
}

run();
