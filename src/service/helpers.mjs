// 服务层共享的模块级常量与纯函数（拆分自原 questions.mjs）。
import { nodePath } from "../mindmap.mjs";

const IMPORTED_SOURCE_TYPES = new Set(["real", "mock"]);

function isImported(item) {
  return IMPORTED_SOURCE_TYPES.has(item?.sourceType);
}

function keepImported(items = []) {
  return items.filter(isImported);
}

const DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
// 模拟考超过时限后仍允许补交答案的宽限秒数（容忍网络抖动，防止死线抢答）。
const EXAM_GRACE_SECONDS = 120;
const BACKUP_FORMAT = "architect-practice-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_ITEMS = 100_000;
const MAX_BACKUP_STRING_LENGTH = 200_000;
const MAX_BACKUP_BYTES = 50_000_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw Object.assign(new Error("生成已停止"), {
      status: 499,
      code: "LLM_GENERATION_CANCELLED",
    });
  }
}

function invalidBackup(message) {
  throw Object.assign(new Error(`备份${message}`), {
    status: 400,
    code: "INVALID_BACKUP",
  });
}

function assertCollection(value, label, { array = true } = {}) {
  if ((array && !Array.isArray(value)) || (!array && !isRecord(value))) {
    invalidBackup(`${label}结构无效`);
  }
  const size = array ? value.length : Object.keys(value).length;
  if (size > MAX_BACKUP_ITEMS) invalidBackup(`${label}数量超过限制`);
  return value;
}

function assertText(value, label, { required = false, max = MAX_BACKUP_STRING_LENGTH } = {}) {
  if (value === undefined || value === null) {
    if (required) invalidBackup(`${label}不能为空`);
    return;
  }
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    invalidBackup(`${label}格式或长度无效`);
  }
}

const QUESTION_REVIEW_STATES = new Set(["pending_review", "approved", "quarantined"]);
const QUESTION_REVIEW_REASONS = Object.freeze({
  NO_HUMAN_FACT_CHECK: "no_human_fact_check",
  SOURCE_NODE_MISSING: "source_node_missing",
  SOURCE_NODE_UNRESOLVED: "source_node_unresolved",
  QUESTION_MISSING: "question_missing",
  OPTIONS_INCOMPLETE: "options_incomplete",
  OPTIONS_DUPLICATE: "options_duplicate",
  CORRECT_ANSWER_INVALID: "correct_answer_invalid",
  ANALYSIS_MISSING: "analysis_missing",
  KNOWLEDGE_DETAIL_MISSING: "knowledge_detail_missing",
});
function isGeneratedQuestion(question) { return (question?.sourceType ?? "generated") === "generated"; }
function reviewStatusOf(question) { if (!isGeneratedQuestion(question)) return null; return QUESTION_REVIEW_STATES.has(question.reviewStatus) ? question.reviewStatus : "pending_review"; }
function isQuestionEligibleForFormalStudy(question) { if (!question || question.disabledAt) return false; if (!isGeneratedQuestion(question)) return true; return reviewStatusOf(question) === "approved" && Boolean(String(question.reviewedBy ?? "").trim()) && Boolean(String(question.reviewEvidence ?? "").trim()); }
function structureIssuesOf(question, sourceNodeResolved = null) {
  const issues = [];
  if (!String(question?.sourceNode ?? "").trim()) issues.push(QUESTION_REVIEW_REASONS.SOURCE_NODE_MISSING);
  else if (sourceNodeResolved === false) issues.push(QUESTION_REVIEW_REASONS.SOURCE_NODE_UNRESOLVED);
  if (!String(question?.question ?? "").trim()) issues.push(QUESTION_REVIEW_REASONS.QUESTION_MISSING);
  const keys = ["A", "B", "C", "D"];
  const values = keys.map((key) => String(question?.options?.[key] ?? "").trim());
  if (values.some((value) => !value)) issues.push(QUESTION_REVIEW_REASONS.OPTIONS_INCOMPLETE);
  else if (new Set(values).size !== values.length) issues.push(QUESTION_REVIEW_REASONS.OPTIONS_DUPLICATE);
  if (!keys.includes(question?.correctAnswer)) issues.push(QUESTION_REVIEW_REASONS.CORRECT_ANSWER_INVALID);
  if (!String(question?.analysis ?? "").trim() || question.analysis === "暂无解析") issues.push(QUESTION_REVIEW_REASONS.ANALYSIS_MISSING);
  if (!String(question?.knowledgeDetail ?? "").trim()) issues.push(QUESTION_REVIEW_REASONS.KNOWLEDGE_DETAIL_MISSING);
  return issues;
}
function reviewReasonLabel(reason) {
  return { no_human_fact_check: "没有人工事实核验凭据", source_node_missing: "缺少来源导图节点", source_node_unresolved: "来源导图节点无法解析", question_missing: "题干为空", options_incomplete: "选项不完整", options_duplicate: "选项不唯一", correct_answer_invalid: "正确答案非法", analysis_missing: "解析为空或仅为占位文本", knowledge_detail_missing: "缺少知识点详解" }[reason] ?? reason;
}

