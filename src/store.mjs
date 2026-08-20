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
    this.writeQueue = Promise.resolve();
    this.db = null;
  }

  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.prepare(
        "INSERT INTO app_state (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const key of STATE_KEYS) {
        statement.run(key, JSON.stringify(state[key]));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}

// Backward-compatible name for tests and integrations using the old store API.
export class JsonStore extends SQLiteStore {}
