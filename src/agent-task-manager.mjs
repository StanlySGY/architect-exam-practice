import { createHash, randomUUID } from "node:crypto";

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function taskError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function json(value, fallback = null) {
  try { return JSON.stringify(value); } catch { return JSON.stringify(fallback); }
}

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function normalizeAgentTaskPayload(input = {}) {
  const mode = input.mode || "run";
  if (!["run", "review"].includes(mode)) {
    throw taskError("未知的 Agent 任务模式", 400, "AGENT_TASK_MODE_INVALID");
  }
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw taskError("请先输入任务内容", 400, "AGENT_PROMPT_REQUIRED");
  if (prompt.length > 16_000) throw taskError("任务内容不能超过 16000 个字符", 413, "AGENT_PROMPT_TOO_LARGE");

  if (mode === "review") {
    const results = (Array.isArray(input.results) ? input.results : [])
      .filter((item) => item && !item.error && String(item.answer || "").trim())
      .slice(0, 4)
      .map((item) => ({
        agentId: String(item.agentId || "").slice(0, 100),
        agentName: String(item.agentName || "Agent").slice(0, 120),
        answer: String(item.answer).slice(0, 30_000),
        concerns: Array.isArray(item.concerns) ? item.concerns.slice(0, 12).map((value) => String(value).slice(0, 1000)) : [],
      }));
    if (results.length < 2) throw taskError("至少需要两个成功的 Agent 回答才能重新评审", 400, "AGENT_REVIEW_REQUIRES_TWO");
    return {
      mode,
      prompt,
      judgeAgentId: String(input.judgeAgentId || "").slice(0, 100),
      results,
    };
  }

  const strategy = input.strategy || "single";
  if (!["single", "parallel", "battle"].includes(strategy)) {
    throw taskError("未知的 Agent 协作策略", 400, "AGENT_STRATEGY_INVALID");
  }
  const agentIds = [...new Set((Array.isArray(input.agentIds) ? input.agentIds : []).map((value) => String(value).slice(0, 100)).filter(Boolean))].slice(0, 4);
  if (strategy === "single" && agentIds.length > 1) {
    throw taskError("单 Agent 策略只能选择一个角色", 400, "AGENT_SELECTION_INVALID");
  }
  if (strategy !== "single" && agentIds.length < 2) {
    throw taskError("并行或对战至少需要选择两个已启用的 Agent", 400, "AGENT_COLLABORATION_REQUIRES_TWO");
  }
  return {
    mode,
    prompt,
    strategy,
    agentIds,
    judgeAgentId: String(input.judgeAgentId || "").slice(0, 100),
  };
}