function assertId(value, label) {
  assertText(value, label, { required: true, max: 256 });
}

function assertTime(value, label) {
  if (value === undefined || value === null || value === "") return;
  assertText(value, label, { max: 80 });
  if (!Number.isFinite(Date.parse(value))) invalidBackup(`${label}不是有效时间`);
}

function assertUniqueIds(items, label) {
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) invalidBackup(`${label}第 ${index + 1} 项不是对象`);
    assertId(item.id, `${label}第 ${index + 1} 项 id`);
    if (ids.has(item.id)) invalidBackup(`${label}存在重复 id`);
    ids.add(item.id);
  }
  return ids;
}

function assertAnswerMap(value, label, questionIds) {
  if (value === undefined || value === null) return;
  assertCollection(value, label, { array: false });
  for (const [questionId, answer] of Object.entries(value)) {
    assertId(questionId, `${label}题目 id`);
    if (!questionIds.has(questionId)) invalidBackup(`${label}引用了不存在的题目`);
    if (!["A", "B", "C", "D"].includes(answer)) {
      invalidBackup(`${label}包含无效选项`);
    }
  }
}

function assertRevisionMap(value, label, questionIds) {
  if (value === undefined || value === null) return;
  assertCollection(value, label, { array: false });
  for (const [questionId, revision] of Object.entries(value)) {
    assertId(questionId, `${label}题目 id`);
    if (!questionIds.has(questionId)) invalidBackup(`${label}引用了不存在的题目`);
    if (!Number.isInteger(revision) || revision < 1) invalidBackup(`${label}版本无效`);
  }
}

function assertQuestionSnapshot(snapshot, questionId, label) {
  if (!isRecord(snapshot) || snapshot.id !== questionId) {
    invalidBackup(`${label}引用无效`);
  }
  assertText(snapshot.question, `${label}题干`, { required: true });
  if (!validateOptions(snapshot.options)) invalidBackup(`${label}选项无效`);
  for (const option of Object.values(snapshot.options)) {
    assertText(option, `${label}选项`, { required: true, max: 20_000 });
  }
  if (!["A", "B", "C", "D"].includes(snapshot.correctAnswer)) {
    invalidBackup(`${label}正确答案无效`);
  }
  if (
    snapshot.sourceType !== undefined &&
    !["generated", "real", "mock"].includes(snapshot.sourceType)
  ) {
    invalidBackup(`${label}题目来源无效`);
  }
  assertTime(snapshot.createdAt, `${label}创建时间`);
}

