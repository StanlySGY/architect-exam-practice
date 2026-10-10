import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSourceMapping, renderSourceMappingMarkdown } from '../scripts/audit-bank-source-mapping.mjs';

test('来源映射按题型和年份生成候选，不把同名或文本匹配直接当成来源证明', () => {
  const root = '/tmp/source-root';
  const files = [
    '/tmp/source-root/02-历年真题/2020年下半年-系统架构设计师-案例分析.md',
    '/tmp/source-root/02-历年真题(补充)/2020年下半年-系统架构设计师-案例分析.md',
    '/tmp/source-root/02-历年真题/2020年下半年-系统架构设计师-论文.md',
  ];
  const contents = new Map(files.map((file) => [file, '# 试题一\n论模型驱动架构设计方法及其应用\n在某系统中设计架构']));
  const report = auditSourceMapping({
    choices: [{ id: 'choice-1', sourceType: 'real', term: '2020年下半年', stem: '在某系统中设计架构', sourceFile: '旧目录/综合知识.md' }],
    cases: [{ id: 'case-1', sourceType: 'real', term: '2020年下半年', title: '试题一', description: '在某系统中设计架构', sourceFile: '旧目录/案例分析.md' }],
    essays: [{ id: 'essay-1', sourceType: 'real', term: '2020年下半年', title: '论模型驱动架构设计方法及其应用', prompt: '论模型驱动架构设计方法及其应用', sourceFile: '旧目录/论文.md' }, { id: 'essay-remote', sourceType: 'real', title: '远程题目', sourceFile: 'https://example.com/exam' }, { id: 'essay-mock', sourceType: 'mock', term: '2026年5月 模拟卷1', title: '模拟题', sourceFile: '模拟题/论文.md' }],
  }, root, files, contents);
  assert.equal(report.readOnly, true);
  assert.equal(report.counts.records, 5);
  assert.equal(report.records.find((x) => x.id === 'case-1').status, 'ambiguous-candidates');
  assert.equal(report.records.find((x) => x.id === 'essay-1').status, 'candidate-text-match-needs-human-review');
  assert.equal(report.records.find((x) => x.id === 'essay-remote').status, 'remote-source-needs-review');
  assert.equal(report.records.find((x) => x.id === 'essay-mock').status, 'simulated-no-original-source');
  assert.match(renderSourceMappingMarkdown(report), /不判断答案对错/);
});

test('来源映射阻止 sourceFile 路径逃逸 source root', () => {
  const report = auditSourceMapping({ choices: [{ id: 'escape', sourceType: 'real', term: '2020年下半年', stem: 'x', sourceFile: '../../outside.md' }] }, '/tmp/source-root', []);
  assert.equal(report.records[0].status, 'unsafe-source-path');
  assert.deepEqual(report.records[0].candidates, []);
});
