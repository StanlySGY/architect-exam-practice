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
test('how/confusions 不包含批量补写的通用模板尾句', () => {
  const forbiddenTails = [
    '学习时请把上述机制与本单元的适用条件、关键约束和代价对应起来；涉及精确结论时回查来源。',
    '辨析时围绕本单元的核心概念与适用条件，明确相邻术语的区别；缺乏证据的结论保留待核验。',
  ];
  for (const [id, unit] of units) {
    for (const field of ['how', 'confusions']) {
      assert.ok(!forbiddenTails.some((tail) => String(unit[field] ?? '').endsWith(tail)), `${id}.${field} still contains a generic template tail`);
    }
  }
});
test('数据库设计基础单元的 why/how/confusions 按各自主题区分', () => {
  const ids = ['6.1.2','6.1.3','6.2.1','6.2.2','6.3.2','6.3.3','6.3.4','6.3.5','6.3.6','6.3.7','6.4'];
  for (const field of ['why', 'how', 'confusions']) {
    const values = ids.map((id) => content.units[id]?.[field]);
    assert.ok(values.every((value) => typeof value === 'string' && value.trim()), `${field} must remain present`);
    assert.equal(new Set(values).size, ids.length, `${field} should be topic-specific across audited database units`);
  }
});
test('信息安全基础单元的 why/how/confusions 按安全主题区分', () => {
  const ids = ['4.1.1','4.1.2','4.1.3','4.2','4.3.1','4.3.2','4.3.3','4.4.1','4.4.2','4.4.3','4.5.1','4.5.2','4.5.3','4.6.1','4.6.2','4.7.1','4.7.2','4.7.3','4.7.4','4.7.5','4.7.6','4.8.1','4.8.2'];
  for (const field of ['why', 'how', 'confusions']) {
    const values = ids.map((id) => content.units[id]?.[field]);
    assert.ok(values.every((value) => typeof value === 'string' && value.trim()), `${field} must remain present`);
    assert.equal(new Set(values).size, ids.length, `${field} should be topic-specific across audited security units`);
  }
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

test('章节总览与目录主题一致，且核验状态与来源状态不冲突', () => {
  const chapters = JSON.parse(fs.readFileSync(new URL('../data/chapters.json', import.meta.url), 'utf8'));
  for (const chapter of chapters) {
    const unit = content.units[String(chapter.id)];
    if (!unit) continue;
    assert.equal(unit.chapterTitle, chapter.title, 'chapter title mismatch: ' + chapter.id);
    assert.equal(unit.status, 'partial', 'chapter overview must not imply full fact verification: ' + chapter.id);
    assert.equal(unit.source?.path, 'data/chapters.json', 'chapter overview source missing: ' + chapter.id);
    assert.equal(unit.source?.status, 'needs-review', 'chapter overview source status mismatch: ' + chapter.id);
  }
  for (const [id, unit] of units) {
    if (unit.status === 'verified') {
      assert.equal(unit.contentSource?.status, 'verified', 'verified status needs verified course-content source: ' + id);
      assert.ok(unit.contentSource?.evidence?.includes('https://'), 'verified status needs a traceable source URL: ' + id);
      assert.ok(unit.sourceEvidence?.includes('https://'), 'verified status needs unit-level source evidence: ' + id);
    }
    if (unit.contentSource?.status === 'verified') assert.equal(unit.status, 'verified', 'verified contentSource needs verified unit: ' + id);
  }
});

test('第1章已核验单元的教学字段必须与各自主题对应', () => {
  const architectureBasics = content.units['1.1'];
  assert.match(architectureBasics.selfChecks[0], /基本组织.*元素之间的关系.*系统环境/);
  assert.match(architectureBasics.selfChecks[1], /分层架构.*事件驱动架构/);
  assert.doesNotMatch(architectureBasics.selfChecks.join(' '), /学习时先区分|请用“从系统边界/);
  const architectRole = content.units['1.2'];
  assert.match(architectRole.how, /职责|任务/);
  assert.match(architectRole.confusions, /项目经理/);
  assert.match(architectRole.examFocus, /非功能需求/);
  assert.doesNotMatch(architectRole.how, /系统边界→关键元素|建模→场景→权衡/);

  for (const id of ['6.3.1', '6.5.1', '6.5.2', '7.2.1', '7.2.6', '7.2.7']) {
    const unit = content.units[id];
    for (const field of ['how', 'confusions', 'scenarios', 'examFocus']) {
      assert.ok(!['本知识点：6.', '本知识点：7.', '先用教材或项目已有案例定位', '每个架构知识点都问五个问题', '与本知识点直接相邻的概念至少做一次对照', '围绕“定义/核心机制'].some(template => unit[field].includes(template)), `${id}.${field} still contains generic template text`);
    }
    assert.ok(unit.examples.length > 20, `${id}.examples should be substantive`);  }

  const databaseTypes = content.units['6.5.1'];
  assert.match(databaseTypes.how, /键值模型.*文档模型.*图模型/);
  assert.match(databaseTypes.confusions, /列式.*宽列/);
  assert.match(databaseTypes.examFocus, /访问模式/);

  const architectureDrivers = content.units['7.2.1'];
  assert.match(architectureDrivers.how, /架构驱动因素/);
  assert.match(architectureDrivers.scenarios, /支付超时/);

  const architectureViews = content.units['7.2.6'];
  assert.match(architectureViews.how, /涉众.*逻辑视图.*运行视图.*部署视图/);
  assert.match(architectureViews.confusions, /视图.*视角/);

  const architectureReview = content.units['7.2.7'];
  assert.match(architectureReview.how, /责任人.*验证证据/);
  assert.match(architectureReview.examFocus, /风险消失/);
  const architectGrowth = content.units['1.3'];
  assert.match(architectGrowth.what, /领导者.*开发者.*系统综合者/);
  assert.match(architectGrowth.how, /工程师.*架构设计师/);
  assert.match(architectGrowth.examFocus, /六种角色特质/);
  assert.doesNotMatch(architectGrowth.how, /系统边界→关键元素|本知识点：1\.3/);
});

test('全量补强不篡改原有事实核验状态', () => {
  const statuses = units.reduce((acc, [, unit]) => (acc[unit.status] = (acc[unit.status] || 0) + 1, acc), {});
  assert.equal(statuses.verified, 3);
  assert.equal(statuses.partial, 306);
  assert.equal(content.coverage.selfCheckEnrichedRecords, 309);
});