function validateBackupData(data) {
  if (!isRecord(data)) invalidBackup("数据结构无效");
  try {
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_BACKUP_BYTES) invalidBackup("文件过大");
  } catch {
    invalidBackup("无法序列化校验");
  }
  if (data.version !== undefined && (!Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION)) {
    invalidBackup("版本不受支持");
  }

  const questions = assertCollection(data.generatedQuestions, "题库");
  const questionIds = assertUniqueIds(questions, "题库");
  for (const [index, question] of questions.entries()) {
    assertText(question.question, `题库第 ${index + 1} 题题干`, { required: true });
    if (!validateOptions(question.options)) invalidBackup("中包含格式无效的选项");
    for (const option of Object.values(question.options)) {
      assertText(option, "题库选项", { required: true, max: 20_000 });
    }
    if (!["A", "B", "C", "D"].includes(question.correctAnswer)) {
      invalidBackup("中包含无效正确答案");
    }
    if (question.sourceType !== undefined && !["generated", "real", "mock"].includes(question.sourceType)) {
      invalidBackup("中包含无效题目来源");
    }
    if (question.reviewStatus !== undefined && !["pending_review", "approved", "quarantined"].includes(question.reviewStatus)) invalidBackup("中包含无效审校状态");
    if (question.reviewReasons !== undefined && !Array.isArray(question.reviewReasons)) invalidBackup("中包含无效审校原因");
    if (question.reviewedBy !== undefined) assertText(question.reviewedBy, "题目审校人", { max: 256 });
    if (question.reviewEvidence !== undefined) assertText(question.reviewEvidence, "题目审校凭据", { max: 4_000 });
    assertTime(question.reviewedAt, "题目审校时间");
    assertTime(question.reviewAuditedAt, "题目审计时间");
    assertTime(question.createdAt, "题目创建时间");
  }

  const sessions = assertCollection(data.sessions, "练习会话", { array: false });
  const sessionIds = new Set();
  for (const [key, session] of Object.entries(sessions)) {
    if (!isRecord(session)) invalidBackup("会话记录格式无效");
    assertId(key, "会话键");
    assertId(session.id, "会话 id");
    if (key !== session.id) invalidBackup("会话键与 id 不一致");
    if (!Array.isArray(session.questionIds) || session.questionIds.length > MAX_BACKUP_ITEMS) {
      invalidBackup("会话题目列表无效");
    }
    const snapshots =
      session.questionSnapshots === undefined
        ? {}
        : assertCollection(session.questionSnapshots, `会话 ${key} 题目快照`, {
            array: false,
          });
    const snapshotIds = new Set();
    for (const [snapshotId, snapshot] of Object.entries(snapshots)) {
      assertId(snapshotId, `会话 ${key} 题目快照 id`);
      assertQuestionSnapshot(
        snapshot,
        snapshotId,
        `会话 ${key} 题目快照 ${snapshotId}`,
      );
      snapshotIds.add(snapshotId);
    }
    const completed = Boolean(
      session.gradedAt ||
        session.abandonedAt ||
        ["abandoned", "submitted", "expired", "graded"].includes(session.status),
    );
    const seenQuestionIds = new Set();
    const sessionQuestionIds = new Set(questionIds);
    for (const questionId of session.questionIds) {
      assertId(questionId, "会话题目引用");
      const liveQuestion = questionIds.has(questionId);
      const snapshotQuestion = completed && snapshotIds.has(questionId);
      if ((!liveQuestion && !snapshotQuestion) || seenQuestionIds.has(questionId)) {
        invalidBackup("会话包含无效或重复题目引用");
      }
      seenQuestionIds.add(questionId);
      if (snapshotQuestion) sessionQuestionIds.add(questionId);
    }
    assertAnswerMap(session.checkedAnswers, "会话答案", sessionQuestionIds);
    assertRevisionMap(session.answerRevisions, "会话答案版本", sessionQuestionIds);
    for (const field of ["createdAt", "startedAt", "deadlineAt", "submittedAt", "gradedAt", "abandonedAt"]) {
      assertTime(session[field], `会话 ${field}`);
    }
    if (session.status !== undefined && !["active", "abandoned", "submitted", "expired", "graded"].includes(session.status)) {
      invalidBackup("会话状态无效");
    }
  }

  const attempts = assertCollection(data.attempts, "练习记录");
  const attemptIds = assertUniqueIds(attempts, "练习记录");
  void attemptIds;
  const sessionIdSet = new Set(Object.keys(sessions));
  for (const attempt of attempts) {
    if (attempt.sessionId !== undefined && attempt.sessionId !== null) {
      assertId(attempt.sessionId, "练习记录 sessionId");
      if (!sessionIdSet.has(attempt.sessionId)) invalidBackup("练习记录引用了不存在的会话");
    }
    assertTime(attempt.gradedAt, "练习记录 gradedAt");
    assertTime(attempt.submittedAt, "练习记录 submittedAt");
    assertTime(attempt.deadlineAt, "练习记录 deadlineAt");
    if (attempt.submissionStatus !== undefined && !["submitted", "expired"].includes(attempt.submissionStatus)) {
      invalidBackup("练习记录提交状态无效");
    }
  }

  const wrongBook = assertCollection(data.wrongBook, "错题本", { array: false });
  for (const [questionId, record] of Object.entries(wrongBook)) {
    assertId(questionId, "错题本键");
    if (!isRecord(record) || record.questionId !== questionId) invalidBackup("错题本引用无效");
    if (!questionIds.has(questionId) && record.questionSnapshot?.id !== questionId) {
      invalidBackup("错题本引用了不存在的题目");
    }
    assertTime(record.firstWrongAt, "错题首次时间");
    assertTime(record.lastWrongAt, "错题最近时间");
    assertTime(record.nextReviewAt, "错题下次复习时间");
  }

  for (const [label, value] of [["问题题目", data.questionIssues ?? {}]]) {
    const issues = assertCollection(value, label, { array: false });
    for (const [questionId, issue] of Object.entries(issues)) {
      assertId(questionId, `${label}键`);
      if (!isRecord(issue) || issue.questionId !== questionId || !questionIds.has(questionId)) {
        invalidBackup(`${label}引用无效`);
      }
      assertText(issue.note, `${label}说明`, { max: 2_000 });
      assertTime(issue.createdAt, `${label}创建时间`);
      assertTime(issue.resolvedAt, `${label}解决时间`);
      if (
        issue.status !== undefined &&
        !["open", "acknowledged", "resolved"].includes(issue.status)
      ) {
        invalidBackup(`${label}状态无效`);
      }
    }
  }

  const cases = assertCollection(data.caseQuestions ?? [], "案例题");
  const caseIds = assertUniqueIds(cases, "案例题");
  for (const item of cases) {
    assertText(item.title, "案例标题", { required: true });
    assertText(item.scenario, "案例场景", { required: true });
    const subQuestions = assertCollection(item.questions ?? [], "案例小问");
    const subIds = assertUniqueIds(subQuestions, "案例小问");
    void subIds;
    for (const question of subQuestions) assertText(question.text, "案例小问题干", { required: true });
    assertTime(item.createdAt, "案例创建时间");
  }

  const papers = assertCollection(data.paperQuestions ?? [], "论文题");
  assertUniqueIds(papers, "论文题");
  for (const paper of papers) {
    assertText(paper.title, "论文标题", { required: true });
    assertText(paper.description, "论文说明", { required: true });
    assertText(paper.draft, "论文草稿", { max: 1_000_000 });
    assertTime(paper.createdAt, "论文创建时间");
    if (paper.mock) {
      if (!isRecord(paper.mock)) invalidBackup("论文计时记录无效");
      assertTime(paper.mock.startedAt, "论文模拟开始时间");
      assertTime(paper.mock.deadlineAt, "论文模拟截止时间");
      assertTime(paper.mock.submittedAt, "论文模拟提交时间");
    }
  }

  const wikiEntries = assertCollection(data.wikiEntries ?? [], "Wiki 条目");
  assertUniqueIds(wikiEntries, "Wiki 条目");
  for (const entry of wikiEntries) {
    assertText(entry.title, "Wiki 标题", { required: true });
    assertText(entry.summary, "Wiki 摘要", { required: true });
    for (const field of ["keyPoints", "commonMistakes", "related"]) {
      if (entry[field] !== undefined) {
        const values = assertCollection(entry[field], `Wiki ${field}`);
        values.forEach((value) => assertText(value, `Wiki ${field} 内容`, { required: true, max: 20_000 }));
      }
    }
    assertTime(entry.createdAt, "Wiki 创建时间");
    assertTime(entry.updatedAt, "Wiki 更新时间");
  }

  const caseExams = assertCollection(data.caseExams ?? [], "案例模拟卷");
  assertUniqueIds(caseExams, "案例模拟卷");
  for (const exam of caseExams) {
    if (!Array.isArray(exam.caseIds) || exam.caseIds.some((id) => !caseIds.has(id))) {
      invalidBackup("案例模拟卷引用无效");
    }
    for (const field of ["createdAt", "startedAt", "gradedAt", "abandonedAt"]) {
      assertTime(exam[field], `案例模拟卷 ${field}`);
    }
  }

  assertCollection(data.settings ?? {}, "设置", { array: false });
  if (data.auditLog !== undefined) {
    const auditLog = assertCollection(data.auditLog, "审计日志");
    assertUniqueIds(auditLog, "审计日志");
    for (const entry of auditLog) {
      assertText(entry.action, "审计操作", { required: true, max: 100 });
      assertTime(entry.at, "审计时间");
    }
  }
  if (data.llmUsage !== undefined) {
    const usage = assertCollection(data.llmUsage, "模型用量记录");
    for (const entry of usage) {
      assertText(entry.kind, "模型用量任务类型", { required: true, max: 60 });
      assertText(entry.model, "模型用量模型名", { max: 200 });
      assertTime(entry.at, "模型用量时间");
    }
  }
}

