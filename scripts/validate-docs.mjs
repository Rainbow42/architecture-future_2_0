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

const diagramNames = ['bounded-contexts', 'event-storming'];
for (const name of diagramNames) {
  const source = path.join(root, 'Task4Advanced', `${name}.puml`);
  const svg = path.join(root, 'Task4Advanced', `${name}.svg`);
  execFileSync('plantuml', ['-checkonly', source], { stdio: 'pipe' });
  execFileSync('xmllint', ['--noout', svg], { stdio: 'pipe' });
  const image = readFileSync(svg, 'utf8');
  assert(!/Syntax Error|This syntax is deprecated/.test(image), `${name}: render contains an error or warning`);
  for (const match of readFileSync(source, 'utf8').matchAll(/Событие ([A-Z][A-Za-z]+)/g)) {
    assert(eventNames.has(match[1]), `${name}: undocumented event: ${match[1]}`);
  }
}

console.log(`PASS: ${documents.length} Markdown documents, ${linkCount} local links, ${eventNames.size} event contracts, ${diagramNames.length} diagrams`);
