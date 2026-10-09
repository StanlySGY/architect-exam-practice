// data 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  catalogFromImported,
  defaultBankFile,
  readArchitectBank,
} from "../import-bank.mjs";
import { makeId } from "../utils.mjs";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  isImported,
  keepImported,
  validateBackupData,
  isRecord,
  isGeneratedQuestion,
  isPlaceholderReviewText,
  reviewStatusOf,
  structureIssuesOf,
  reviewReasonLabel,
  QUESTION_REVIEW_REASONS,
} from "./helpers.mjs";
import { BankDomain } from "./bank.mjs";

const IMPORT_ID_PREFIX = "import";

function importedId(item) {
  const sourceType = item.sourceType === "mock" ? "mock" : "real";
  const sourceId = String(item.sourceId ?? item.id ?? "").trim();
  return `${IMPORT_ID_PREFIX}:${sourceType}:${encodeURIComponent(sourceId)}`;
}

function sourceIdOf(item) {
  return String(item.sourceId ?? item.id ?? "").trim();
}

function assertNoDuplicateSourceIds(items, label) {
  const seen = new Set();
  for (const item of items) {
    const key = `${item.sourceType === "mock" ? "mock" : "real"}:${sourceIdOf(item)}`;
    if (!sourceIdOf(item) || seen.has(key)) {
      throw Object.assign(new Error(`${label}中存在重复的外部 id：${sourceIdOf(item) || "（空）"}`), {
        status: 400,
        code: "IMPORT_DUPLICATE_ID",
      });
    }
    seen.add(key);
  }
}

function migrateQuestionReferences(state, oldId, newId) {
  if (!oldId || oldId === newId) return;
  for (const session of Object.values(state.sessions ?? {})) {
    if (Array.isArray(session.questionIds)) {
      session.questionIds = session.questionIds.map((id) => (id === oldId ? newId : id));
    }
    for (const field of ["checkedAnswers", "answerRevisions", "confidences"]) {
      if (session[field] && Object.hasOwn(session[field], oldId)) {
        session[field][newId] = session[field][oldId];
        delete session[field][oldId];
      }
    }
    if (session.questionSnapshots && Object.hasOwn(session.questionSnapshots, oldId)) {
      session.questionSnapshots[newId] = {
        ...session.questionSnapshots[oldId],
        id: newId,
      };
      delete session.questionSnapshots[oldId];
    }
  }
  if (Object.hasOwn(state.wrongBook ?? {}, oldId)) {
    const record = state.wrongBook[oldId];
    delete state.wrongBook[oldId];
    state.wrongBook[newId] = {
      ...record,
      questionId: newId,
      questionSnapshot: record.questionSnapshot
        ? { ...record.questionSnapshot, id: newId }
        : record.questionSnapshot,
    };
  }
  if (Object.hasOwn(state.questionIssues ?? {}, oldId)) {
    const issue = state.questionIssues[oldId];
    delete state.questionIssues[oldId];
    state.questionIssues[newId] = { ...issue, questionId: newId };
  }
  for (const attempt of state.attempts ?? []) {
    for (const collection of [attempt.details, attempt.questions]) {
      if (!Array.isArray(collection)) continue;
      for (const detail of collection) {
        if (detail?.id === oldId) detail.id = newId;
        if (detail?.questionId === oldId) detail.questionId = newId;
      }
    }
  }
}

function migrateCaseReferences(state, oldId, newId) {
  if (!oldId || oldId === newId) return;
  for (const exam of state.caseExams ?? []) {
    if (Array.isArray(exam.caseIds)) {
      exam.caseIds = exam.caseIds.map((id) => (id === oldId ? newId : id));
    }
    if (exam.drafts && Object.hasOwn(exam.drafts, oldId)) {
      exam.drafts[newId] = exam.drafts[oldId];
      delete exam.drafts[oldId];
    }
    for (const item of exam.grade?.cases ?? []) {
      if (item?.caseId === oldId) item.caseId = newId;
    }
  }
}

function findExistingImported(items, incoming) {
  const sourceType = incoming.sourceType === "mock" ? "mock" : "real";
  const sourceId = sourceIdOf(incoming);
  const namespaced = importedId(incoming);
  return items.filter((item) => {
    if (!isImported(item)) return false;
    if ((item.sourceType === "mock" ? "mock" : "real") !== sourceType) return false;
    return item.id === namespaced || sourceIdOf(item) === sourceId;
  });
}