function publicQuestion(question) {
  const {
    correctAnswer,
    analysis,
    knowledgeDetail,
    commonMistake,
    memoryTip,
    ...safe
  } = question;
  return safe;
}

function presentQuestion(question, assets) {
  const safe = publicQuestion(assets.attachChoice(question));
  delete safe.aiAnalysis;
  return safe;
}

function answerFeedback(question, answer, assets) {
  const attached = assets.attachChoice(question);
  return {
    id: question.id,
    userAnswer: answer,
    correctAnswer: question.correctAnswer,
    isCorrect: answer === question.correctAnswer,
    analysis: question.analysis,
    knowledgeDetail: question.knowledgeDetail,
    knowledgePoint: question.knowledgePoint,
    commonMistake: question.commonMistake,
    memoryTip: question.memoryTip,
    optionRationale: question.optionRationale ?? null,
    figure: attached.figure ?? null,
    figureMissing: Boolean(attached.figureMissing),
    aiAnalysis: attached.aiAnalysis ?? null,
  };
}

function validateOptions(options) {
  return (
    options &&
    Object.keys(options).length === 4 &&
    ["A", "B", "C", "D"].every(
      (key) => typeof options[key] === "string" && options[key].trim(),
    )
  );
}

function normalizeComparableText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigramSimilarity(left, right) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftPairs = new Set();
  const rightPairs = new Set();
  for (let index = 0; index < left.length - 1; index += 1) {
    leftPairs.add(left.slice(index, index + 2));
  }
  for (let index = 0; index < right.length - 1; index += 1) {
    rightPairs.add(right.slice(index, index + 2));
  }
  let overlap = 0;
  for (const pair of leftPairs) {
    if (rightPairs.has(pair)) overlap += 1;
  }
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function optionText(question) {
  return ["A", "B", "C", "D"]
    .map((key) => normalizeComparableText(question.options?.[key]))
    .sort()
    .join("|");
}

