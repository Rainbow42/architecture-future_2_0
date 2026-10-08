import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const model = JSON.parse(readFileSync(path.join(root, 'Task5Advanced/cost-model.json'), 'utf8'));
assert.equal(model.years, 3);
assert.equal(model.currency, 'RUB');
assert.equal(new Set(model.lines.map(line => line.id)).size, model.lines.length);
assert.equal(model.legacy_retention.length, model.years);
assert(model.legacy_retention.every(value => Number.isFinite(value) && value >= 0 && value <= 1));

for (const line of model.lines) {
  assert(line.category in model.categories, `Unknown category: ${line.id}`);
  for (const scenario of ['as_is', 'to_be']) {
    assert.equal(line[scenario].length, model.years, line.id);
    assert(line[scenario].every(value => Number.isFinite(value) && value >= 0), line.id);
  }
  assert(Number.isFinite(line.rate_rub) && line.rate_rub >= 0, line.id);
  assert(Number.isFinite(line.periods) && line.periods > 0, line.id);
}

function cost(line, scenario, year, options = {}) {
  let quantity = line[scenario][year];
  if (scenario === 'to_be') {
    if (line.legacy_retention) quantity *= (options.retention ?? model.legacy_retention)[year];
    if (line.cloud) quantity *= options.cloudFactor ?? 1;
    if (line.storage) quantity *= options.storageFactor ?? 1;
    if (line.id === 'analyst_routine' && options.noProductivityGain) quantity = line.as_is[year];
    if (line.id === 'legacy_licenses' && options.keepLegacyLicenses) quantity = line.as_is[year];
    if (line.id === 'migration_team') quantity *= options.migrationFactor ?? 1;
  }
  return Math.round(quantity * line.rate_rub * line.periods);
}

const sum = values => values.reduce((total, value) => total + value, 0);
const annual = (scenario, options = {}, category) => Array.from({ length: model.years }, (_, year) =>
  sum(model.lines.filter(line => !category || line.category === category).map(line => cost(line, scenario, year, options))),
);
const fmt = value => (value / 1_000_000).toFixed(2).replace('.', ',');
const asIs = annual('as_is');
const toBe = annual('to_be');
const rows = [
  '| Статья, млн ₽ | As-is: год 1 | Год 2 | Год 3 | To-be: год 1 | Год 2 | Год 3 |',
  '|---|---:|---:|---:|---:|---:|---:|',
];
for (const [category, label] of Object.entries(model.categories)) {
  rows.push(`| ${label} | ${[...annual('as_is', {}, category), ...annual('to_be', {}, category)].map(fmt).join(' | ')} |`);
}
rows.push(`| **Всего за год** | ${[...asIs, ...toBe].map(fmt).join(' | ')} |`);
rows.push('', '| Показатель | Млн ₽ |', '|---|---:|');
rows.push(`| As-is за 3 года | ${fmt(sum(asIs))} |`);
rows.push(`| To-be за 3 года | ${fmt(sum(toBe))} |`);
rows.push(`| Дополнительная стоимость to-be | ${fmt(sum(toBe) - sum(asIs))} |`);
const analyst = model.lines.find(line => line.id === 'analyst_routine');
const hoursReleased = sum(analyst.as_is) - sum(analyst.to_be);
rows.push(`| Оценка высвобождаемого времени: ${hoursReleased} часов | ${fmt(hoursReleased * analyst.rate_rub)} |`);
rows.push('', '| Сценарий чувствительности | To-be за 3 года, млн ₽ | Превышение as-is, млн ₽ |', '|---|---:|---:|');
for (const [label, options] of [
  ['Базовые допущения', {}],
  ['Ресурсы облака дороже на 30%', { cloudFactor: 1.3 }],
  ['Объёмы хранилищ платформы вдвое больше', { storageFactor: 2 }],
  ['Рутина аналитиков не сокращается', { noProductivityGain: true }],
  ['Вывод легаси задержан: 100% / 100% / 65%, лицензии сохранены', { retention: [1, 1, 0.65], keepLegacyLicenses: true }],
  ['Трудоёмкость миграции больше на 30%', { migrationFactor: 1.3 }],
]) {
  const total = sum(annual('to_be', options));
  rows.push(`| ${label} | ${fmt(total)} | ${fmt(total - sum(asIs))} |`);
}

const table = rows.join('\n');
if (process.argv.includes('--check')) {
  const report = readFileSync(path.join(root, 'Task5Advanced/tco-analysis.md'), 'utf8');
  const stored = report.split('<!-- tco:start -->\n')[1]?.split('\n<!-- tco:end -->')[0];
  assert.equal(stored, table, 'TCO tables differ from cost-model.json; recalculate and update the report');
  for (const scenario of ['as_is', 'to_be']) {
    assert.equal(sum(annual(scenario)), sum(Object.keys(model.categories).map(category => sum(annual(scenario, {}, category)))));
  }
  console.log(`PASS: ${model.lines.length} cost lines, 3 years, category totals, 6 sensitivity scenarios and report tables`);
} else {
  console.log(table);
}