function normalizeImportedBatch(items, label) {
  assertNoDuplicateSourceIds(items, label);
  return items.map((item) => ({
    ...item,
    sourceId: sourceIdOf(item),
  }));
}

function availableImportId(stateItems, preferredId, excluded = null) {
  const occupied = new Set(
    stateItems
      .filter((item) => item !== excluded)
      .map((item) => item.id),
  );
  if (!occupied.has(preferredId)) return preferredId;
  let suffix = 2;
  let candidate = `${preferredId}:${suffix}`;
  while (occupied.has(candidate)) {
    suffix += 1;
    candidate = `${preferredId}:${suffix}`;
  }
  return candidate;
}

function importTargetId(stateItems, incoming, previous) {
  const sourceId = sourceIdOf(incoming);
  const namespacedId = importedId(incoming);
  if (
    previous &&
    stateItems.some((item) => item !== previous && item.id === previous.id)
  ) {
    return availableImportId(stateItems, namespacedId, previous);
  }
  if (previous) return previous.id;
  // 同一来源的既有记录由 previous 复用原 ID；其他来源或生成题占用时
  // 必须切到命名空间 ID，避免 real/foo 与 mock/foo 互相覆盖。
  const sourceIdOccupied = stateItems.some((item) => item.id === sourceId);
  return sourceIdOccupied
    ? availableImportId(stateItems, namespacedId)
    : sourceId;
}

export class DataDomain extends BankDomain {
  async init() {
    await super.init();
    await this.auditGeneratedQuestionTrust();
  }

  sourceNodeResolves(question) {
    const raw = String(question?.sourceNode ?? "").trim();
    if (!raw || !this.mindMap) return false;
    const parts = raw.split(" › ").map((item) => item.trim()).filter(Boolean);
    if (!parts.length) return false;
    let node = (this.mindMap.children ?? []).find((item) => item.text?.trim() === parts[0]);
    if (!node && this.mindMap.text?.trim() === parts[0]) node = this.mindMap;
    if (!node) return false;
    for (const part of parts.slice(1)) {
      node = (node.children ?? []).find((item) => item.text?.trim() === part);
      if (!node) return false;
    }
    return true;
  }

  async auditGeneratedQuestionTrust() {
    const now = this.now();
    return this.store.update((state) => {
      const generated = state.generatedQuestions.filter(isGeneratedQuestion);
      const reasons = {};
      let changed = 0;
      let pendingReview = 0;
      let quarantined = 0;
      for (const question of generated) {
        const issues = structureIssuesOf(question, this.sourceNodeResolves(question));
        const currentRevision = Number.isInteger(question.revision) && question.revision > 0 ? question.revision : 1;
        const fields = Array.isArray(question.reviewedFields) ? question.reviewedFields : [];
        const hasTraceableEvidence = ["official_exam", "official_standard", "textbook", "secondary_source"].includes(question.reviewEvidenceType) && !isPlaceholderReviewText(question.reviewEvidenceReference) && !isPlaceholderReviewText(question.reviewEvidence) && ["question", "options", "correctAnswer", "analysis"].every((field) => fields.includes(field));
        const hasHumanEvidence = hasTraceableEvidence && Number.isInteger(question.reviewedRevision) && question.reviewedRevision === currentRevision && Boolean(String(question.reviewedBy ?? "").trim()) && Boolean(String(question.reviewEvidence ?? "").trim()) && Boolean(String(question.reviewedAt ?? "").trim()) && Number.isFinite(Date.parse(question.reviewedAt));
        const status = issues.length ? "quarantined" : reviewStatusOf(question) === "approved" && hasHumanEvidence ? "approved" : "pending_review";
        const reviewReasons = issues.length ? issues : status === "approved" ? [] : [QUESTION_REVIEW_REASONS.NO_HUMAN_FACT_CHECK];
        if (question.reviewStatus !== status || JSON.stringify(question.reviewReasons ?? []) !== JSON.stringify(reviewReasons)) {
          question.reviewStatus = status;
          question.reviewReasons = reviewReasons;
          question.reviewAuditedAt = now;
          changed += 1;
        }
        if (status === "pending_review") pendingReview += 1;
        if (status === "quarantined") quarantined += 1;
        for (const reason of reviewReasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
      const approved = generated.filter((question) => reviewStatusOf(question) === "approved").length;
      if (changed) this.appendAudit(state, "questions.review-audit", { generated: generated.length, changed, pendingReview, approved, quarantined, reasons, note: "确定性结构审计；没有创建人工事实核验凭据，也没有自动批准生成题。" });
      return { generated: generated.length, changed, pendingReview, approved, quarantined, reasons };
    });
  }

  questionReviewStats(state = this.store.snapshot()) {
    const generated = (state.generatedQuestions ?? []).filter(isGeneratedQuestion);
    const counts = { pending_review: 0, approved: 0, quarantined: 0 };
    const reasons = {};
    for (const question of generated) {
      const status = reviewStatusOf(question);
      counts[status] += 1;
      for (const reason of question.reviewReasons ?? []) reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
    return { ...counts, total: generated.length, reasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])), reasonLabels: Object.fromEntries(Object.keys(reasons).map((reason) => [reason, reviewReasonLabel(reason)])) };
  }
  appendAudit(state, action, details = {}) {
    state.auditLog ??= [];
    state.auditLog.push({
      id: makeId("audit"),
      action,
      at: this.now(),
      ...details,
    });
    state.auditLog = state.auditLog.slice(-200);
  }

