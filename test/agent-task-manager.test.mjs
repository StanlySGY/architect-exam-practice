import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { AgentTaskManager, AgentTaskStore } from "../src/agent-task-manager.mjs";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "architect-agent-task-"));
  const file = join(directory, "tasks.sqlite");
  let db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  let clock = 1_800_000_000_000;
  const now = () => clock;
  let store = new AgentTaskStore(db, { now, ...options });
  store.init();
  t.after(() => {
    try { db.close(); } catch {}
    return rm(directory, { recursive: true, force: true });
  });
  return {
    file,
    now,
    store: () => store,
    db: () => db,
    advance(ms) { clock += ms; },
    reopen() {
      db.close();
      db = new DatabaseSync(file);
      db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
      store = new AgentTaskStore(db, { now, ...options });
      store.init();
      return store;
    },
  };
}

const singlePayload = (overrides = {}) => ({
  mode: "run",
  prompt: "解释架构权衡",
  strategy: "single",
  agentIds: ["tutor"],
  ...overrides,
});

async function waitFor(read, predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("等待任务状态超时");
}

test("持久任务：幂等创建、payload 白名单、配额与身份隔离", async (t) => {
  const f = await fixture(t, { maxActiveTasks: 1 });
  const store = f.store();
  const created = store.createTask({
    ownerKey: "owner-a",
    idempotencyKey: "request-0001",
    payload: { ...singlePayload(), apiKey: "must-not-be-persisted" },
  });
  assert.equal(created.task.status, "queued");
  assert.equal(created.replayed, false);
  assert.deepEqual(created.task.request, { ...singlePayload(), judgeAgentId: "" });
  assert.equal(JSON.stringify(created.task).includes("must-not-be-persisted"), false);

  const replayed = store.createTask({
    ownerKey: "owner-a",
    idempotencyKey: "request-0001",
    payload: singlePayload(),
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.task.id, created.task.id);
  assert.throws(
    () => store.createTask({ ownerKey: "owner-a", idempotencyKey: "request-0001", payload: singlePayload({ prompt: "另一项任务" }) }),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED" && error.status === 409,
  );
  assert.throws(
    () => store.createTask({ ownerKey: "owner-a", idempotencyKey: "request-0002", payload: singlePayload() }),
    (error) => error.code === "AGENT_TASK_QUOTA_EXCEEDED" && error.status === 429,
  );

  assert.equal(store.getTask(created.task.id, "owner-b"), null);
  assert.equal(store.cancelTask(created.task.id, "owner-b"), null);
  assert.equal(store.listEvents(created.task.id, "owner-b", 0), null);
  assert.deepEqual(store.listTasks("owner-b"), []);
  const listed = store.listTasks("owner-a");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].promptPreview, "解释架构权衡");
  assert.equal("request" in listed[0], false);
});

