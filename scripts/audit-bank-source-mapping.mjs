import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const norm = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}（）()【】“”‘’《》、，。；：！？]/gu, '');
const YEAR_TERM = /(\d{4}年(?:上|下)半年)/u;

async function markdownFiles(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(file);
    }
  }
  await walk(root);
  return found.sort();
}

function rowsFromBank(bank) {
  const rows = [];
  for (const x of bank?.choices ?? []) rows.push({ id: String(x.id ?? ''), kind: 'choice', sourceType: x.sourceType ?? null, term: x.term ?? '', paper: x.paper ?? '', title: x.stem ?? '', matchText: x.stem ?? '', sourceFile: x.sourceFile ?? '', sourceUrl: x.sourceUrl ?? '', text: x.stem ?? '' });
  for (const x of bank?.cases ?? []) rows.push({ id: String(x.id ?? ''), kind: 'case', sourceType: x.sourceType ?? null, term: x.term ?? '', paper: x.paper ?? '', title: x.title ?? '', matchText: x.description ?? (x.subQuestions ?? []).map((q) => q.prompt ?? '').join(' '), sourceFile: x.sourceFile ?? '', sourceUrl: x.sourceUrl ?? '', text: [x.title ?? '', x.description ?? '', ...(x.subQuestions ?? []).map((q) => q.prompt ?? '')].join(' ') });
  for (const x of bank?.essays ?? []) rows.push({ id: String(x.id ?? ''), kind: 'essay', sourceType: x.sourceType ?? null, term: x.term ?? '', paper: x.paper ?? '', title: x.title ?? '', matchText: x.title ?? '', sourceFile: x.sourceFile ?? '', sourceUrl: x.sourceUrl ?? '', text: [x.title ?? '', x.prompt ?? ''].join(' ') });
  return rows;
}

function safeResolve(root, source) {
  const absolute = resolve(root, source);
  const rel = relative(root, absolute);
  const inside = rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
  return { absolute, inside, exists: inside && existsSync(absolute) };
}

function kindMatches(path, kind) {
  if (kind === 'choice') return /综合知识|选择题|客观题/u.test(path) && !/案例分析|论文/u.test(path);
  if (kind === 'case') return /案例分析/u.test(path);
  return /论文/u.test(path);
}