  // 操作审计：导出备份、导入备份、清空数据等管理动作，按时间倒序返回。
  auditLog() {
    const entries = this.store.snapshot().auditLog ?? [];
    return [...entries].toSorted((left, right) =>
      String(right.at).localeCompare(String(left.at)),
    );
  }

  studyMaterials() {
    return this.assets.studyMaterials();
  }

  studyMaterial(id) {
    return this.assets.studyMaterial(id);
  }

  diagnosisExport() {
    const state = this.store.snapshot();
    const questions = this.questionMap(state);
    const modules = new Map();
    for (const session of Object.values(state.sessions)) {
      if (!session.gradedAt) continue;
      for (const questionId of session.questionIds ?? []) {
        const answer = session.checkedAnswers?.[questionId];
        if (!answer) continue;
        const question = questions.get(questionId);
        if (!question) continue;
        const key =
          question.module ||
          question.knowledgePoint ||
          `第 ${question.chapter} 章`;
        const current = modules.get(key) ?? { total: 0, correct: 0, wrong: 0 };
        current.total += 1;
        if (answer === question.correctAnswer) current.correct += 1;
        else current.wrong += 1;
        modules.set(key, current);
      }
    }
    const byModule = Object.fromEntries(
      [...modules.entries()].map(([key, stat]) => [
        key,
        {
          ...stat,
          accuracy: stat.total ? stat.correct / stat.total : 0,
        },
      ]),
    );
    const recentWrong = Object.values(state.wrongBook)
      .filter((record) => !record.mastered && !record.disabledByIssue)
      .sort((left, right) =>
        String(right.lastWrongAt).localeCompare(String(left.lastWrongAt)),
      )
      .slice(0, 50)
      .map((record) => {
        const question =
          questions.get(record.questionId) ?? record.questionSnapshot ?? {};
        const attached = this.assets.attachChoice(question);
        return {
          id: record.questionId,
          module:
            question.module ||
            question.knowledgePoint ||
            `第 ${question.chapter ?? "—"} 章`,
          timesWrong: record.timesWrong ?? 0,
          lastWrongAt: record.lastWrongAt ?? null,
          stem: attached.question ?? "",
          options: question.options ?? null,
          correctAnswer: question.correctAnswer ?? null,
          analysis: question.analysis ?? null,
          figureMissing: Boolean(attached.figureMissing),
        };
      });
    return {
      schemaVersion: 1,
      generatedAt: this.now(),
      subject: "系统架构设计师",
      app: "architect-chapter-practice",
      statistics: this.statistics(),
      studyPlan: this.getStudyPlan(),
      learner: {
        byModule,
        bookmarkedQuestionIds: this.allQuestions(state)
          .filter((question) => question.starred)
          .map((question) => question.id),
        recentWrong,
      },
      aiInstructions: [
        "只针对系统架构设计师，不要扩展到其他软考科目。",
        "先按模块正确率找短板，不要只看单题。",
        "图示缺失时不要编造图中位置、连线或数值。",
        "结合学习计划和错题，给出下一周可执行的复习安排。",
      ],
    };
  }

