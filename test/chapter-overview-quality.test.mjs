import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const content = JSON.parse(fs.readFileSync(new URL('../data/learning-content.json', import.meta.url), 'utf8'));
test('18个章节导读核心教学字段按章节主题定制并保持待核验状态', () => {
  const fields = ['what', 'why', 'how', 'confusions', 'scenarios', 'examFocus'];
  const oldTemplates = [
    '本章围绕《绪论》展开，涵盖教材目录所列的核心概念、方法与实践主题；具体知识点以对应小节为准。',
    '本单元是第1章《绪论》的章节导读，用于建立全章结构，再进入下级知识点逐项学习。',
    '不要仅凭章节标题推断具体结论，也不要把本章导读当成完整教材内容；概念、标准、公式和参数须在对应小节核对。',
    '章节导读情境（非教材原例）：围绕《绪论》选取一个系统问题，列出目标、约束、候选方案和需要查证的依据。',
    '根据教材目录和考试大纲梳理本章考点；涉及公式、标准、版本、精确参数、真题答案或教材案例时，必须回查可靠来源。'
  ];
  for (let n = 1; n <= 18; n++) {
    const unit = content.units[String(n)];
    assert.ok(unit, 'missing chapter ' + n);
    assert.equal(unit.status, 'partial', 'chapter must remain unverified ' + n);
    for (const field of fields) assert.ok(typeof unit[field] === 'string' && unit[field].length > 30, n + '.' + field + ' missing');
    for (const template of oldTemplates) for (const field of fields) assert.notEqual(unit[field], template, n + '.' + field + ' retains generic text');
  }
  for (const field of fields) assert.equal(new Set(Array.from({ length: 18 }, (_, i) => content.units[String(i + 1)][field])).size, 18, field + ' should be topic-specific');
  assert.match(content.units['6'].what, /数据库/);
  assert.match(content.units['7'].scenarios, /支付服务超时/);
  assert.match(content.units['14'].how, /云原生/);
  assert.match(content.units['18'].confusions, /防护强度/);
});

test('全量学习单元不再残留已识别的批量模板尾句', () => {
  const known = [
    '与本知识点直接相邻的概念至少做一次对照',
    '先用教材或项目已有案例定位',
    '围绕“定义/核心机制—关键词—与相邻概念的区别—适用场景—限制与权衡”形成题目识别卡',
    '本知识点：',
    '每个架构知识点都问五个问题',
    '重点把本知识点放进架构案例'
  ];
  let counts = Object.fromEntries(known.map((text) => [text, 0]));
  for (const [id, unit] of Object.entries(content.units)) {
    for (const field of ['how', 'confusions', 'scenarios', 'examFocus']) {
      const value = String(unit[field] || '');
      for (const template of known) {
        if (value.includes(template)) counts[template]++;
      }
    }
  }
  assert.deepEqual(counts, Object.fromEntries(known.map((text) => [text, 0])));
});
