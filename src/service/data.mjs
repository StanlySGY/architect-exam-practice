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
} from "./helpers.mjs";
import { BankDomain } from "./bank.mjs";

export class DataDomain extends BankDomain {
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
    const createdAt = this.now();
    return this.store.update((state) => {
      const questionsById = new Map(
        state.generatedQuestions.map((item) => [item.id, item]),
      );
      let questionsAdded = 0;
      let questionsUpdated = 0;
      for (const item of mapped.questions) {
        const next = { ...item, createdAt: questionsById.get(item.id)?.createdAt ?? createdAt };
        if (questionsById.has(item.id)) {
          const index = state.generatedQuestions.findIndex((row) => row.id === item.id);
          const previous = state.generatedQuestions[index];
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
      const casesById = new Map(state.caseQuestions.map((item) => [item.id, item]));
      let casesAdded = 0;
      let casesUpdated = 0;
      for (const item of mapped.cases) {
        if (casesById.has(item.id)) {
          const index = state.caseQuestions.findIndex((row) => row.id === item.id);
          const previous = state.caseQuestions[index];
          state.caseQuestions[index] = {
            ...previous,
            ...item,
            drafts: previous.drafts,
            grade: previous.grade,
            createdAt: previous.createdAt ?? createdAt,
          };
          casesUpdated += 1;
        } else {
          state.caseQuestions.push({ ...item, createdAt });
          casesAdded += 1;
        }
      }
      const papersById = new Map(state.paperQuestions.map((item) => [item.id, item]));
      let papersAdded = 0;
      let papersUpdated = 0;
      for (const item of mapped.papers) {
        if (papersById.has(item.id)) {
          const index = state.paperQuestions.findIndex((row) => row.id === item.id);
          const previous = state.paperQuestions[index];
          state.paperQuestions[index] = {
            ...previous,
            ...item,
            draft: previous.draft,
            grade: previous.grade,
            mock: previous.mock,
            createdAt: previous.createdAt ?? createdAt,
          };
          papersUpdated += 1;
        } else {
          state.paperQuestions.push({ ...item, createdAt });
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