  async setDailyGoal(goal) {
    const value = Math.max(0, Math.min(500, Number(goal) || 0));
    return this.store.update((state) => {
      state.settings ??= {};
      state.settings.dailyGoal = value;
      return { dailyGoal: value };
    });
  }

  // LLM 用量记账：每次模型调用后追加一条（保留最近 500 条），用于费用观察。
  async recordLlmUsage({ kind, model, promptTokens, completionTokens, requests }) {
    const entry = {
      kind: String(kind ?? "unknown").slice(0, 60),
      model: String(model ?? "").slice(0, 200),
      promptTokens: Math.max(0, Number(promptTokens) || 0),
      completionTokens: Math.max(0, Number(completionTokens) || 0),
      requests: Math.max(1, Number(requests) || 1),
      at: this.now(),
    };
    return this.store.update((state) => {
      state.llmUsage ??= [];
      state.llmUsage.push(entry);
      state.llmUsage = state.llmUsage.slice(-500);
      return entry;
    });
  }

  llmUsageSummary() {
    const entries = this.store.snapshot().llmUsage ?? [];
    return {
      requests: entries.reduce((sum, entry) => sum + (entry.requests || 1), 0),
      promptTokens: entries.reduce((sum, entry) => sum + (entry.promptTokens || 0), 0),
      completionTokens: entries.reduce(
        (sum, entry) => sum + (entry.completionTokens || 0),
        0,
      ),
      recent: entries.slice(-50).toReversed(),
    };
  }

  // SQLite 在线备份：VACUUM INTO 生成一致性的独立数据库文件，服务不必停机。
  // 备份目录相对 SQLite 文件所在目录解析，测试与自定义数据路径都安全。
  async backupDatabase() {
    const fs = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const backupDirectory = resolve(dirname(this.store.file), "backups");
    await fs.mkdir(backupDirectory, { recursive: true });
    const fileName = `db-backup-${Date.now()}.sqlite`;
    const targetPath = resolve(backupDirectory, fileName);
    await this.store.backupToFile(targetPath);
    const { size } = await fs.stat(targetPath);
    // 备份目录内只保留最近 5 份数据库快照。
    const existing = (await fs.readdir(backupDirectory))
      .filter((name) => name.startsWith("db-backup-") && name.endsWith(".sqlite"))
      .sort();
    for (const name of existing.slice(0, Math.max(0, existing.length - 5))) {
      await fs.rm(resolve(backupDirectory, name), { force: true }).catch(() => {});
    }
    await this.store.update((state) => {
      this.appendAudit(state, "data.backup-db", { file: fileName, bytes: size });
      return { file: fileName, bytes: size };
    });
    return { file: fileName, bytes: size };
  }

  dataSummary(state = this.store.snapshot()) {
    const sessions = Object.values(state.sessions);
    const questions = state.generatedQuestions;
    const cases = state.caseQuestions;
    const papers = state.paperQuestions;
    const byType = (items) => ({
      generated: items.filter((item) => (item.sourceType ?? "generated") === "generated").length,
      real: items.filter((item) => item.sourceType === "real").length,
      mock: items.filter((item) => item.sourceType === "mock").length,
    });
    return {
      questions: questions.length,
      generatedQuestions: byType(questions).generated,
      realQuestions: byType(questions).real,
      mockQuestions: byType(questions).mock,
      wrongQuestions: Object.keys(state.wrongBook).length,
      attempts: state.attempts.length,
      activeSessions: sessions.filter(
        (session) => !session.gradedAt && !session.abandonedAt,
      ).length,
      questionIssues: Object.values(state.questionIssues).filter(
        (issue) => !issue.resolvedAt,
      ).length,
      cases: cases.length,
      generatedCases: byType(cases).generated,
      realCases: byType(cases).real,
      mockCases: byType(cases).mock,
      papers: papers.length,
      generatedPapers: byType(papers).generated,
      realPapers: byType(papers).real,
      mockPapers: byType(papers).mock,
      wikiEntries: state.wikiEntries.length,
      caseExams: state.caseExams.length,
      llmRequests: (state.llmUsage ?? []).reduce(
        (sum, entry) => sum + (entry.requests || 1),
        0,
      ),
      llmTokens: (state.llmUsage ?? []).reduce(
        (sum, entry) => sum + (entry.promptTokens || 0) + (entry.completionTokens || 0),
        0,
      ),
    };
  }