function publicTask(row, { includePayload = false, includeSummary = false } = {}) {
  if (!row) return null;
  const task = {
    id: row.id,
    status: row.status,
    attemptCount: Number(row.attempts) || 0,
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    startedAt: row.started_at == null ? null : new Date(Number(row.started_at)).toISOString(),
    finishedAt: row.finished_at == null ? null : new Date(Number(row.finished_at)).toISOString(),
    heartbeatAt: row.heartbeat_at == null ? null : new Date(Number(row.heartbeat_at)).toISOString(),
    leaseExpiresAt: row.lease_expires_at == null ? null : new Date(Number(row.lease_expires_at)).toISOString(),
    cancelRequested: row.cancel_requested_at != null,
    eventSeq: Number(row.event_seq) || 0,
    result: parseJson(row.result_json),
    error: parseJson(row.error_json),
  };
  if (includeSummary) {
    const payload = parseJson(row.payload_json, {});
    task.promptPreview = String(payload?.prompt || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  if (includePayload) task.request = parseJson(row.payload_json, {});
  return task;
}

export class AgentTaskStore {
  constructor(db, {
    now = () => Date.now(),
    leaseMs = 30_000,
    maxAttempts = 2,
    maxActiveTasks = 3,
    retentionMs = DEFAULT_RETENTION_MS,
  } = {}) {
    if (!db) throw new TypeError("AgentTaskStore requires an initialized SQLite database");
    this.db = db;
    this.now = now;
    this.leaseMs = leaseMs;
    this.maxAttempts = maxAttempts;
    this.maxActiveTasks = maxActiveTasks;
    this.retentionMs = retentionMs;
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY NOT NULL,
        owner_key TEXT NOT NULL,
        idempotency_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        heartbeat_at INTEGER,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        cancel_requested_at INTEGER,
        event_seq INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        error_json TEXT,
        UNIQUE(owner_key, idempotency_hash)
      );
      CREATE INDEX IF NOT EXISTS agent_tasks_owner_created
        ON agent_tasks(owner_key, created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_tasks_claim
        ON agent_tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS agent_tasks_lease
        ON agent_tasks(status, lease_expires_at);
      CREATE TABLE IF NOT EXISTS agent_task_events (
        task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(task_id, seq)
      );
    `);
  }

  transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  insertEvent(taskId, type, payload, now = this.now()) {
    const row = this.db.prepare("SELECT event_seq FROM agent_tasks WHERE id = ?").get(taskId);
    if (!row) return null;
    const seq = Number(row.event_seq) + 1;
    this.db.prepare("UPDATE agent_tasks SET event_seq = ?, updated_at = ? WHERE id = ?").run(seq, now, taskId);
    this.db.prepare(
      "INSERT INTO agent_task_events(task_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(taskId, seq, type, json(payload), now);
    return seq;
  }

  createTask({ ownerKey = "local", idempotencyKey, payload }) {
    if (!ownerKey || ownerKey.length > 128) throw taskError("任务身份无效", 400, "AGENT_TASK_OWNER_INVALID");
    if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 128) {
      throw taskError("缺少有效的 Idempotency-Key", 400, "IDEMPOTENCY_KEY_REQUIRED");
    }
    const cleanPayload = normalizeAgentTaskPayload(payload);
    const payloadJson = json(cleanPayload);
    const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
    const idempotencyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const now = this.now();

    return this.transaction(() => {
      const existing = this.db.prepare(
        "SELECT * FROM agent_tasks WHERE owner_key = ? AND idempotency_hash = ?",
      ).get(ownerKey, idempotencyHash);
      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          throw taskError("相同 Idempotency-Key 已用于不同任务内容", 409, "IDEMPOTENCY_KEY_REUSED");
        }
        return { task: publicTask(existing, { includePayload: true }), replayed: true };
      }

      const activeCount = this.db.prepare(
        "SELECT COUNT(*) AS count FROM agent_tasks WHERE owner_key = ? AND status IN ('queued', 'running', 'cancelling')",
      ).get(ownerKey).count;
      if (Number(activeCount) >= this.maxActiveTasks) {
        throw taskError("当前已有多个 Agent 任务排队或运行，请稍后再试", 429, "AGENT_TASK_QUOTA_EXCEEDED");
      }

      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO agent_tasks(
          id, owner_key, idempotency_hash, payload_hash, payload_json,
          status, attempts, created_at, updated_at, event_seq
        ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, 0)
      `).run(id, ownerKey, idempotencyHash, payloadHash, payloadJson, now, now);
      this.insertEvent(id, "task_queued", { mode: cleanPayload.mode }, now);
      const task = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id);
      return { task: publicTask(task, { includePayload: true }), replayed: false };
    });
  }

  getTask(taskId, ownerKey, { includePayload = true } = {}) {
    const row = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ? AND owner_key = ?").get(taskId, ownerKey);
    return publicTask(row, { includePayload });
  }

  listTasks(ownerKey, limit = 10) {
    const size = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)));
    return this.db.prepare(
      "SELECT * FROM agent_tasks WHERE owner_key = ? ORDER BY created_at DESC LIMIT ?",
    ).all(ownerKey, size).map((row) => publicTask(row, { includeSummary: true }));
  }

  listEvents(taskId, ownerKey, afterSeq = 0, limit = 100) {
    const exists = this.db.prepare("SELECT id FROM agent_tasks WHERE id = ? AND owner_key = ?").get(taskId, ownerKey);
    if (!exists) return null;
    const cursor = Math.max(0, Math.floor(Number(afterSeq) || 0));
    const size = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
    const rows = this.db.prepare(
      "SELECT seq, type, payload_json, created_at FROM agent_task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
    ).all(taskId, cursor, size);
    return rows.map((row) => ({
      seq: Number(row.seq),
      type: row.type,
      payload: parseJson(row.payload_json, {}),
      createdAt: new Date(Number(row.created_at)).toISOString(),
    }));
  }

  cancelTask(taskId, ownerKey) {
    const now = this.now();
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ? AND owner_key = ?").get(taskId, ownerKey);
      if (!row) return null;
      if (row.status === "queued") {
        this.db.prepare(
          "UPDATE agent_tasks SET status = 'cancelled', cancel_requested_at = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
        ).run(now, now, now, taskId);
        this.insertEvent(taskId, "task_cancelled", { reason: "cancelled_before_start" }, now);
      } else if (row.status === "running") {
        this.db.prepare(
          "UPDATE agent_tasks SET status = 'cancelling', cancel_requested_at = ?, updated_at = ? WHERE id = ? AND status = 'running'",
        ).run(now, now, taskId);
        this.insertEvent(taskId, "task_cancel_requested", {}, now);
      }
      const updated = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(taskId);
      return publicTask(updated, { includePayload: true });
    });
  }

  claimNextTask(ownerId) {
    const now = this.now();
    return this.transaction(() => {
      const expired = this.db.prepare(
        "SELECT * FROM agent_tasks WHERE status IN ('running', 'cancelling') AND lease_expires_at <= ? ORDER BY lease_expires_at",
      ).all(now);
      for (const row of expired) {
        if (row.cancel_requested_at != null || row.status === "cancelling") {
          this.db.prepare(
            "UPDATE agent_tasks SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?",
          ).run(now, now, row.id);
          this.insertEvent(row.id, "task_cancelled", { reason: "lease_expired_after_cancel" }, now);
        } else if (Number(row.attempts) >= this.maxAttempts) {
          const error = { code: "AGENT_TASK_LEASE_EXPIRED", message: "任务执行租约多次过期，已停止自动重跑" };
          this.db.prepare(
            "UPDATE agent_tasks SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?, error_json = ? WHERE id = ?",
          ).run(now, now, json(error), row.id);
          this.insertEvent(row.id, "task_failed", error, now);
        } else {
          this.db.prepare(
            "UPDATE agent_tasks SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
          ).run(now, row.id);
          this.insertEvent(row.id, "task_requeued", { reason: "lease_expired", previousAttempt: Number(row.attempts) }, now);
        }
      }

      const next = this.db.prepare(
        "SELECT * FROM agent_tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
      ).get();
      if (!next) return null;
      const attempt = Number(next.attempts) + 1;
      this.db.prepare(`
        UPDATE agent_tasks
        SET status = 'running', attempts = ?, lease_owner = ?, heartbeat_at = ?,
            lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(attempt, ownerId, now, now + this.leaseMs, now, now, next.id);
      this.insertEvent(next.id, attempt > 1 ? "task_resumed" : "task_started", { attempt }, now);
      return publicTask(this.db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(next.id), { includePayload: true });
    });
  }

  heartbeat(taskId, ownerId) {
    const now = this.now();
    return this.transaction(() => {
      const row = this.db.prepare(
        "SELECT status, cancel_requested_at, lease_expires_at FROM agent_tasks WHERE id = ? AND lease_owner = ?",
      ).get(taskId, ownerId);
      if (!row || !["running", "cancelling"].includes(row.status) || Number(row.lease_expires_at) <= now) {
        return { owned: false, cancelRequested: false };
      }
      this.db.prepare(
        "UPDATE agent_tasks SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ?",
      ).run(now, now + this.leaseMs, now, taskId, ownerId);
      return { owned: true, cancelRequested: row.cancel_requested_at != null || row.status === "cancelling" };
    });
  }

  appendProgress(taskId, ownerId, event) {
    return this.transaction(() => {
      const row = this.db.prepare(
        "SELECT status, lease_owner, lease_expires_at FROM agent_tasks WHERE id = ?",
      ).get(taskId);
      if (!row || row.lease_owner !== ownerId || !["running", "cancelling"].includes(row.status) || Number(row.lease_expires_at) <= this.now()) return null;
      return this.insertEvent(taskId, "progress", event);
    });
  }

  finishTask(taskId, ownerId, { result = null, error = null } = {}) {
    const now = this.now();
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM agent_tasks WHERE id = ? AND lease_owner = ?").get(taskId, ownerId);
      if (!row || !["running", "cancelling"].includes(row.status) || Number(row.lease_expires_at) <= now) return null;
      if (row.cancel_requested_at != null || row.status === "cancelling") {
        const cancelError = { code: "LLM_GENERATION_CANCELLED", message: "任务已取消" };
        this.db.prepare(
          "UPDATE agent_tasks SET status = 'cancelled', result_json = ?, error_json = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?",
        ).run(json(result), json(cancelError), now, now, taskId);
        this.insertEvent(taskId, "task_cancelled", { reason: "user_requested" }, now);
      } else if (error) {
        const safeError = { code: String(error.code || "AGENT_TASK_FAILED").slice(0, 100), message: String(error.message || "Agent 任务执行失败").slice(0, 1500) };
        this.db.prepare(
          "UPDATE agent_tasks SET status = 'failed', error_json = ?, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?",
        ).run(json(safeError), now, now, taskId);
        this.insertEvent(taskId, "task_failed", safeError, now);
      } else {
        this.db.prepare(
          "UPDATE agent_tasks SET status = 'completed', result_json = ?, error_json = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?",
        ).run(json(result), now, now, taskId);
        this.insertEvent(taskId, "task_completed", { result }, now);
      }
      return publicTask(this.db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(taskId), { includePayload: true });
    });
  }

  purgeExpired() {
    const cutoff = this.now() - this.retentionMs;
    return this.db.prepare(
      "DELETE FROM agent_tasks WHERE status IN ('completed', 'failed', 'cancelled') AND finished_at < ?",
    ).run(cutoff).changes;
  }
}

export class AgentTaskManager {
  constructor({
    db,
    generator,
    now = () => Date.now(),
    pollMs = 500,
    heartbeatMs = 5_000,
    leaseMs = 30_000,
    maxAttempts = 2,
    maxActiveTasks = 3,
    retentionMs = DEFAULT_RETENTION_MS,
    ownerId = randomUUID(),
  } = {}) {
    this.store = new AgentTaskStore(db, { now, leaseMs, maxAttempts, maxActiveTasks, retentionMs });
    this.generator = generator;
    this.now = now;
    this.pollMs = pollMs;
    this.heartbeatMs = heartbeatMs;
    this.ownerId = ownerId;
    this.timer = null;
    this.running = false;
    this.controllers = new Map();
    this.lastPruneAt = 0;
  }

  init() {
    this.store.init();
    this.store.purgeExpired();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.drain(); }, this.pollMs);
    this.timer.unref?.();
    void this.drain();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.now() - this.lastPruneAt > 60 * 60 * 1000) {
        this.store.purgeExpired();
        this.lastPruneAt = this.now();
      }
      const task = this.store.claimNextTask(this.ownerId);
      if (task) await this.execute(task);
    } catch (error) {
      process.stderr.write(`[agent-task-manager] ${String(error?.message || error)}\n`);
    } finally {
      this.running = false;
    }
  }

  async execute(task) {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    const heartbeat = setInterval(() => {
      try {
        const state = this.store.heartbeat(task.id, this.ownerId);
        if (!state.owned) {
          controller.abort(taskError("任务执行租约已失效", 409, "AGENT_TASK_LEASE_LOST"));
        } else if (state.cancelRequested && !controller.signal.aborted) {
          controller.abort(taskError("任务已取消", 499, "LLM_GENERATION_CANCELLED"));
        }
      } catch {
        // SQLite 短暂忙碌时由下一次心跳重试；租约本身仍有过期保护。
      }
    }, this.heartbeatMs);
    heartbeat.unref?.();

    try {
      const payload = task.request || {};
      const onProgress = (event) => {
        try { this.store.appendProgress(task.id, this.ownerId, event); } catch { /* 进度记录失败不影响模型调用 */ }
      };
      const result = payload.mode === "review"
        ? await this.generator.reviewAgentTask({ ...payload, signal: controller.signal, onProgress })
        : await this.generator.runAgentTask({ ...payload, signal: controller.signal, onProgress });
      this.store.finishTask(task.id, this.ownerId, { result });
    } catch (error) {
      if (error?.code === "AGENT_TASK_LEASE_LOST") return;
      this.store.finishTask(task.id, this.ownerId, { error });
    } finally {
      clearInterval(heartbeat);
      this.controllers.delete(task.id);
    }
  }
}
