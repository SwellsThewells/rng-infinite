// Ajoute ?v=<hash du contenu> aux CSS/JS référencés par index.html.
// Sans ça, le cache de GitHub Pages (10 min) peut servir un mélange d'ancien CSS et de nouveau JS.
//   node tools/stamp.mjs   (à lancer avant chaque commit)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'index.html');

const html = fs.readFileSync(file, 'utf8').replace(
  /(href|src)="((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"/g,
  (_, attr, asset) => {
    const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, asset))).digest('hex').slice(0, 10);
    return `${attr}="${asset}?v=${hash}"`;
  },
);

fs.writeFileSync(file, html);
console.log(html.match(/(?:css|js)\/[\w.-]+\.(?:css|js)\?v=[0-9a-f]+/g).join('\n'));
