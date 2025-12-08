import { readFile } from 'fs/promises';

async function getLastedModified(url: string): Promise<string | null> {
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