export function auditSourceMapping(bank, sourceRoot, files, contents = new Map()) {
  const root = resolve(sourceRoot);
  const rows = rowsFromBank(bank);
  const records = rows.map((row) => {
    const source = String(row.sourceFile ?? '').trim();
    if (/^https?:\/\//iu.test(source) || /^https?:\/\//iu.test(String(row.sourceUrl ?? ''))) return { ...row, status: 'remote-source-needs-review', candidates: [], matchBasis: [], note: '远程来源需核对可访问性、页面题目定位与题干一致性。' };
    if (row.sourceType === 'mock' || /模拟卷|模拟题/u.test(String(row.term) + ' ' + source)) return { ...row, status: 'missing-source-candidate', candidates: [], matchBasis: [], note: '清洗历年真题目录不含该模拟卷的独立原始文件；来源生成/整理过程尚待确认。' };
    if (source) {
      const resolved = safeResolve(root, source);
      if (!resolved.inside) return { ...row, status: 'unsafe-source-path', candidates: [], matchBasis: [], note: '来源路径超出 source root，禁止按该路径读取。' };
      if (resolved.exists) return { ...row, status: 'source-path-resolves', candidates: [{ path: relative(root, resolved.absolute).split(sep).join('/'), matchedTitle: false, matchedStem: false, sourceVariant: 'direct' }], matchBasis: ['sourceFile path resolves'], note: '声明路径可解析；仍需核对题目和答案内容。' };
    }
    const match = String(row.term).match(YEAR_TERM) || String(row.paper).match(YEAR_TERM);
    const year = match ? match[1] : '';
    const candidatesByYear = files.filter((file) => {
      const rel = relative(root, file).split(sep).join('/');
      return Boolean(year) && rel.includes(year) && /系统架构设计师/u.test(rel) && kindMatches(rel, row.kind);
    });
    const title = norm(row.title);
    const stem = norm(row.matchText ?? row.text);
    const matches = candidatesByYear.map((file) => {
      const rel = relative(root, file).split(sep).join('/');
      const content = norm(contents.get(file) ?? '');
      const matchedTitle = title.length >= 8 && !/^试题[一二三四五六七八九十]+$/u.test(String(row.title)) && content.includes(title);
      const probe = row.kind === 'case' ? stem.slice(0, 80) : stem;
      const matchedStem = probe.length >= 18 && content.includes(probe);
      return { path: rel, matchedTitle, matchedStem, sourceVariant: /补充/u.test(rel) ? 'supplement' : 'primary-or-unspecified' };
    }).filter((x) => x.matchedTitle || x.matchedStem);
    const candidates = matches.length ? matches : candidatesByYear.map((file) => ({ path: relative(root, file).split(sep).join('/'), matchedTitle: false, matchedStem: false, sourceVariant: /补充/u.test(file) ? 'supplement' : 'primary-or-unspecified' }));
    const ambiguous = new Set(candidates.map((x) => x.path)).size > 1 || (candidates.length > 1 && new Set(candidates.map((x) => x.sourceVariant)).size > 1);
    let status = 'no-local-candidate';
    if (candidates.length && ambiguous) status = 'ambiguous-candidates';
    else if (matches.length) status = 'candidate-text-match-needs-human-review';
    else if (candidates.length) status = 'candidate-by-year-and-type-only';
    const matchBasis = [year ? 'year=' + year : 'year-not-found', 'kind=' + row.kind];
    if (matches.some((x) => x.matchedTitle)) matchBasis.push('normalized-title-substring');
    if (matches.some((x) => x.matchedStem)) matchBasis.push('normalized-stem-substring');
    const note = status === 'no-local-candidate' ? '没有找到同年度、同科目、同题型本地候选；不代表题目错误。' : ambiguous ? '存在多个候选或主版/补充版歧义，禁止自动认定同源。' : matches.length ? '文本匹配仅是候选证据，仍需人工核对题干、题号、答案及版本。' : '仅按年份和题型找到候选文件，尚无题目文本匹配证据。';
    return { ...row, status, candidates, matchBasis, note };
  });
  for (const record of records) { delete record.text; delete record.matchText; }
  const byStatus = {};
  for (const item of records) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  return { reportVersion: 1, generatedAt: new Date().toISOString(), readOnly: true, sourceRoot: relative(process.cwd(), root).split(sep).join('/'), counts: { records: records.length, choices: rows.filter((x) => x.kind === 'choice').length, cases: rows.filter((x) => x.kind === 'case').length, essays: rows.filter((x) => x.kind === 'essay').length, byStatus }, note: '来源映射只提供可复核候选，不验证答案正确性，也不修改题库。文本匹配不构成同源证明。', records };
}

export function renderSourceMappingMarkdown(report) {
  const lines = ['# 题库来源映射审计', '', '- 生成时间：' + report.generatedAt, '- 来源目录：' + report.sourceRoot, '- 只读：' + report.readOnly, '- 记录数：' + report.counts.records, '', '## 分类计数', '', '| 状态 | 数量 |', '|---|---:|'];
  for (const [status, count] of Object.entries(report.counts.byStatus)) lines.push('| ' + status + ' | ' + count + ' |');
  lines.push('', '> 本报告只生成来源候选，不判断答案对错；同年度、同题型或文本片段匹配都不能单独证明来源一致。', '', '## 需要处理的记录', '');
  for (const item of report.records.filter((x) => x.status !== 'source-path-resolves')) {
    lines.push('### ' + item.id + ' — ' + item.status, '', '- 类型：' + item.kind + ' / ' + (item.sourceType ?? 'unknown'), '- 年份/试卷：' + item.term + ' / ' + item.paper, '- 声明来源：' + (item.sourceFile || '(missing)'), '- 标题/题干：' + String(item.title).replace(/\s+/g, ' ').slice(0, 180), '- 匹配依据：' + (item.matchBasis.join(', ') || '无'), '- 说明：' + item.note);
    if (item.candidates.length) for (const c of item.candidates) lines.push('- 候选：' + c.path + '（标题匹配=' + c.matchedTitle + ', 题干匹配=' + c.matchedStem + ', 版本=' + c.sourceVariant + '）');
    else lines.push('- 候选：无');
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const bankPath = resolve(process.argv[2] ?? '../architect-exam-bank/data/bank.json');
  const sourceRoot = resolve(process.argv[3] ?? '../ruankao-senior-architecture-designer/sources');
  const jsonOut = process.argv[4] ? resolve(process.argv[4]) : null;
  const mdOut = process.argv[5] ? resolve(process.argv[5]) : null;
  const bank = JSON.parse(await readFile(bankPath, 'utf8'));
  const files = await markdownFiles(sourceRoot);
  const contents = new Map(await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')])));
  const report = auditSourceMapping(bank, sourceRoot, files, contents);
  if (jsonOut) { await mkdir(dirname(jsonOut), { recursive: true }); const compact = { ...report, records: report.records.map(({ title, paper, matchBasis, note, candidates, ...record }) => ({ ...record, candidates: candidates.map(({ path, matchedTitle, matchedStem, sourceVariant }) => ({ path, matchedTitle, matchedStem, sourceVariant })) })) }; await writeFile(jsonOut, JSON.stringify(compact, null, 2)); }
  if (mdOut) { await mkdir(dirname(mdOut), { recursive: true }); await writeFile(mdOut, renderSourceMappingMarkdown(report) + '\n'); }
  process.stdout.write(JSON.stringify({ ...report.counts, jsonOut, mdOut }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write('来源映射审计失败：' + error.message + '\n'); process.exitCode = 1; });