  // 内容健康度只读聚合：展示来源和待核对状态，不推断答案事实正确性。
  contentHealth(state = this.store.snapshot()) {
    const questionItems = state.generatedQuestions ?? [];
    const contentGroups = [
      ["questions", questionItems],
      ["cases", state.caseQuestions ?? []],
      ["papers", state.paperQuestions ?? []],
    ];
    const sourceCount = (items) => ({
      total: items.length,
      active: items.filter((item) => !item.disabledAt).length,
      generated: items.filter(
        (item) => (item.sourceType ?? "generated") === "generated",
      ).length,
      real: items.filter((item) => item.sourceType === "real").length,
      mock: items.filter((item) => item.sourceType === "mock").length,
    });
    const sources = Object.fromEntries(
      contentGroups.map(([name, items]) => [name, sourceCount(items)]),
    );
    const answerTrust = new Map();
    const addTrust = (code, label, count) => {
      if (!count) return;
      const current = answerTrust.get(code) ?? { code, label, count: 0 };
      current.count += count;
      answerTrust.set(code, current);
    };
    for (const [, items] of contentGroups) {
      for (const item of items) {
        const sourceType = item.sourceType ?? "generated";
        if (sourceType === "generated") {
          addTrust("generated", "生成内容，未独立核验", 1);
        } else if (item.answerTrust === "ai-reference") {
          addTrust("ai-reference", "AI 参考答案", 1);
        } else if (sourceType === "mock") {
          addTrust("mock-unverified", "模拟题答案未独立核验", 1);
        } else {
          addTrust("third-party", "第三方整理答案", 1);
        }
      }
    }
    const isMissingText = (value) => {
      const text = String(value ?? "").trim();
      return !text || text === "暂无解析";
    };
    const generated = questionItems.filter(
      (question) => (question.sourceType ?? "generated") === "generated",
    );
    const generatedActive = generated.filter(
      (question) => !question.disabledAt,
    );
    const generatedQuality = {
      total: generated.length,
      active: generatedActive.length,
      withSourceNode: generatedActive.filter((question) =>
        Boolean(String(question.sourceNode ?? "").trim()),
      ).length,
      missingSourceNode: generatedActive.filter(
        (question) => !String(question.sourceNode ?? "").trim(),
      ).length,
      withAnalysis: generatedActive.filter(
        (question) => !isMissingText(question.analysis),
      ).length,
      missingAnalysis: generatedActive.filter((question) =>
        isMissingText(question.analysis),
      ).length,
    };
    generatedQuality.traceabilityRate = generatedQuality.active
      ? Math.round(
          (generatedQuality.withSourceNode / generatedQuality.active) * 100,
        )
      : null;
    generatedQuality.analysisRate = generatedQuality.active
      ? Math.round(
          (generatedQuality.withAnalysis / generatedQuality.active) * 100,
        )
      : null;

    const catalog = this.realExamCatalog(state);
    const incomplete = catalog.filter(
      (paper) => paper.missingQuestionNos.length > 0,
    );
    const missingQuestionCount = incomplete.reduce(
      (sum, paper) => sum + paper.missingQuestionNos.length,
      0,
    );
    const wikiEntries = state.wikiEntries ?? [];
    const wikiLint = this.wikiLint();
    const lintByType = {};
    for (const issue of wikiLint.issues) {
      for (const type of issue.issues ?? []) {
        lintByType[type] = (lintByType[type] ?? 0) + 1;
      }
    }
    const issues = Object.values(state.questionIssues ?? {}).filter(
      (issue) => !issue.resolvedAt,
    );
    return {
      generatedAt: this.now(),
      sources,
      answerTrust: [...answerTrust.values()],
      generatedQuality,
      review: this.questionReviewStats(state),
      examCoverage: {
        totalPapers: catalog.length,
        incompletePapers: incomplete.length,
        completePapers: catalog.length - incomplete.length,
        missingQuestionCount,
        incomplete: incomplete.map((paper) => ({
          term: paper.term,
          sourceType: paper.sourceType,
          questions: paper.questions,
          expectedQuestions: paper.expectedQuestions,
          missingQuestionNos: paper.missingQuestionNos,
        })),
      },
      wiki: {
        total: wikiEntries.length,
        draft: wikiEntries.filter(
          (entry) => (entry.status ?? "draft") === "draft",
        ).length,
        reviewed: wikiEntries.filter((entry) => entry.status === "reviewed")
          .length,
        flagged: wikiEntries.filter((entry) => entry.status === "flagged")
          .length,
        lintProblems: wikiLint.problems,
        lintByType,
      },
      questionIssues: {
        unresolved: issues.length,
        open: issues.filter((issue) => (issue.status ?? "open") === "open")
          .length,
        acknowledged: issues.filter((issue) => issue.status === "acknowledged")
          .length,
      },
    };
  }

