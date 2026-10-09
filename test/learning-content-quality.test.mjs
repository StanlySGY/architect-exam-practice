import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const content = JSON.parse(fs.readFileSync(new URL('../data/learning-content.json', import.meta.url), 'utf8'));
const units = Object.entries(content.units);
const highValue = ['1.2','1.3','2.1','2.4','2.5','5.1','5.2','5.4','6.1.1','6.1.2','6.1.3','6.1.4','6.2.1','6.2.2','6.2.3','6.3.1','6.3.2','6.3.3','6.3.4','6.3.5','6.3.6','6.3.7','6.4','6.5.1','6.5.2','7.1.1','7.1.2','7.1.3','7.2.1','7.2.2','7.2.3','7.2.4','7.2.5','7.2.6','7.2.7','7.2.8','7.2.9','7.3.1','7.3.2','7.3.3','7.3.4','7.3.5','7.3.6','7.4.1','7.4.3','7.4.4','7.5.1','7.5.4','8.1.1','9.1.1','10.1.1','14.1','15.1','18.2.1','18.2.2','19.1'];

test('309个学习单元的例子、陷阱不重复且自检题完整', () => {
  assert.equal(units.length, 309);
  for (const [id, unit] of units) {
    assert.ok(unit.examples && unit.examples.length >= 14, id + ' examples missing');
    assert.ok(unit.pitfalls && unit.pitfalls.length >= 14, id + ' pitfalls missing');
    assert.ok(Array.isArray(unit.selfChecks) && unit.selfChecks.length >= 2, id + ' needs at least two self-checks');
  }
  assert.equal(new Set(units.map(([, u]) => u.examples)).size, units.length, 'examples must be unique per learning unit');
  assert.equal(new Set(units.map(([, u]) => u.pitfalls)).size, units.length, 'pitfalls must be unique per learning unit');
});

test('高价值单元的例子与陷阱包含足够的知识点说明', () => {
  for (const id of highValue) {
    const unit = content.units[id];
    assert.ok(unit, id + ' missing');
    assert.ok(unit.examples.length >= 30, id + ' example too short');
    assert.ok(unit.pitfalls.length >= 20, id + ' pitfall too short');
    assert.ok(unit.selfChecks.length >= 2, id + ' self-checks missing');
  }
});

test('全量补强不篡改原有事实核验状态', () => {
  const statuses = units.reduce((acc, [, unit]) => (acc[unit.status] = (acc[unit.status] || 0) + 1, acc), {});
  assert.equal(statuses.verified, 4);
  assert.equal(statuses.partial, 305);
  assert.equal(content.coverage.selfCheckEnrichedRecords, 309);
});
