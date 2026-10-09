import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const content = JSON.parse(fs.readFileSync(new URL('../data/learning-content.json', import.meta.url), 'utf8'));
const highValue = ['1.2','1.3','2.1','2.4','2.5','5.1','5.2','5.4','6.1.1','6.1.2','6.1.3','6.1.4','6.2.1','6.2.2','6.2.3','6.3.1','6.3.2','6.3.3','6.3.4','6.3.5','6.3.6','6.3.7','6.4','6.5.1','6.5.2','7.1.1','7.1.2','7.1.3','7.2.1','7.2.2','7.2.3','7.2.4','7.2.5','7.2.6','7.2.7','7.2.8','7.2.9','7.3.1','7.3.2','7.3.3','7.3.4','7.3.5','7.3.6','7.4.1','7.4.3','7.4.4','7.5.1','7.5.4','8.1.1','9.1.1','10.1.1','14.1','15.1','18.2.1','18.2.2','19.1'];

test('高价值学习单元的例子和陷阱应具体到知识点', () => {
  const examples = highValue.map(id => content.units[id]?.examples);
  const pitfalls = highValue.map(id => content.units[id]?.pitfalls);
  assert.equal(examples.length, highValue.length);
  assert.equal(pitfalls.length, highValue.length);
  assert.equal(new Set(examples).size, highValue.length);
  assert.equal(new Set(pitfalls).size, highValue.length);
  for (const id of highValue) {
    assert.ok(content.units[id].examples.length >= 30, id + ' examples too short');
    assert.ok(content.units[id].pitfalls.length >= 20, id + ' pitfalls too short');
  }
});
