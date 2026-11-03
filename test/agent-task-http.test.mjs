import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("持久 Agent HTTP API：幂等创建、事件回连、状态查询与取消", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-agent-http-"));
  const keys = ["NODE_ENV", "HOST", "ARCHITECT_DATA_FILE", "ARCHITECT_ENABLE_AGENTS", "ARCHITECT_ACCESS_TOKEN"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.ARCHITECT_DATA_FILE = join(directory, "state.sqlite");
  process.env.ARCHITECT_ENABLE_AGENTS = "true";
  delete process.env.ARCHITECT_ACCESS_TOKEN;

  let server;
  let generator;
  let agentTaskManager;
  let originalRun;
  try {
    ({ server, generator, agentTaskManager } = await import("../server.mjs?agent-task-http-integration"));
    originalRun = generator.runAgentTask;
    agentTaskManager.pollMs = 5;
    agentTaskManager.heartbeatMs = 5;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  t.after(async () => {
    agentTaskManager.stop();
    if (originalRun) generator.runAgentTask = originalRun;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = (extra = {}) => ({ "content-type": "application/json", origin, ...extra });
  const create = (key, body) => fetch(`${origin}/api/agents/tasks`, {
    method: "POST",
    headers: headers({ "idempotency-key": key }),
    body: JSON.stringify(body),
  });
  const body = { mode: "run", prompt: "持久任务 HTTP 集成", strategy: "single", agentIds: ["agent-one"] };

  let callCount = 0;
  generator.runAgentTask = async ({ onProgress }) => {
    callCount += 1;
    onProgress({ type: "agent_started", agentId: "agent-one", agentName: "测试导师" });
    onProgress({ type: "agent_completed", agentId: "agent-one", agentName: "测试导师" });
    return {
      strategy: "single",
      callCount: 1,
      results: [{ agentId: "agent-one", agentName: "测试导师", answer: "持久化结果" }],
    };
  };

  const createdResponse = await create("http-run-001", body);
  assert.equal(createdResponse.status, 202);
  const created = await createdResponse.json();
  assert.equal(created.task.status, "queued");
  assert.ok(created.task.id);
  assert.match(created.eventsUrl, new RegExp(created.task.id));

  const replayResponse = await create("http-run-001", body);
  assert.equal(replayResponse.status, 200);
  const replay = await replayResponse.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.task.id, created.task.id);

  const conflict = await create("http-run-001", { ...body, prompt: "同一个 key 不可复用" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "IDEMPOTENCY_KEY_REUSED");

  const waitForStatus = async (taskId, wantedStatus) => {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const response = await fetch(`${origin}/api/agents/tasks/${taskId}`, { headers: { origin } });
      assert.equal(response.status, 200);
      const payload = await response.json();
      if (payload.task.status === wantedStatus) return payload.task;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`任务未进入状态 ${wantedStatus}`);
  };

  const completed = await waitForStatus(created.task.id, "completed");
  assert.equal(callCount, 1);
  assert.equal(completed.result.results[0].answer, "持久化结果");

  const eventsResponse = await fetch(`${origin}/api/agents/tasks/${created.task.id}/events`, { headers: { origin } });
  assert.equal(eventsResponse.status, 200);
  assert.match(eventsResponse.headers.get("content-type") || "", /text\/event-stream/);
  const eventText = await eventsResponse.text();
  const eventIds = [...eventText.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.ok(eventIds.length >= 5);
  assert.deepEqual(eventIds, [...eventIds].sort((a, b) => a - b));
  assert.match(eventText, /"type":"complete"/);

  const reconnect = await fetch(`${origin}/api/agents/tasks/${created.task.id}/events?after=2`, { headers: { origin } });
  const reconnectText = await reconnect.text();
  const reconnectIds = [...reconnectText.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert.ok(reconnectIds.length > 0);
  assert.ok(reconnectIds.every((id) => id > 2));

  const listResponse = await fetch(`${origin}/api/agents/tasks?limit=5`, { headers: { origin } });
  const listed = await listResponse.json();
  assert.ok(listed.tasks.some((task) => task.id === created.task.id));

  generator.runAgentTask = ({ signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

  const cancelCreatedResponse = await create("http-cancel-001", body);
  const cancelCreated = await cancelCreatedResponse.json();
  await waitForStatus(cancelCreated.task.id, "running");
  const cancelResponse = await fetch(`${origin}/api/agents/tasks/${cancelCreated.task.id}/cancel`, {
    method: "POST",
    headers: headers(),
    body: "{}",
  });
  assert.equal(cancelResponse.status, 200);
  const cancelRequested = await cancelResponse.json();
  assert.ok(["cancelling", "cancelled"].includes(cancelRequested.task.status));
  const cancelled = await waitForStatus(cancelCreated.task.id, "cancelled");
  assert.equal(cancelled.error.code, "LLM_GENERATION_CANCELLED");
});