function questionsAreDuplicate(left, right) {
  const leftText = normalizeComparableText(left.question);
  const rightText = normalizeComparableText(right.question);
  if (!leftText || !rightText) return false;
  if (leftText === rightText) return true;
  if (Math.min(leftText.length, rightText.length) < 10) return false;
  const questionScore = bigramSimilarity(leftText, rightText);
  if (questionScore >= 0.9) return true;
  return (
    questionScore >= 0.72 &&
    bigramSimilarity(optionText(left), optionText(right)) >= 0.82
  );
}

function uniqueAgainst(questions, existing) {
  const accepted = [];
  for (const question of questions) {
    const seen = [...existing, ...accepted].some((candidate) =>
      questionsAreDuplicate(question, candidate),
    );
    if (!seen) accepted.push(question);
  }
  return accepted;
}

// 将模型返回的 source_node 解析为导图节点路径。sourceNode 是当前章节/小节节点，
// 用于在导图内定位；找不到时退回模型提供的原文，保证来源信息始终可展示。
function resolveSourceNode(sourceNode, rawSourceNode) {
  const raw = String(rawSourceNode ?? "").trim();
  if (sourceNode && raw) {
    const path = nodePath(sourceNode, raw);
    if (path) return path.join(" › ");
  }
  return raw || null;
}

export {
  IMPORTED_SOURCE_TYPES,
  isGeneratedQuestion,
  reviewStatusOf,
  isQuestionEligibleForFormalStudy,
  structureIssuesOf,
  reviewReasonLabel,
  QUESTION_REVIEW_REASONS,
  QUESTION_REVIEW_STATES,
  isImported,
  keepImported,
  DIFFICULTIES,
  REVIEW_INTERVALS,
  EXAM_GRACE_SECONDS,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  isRecord,
  throwIfAborted,
  validateBackupData,
  publicQuestion,
  presentQuestion,
  answerFeedback,
  validateOptions,
  normalizeComparableText,
  bigramSimilarity,
  optionText,
  questionsAreDuplicate,
  uniqueAgainst,
  resolveSourceNode,
};