  async exportData() {
    return this.store.update((state) => {
      this.appendAudit(state, "data.export");
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        schemaVersion: BACKUP_VERSION,
        exportedAt: this.now(),
        data: structuredClone(state),
      };
    });
  }

  async importData({ backup, confirm }) {
    if (confirm !== "IMPORT") {
      throw Object.assign(new Error("导入确认口令无效"), {
        status: 400,
        code: "CONFIRMATION_REQUIRED",
      });
    }
    if (
      !isRecord(backup) ||
      backup.format !== BACKUP_FORMAT ||
      backup.version !== BACKUP_VERSION ||
      (backup.schemaVersion !== undefined && backup.schemaVersion !== BACKUP_VERSION)
    ) {
      throw Object.assign(new Error("不是受支持的软考练习备份文件"), {
        status: 400,
        code: "INVALID_BACKUP",
      });
    }
    validateBackupData(backup.data);
    // 导入前留下可恢复快照；审计条目写入新状态后，旧快照仍保持原样。
    const restorePoint = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      schemaVersion: BACKUP_VERSION,
      exportedAt: this.now(),
      data: this.store.snapshot(),
    };
    const restoreDirectory = resolve(this.root, "data/backups");
    await mkdir(restoreDirectory, { recursive: true });
    await writeFile(
      resolve(restoreDirectory, `before-import-${Date.now()}-${makeId("restore")}.json`),
      JSON.stringify(restorePoint),
      { encoding: "utf8", flag: "wx" },
    );
    return this.store.update((state) => {
      state.version = Number(backup.data.version) || 1;
      state.generatedQuestions = structuredClone(
        backup.data.generatedQuestions,
      );
      state.sessions = structuredClone(backup.data.sessions);
      state.attempts = structuredClone(backup.data.attempts);
      state.wrongBook = structuredClone(backup.data.wrongBook);
      state.questionIssues = structuredClone(backup.data.questionIssues ?? {});
      state.settings = structuredClone(backup.data.settings ?? {});
      state.caseQuestions = structuredClone(backup.data.caseQuestions ?? []);
      state.paperQuestions = structuredClone(backup.data.paperQuestions ?? []);
      state.wikiEntries = structuredClone(backup.data.wikiEntries ?? []);
      state.caseExams = structuredClone(backup.data.caseExams ?? []);
      state.auditLog = structuredClone(backup.data.auditLog ?? []);
      state.llmUsage = structuredClone(backup.data.llmUsage ?? []);
      this.appendAudit(state, "data.import");
      return { ...this.dataSummary(state), restorePointAt: restorePoint.exportedAt };
    });
  }

  async clearData({ scope, confirm }) {
    if (confirm !== "CLEAR") {
      throw Object.assign(new Error("清空确认口令无效"), {
        status: 400,
        code: "CONFIRMATION_REQUIRED",
      });
    }
    const supported = new Set(["questions", "wrongBook", "attempts", "all"]);
    if (!supported.has(scope)) {
      throw Object.assign(new Error("清空范围无效"), { status: 400 });
    }
    return this.store.update((state) => {
      if (scope === "questions" || scope === "all") {
        state.generatedQuestions = keepImported(state.generatedQuestions);
        if (scope === "questions") {
          state.attempts = state.attempts.map((attempt) => ({
            ...attempt,
            sessionId: null,
          }));
        }
        state.sessions = {};
        state.wrongBook = {};
        state.questionIssues = {};
      }
      if (scope === "wrongBook" || scope === "all") state.wrongBook = {};
      if (scope === "attempts" || scope === "all") {
        state.attempts = [];
        if (scope === "attempts") {
          state.sessions = Object.fromEntries(
            Object.entries(state.sessions).filter(
              ([, session]) => !session.gradedAt && !session.abandonedAt,
            ),
          );
        }
      }
      if (scope === "all") {
        state.caseQuestions = keepImported(state.caseQuestions);
        state.paperQuestions = keepImported(state.paperQuestions);
        state.wikiEntries = [];
        state.caseExams = [];
      }
      this.appendAudit(state, "data.clear", { scope });
      return this.dataSummary(state);
    });
  }

  realExamCatalog(state = this.store.snapshot()) {
    return catalogFromImported({
      questions: state.generatedQuestions.filter(isImported),
      cases: state.caseQuestions.filter(isImported),
      papers: state.paperQuestions.filter(isImported),
    });
  }

  async importArchitectBank({ file } = {}) {
    const bankFile = file ? resolve(this.root, file) : defaultBankFile(this.root);
    const mapped = await readArchitectBank(bankFile);
    const importedQuestions = normalizeImportedBatch(mapped.questions, "选择题");
    const importedCases = normalizeImportedBatch(mapped.cases, "案例题");
    const importedPapers = normalizeImportedBatch(mapped.papers, "论文题");
    const createdAt = this.now();
    return this.store.update((state) => {
      let questionsAdded = 0;
      let questionsUpdated = 0;
      for (const item of importedQuestions) {
        const matches = findExistingImported(state.generatedQuestions, item);
        const previous = matches[0];
        const targetId = importTargetId(state.generatedQuestions, item, previous);
        const next = {
          ...item,
          id: targetId,
          createdAt: previous?.createdAt ?? createdAt,
        };
        if (previous) {
          const index = state.generatedQuestions.findIndex((row) => row === previous);
          migrateQuestionReferences(state, previous.id, targetId);
          state.generatedQuestions[index] = {
            ...previous,
            ...next,
            starred: previous.starred,
            disabledAt: previous.disabledAt,
            createdAt: previous.createdAt ?? createdAt,
          };
          questionsUpdated += 1;
        } else {
          state.generatedQuestions.push(next);
          questionsAdded += 1;
        }
      }
      let casesAdded = 0;
      let casesUpdated = 0;
      for (const item of importedCases) {
        const previous = findExistingImported(state.caseQuestions, item)[0];
        const targetId = importTargetId(state.caseQuestions, item, previous);
        if (previous) {
          const index = state.caseQuestions.findIndex((row) => row === previous);
          migrateCaseReferences(state, previous.id, targetId);
          state.caseQuestions[index] = {
            ...previous,
            ...item,
            id: targetId,
            drafts: previous.drafts,
            grade: previous.grade,
            createdAt: previous.createdAt ?? createdAt,
          };
          casesUpdated += 1;
        } else {
          state.caseQuestions.push({
            ...item,
            id: targetId,
            createdAt,
          });
          casesAdded += 1;
        }
      }
      let papersAdded = 0;
      let papersUpdated = 0;
      for (const item of importedPapers) {
        const previous = findExistingImported(state.paperQuestions, item)[0];
        const targetId = importTargetId(state.paperQuestions, item, previous);
        if (previous) {
          const index = state.paperQuestions.findIndex((row) => row === previous);
          state.paperQuestions[index] = {
            ...previous,
            ...item,
            id: targetId,
            draft: previous.draft,
            grade: previous.grade,
            mock: previous.mock,
            createdAt: previous.createdAt ?? createdAt,
          };
          papersUpdated += 1;
        } else {
          state.paperQuestions.push({
            ...item,
            id: targetId,
            createdAt,
          });
          papersAdded += 1;
        }
      }
      return {
        file: bankFile,
        questions: {
          total: mapped.questions.length,
          added: questionsAdded,
          updated: questionsUpdated,
        },
        cases: {
          total: mapped.cases.length,
          added: casesAdded,
          updated: casesUpdated,
        },
        papers: {
          total: mapped.papers.length,
          added: papersAdded,
          updated: papersUpdated,
        },
        catalog: this.realExamCatalog(state),
        summary: this.dataSummary(state),
      };
    });
  }
}
