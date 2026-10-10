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
  for (const x of bank?.choices ?? []) rows.push({ id: String(x.id ?? ''), kind: 'choice', sourceType: x.sourceType ?? null, term: x.term ?? '', paper: x.paper ?? '', questionNo: x.questionNo ?? null, stem: x.stem ?? '', options: x.options ?? null, answer: x.answer ?? '', title: x.stem ?? '', matchText: x.stem ?? '', sourceFile: x.sourceFile ?? '', sourceUrl: x.sourceUrl ?? '', text: x.stem ?? '' });
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
export function inspectQuestionAtNumber(content, questionNo, row) {
  const text = String(content ?? '');
  const headings = [...text.matchAll(/^#{1,6}\s*(?:第\s*)?(\d+)\s*题[^\n]*$/gmu)];
  const blocks = headings.map((heading, index) => ({
    questionNo: Number(heading[1]),
    text: text.slice(heading.index, headings[index + 1]?.index ?? text.length).replace(heading[0], '')
  }));
  const inspect = (block) => {
    if (!block || !row?.options || typeof row.options !== 'object') return null;
    const optionMap = {};
    for (const line of block.text.split(/\r?\n/u)) {
      const match = line.match(/^\s*(?:[-*]\s*)?\*\*([A-D])\.?\*\*\s*(.*?)\s*$/u)
        ?? line.match(/^\s*([A-D])[.、)）]\s*(.*?)\s*$/u);
      if (match && match[2]) optionMap[match[1]] = match[2].trim();
    }
    const optionKeys = Object.keys(row.options);
    const matchedOptions = optionKeys.length >= 4 && optionKeys.every((key) => norm(optionMap[key]) === norm(row.options[key]));
    const answerMatch = block.text.match(/(?:正确答案|参考答案|答案)\s*[:：]\s*([A-D]{1,4})/u);
    const sourceAnswer = answerMatch?.[1]?.toUpperCase() ?? '';
    const matchedAnswer = Boolean(sourceAnswer && sourceAnswer === String(row.answer ?? '').toUpperCase());
    const firstOption = block.text.search(/^\s*(?:[-*]\s*)?\*\*[A-D]\.?\*\*/mu);
    const stemText = firstOption >= 0 ? block.text.slice(0, firstOption) : block.text.split(/(?:正确答案|参考答案|答案)\s*[:：]/u)[0];
    const rowStem = norm(row.stem ?? row.title);
    const sourceStem = norm(stemText);
    const matchedStem = rowStem.length >= 8 && sourceStem.length >= 8 && (sourceStem.includes(rowStem) || rowStem.includes(sourceStem));
    return { questionNo: block.questionNo, matchedStem, matchedOptions, matchedAnswer, matchedExactQuestion: matchedStem && matchedOptions && matchedAnswer };
  };
  const atNumber = blocks.find((block) => block.questionNo === Number(questionNo));
  const exactAtNumber = inspect(atNumber);
  const contentMatchElsewhere = blocks.map(inspect).find((candidate) => candidate?.matchedExactQuestion) ?? null;
  return { atNumber: exactAtNumber, contentMatchElsewhere };
}

export function auditSourceMapping(bank, sourceRoot, files, contents = new Map()) {
  const root = resolve(sourceRoot);
  const rows = rowsFromBank(bank);
  const records = rows.map((row) => {
    const source = String(row.sourceFile ?? '').trim();
    if (/^https?:\/\//iu.test(source) || /^https?:\/\//iu.test(String(row.sourceUrl ?? ''))) return { ...row, status: 'remote-source-needs-review', candidates: [], matchBasis: [], note: '远程来源需核对可访问性、页面题目定位与题干一致性。' };
    if (row.sourceType === 'mock' || /模拟卷|模拟题/u.test(String(row.term) + ' ' + source)) return { ...row, status: 'simulated-no-original-source', candidates: [], matchBasis: ['sourceType=mock'], note: '这是模拟题而非历年真题，不能要求映射到真题原卷；应另行核对其知识点、答案与命题来源，不把缺少真题原卷误报为来源映射失败。' };
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
      const raw = String(contents.get(file) ?? '');
      const content = norm(raw);
      const matchedTitle = title.length >= 8 && !/^试题[一二三四五六七八九十]+$/u.test(String(row.title)) && content.includes(title);
      const probe = row.kind === 'case' ? stem.slice(0, 80) : stem;
      const matchedStem = probe.length >= 18 && content.includes(probe);
      const questionReview = row.kind === 'choice' && row.questionNo ? inspectQuestionAtNumber(raw, row.questionNo, row) : { atNumber: null, contentMatchElsewhere: null };
      const matchedExactQuestion = Boolean(questionReview.atNumber?.matchedExactQuestion);
      const questionNumberMismatch = Boolean(questionReview.contentMatchElsewhere?.matchedExactQuestion && !matchedExactQuestion && questionReview.contentMatchElsewhere.questionNo !== Number(row.questionNo));
      return { path: rel, matchedTitle, matchedStem, sourceVariant: /补充/u.test(rel) ? 'supplement' : 'primary-or-unspecified', matchedQuestionNo: matchedExactQuestion ? Number(row.questionNo) : questionReview.contentMatchElsewhere?.questionNo ?? null, matchedOptions: Boolean(questionReview.atNumber?.matchedOptions || questionReview.contentMatchElsewhere?.matchedOptions), matchedAnswer: Boolean(questionReview.atNumber?.matchedAnswer || questionReview.contentMatchElsewhere?.matchedAnswer), matchedExactQuestion, questionNumberMismatch };
    }).filter((x) => x.matchedTitle || x.matchedStem || x.matchedExactQuestion || (x.matchedOptions && x.matchedAnswer));
    const candidates = matches.length ? matches : candidatesByYear.map((file) => ({ path: relative(root, file).split(sep).join('/'), matchedTitle: false, matchedStem: false, sourceVariant: /补充/u.test(file) ? 'supplement' : 'primary-or-unspecified', matchedQuestionNo: null, matchedOptions: false, matchedAnswer: false, matchedExactQuestion: false, questionNumberMismatch: false }));
    const exactMatches = candidates.filter((x) => x.matchedExactQuestion);
    const numberMismatches = candidates.filter((x) => x.questionNumberMismatch);
    const ambiguous = new Set(candidates.map((x) => x.path)).size > 1 || (candidates.length > 1 && new Set(candidates.map((x) => x.sourceVariant)).size > 1);
    let status = 'no-local-candidate';
    if (exactMatches.length > 1) status = 'multiple-question-content-matches-needs-source-precedence-review';
    else if (exactMatches.length === 1) status = 'candidate-question-content-match-needs-human-review';
    else if (numberMismatches.length) status = 'candidate-content-match-local-heading-number-differs';
    else if (candidates.length && ambiguous) status = 'ambiguous-candidates';
    else if (matches.length) status = 'candidate-text-match-needs-human-review';
    else if (candidates.length) status = 'candidate-by-year-and-type-only';
    const matchBasis = [year ? 'year=' + year : 'year-not-found', 'kind=' + row.kind];
    if (matches.some((x) => x.matchedTitle)) matchBasis.push('normalized-title-substring');
    if (matches.some((x) => x.matchedStem)) matchBasis.push('normalized-stem-substring');
    if (exactMatches.length) matchBasis.push('question-number+stem+options+answer-match');
    if (numberMismatches.length) matchBasis.push('stem+options+answer-match-at-different-local-heading-number');
    const note = status === 'no-local-candidate' ? '没有找到同年度、同科目、同题型本地候选；不代表题目错误。' : status === 'candidate-question-content-match-needs-human-review' ? '题号、题干、选项和答案与本地候选文本匹配；该文本仍可能是非官方整理版，需确认来源版本后才能确认来源映射。' : status === 'multiple-question-content-matches-needs-source-precedence-review' ? '多个本地版本均匹配题号、题干、选项和答案，仍需确定来源版本优先级。' : status === 'candidate-content-match-local-heading-number-differs' ? '题干、选项和答案在同年度候选文本的其他本地标题号匹配；清洗版可能省略或重排题号，不能据此认定题库题号错误，必须人工对照原卷。' : ambiguous ? '存在多个候选或主版/补充版歧义，禁止自动认定同源。' : matches.length ? '文本匹配仅是候选证据，仍需人工核对题干、题号、答案及版本。' : '仅按年份和题型找到候选文件，尚无题目文本匹配证据。';
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
  for (const item of report.records.filter((x) => !['source-path-resolves', 'simulated-no-original-source'].includes(x.status))) {
    lines.push('### ' + item.id + ' — ' + item.status, '', '- 类型：' + item.kind + ' / ' + (item.sourceType ?? 'unknown'), '- 年份/试卷：' + item.term + ' / ' + item.paper, '- 声明来源：' + (item.sourceFile || '(missing)'), '- 标题/题干：' + String(item.title).replace(/\s+/g, ' ').slice(0, 180), '- 匹配依据：' + (item.matchBasis.join(', ') || '无'), '- 说明：' + item.note);
    if (item.candidates.length) for (const c of item.candidates) lines.push('- 候选：' + c.path + '（标题匹配=' + c.matchedTitle + ', 题干匹配=' + c.matchedStem + ', 题号=' + (c.matchedQuestionNo ?? '未匹配') + ', 选项匹配=' + Boolean(c.matchedOptions) + ', 答案匹配=' + Boolean(c.matchedAnswer) + ', 完整内容匹配=' + Boolean(c.matchedExactQuestion) + ', 题号错配=' + Boolean(c.questionNumberMismatch) + ', 版本=' + c.sourceVariant + '）');
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
  if (jsonOut) { await mkdir(dirname(jsonOut), { recursive: true }); const compact = { ...report, records: report.records.map(({ title, paper, matchBasis, note, candidates, ...record }) => ({ ...record, candidates: candidates.map(({ path, matchedTitle, matchedStem, sourceVariant, matchedQuestionNo, matchedOptions, matchedAnswer, matchedExactQuestion, questionNumberMismatch }) => ({ path, matchedTitle, matchedStem, sourceVariant, matchedQuestionNo, matchedOptions, matchedAnswer, matchedExactQuestion, questionNumberMismatch })) })) }; await writeFile(jsonOut, JSON.stringify(compact, null, 2)); }
  if (mdOut) { await mkdir(dirname(mdOut), { recursive: true }); await writeFile(mdOut, renderSourceMappingMarkdown(report) + '\n'); }
  process.stdout.write(JSON.stringify({ ...report.counts, jsonOut, mdOut }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write('来源映射审计失败：' + error.message + '\n'); process.exitCode = 1; });
