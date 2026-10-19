import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['docs', 'Task1Advanced', 'Task2Advanced', 'Task3Advanced', 'Task4Advanced', 'Task5Advanced'];
const documents = ['README.md'];

for (const directory of directories) {
  for (const file of readdirSync(path.join(root, directory))) {
    if (file.endsWith('.md')) documents.push(path.join(directory, file));
  }
}

let linkCount = 0;
for (const document of documents) {
  const contents = readFileSync(path.join(root, document), 'utf8');
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^https?:\/\//.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(document), decodeURIComponent(target));
    assert(resolved.startsWith(`${root}${path.sep}`), `${document}: link outside repository: ${target}`);
    assert(existsSync(resolved), `${document}: missing link target: ${target}`);
    linkCount += 1;
  }
}

const catalog = readFileSync(path.join(root, 'Task4Advanced/events.md'), 'utf8');
const eventNames = new Set([...catalog.matchAll(/^\| ([A-Z][A-Za-z]+)(?: \/| \|)/gm)].map(match => match[1]));
assert(eventNames.size >= 20, 'Event catalog is missing expected contracts');
const aggregates = readFileSync(path.join(root, 'Task4Advanced/aggregates.md'), 'utf8');
for (const row of aggregates.split('\n').filter(line => /^\| [^|]+ \/ [A-Z][A-Za-z]+ \|/.test(line))) {
  const fields = row.split('|');
  for (const event of fields[fields.length - 2].trim().split(', ')) {
    assert(eventNames.has(event), `Aggregate references undocumented event: ${event}`);
  }
}

const diagrams = ['Task3Advanced', 'Task4Advanced'].flatMap(directory =>
  readdirSync(path.join(root, directory))
    .filter(file => file.endsWith('.puml'))
    .map(file => path.join(directory, file)),
);
for (const name of diagrams) {
  const source = path.join(root, name);
  const svg = source.replace(/\.puml$/, '.svg');
  execFileSync('plantuml', ['-checkonly', source], { stdio: 'pipe' });
  execFileSync('xmllint', ['--noout', svg], { stdio: 'pipe' });
  const image = readFileSync(svg, 'utf8');
  assert(!/Syntax Error|This syntax is deprecated/.test(image), `${name}: render contains an error or warning`);
  for (const match of readFileSync(source, 'utf8').matchAll(/Событие ([A-Z][A-Za-z]+)/g)) {
    assert(eventNames.has(match[1]), `${name}: undocumented event: ${match[1]}`);
  }
}

const risks = readFileSync(path.join(root, 'Task3Advanced/risks.md'), 'utf8');
const riskRows = [...risks.matchAll(/^\| ([ATO]\d+) \| [^|]+ \| ([123]) \/ ([123]) \/ (\d+) \|/gm)];
assert(riskRows.length > 0, 'Risk register is empty');
assert.equal(new Set(riskRows.map(row => row[1])).size, riskRows.length, 'Duplicate risk IDs');
const matrix = new Map([...risks.matchAll(/^\| ([123]) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
  .map(row => [Number(row[1]), row.slice(2)]));
for (const [, id, probability, impact, score] of riskRows) {
  assert.equal(Number(probability) * Number(impact), Number(score), `${id}: incorrect score`);
  const cell = matrix.get(Number(probability))?.[Number(impact) - 1];
  assert(cell?.split(',').map(value => value.trim()).includes(id), `${id}: missing or misplaced in risk matrix`);
}

const radar = readFileSync(path.join(root, 'Task5Advanced/tech-radar.md'), 'utf8');
const radarMapIds = [...radar.split('## Adopt:')[0].matchAll(/[|;] ([ATSH]\d+) /g)].map(match => match[1]);
const radarDetailIds = [...radar.matchAll(/^\| ([ATSH]\d+) \|/gm)].map(match => match[1]);
assert.equal(new Set(radarMapIds).size, radarMapIds.length, 'Duplicate radar map IDs');
assert.equal(new Set(radarDetailIds).size, radarDetailIds.length, 'Duplicate radar detail IDs');
assert.deepEqual([...radarMapIds].sort(), [...radarDetailIds].sort(), 'Radar map and details differ');
assert.deepEqual([...new Set(radarMapIds.map(id => id[0]))].sort(), ['A', 'H', 'S', 'T'], 'Missing radar rings');

console.log(`PASS: ${documents.length} Markdown documents, ${linkCount} local links, ${eventNames.size} event contracts, ${diagrams.length} diagrams, ${riskRows.length} risks, ${radarDetailIds.length} radar decisions`);
