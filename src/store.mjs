import { copyFile, mkdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, extname, parse } from "node:path";
import { clone } from "./utils.mjs";

const EMPTY_STATE = {
  version: 1,
  generatedQuestions: [],
  sessions: {},
  attempts: [],
  wrongBook: {},
  questionIssues: {},
  settings: {},
  learningProgress: {},
  caseQuestions: [],
  paperQuestions: [],
  wikiEntries: [],
  caseExams: [],
  auditLog: [],
  llmUsage: [],
};

const STATE_KEYS = Object.keys(EMPTY_STATE);

function normalizeState(value) {
  const saved = value && typeof value === "object" ? value : {};
  return {
    version: Number(saved.version) || 1,
    generatedQuestions: Array.isArray(saved.generatedQuestions)
      ? saved.generatedQuestions
      : [],
    sessions:
      saved.sessions && typeof saved.sessions === "object"
        ? saved.sessions
        : {},
    attempts: Array.isArray(saved.attempts) ? saved.attempts : [],
    wrongBook:
      saved.wrongBook && typeof saved.wrongBook === "object"
        ? saved.wrongBook
        : {},
    questionIssues:
      saved.questionIssues && typeof saved.questionIssues === "object"
        ? saved.questionIssues
        : {},
    settings:
      saved.settings && typeof saved.settings === "object"
        ? saved.settings
        : {},
    learningProgress:
      saved.learningProgress && typeof saved.learningProgress === "object"
        ? saved.learningProgress
        : {},
    caseQuestions: Array.isArray(saved.caseQuestions)
      ? saved.caseQuestions
      : [],
    paperQuestions: Array.isArray(saved.paperQuestions)
      ? saved.paperQuestions
      : [],
    wikiEntries: Array.isArray(saved.wikiEntries)
      ? saved.wikiEntries
      : [],
    caseExams: Array.isArray(saved.caseExams) ? saved.caseExams : [],
    auditLog: Array.isArray(saved.auditLog) ? saved.auditLog : [],
    llmUsage: Array.isArray(saved.llmUsage) ? saved.llmUsage : [],
  };
}

function sqlitePath(file) {
  return extname(file).toLowerCase() === ".json"
    ? `${parse(file).dir}/${parse(file).name}.sqlite`
    : file;
}

export class SQLiteStore {
  constructor(file) {
    this.sourceFile = file;
    this.file = sqlitePath(file);
    const fileInfo = parse(this.file);
    this.legacyFile = null;
    if (this.sourceFile !== this.file) {
      this.legacyFile = this.sourceFile;
    } else if (fileInfo.ext === ".sqlite") {
      this.legacyFile = `${fileInfo.dir}/${fileInfo.name}.json`;
    }
    this.state = clone(EMPTY_STATE);
    // 每个 key 上次持久化时的 JSON 文本，用于跳过未变化字段的磁盘写入。
    this.persistedJson = new Map();
    this.writeQueue = Promise.resolve();
    this.db = null;
  }

  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    const rows = this.db.prepare("SELECT key, value FROM app_state").all();
    if (rows.length === 0) {
      const legacy = await this.readLegacyState();
      this.state = normalizeState(legacy ?? EMPTY_STATE);
      this.persistState();
      return;
    }
    const saved = {};
    for (const row of rows) {
      try {
        saved[row.key] = JSON.parse(row.value);
      } catch (error) {
        throw new Error(
          `SQLite 状态字段 ${row.key} 无法解析: ${error.message}`,
          {
            cause: error,
          },
        );
      }
    }
    this.state = normalizeState(saved);
    for (const key of STATE_KEYS) {
      this.persistedJson.set(key, JSON.stringify(this.state[key]));
    }
  }

  async readLegacyState() {
    if (!this.legacyFile) return null;
    try {
      const contents = await readFile(this.legacyFile, "utf8");
      const legacy = JSON.parse(contents);
      // Keep the JSON file as a user-readable backup after migration.
      await copyFile(this.legacyFile, `${this.legacyFile}.migrated-backup`);
      return legacy;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(`无法迁移旧 JSON 数据: ${error.message}`, {
        cause: error,
      });
    }
  }

  snapshot() {
    return clone(this.state);
  }

  async update(mutator) {
    const operation = this.writeQueue.then(async () => {
      const draft = clone(this.state);
      const result = await mutator(draft);
      const nextState = normalizeState(draft);
      this.persistState(nextState);
      this.state = nextState;
      return clone(result);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  persistState(state = this.state) {
    if (!this.db) throw new Error("SQLite 存储尚未初始化");
    // 全量序列化后只把发生变化的 key 写入 SQLite；
    // 状态整体可达数 MB，逐操作全量重写会造成明显的写放大。
    const serialized = new Map();
    let changed = false;
    for (const key of STATE_KEYS) {
      const json = JSON.stringify(state[key]);
      serialized.set(key, json);
      if (this.persistedJson.get(key) !== json) changed = true;
    }
    if (!changed) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.prepare(
        "INSERT INTO app_state (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const key of STATE_KEYS) {
        if (this.persistedJson.get(key) === serialized.get(key)) continue;
        statement.run(key, serialized.get(key));
      }
      this.db.exec("COMMIT");
      this.persistedJson = serialized;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  // 在线备份：VACUUM INTO 写出一致性快照，主库在备份期间仍可读写。
  async backupToFile(targetPath) {
    if (!this.db) throw new Error("SQLite 存储尚未初始化");
    this.db
      .prepare("VACUUM INTO ?")
      .run(targetPath);
  }
}

// Backward-compatible name for tests and integrations using the old store API.
export class JsonStore extends SQLiteStore {}
