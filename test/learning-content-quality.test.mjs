import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const content = JSON.parse(fs.readFileSync(new URL('../data/learning-content.json', import.meta.url), 'utf8'));
const highValue = ['8.1.1','9.1.1','10.1.1','14.1','15.1','18.2.1','18.2.2','19.1'];

test('高价值学习单元的例子和陷阱应具体到知识点', () => {
  const examples = highValue.map(id => content.units[id]?.examples);
  const pitfalls = highValue.map(id => content.units[id]?.pitfalls);
  assert.equal(examples.length, 8);
  assert.equal(pitfalls.length, 8);
  assert.equal(new Set(examples).size, highValue.length);
  assert.equal(new Set(pitfalls).size, highValue.length);
  for (const id of highValue) {
    assert.ok(content.units[id].examples.length >= 30, id + ' examples too short');
    assert.ok(content.units[id].pitfalls.length >= 20, id + ' pitfalls too short');
  }
});
