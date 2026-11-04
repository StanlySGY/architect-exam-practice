import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, appendFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildVerificationQueue } from './audit-learning-verification-queue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const hasFlag = (name) => ARGV.includes('--' + name);
const option = (name, fallback) => {
  const prefix = '--' + name + '=';
  const value = ARGV.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};
const integer = (name, fallback, min, max) => {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('--' + name + ' 范围应为 ' + min + '..' + max);
  return value;
};
const BASE = new URL(option('base-url', 'http://127.0.0.1:3210'));
if (BASE.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(BASE.hostname)) throw new Error('仅允许本机 loopback HTTP API');
const CONCURRENCY = integer('concurrency', 6, 1, 12);
const CHUNK_SIZE = integer('batch-size', 12, 1, 50);
const TIMEOUT_MS = integer('timeout-ms', 12000, 1000, 30000);
const MAX_URLS = integer('max-urls', 10000, 1, 10000);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const execFileAsync = promisify(execFile);
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.tmp-' + process.pid;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
async function log(path, message) {
  const line = '[' + new Date().toISOString() + '] ' + message + '\n';
  process.stdout.write(line);
  await appendFile(path, line, { mode: 0o600 });
}
async function markdownManifest(root) {
  if (!(await exists(root))) return [];
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const info = await stat(path);
        files.push([relative(root, path).split(sep).join('/'), info.size, info.mtimeMs]);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a[0].localeCompare(b[0]));
}
async function lock(path) {
  const create = async () => {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.close();
  };
  try { await create(); return; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  let stale = false;
  try {
    const previous = await readJson(path);
    try { process.kill(Number(previous.pid), 0); } catch (error) { stale = error.code === 'ESRCH'; }
  } catch { stale = true; }
  if (!stale) throw new Error('任务已有运行中的进程，为避免重复访问不会并行启动');
  await rm(path, { force: true });
  await create();
}
async function api(path) {
  const response = await fetch(new URL(path, BASE), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('本地 API ' + path + ' HTTP ' + response.status);
  return response.json();
}
async function paged(path, key, size = 100) {
  const first = await api(path + '?limit=' + size + '&offset=0');
  const total = Number(first.total ?? first[key]?.length ?? 0);
  if (!Number.isSafeInteger(total) || total < 0 || total > 20000) throw new Error(path + ' 返回异常总量 ' + total);
  const rows = [...(first[key] ?? [])];
  while (rows.length < total) {
    const page = await api(path + '?limit=' + size + '&offset=' + rows.length);
    if (Number(page.total) !== total) throw new Error(path + ' 分页期间数据量变化');
    const nextRows = page[key] ?? [];
    if (!nextRows.length) throw new Error(path + ' 分页没有前进：' + rows.length + '/' + total);
    rows.push(...nextRows);
    if (rows.length > total) throw new Error(path + ' 分页返回超过声明总量');
  }
  if (rows.length !== total) throw new Error(path + ' 分页不完整');
  return rows;
}
export function classifyAuthority(url, declared = '') {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'invalid-url'; }
  const authority = String(declared).toLowerCase();
  if (host === 'tup.tsinghua.edu.cn' || host.endsWith('.tup.tsinghua.edu.cn') || /清华大学出版社|出版社/u.test(authority)) return 'publisher';
  if (/\.gov(?:\.cn)?$|\.gov\.[a-z]{2}$|(^|\.)europa\.eu$/u.test(host)) return 'government-or-public-agency';
  if (/nist\.gov|nasa\.gov/u.test(host)) return 'government-or-public-agency';
  if (/iso\.org|iec\.ch|ieee\.org|w3\.org|ietf\.org|标准组织/u.test(host + ' ' + authority)) return 'standards-body';
  if (/\.edu(?:\.[a-z]{2})?$|\.ac\.[a-z]{2}$|academic\.oup\.com$|\.oup\.com$|springer\.com$|sciencedirect\.com$|acm\.org$|pubmed\.ncbi\.nlm\.nih\.gov$|arxiv\.org$|doi\.org$/u.test(host)) return 'academic-or-research';
  if (/大学|学术|期刊/u.test(authority) && !/博客|论坛|community/u.test(authority)) return 'academic-or-research';
  if (/learn\.microsoft\.com|docs\.aws\.amazon\.com|aws\.amazon\.com|amazonaws\.com|cloudflare\.com|ibm\.com\/docs|kubernetes\.io|redis\.io|postgresql\.org|owasp\.org/u.test(host)) return 'vendor-or-project-documentation';
  if (/britannica\.com|encyclopedia/u.test(host)) return 'reference-work';
  if (/csdn\.net|zhihu\.com|juejin\.cn|cnblogs\.com|stackoverflow\.com|github\.com|gitee\.com|blog|community|博客|论坛/u.test(host + ' ' + authority)) return 'community-or-secondary-source';
  return 'unknown-authority';
}
export function classifyHttpStatus(status) {
  if (status >= 200 && status < 300) return 'reachable';
  if ([401, 403, 407].includes(status)) return 'access-restricted';
  if ([404, 410].includes(status)) return 'not-found';
  if ([408, 425, 429].includes(status)) return 'retry-or-rate-limited';
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  return 'unexpected-status';
}
export function isRetryableSourceStatus(status) {
  return ['network-error', 'server-error', 'retry-or-rate-limited'].includes(status);
}
export function shouldFallbackToGet(status) {
  return !Number.isInteger(status) || status < 200 || status >= 300;
}
export function collectEvidenceUrls(content) {
  const map = new Map();
  for (const [id, unit] of Object.entries(content?.units ?? {})) {
    for (const evidence of Array.isArray(unit?.evidence) ? unit.evidence : []) {
      const url = String(evidence?.url ?? '').trim();
      if (!/^https?:\/\//iu.test(url)) continue;
      if (!map.has(url)) map.set(url, { url, units: new Set(), titles: new Set(), authorities: new Set(), statuses: new Set() });
      const item = map.get(url);
      item.units.add(id);
      if (evidence.sourceTitle) item.titles.add(evidence.sourceTitle);
      if (evidence.sourceAuthority) item.authorities.add(evidence.sourceAuthority);
      if (evidence.reviewStatus) item.statuses.add(evidence.reviewStatus);
    }
  }
  return [...map.values()].map((item) => ({
    url: item.url, unitIds: [...item.units].sort(), sourceTitles: [...item.titles].sort(),
    authorities: [...item.authorities].sort(), reviewStatuses: [...item.statuses].sort(),
    authorityClass: classifyAuthority(item.url, [...item.authorities].join('; ')),
  })).sort((a, b) => a.url.localeCompare(b.url));
}
export function buildLearningReviewBatches(queue, size = 20) {
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error('batch size 必须在 1..50 之间');
  const batches = [];
  for (let offset = 0; offset < queue.length; offset += size) {
    const units = queue.slice(offset, offset + size);
    batches.push({
      batch: batches.length + 1,
      batchId: 'learning-' + String(batches.length + 1).padStart(3, '0'),
      unitCount: units.length,
      units,
      instructions: [
        '逐项核对事实、术语、公式、标准号、版本、参数和适用前提。',
        '证据只支持 supportedClaim 与 scope 明确覆盖的内容，不得扩大为整单元证明。',
        '优先使用出版社正文、官方标准、政府机构、标准组织、论文原文或维护者官方文档。',
        '无法确认来源版本、正文不可访问或证据范围不足时，保留 partial 并记录阻塞。',
        '不得自动升级学习单元 status，不得把 AI 总结当作人工核验。',
      ],
    });
  }
  return batches;
}
export function isGeneratedQuestion(item) {
  return item?.sourceType === 'generated'
    || (!item?.sourceType && item?.source === 'ruankao-agent/mindmap');
}
export function auditGeneratedQuestions(questions) {
  const generated = questions.filter(isGeneratedQuestion);
  const statuses = {};
  const duplicateMap = new Map();
  const flags = [];
  const seenIds = new Set();
  for (const item of generated) {
    const status = String(item.reviewStatus ?? item.status ?? '(unlabelled)');
    statuses[status] = (statuses[status] ?? 0) + 1;
    const stem = normalize(item.question);
    if (stem) {
      if (!duplicateMap.has(stem)) duplicateMap.set(stem, []);
      duplicateMap.get(stem).push(item);
    }
    const options = item.options && typeof item.options === 'object'
      ? ['A', 'B', 'C', 'D'].map((key) => String(item.options[key] ?? '').trim()) : [];
    const reasons = [];
    if (!String(item.question ?? '').trim()) reasons.push('missing-question');
    if (options.length !== 4 || options.some((entry) => !entry)) reasons.push('incomplete-four-options');
    if (options.length === 4 && new Set(options.map(normalize)).size !== 4) reasons.push('duplicate-options');
    if (!['A', 'B', 'C', 'D'].includes(String(item.correctAnswer ?? ''))) reasons.push('invalid-correct-answer');
    if (!String(item.analysis ?? '').trim()) reasons.push('missing-analysis');
    if (!String(item.sourceNode ?? '').trim()) reasons.push('missing-mindmap-source-node');
    if (!String(item.knowledgeDetail ?? '').trim()) reasons.push('missing-knowledge-detail');
    if (item.section && item.sourceNode && !String(item.sourceNode).includes(String(item.section))) reasons.push('section-not-visible-in-source-node');
    if (seenIds.has(item.id)) reasons.push('duplicate-id');
    seenIds.add(item.id);
    if (reasons.length) flags.push({ id: item.id, chapter: item.chapter, section: item.section, reasons });
  }
  const duplicates = [...duplicateMap.values()].filter((group) => group.length > 1).map((group) => ({
    ids: group.map((item) => item.id),
    chapter: group[0].chapter,
    section: group[0].section,
    sameOptions: group.every((item) => JSON.stringify(item.options ?? {}) === JSON.stringify(group[0].options ?? {})),
    sameAnswer: group.every((item) => item.correctAnswer === group[0].correctAnswer),
  }));
  return {
    total: generated.length,
    statusDistribution: statuses,
    structureFlagged: flags.length,
    structureFlagCounts: flags.reduce((counts, row) => {
      for (const reason of row.reasons) counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {}),
    duplicateGroups: duplicates,
    flags,
    note: '结构/重复扫描只生成审校候选，不判断答案真伪，不批准、不删除、不改写题目。',
  };
}
export function buildAnswerRiskPacket(report, questionIds, caseIds, paperIds) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  return {
    total: findings.length,
    ruleCounts: report?.ruleCounts ?? {},
    triageCategories: report?.triageCategories ?? {},
    findings: findings.map((finding) => {
      const item = finding.item ?? {};
      const id = String(item.id ?? '');
      const parentId = id.split(':')[0];
      const found = item.kind === 'choice' ? questionIds.has(id)
        : item.kind === 'case' ? caseIds.has(parentId)
          : item.kind === 'essay' ? paperIds.has(parentId) : false;
      return {
        id, kind: item.kind ?? null, term: item.term ?? null, questionNo: item.questionNo ?? null,
        field: item.field ?? null, rule: finding.rule ?? null, matchedText: finding.matchedText ?? null,
        triageCategory: finding.triageCategory ?? null, sourceLocatorAssessment: finding.sourceLocatorAssessment ?? null,
        recordFoundInLocalReadOnlyApi: found, context: finding.context ?? '', guidance: finding.guidance ?? '',
      };
    }),
    note: '风险词命中是人工复核候选，不等于答案错误；不修改答案、source、answerTrust 或题库记录。',
  };
}
async function parallelMap(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}
async function curlProbe(url, method) {
  const timeoutSeconds = Math.max(1, Math.ceil(TIMEOUT_MS / 1000));
  const connectSeconds = Math.max(1, Math.min(8, timeoutSeconds));
  const format = ['%{http_code}', '%{url_effective}', '%{content_type}', '%{num_redirects}'].join('\n');
  const args = [
    '--silent', '--show-error', '--location', '--max-redirs', '8',
    '--connect-timeout', String(connectSeconds), '--max-time', String(timeoutSeconds),
    '--user-agent', 'architect-exam-practice-local-review/1.0',
    '--header', 'Accept: text/html,application/pdf,*/*;q=0.5',
    '--write-out', format, '--output', '/dev/null',
  ];
  if (method === 'HEAD') args.push('--head');
  else args.push('--range', '0-0', '--max-filesize', '1048576');
  args.push(url);
  try {
    const { stdout } = await execFileAsync('curl', args, {
      timeout: TIMEOUT_MS + 3000,
      maxBuffer: 4096,
      env: process.env,
    });
    const lines = String(stdout).trim().split('\n');
    const status = Number(lines[0] ?? 0);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      return { httpStatus: null, finalUrl: null, contentType: null, redirects: 0, error: 'curl-no-http-response' };
    }
    return {
      httpStatus: status,
      finalUrl: lines[1] || null,
      contentType: lines[2] || null,
      redirects: Number(lines[3] ?? 0) || 0,
      error: null,
    };
  } catch (error) {
    const output = String(error.stdout ?? '').trim().split('\n');
    const status = Number(output[0] ?? 0);
    return {
      httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
      finalUrl: output[1] || null,
      contentType: output[2] || null,
      redirects: Number(output[3] ?? 0) || 0,
      error: String(error.code ?? (error.killed ? 'ETIMEDOUT' : error.signal ?? 'curl-error')),
    };
  }
}
async function checkSource(item) {
  const started = Date.now();
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result = await curlProbe(item.url, 'HEAD');
    let method = 'HEAD';
    let headStatus = null;
    // Some origins reject or mis-handle HEAD (including with 404) while serving
    // the same resource normally to GET. Treat HEAD as a hint only and confirm
    // every non-2xx response with a bounded one-byte GET before classifying it.
    if (shouldFallbackToGet(result.httpStatus)) {
      headStatus = result.httpStatus;
      result = await curlProbe(item.url, 'GET');
      method = 'GET';
    }
    const status = result.httpStatus ? classifyHttpStatus(result.httpStatus) : 'network-error';
    lastError = result.error;
    if (['retry-or-rate-limited', 'server-error', 'network-error'].includes(status) && attempt === 1 && !stopping) {
      await sleep(700);
      continue;
    }
    return {
      url: item.url, authorityClass: item.authorityClass, status,
      httpStatus: result.httpStatus, method, headStatus, fallbackUsed: method === 'GET',
      finalUrl: result.finalUrl, redirected: result.redirects > 0,
      contentType: result.contentType, unitIds: item.unitIds,
      sourceTitles: item.sourceTitles, authorities: item.authorities,
      attempts: attempt, durationMs: Date.now() - started, error: result.error,
    };
  }
  return {
    url: item.url, authorityClass: item.authorityClass, status: 'network-error',
    httpStatus: null, method: null, headStatus: null, fallbackUsed: false,
    finalUrl: null, redirected: false, contentType: null,
    unitIds: item.unitIds, sourceTitles: item.sourceTitles, authorities: item.authorities,
    attempts: 2, durationMs: Date.now() - started, error: lastError,
  };
}

