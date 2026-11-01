import {readFile,writeFile,mkdir,readdir,copyFile,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {build} from 'esbuild';
import {printPlan} from './namecard/src/print.js';
const root=new URL('./',import.meta.url),dist=new URL('dist/',root);
async function buildNameCards(){
const runFile=promisify(execFile);
const here=new URL('namecard/',root),gas=dist;
await mkdir(gas,{recursive:true});
const read=name=>readFile(new URL(name,here),'utf8');
const design=JSON.parse(await read('design.json'));
const members=JSON.parse(await read('members.json'));
const resources=JSON.parse(await read('resources.json'));
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
  const recipe = resources[path].processing;
  const input = await download(url);
  // Render SVG at 144 dpi without imposing a target width or height.
  const { data, info } = await sharp(input, { density: 144 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let image = { data, width: info.width, height: info.height };
  if (recipe.kind === 'trim') image = trim(image);
  else if (recipe.kind === 'watermark') image = watermark(recipe.trim ? trim(image) : image);
  else if (recipe.kind === 'svg-watermark') image = watermark(image, [230, 139, 54]);
  else throw new Error(`素材の加工指定が不正です：${path}`);
  const png = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false }).toBuffer();
  images[path] = png.toString('base64');
}


const entries=Object.entries(resources);let next=0;
await Promise.all(Array.from({length:6},async()=>{while(next<entries.length){const [path,{url}]=entries[next++];await processImage(path,url);}}));
const bundle=await build({entryPoints:[new URL('src/main.js',here).pathname],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:false,legalComments:'inline'});
const escapeJson=value=>JSON.stringify(value).replaceAll('<','\\u003c');
const runtime={design,members,images:Object.fromEntries(entries.map(([path])=>[path,images[path]]))};
const ui=await read('dialog.html');
const pakoLicense=await readFile(new URL('node_modules/pako/LICENSE',root),'utf8');
const fontParserLicense=await readFile(new URL('node_modules/opentype.js/LICENSE',root),'utf8');
const qrLicense=fontParserLicense.replace(/Copyright[^\n]*/, 'Copyright (c) 2009 Kazuhiko Arase');
const licenseComment='\n/*\n'+[pakoLicense,fontParserLicense,qrLicense].join('\n')+'\n*/\n';
await writeFile(new URL('NameCardPage.html',gas),ui.replace('<!-- DATA -->','<script id="card-data" type="application/json">'+escapeJson(runtime)+'</script>').replace('<!-- SCRIPT -->','<script>'+(bundle.outputFiles[0].text+licenseComment).replaceAll('</script','<\\/script')+'</script>'));
const schema=design.groups.map(({id,ratingHeader,favoriteHeader})=>({id,ratingHeader,favoriteHeader}));
await writeFile(new URL('NameCard.gs',gas),'// Generated by gas/build.mjs.\nvar CARD_HEADERS='+JSON.stringify(schema)+';\nvar CARD_PRINT='+JSON.stringify(Object.fromEntries(Object.keys(design.print.papers).map(paper=>[paper,printPlan(design,paper)])))+';\nvar CARD_CELL='+JSON.stringify({width:design.print.cellWidthPx,height:design.print.cellHeightPx})+';\nvar CARD_MARGIN='+design.print.marginMm+';\n'+await read('server/dialog.js')+'\n'+await read('server/sheets.js'));
console.log('名刺用GASファイルを生成しました：画像'+entries.length+'点');

}
async function buildSeating(){
const source=new URL('seating/',root);
await mkdir(dist,{recursive:true});
const read=name=>readFile(new URL(name,source),'utf8');
const palette=JSON.parse(await read('colors.json'));
let html=await read('SeatingDialog.html');
for(const name of ['SeatingStyle','SeatingEngine','SeatingSession','SeatingController']){
  html=html.replace('<!-- '+name+' -->',await read(name+'.html'));
}
html=html.replace('/* SeatingColors */ null',JSON.stringify(palette));
await writeFile(new URL('SeatingDialog.html',dist),html);
await writeFile(new URL('SeatingPalette.gs',dist),'var SEATING_LEVEL_PALETTE='+JSON.stringify(palette)+';\n');
for(const name of await readdir(source))if(name.endsWith('.gs'))await copyFile(new URL(name,source),new URL(name,dist));

}
await buildNameCards();
await buildSeating();
const entries=['Entrypoints.gs','appsscript.json'];
for(const name of entries)await copyFile(new URL(name,root),new URL(name,dist));
const seatingFiles=(await readdir(new URL('seating/',root))).filter(name=>name.endsWith('.gs'));
const expected=new Set([...entries,...seatingFiles,'SeatingDialog.html','SeatingPalette.gs','NameCard.gs','NameCardPage.html']);
for(const name of await readdir(dist))if(/\.(gs|html|json)$/.test(name)&&!name.startsWith('.')&&!expected.has(name))await unlink(new URL(name,dist));
console.log('GAS送信対象をgas/dist/に出力しました。');
