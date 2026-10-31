import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

const gas = new URL('../gas/', import.meta.url);
const source = await readFile(new URL('NameCardAssets.html', gas), 'utf8');
const assets = JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1));
const downloads = new Map();
const images = {};
const browserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

function download(url) {
  if (!downloads.has(url)) {
    downloads.set(url, (async () => {
      const host = new URL(url).hostname;
      if (host === 'llwiki.org') {
        try {
          const { stdout } = await runFile('curl', ['--fail', '--silent', '--show-error', '--location',
            '--max-time', '30', '--user-agent', browserAgent, url],
            { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
          return stdout;
        } catch (error) {
          throw new Error(`素材を取得できません：${url}（curl：${error.stderr?.toString().trim() || error.code}）`);
        }
      }
      const headers = host.endsWith('lovelive-anime.jp') ? { 'User-Agent': browserAgent } : {};
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`素材を取得できません：${url}（HTTP ${response.status}）`);
      return Buffer.from(await response.arrayBuffer());
    })());
  }
  return downloads.get(url);
}

function crop(image, x, y, width, height) {
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > image.width || y + height > image.height) {
    throw new Error('素材の切り抜き範囲が不正です。');
  }
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4;
    image.data.copy(data, row * width * 4, start, start + width * 4);
  }
  return { data, width, height };
}

function trim(image) {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3]) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('素材画像が空です。');
  return crop(image, left, top, right - left + 1, bottom - top + 1);
}

function watermark(image, background) {
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    if (background) {
      for (let channel = 0; channel < 3; channel++) {
        image.data[i + channel] = Math.floor((background[channel] * (255 - alpha) + 255 * alpha + 127) / 255);
      }
      image.data[i + 3] = 26;
    } else {
      image.data[i + 3] = alpha % 20 === 5 ? Math.floor(alpha / 10) : Math.round(alpha / 10);
    }
  }
  return image;
}

async function processImage(path, url) {
  const recipe = assets.imageProcessing[path] ?? { kind: 'trim' };
  const input = await download(url);
  // Render SVG at 144 dpi without imposing a target width or height.
  const { data, info } = await sharp(input, { density: 144 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let image = { data, width: info.width, height: info.height };
  if (recipe.kind === 'trim') image = trim(image);
  else if (recipe.kind === 'crop') image = crop(image, recipe.x, recipe.y, recipe.width, recipe.height);
  else if (recipe.kind === 'watermark') image = watermark(recipe.trim ? trim(image) : image);
  else if (recipe.kind === 'svg-watermark') image = watermark(image, [230, 139, 54]);
  else throw new Error(`素材の加工指定が不正です：${path}`);
  const png = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false }).toBuffer();
  images[path] = png.toString('base64');
}

const entries = Object.entries(assets.images);
let next = 0;
await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
  while (next < entries.length) {
    const [path, url] = entries[next++];
    await processImage(path, url);
  }
}));
const ordered = Object.fromEntries(entries.map(([path]) => [path, images[path]]));
await writeFile(new URL('NameCardEmbedded.html', gas),
  `<script id="name-card-embedded" type="application/json">${JSON.stringify({ version: 1, images: ordered })}</script>\n`);
console.log(`名刺素材${entries.length}点を生成しました。取得元${downloads.size}件。`);
