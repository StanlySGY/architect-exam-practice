import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TASK_HISTORY_LIMIT,
  AGENT_TASK_HISTORY_STORAGE_KEY,
  clearAgentTaskHistory,
  loadAgentTaskHistory,
  normalizeAgentTaskHistoryRecord,
  removeAgentTaskHistory,
  saveAgentTaskHistory,
} from "../public/agent-task-history.mjs";
function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
function record(id, overrides = {}) {
  return {
    id, createdAt: "2026-11-02T12:00:00.000Z", prompt: "解释 CAP 定理",
    strategy: "single", agentIds: ["agent-1"], judgeAgentId: "",
    durationMs: 1200, callCount: 1,
    result: { results: [{
      agentName: "备考导师", model: "model-a", answer: "一致性、可用性和分区容错性。",
      confidence: 0.9, keyPoints: ["分区发生时"], concerns: [],
    }], synthesis: null },
    ...overrides,
  };
}
test("历史只保留最近 8 条，并将最新任务放在最前", () => {
  const storage = memoryStorage();
  for (let index = 1; index <= 10; index += 1) assert.equal(saveAgentTaskHistory(record("task-" + index), storage).ok, true);
  const items = loadAgentTaskHistory(storage);
  assert.equal(items.length, AGENT_TASK_HISTORY_LIMIT);
  assert.equal(items[0].id, "task-10");
  assert.equal(items.at(-1).id, "task-3");
});
test("历史记录只保留展示所需字段，不保留多余凭据字段", () => {
  const storage = memoryStorage();
  const saved = saveAgentTaskHistory(record("safe", {
    apiKey: "should-not-be-stored",
    result: { apiKey: "should-not-be-stored", results: [{ agentName: "导师", answer: "回答", unexpectedSecret: "should-not-be-stored" }] },
  }), storage);
  assert.equal(saved.ok, true);
  assert.equal(storage.getItem(AGENT_TASK_HISTORY_STORAGE_KEY).includes("should-not-be-stored"), false);
  assert.deepEqual(Object.keys(loadAgentTaskHistory(storage)[0].result.results[0]).sort(), [
    "agentId", "agentName", "answer", "concerns", "confidence", "error", "keyPoints", "model", "quality",
  ]);
});
test("历史记录保留经过白名单规范化的 Router 计划和质量门禁摘要", () => {
  const storage = memoryStorage();
  const saved = saveAgentTaskHistory(record("plan-history", {
    result: {
      strategy: "battle",
      plan: {
        version: 1,
        strategy: "battle",
        router: { id: "local-deterministic-router", mode: "deterministic", decision: "独立 Worker" },
        execution: { mode: "parallel_then_review", workerCount: 2, maxParallelWorkers: 2 },
        steps: [
          { id: "worker-1", type: "worker", role: "worker", agentId: "a1", agentName: "导师", dependsOn: [], execution: "parallel" },
          { id: "review", type: "review", role: "evaluator", agentId: "judge", agentName: "评审", dependsOn: ["worker-1"], execution: "after_workers", minimumSuccessfulDependencies: 2 },
        ],
        secret: "must-not-persist",
      },
      results: [{ agentName: "导师", answer: "结论", confidence: 0.8, quality: { gate: "agent-output-contract-v1", passed: true, issues: [], secret: "drop" } }],
      synthesis: null,
      quality: { gate: "agent-output-contract-v1", status: "passed", workers: { passed: 1, failed: 0, notEvaluated: 0 }, review: "passed", note: "contract only", secret: "drop" },
    },
  }), storage);
  assert.equal(saved.ok, true);
  const stored = storage.getItem(AGENT_TASK_HISTORY_STORAGE_KEY);
  assert.equal(stored.includes("must-not-persist"), false);
  const loaded = loadAgentTaskHistory(storage)[0];
  assert.equal(loaded.result.plan.router.mode, "deterministic");
  assert.equal(loaded.result.plan.steps[1].minimumSuccessfulDependencies, 2);
  assert.equal(loaded.result.results[0].quality.passed, true);
  assert.equal(loaded.result.quality.status, "passed");
});

test("无效记录和超长结果被拒绝，不写入历史", () => {
  const storage = memoryStorage();
  assert.equal(normalizeAgentTaskHistoryRecord({ id: "bad" }), null);
  const result = saveAgentTaskHistory(record("large", { result: { results: [{ answer: "x".repeat(160_000) }] } }), storage);
  assert.equal(result.ok, false);
  assert.equal(loadAgentTaskHistory(storage).length, 0);
});

test("删除单条与清空历史都能持久化", () => {
  const storage = memoryStorage();
  saveAgentTaskHistory(record("one"), storage);
  saveAgentTaskHistory(record("two"), storage);
  assert.equal(removeAgentTaskHistory("one", storage).items.length, 1);
  assert.equal(loadAgentTaskHistory(storage)[0].id, "two");
  assert.equal(clearAgentTaskHistory(storage).ok, true);
  assert.deepEqual(loadAgentTaskHistory(storage), []);
});
test("损坏数据和不可用存储不会让页面初始化抛错", () => {
  const storage = memoryStorage();
  storage.setItem(AGENT_TASK_HISTORY_STORAGE_KEY, "{");
  assert.deepEqual(loadAgentTaskHistory(storage), []);
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(loadAgentTaskHistory(broken), []);
  assert.equal(saveAgentTaskHistory(record("x"), broken).ok, false);
  assert.equal(removeAgentTaskHistory("x", broken).ok, false);
  assert.equal(clearAgentTaskHistory(broken).ok, false);
});