test("持久任务：事务领取只会让一个 Worker 获得租约，事件游标严格递增", async (t) => {
  const f = await fixture(t);
  const firstStore = f.store();
  const created = firstStore.createTask({
    ownerKey: "local",
    idempotencyKey: "request-0002",
    payload: singlePayload(),
  });
  const secondStore = new AgentTaskStore(f.db());
  secondStore.init();

  const claims = [firstStore.claimNextTask("worker-a"), secondStore.claimNextTask("worker-b")];
  const claimed = claims.filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "running");
  assert.equal(claimed[0].attemptCount, 1);
  assert.equal(firstStore.heartbeat(created.task.id, "not-owner").owned, false);

  const owner = claimed[0] === null ? "worker-b" : "worker-a";
  firstStore.appendProgress(created.task.id, owner, { type: "agent_started", agentId: "tutor" });
  firstStore.appendProgress(created.task.id, owner, { type: "agent_completed", agentId: "tutor" });
  const completed = firstStore.finishTask(created.task.id, owner, {
    result: { strategy: "single", results: [{ answer: "结论" }] },
  });
  assert.equal(completed.status, "completed");
  const all = firstStore.listEvents(created.task.id, "local", 0);
  assert.deepEqual(all.map((event) => event.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(all.map((event) => event.type), [
    "task_queued", "task_started", "progress", "progress", "task_completed",
  ]);
  assert.deepEqual(firstStore.listEvents(created.task.id, "local", 2).map((event) => event.seq), [3, 4, 5]);
  assert.equal(firstStore.finishTask(created.task.id, "other-worker", { result: {} }), null);
});

test("进程重启后 SQLite 状态保留；租约过期任务有限重排并继续执行", async (t) => {
  const f = await fixture(t, { leaseMs: 10, maxAttempts: 2 });
  const beforeRestart = f.store();
  const created = beforeRestart.createTask({
    ownerKey: "local",
    idempotencyKey: "request-restart",
    payload: singlePayload(),
  });
  const claimed = beforeRestart.claimNextTask("old-process");
  assert.equal(claimed.id, created.task.id);
  assert.equal(claimed.attemptCount, 1);

  f.advance(11);
  const afterRestart = f.reopen();
  assert.equal(afterRestart.heartbeat(created.task.id, "old-process").owned, false);
  assert.equal(afterRestart.appendProgress(created.task.id, "old-process", { type: "late" }), null);
  assert.equal(afterRestart.finishTask(created.task.id, "old-process", { result: { answer: "stale" } }), null);
  const recovered = afterRestart.claimNextTask("new-process");
  assert.equal(recovered.id, created.task.id);
  assert.equal(recovered.status, "running");
  assert.equal(recovered.attemptCount, 2);
  assert.equal(recovered.request.prompt, "解释架构权衡");
  assert.deepEqual(afterRestart.listEvents(created.task.id, "local", 0).map((event) => event.type), [
    "task_queued", "task_started", "task_requeued", "task_resumed",
  ]);

  f.advance(11);
  assert.equal(afterRestart.claimNextTask("third-process"), null);
  const exhausted = afterRestart.getTask(created.task.id, "local");
  assert.equal(exhausted.status, "failed");
  assert.equal(exhausted.error.code, "AGENT_TASK_LEASE_EXPIRED");
});

test("取消任务：排队任务立即取消，运行任务先进入 cancelling 并由租约持有者收尾", async (t) => {
  const f = await fixture(t, { leaseMs: 100 });
  const store = f.store();
  const queued = store.createTask({
    ownerKey: "local",
    idempotencyKey: "cancel-before-start",
    payload: singlePayload(),
  });
  assert.equal(store.cancelTask(queued.task.id, "local").status, "cancelled");
  assert.equal(store.claimNextTask("worker"), null);

  const running = store.createTask({
    ownerKey: "local",
    idempotencyKey: "cancel-running",
    payload: singlePayload(),
  });
  store.claimNextTask("worker");
  assert.equal(store.cancelTask(running.task.id, "local").status, "cancelling");
  assert.equal(store.heartbeat(running.task.id, "worker").cancelRequested, true);
  const lateResult = store.finishTask(running.task.id, "worker", { result: { answer: "已经返回" } });
  assert.equal(lateResult.status, "cancelled");
  assert.equal(lateResult.result.answer, "已经返回");
  assert.equal(store.listEvents(running.task.id, "local").at(-1).type, "task_cancelled");
});

test("取消与完成竞态以持久化 cancel_requested 状态为准", async (t) => {
  const f = await fixture(t);
  const store = f.store();
  const created = store.createTask({
    ownerKey: "local",
    idempotencyKey: "cancel-race",
    payload: singlePayload(),
  });
  store.claimNextTask("worker");
  store.cancelTask(created.task.id, "local");
  const finished = store.finishTask(created.task.id, "worker", { result: { answer: "late" } });
  assert.equal(finished.status, "cancelled");
  assert.equal(finished.error.code, "LLM_GENERATION_CANCELLED");
});

test("终态任务按保留策略清理，活动任务不被清理", async (t) => {
  const f = await fixture(t, { retentionMs: 100 });
  const store = f.store();
  const old = store.createTask({ ownerKey: "local", idempotencyKey: "old", payload: singlePayload() });
  store.cancelTask(old.task.id, "local");
  const active = store.createTask({ ownerKey: "local", idempotencyKey: "active", payload: singlePayload() });
  f.advance(101);
  assert.equal(store.purgeExpired(), 1);
  assert.equal(store.getTask(old.task.id, "local"), null);
  assert.equal(store.getTask(active.task.id, "local").status, "queued");
});

test("后台执行器持久化真实进度和完成结果，不需要 SSE 连接保持", async (t) => {
  const f = await fixture(t, { leaseMs: 500 });
  const store = f.store();
  let executions = 0;
  const manager = new AgentTaskManager({
    db: f.db(),
    now: f.now,
    pollMs: 5,
    heartbeatMs: 10,
    leaseMs: 500,
    generator: {
      async runAgentTask({ onProgress }) {
        executions += 1;
        onProgress({ type: "agent_started", agentId: "tutor", agentName: "备考导师" });
        return { strategy: "single", callCount: 1, results: [{ agentId: "tutor", answer: "可靠性结论" }] };
      },
      async reviewAgentTask() { throw new Error("unexpected review call"); },
    },
  });
  manager.init();
  const created = store.createTask({ ownerKey: "local", idempotencyKey: "manager-complete", payload: singlePayload() });
  manager.start();
  try {
    const completed = await waitFor(
      () => manager.store.getTask(created.task.id, "local"),
      (task) => task?.status === "completed",
    );
    assert.equal(executions, 1);
    assert.equal(completed.result.results[0].answer, "可靠性结论");
    assert.deepEqual(manager.store.listEvents(created.task.id, "local").map((event) => event.type), [
      "task_queued", "task_started", "progress", "task_completed",
    ]);
  } finally {
    manager.stop();
  }
});

test("后台执行器收到持久取消请求后中断当前模型任务并写入 cancelled", async (t) => {
  const f = await fixture(t, { leaseMs: 500 });
  const manager = new AgentTaskManager({
    db: f.db(),
    now: f.now,
    pollMs: 5,
    heartbeatMs: 5,
    leaseMs: 500,
    generator: {
      runAgentTask({ signal }) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      async reviewAgentTask() { throw new Error("unexpected review call"); },
    },
  });
  manager.init();
  const created = manager.store.createTask({ ownerKey: "local", idempotencyKey: "manager-cancel", payload: singlePayload() });
  manager.start();
  try {
    await waitFor(
      () => manager.store.getTask(created.task.id, "local"),
      (task) => task?.status === "running",
    );
    manager.store.cancelTask(created.task.id, "local");
    const cancelled = await waitFor(
      () => manager.store.getTask(created.task.id, "local"),
      (task) => task?.status === "cancelled",
    );
    assert.equal(cancelled.error.code, "LLM_GENERATION_CANCELLED");
  } finally {
    manager.stop();
  }
});