async function main() {
  const contentText = await readFile(join(ROOT, 'data', 'learning-content.json'), 'utf8');
  const content = JSON.parse(contentText);
  const verification = buildVerificationQueue(content);
  const learningBatches = buildLearningReviewBatches(verification.queue, 20);
  const evidenceUrls = collectEvidenceUrls(content);
  const riskReport = await readJson(join(ROOT, 'docs', 'audits', 'answer-risk-review-queue.json'));
  const historicalMapping = await readJson(join(ROOT, 'docs', 'audits', 'source-mapping-review-queue.json'));
  const questions = await paged('/api/questions', 'records');
  const cases = await paged('/api/cases', 'cases');
  const papers = await paged('/api/papers', 'papers');
  const dataStatus = await api('/api/data/status');
  const generatedAudit = auditGeneratedQuestions(questions);
  const riskPacket = buildAnswerRiskPacket(
    riskReport,
    new Set(questions.map((item) => String(item.id))),
    new Set(cases.map((item) => String(item.id))),
    new Set(papers.map((item) => String(item.id))),
  );
  const externalBankPath = resolve(ROOT, '../architect-exam-bank/data/bank.json');
  const externalSourcePath = resolve(ROOT, '../ruankao-senior-architecture-designer/sources');
  const externalBankAvailable = await exists(externalBankPath);
  const externalSourceAvailable = await exists(externalSourcePath);
  const externalBankStat = externalBankAvailable ? await stat(externalBankPath) : null;
  const sourceManifest = externalSourceAvailable ? await markdownManifest(externalSourcePath) : [];
  const sourceManifestFingerprint = digest(JSON.stringify(sourceManifest));
  const inputFingerprint = digest(JSON.stringify({
    contentHash: digest(contentText),
    questions: questions.map((item) => [
      item.id, item.revision, item.reviewStatus, item.status,
      digest(String(item.question ?? '') + JSON.stringify(item.options ?? {}) + String(item.analysis ?? '')),
    ]),
    cases: cases.map((item) => item.id),
    papers: papers.map((item) => item.id),
    risks: (riskReport.findings ?? []).map((item) => [item.item?.id, item.rule, item.matchedText]),
    externalBank: externalBankStat ? [externalBankStat.size, externalBankStat.mtimeMs] : null,
    sourceManifestFingerprint,
  }));
  const plan = {
    learningRecords: verification.sourceUnitCount,
    leafUnits: verification.unitCount,
    awaitingHumanVerification: verification.unitsAwaitingVerification,
    learningReviewBatches: learningBatches.length,
    evidenceRecords: Object.values(content.units ?? {}).reduce((sum, unit) => sum + (unit.evidence?.length ?? 0), 0),
    uniqueEvidenceUrls: evidenceUrls.length,
    questions: questions.length,
    generatedQuestions: generatedAudit.total,
    cases: cases.length,
    essays: papers.length,
    answerRiskFindings: riskPacket.total,
    localPdfProvenanceUnverified: verification.unitsWithUnverifiedLocalPdfProvenance.length,
    externalBankAvailable,
    externalSourceRepositoryAvailable: externalSourceAvailable,
    externalSourceMarkdownFiles: sourceManifest.length,
    externalBankSizeBytes: externalBankStat?.size ?? null,
    externalSourceManifestFingerprint: sourceManifestFingerprint,
    dataStatus: {
      generatedQuestions: dataStatus.generatedQuestions,
      realQuestions: dataStatus.realQuestions,
      mockQuestions: dataStatus.mockQuestions,
      cases: dataStatus.cases,
      papers: dataStatus.papers,
    },
    boundary: '本地 API GET only；来源 HEAD / GET Range；无 LLM 调用、无 SQLite 写入、无题库修改/批准、无学习状态修改。',
  };

  if (hasFlag('dry-run')) {
    process.stdout.write(JSON.stringify({
      plan,
      generatedQuestionAudit: {
        statusDistribution: generatedAudit.statusDistribution,
        structureFlagged: generatedAudit.structureFlagged,
        structureFlagCounts: generatedAudit.structureFlagCounts,
        duplicateGroups: generatedAudit.duplicateGroups.length,
      },
      historicalSourceMappingSnapshot: historicalMapping.counts ?? null,
      urlPreview: evidenceUrls.slice(0, 8).map((item) => ({ url: item.url, authorityClass: item.authorityClass })),
    }, null, 2) + '\n');
    return;
  }

  const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'share');
  const jobsRoot = join(stateRoot, 'architect-exam-practice', 'review-jobs');
  const baseId = String(option('job-id', 'verification-research')).replace(/[^a-zA-Z0-9._-]/gu, '-').slice(0, 80);
  const jobId = hasFlag('fresh') ? baseId + '-' + new Date().toISOString().replace(/[:.]/gu, '-') : baseId;
  const jobDir = join(jobsRoot, jobId);
  const statePath = join(jobDir, 'state.json');
  const reportPath = join(jobDir, 'report.json');
  const logPath = join(jobDir, 'job.log');
  const lockPath = join(jobDir, '.lock');
  await mkdir(jobDir, { recursive: true, mode: 0o700 });
  await lock(lockPath);

  try {
    let state;
    if (await exists(statePath)) {
      state = await readJson(statePath);
      if (state.inputFingerprint !== inputFingerprint) {
        throw new Error('输入数据发生变化；请使用 --fresh 创建新任务，旧结果会保留');
      }
      if (state.status === 'completed' && !hasFlag('retry-network-errors')) {
        process.stdout.write(JSON.stringify({
          jobId, status: state.status, reportPath,
          message: '任务已完成；如需重新检查 URL，请使用 --fresh。',
        }, null, 2) + '\n');
        return;
      }
    } else {
      state = {
        jobId, inputFingerprint, status: 'running', urlResults: {},
        createdAt: new Date().toISOString(),
      };
    }

    await saveJson(join(jobDir, 'plan.json'), {
      jobId, inputFingerprint, generatedAt: new Date().toISOString(), ...plan,
    });
    await saveJson(join(jobDir, 'learning-review-batches.json'), {
      totalUnits: verification.unitsAwaitingVerification,
      batchSize: 20,
      batchCount: learningBatches.length,
      batches: learningBatches,
    });
    await saveJson(join(jobDir, 'generated-question-audit.json'), generatedAudit);
    await saveJson(join(jobDir, 'answer-risk-review-packet.json'), riskPacket);
    await saveJson(join(jobDir, 'scoring-calibration-intake-template.json'), {
      version: 1,
      requiredFields: ['sampleId', 'kind', 'rubricVersion', 'humanScores', 'adjudicatedScore', 'aiRun', 'review'],
      recommendedSamples: { case: 10, essay: 10, humanGradersPerSample: 2 },
      metrics: [
        'total-score MAE', 'per-dimension MAE', 'weighted human inter-rater agreement',
        'AI-human score bias by score band', 'pass/fail disagreement rate',
      ],
      warning: '此模板不是校准结果；没有人工双评锚点样本时不得声称评分准确率或一致性。',
    });
    await saveJson(join(jobDir, 'scoring-calibration-status.json'), {
      status: 'blocked-waiting-for-human-scored-anchor-samples',
      humanAnchorSamplesFound: 0,
      modelRuns: 0,
      reason: '现有评分提示词与自动化结构测试不足以测量评分准确度；此任务不会调用模型。',
    });
    const currentMappingJson = join(jobDir, 'source-mapping-current.json');
    const currentMappingMarkdown = join(jobDir, 'source-mapping-current.md');
    let currentMapping = null;
    if (externalBankAvailable && externalSourceAvailable) {
      let cachedMappingValid = false;
      if (await exists(currentMappingJson)) {
        try {
          currentMapping = await readJson(currentMappingJson);
          cachedMappingValid = Number(currentMapping.counts?.records) > 0
            && currentMapping.sourceRoot
            && await exists(currentMappingMarkdown);
        } catch {
          cachedMappingValid = false;
        }
      }
      if (!cachedMappingValid) {
        await rm(currentMappingJson, { force: true });
        await rm(currentMappingMarkdown, { force: true });
        await log(logPath, '开始对相邻只读题库运行当前来源映射：' + plan.externalSourceMarkdownFiles + ' 个 Markdown 来源文件');
        await execFileAsync(process.execPath, [
          join(ROOT, 'scripts', 'audit-bank-source-mapping.mjs'),
          externalBankPath,
          externalSourcePath,
          currentMappingJson,
          currentMappingMarkdown,
        ], {
          cwd: ROOT,
          timeout: 20 * 60 * 1000,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
        });
        currentMapping = await readJson(currentMappingJson);
        if (!Number.isSafeInteger(Number(currentMapping.counts?.records)) || !currentMapping.records) {
          throw new Error('当前来源映射审计输出不完整');
        }
        await log(logPath, '当前来源映射完成：' + currentMapping.counts.records + ' 条；' + JSON.stringify(currentMapping.counts.byStatus));
      } else {
        await log(logPath, '恢复已完成的来源映射报告：' + currentMapping.counts.records + ' 条');
      }
    } else {
      await log(logPath, '来源映射跳过：相邻原始题库或来源目录不可用');
    }
    await log(logPath, '启动 ' + jobId + '：' + evidenceUrls.length + ' 个来源 URL；' +
      verification.unitsAwaitingVerification + ' 个学习单元待人工核验；' + generatedAudit.total + ' 道生成题');

    const targetUrls = evidenceUrls.slice(0, MAX_URLS);
    const pending = targetUrls.filter((item) => {
      const previous = state.urlResults[item.url];
      return !previous || (hasFlag('retry-network-errors') && isRetryableSourceStatus(previous.status));
    });
    for (let offset = 0; offset < pending.length; offset += CHUNK_SIZE) {
      const chunk = pending.slice(offset, offset + CHUNK_SIZE);
      const results = await parallelMap(chunk, CONCURRENCY, checkSource);
      for (const result of results) state.urlResults[result.url] = result;
      state.status = 'running';
      state.updatedAt = new Date().toISOString();
      await saveJson(statePath, state);
      const counts = Object.values(state.urlResults).reduce((all, item) => {
        all[item.status] = (all[item.status] ?? 0) + 1;
        return all;
      }, {});
      await log(logPath, '来源 URL 进度 ' + Object.keys(state.urlResults).length + '/' +
        targetUrls.length + '；' + JSON.stringify(counts));
      if (stopping) break;
    }

    const results = Object.values(state.urlResults).sort((a, b) => a.url.localeCompare(b.url));
    const statusCounts = results.reduce((all, item) => {
      all[item.status] = (all[item.status] ?? 0) + 1;
      return all;
    }, {});
    const authorityCounts = results.reduce((all, item) => {
      all[item.authorityClass] = (all[item.authorityClass] ?? 0) + 1;
      return all;
    }, {});
    const completed = results.length >= targetUrls.length;
    const report = {
      version: 1,
      jobId,
      generatedAt: new Date().toISOString(),
      inputFingerprint,
      learning: {
        sourceRecords: verification.sourceUnitCount,
        leafUnits: verification.unitCount,
        excludedUnitCount: verification.excludedUnitCount,
        excludedUnits: verification.excludedUnits,
        statusDistribution: verification.statusDistribution,
        awaitingHumanVerification: verification.unitsAwaitingVerification,
        batchesOfTwenty: learningBatches.length,
        missingEvidenceRecords: verification.unitsMissingEvidence,
        unresolvedClaims: verification.unitsWithUnresolvedClaims,
        localPdfProvenanceUnverified: verification.unitsWithUnverifiedLocalPdfProvenance,
      },
      evidenceUrls: {
        unique: evidenceUrls.length,
        checked: results.length,
        statusCounts,
        authorityCounts,
        unresolved: results.filter((item) => item.status !== 'reachable'),
        limitation: 'HTTP 可达性只证明端点响应，不证明正文支持命题、来源身份或整单元正确性。',
      },
      generatedQuestions: {
        total: generatedAudit.total,
        statusDistribution: generatedAudit.statusDistribution,
        structureFlagged: generatedAudit.structureFlagged,
        structureFlagCounts: generatedAudit.structureFlagCounts,
        duplicateGroups: generatedAudit.duplicateGroups.length,
        note: generatedAudit.note,
      },
      answerRisk: {
        total: riskPacket.total,
        ruleCounts: riskPacket.ruleCounts,
        triageCategories: riskPacket.triageCategories,
        mappedToLocalApi: riskPacket.findings.filter((item) => item.recordFoundInLocalReadOnlyApi).length,
        notMappedToLocalApi: riskPacket.findings.filter((item) => !item.recordFoundInLocalReadOnlyApi).length,
      },
      scoringCalibration: {
        status: 'blocked-waiting-for-human-scored-anchor-samples',
        humanAnchorSamplesFound: 0,
        modelRuns: 0,
      },
      externalSources: {
        architectExamBankAvailable: externalBankAvailable,
        candidateSourceRepositoryAvailable: externalSourceAvailable,
        historicalMappingSnapshot: historicalMapping.generatedAt ?? null,
        currentMapping: currentMapping ? {
          generatedAt: currentMapping.generatedAt,
          counts: currentMapping.counts,
          outputJson: currentMappingJson,
          outputMarkdown: currentMappingMarkdown,
        } : null,
        limitation: '当前映射来自 WSL 中只读的原始题库与 58 份来源 Markdown；候选文本、年份或题号匹配仍不等于官方原卷确认，必须人工核对版本、题干和权利来源。',
      },
      safety: {
        localApiRequests: 'GET only',
        externalRequests: 'HEAD; GET Range fallback on every non-2xx HEAD response',
        modelCalls: 0,
        sqliteWrites: 0,
        questionMutations: 0,
        learningStatusMutations: 0,
        approvals: 0,
      },
    };
    await saveJson(join(jobDir, 'url-check-results.json'), { total: results.length, results });
    await saveJson(reportPath, report);
    state.status = completed ? 'completed' : 'paused';
    state.updatedAt = new Date().toISOString();
    state.completedAt = completed ? new Date().toISOString() : null;
    await saveJson(statePath, state);
    await log(logPath, '任务' + state.status + '；检查 ' + results.length + '/' +
      targetUrls.length + ' 个来源 URL；报告 ' + reportPath);
    process.stdout.write(JSON.stringify({
      jobId,
      status: state.status,
      jobDir,
      reportPath,
      checkedUrls: results.length,
      totalUrls: targetUrls.length,
      urlStatusCounts: statusCounts,
      learningUnitsAwaitingHumanReview: verification.unitsAwaitingVerification,
      generatedQuestions: generatedAudit.total,
      generatedQuestionsFlagged: generatedAudit.structureFlagged,
      answerRiskFindings: riskPacket.total,
      externalSourceRepositoryAvailable: externalSourceAvailable,
    }, null, 2) + '\n');
  } finally {
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write('本地复核长任务失败：' + (error.stack ?? error.message) + '\n');
    process.exitCode = 1;
  });
}
