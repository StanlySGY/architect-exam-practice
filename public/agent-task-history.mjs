export const AGENT_TASK_HISTORY_STORAGE_KEY = "architect-agent-task-history";
export const AGENT_TASK_HISTORY_LIMIT = 8;
const STRATEGIES = new Set(["single", "parallel", "battle"]);
const MAX_RECORD_CHARS = 150_000;
function text(value, limit = 4000) { return typeof value === "string" ? value.slice(0, limit) : ""; }
function textList(value, limit = 12, itemLimit = 1000) {
  return Array.isArray(value) ? value.slice(0, limit).map((item) => text(item, itemLimit)).filter(Boolean) : [];
}
function finiteNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function normalizeQuality(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.passed === "boolean") {
    return { gate: text(value.gate, 100), passed: value.passed, issues: textList(value.issues) };
  }
  const status = ["passed", "partial", "failed"].includes(value.status) ? value.status : "failed";
  const review = ["passed", "failed", "pending", "skipped", "not_required"].includes(value.review) ? value.review : "not_required";
  const workers = value.workers && typeof value.workers === "object" ? value.workers : {};
  return {
    gate: text(value.gate, 100),
    status,
    workers: {
      passed: Math.round(finiteNumber(workers.passed, 0, 4)),
      failed: Math.round(finiteNumber(workers.failed, 0, 4)),
      notEvaluated: Math.round(finiteNumber(workers.notEvaluated, 0, 4)),
    },
    review,
    note: text(value.note, 500),
  };
}
function normalizePlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const router = value.router && typeof value.router === "object" ? value.router : {};
  const execution = value.execution && typeof value.execution === "object" ? value.execution : {};
  const steps = Array.isArray(value.steps) ? value.steps.slice(0, 5).map((step, index) => ({
    id: text(step?.id, 100) || `step-${index + 1}`,
    type: step?.type === "review" ? "review" : "worker",
    role: step?.role === "evaluator" ? "evaluator" : "worker",
    agentId: text(step?.agentId, 100),
    agentName: text(step?.agentName, 120) || "Agent",
    dependsOn: Array.isArray(step?.dependsOn) ? step.dependsOn.slice(0, 4).map((item) => text(item, 100)).filter(Boolean) : [],
    execution: text(step?.execution, 40),
    minimumSuccessfulDependencies: Math.round(finiteNumber(step?.minimumSuccessfulDependencies, 0, 4)),
  })) : [];
  return {
    version: Math.round(finiteNumber(value.version, 1, 10, 1)),
    strategy: STRATEGIES.has(value.strategy) ? value.strategy : "single",
    router: {
      id: text(router.id, 100),
      mode: text(router.mode, 40),
      decision: text(router.decision, 300),
    },
    execution: {
      mode: text(execution.mode, 60),
      workerCount: Math.round(finiteNumber(execution.workerCount, 0, 4)),
      maxParallelWorkers: Math.round(finiteNumber(execution.maxParallelWorkers, 0, 4)),
    },
    steps,
  };
}
function normalizeResultItem(item, fallbackAgentId = "") {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return {
    agentId: text(item.agentId, 100) || fallbackAgentId,
    agentName: text(item.agentName, 120) || "Agent",
    model: text(item.model, 200),
    error: text(item.error, 3000),
    answer: text(item.answer, 40_000),
    confidence: finiteNumber(item.confidence, 0, 1),
    keyPoints: textList(item.keyPoints),
    concerns: textList(item.concerns),
    quality: normalizeQuality(item.quality),
  };
}
function normalizeSynthesis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { judgedBy: text(value.judgedBy, 120), answer: text(value.answer, 40_000), keyPoints: textList(value.keyPoints), concerns: textList(value.concerns), quality: normalizeQuality(value.quality) };
}
export function normalizeAgentTaskHistoryRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  let sourceLength;
  try {
    sourceLength = JSON.stringify(value)?.length ?? Infinity;
  } catch {
    return null;
  }
  if (sourceLength > MAX_RECORD_CHARS) return null;
  const id = text(value.id, 100);
  const prompt = text(value.prompt, 16_000);
  const strategy = STRATEGIES.has(value.strategy) ? value.strategy : "";
  const createdTime = Date.parse(text(value.createdAt, 40));
  const rawResults = value.result?.results;
  if (!id || !prompt || !strategy || !Number.isFinite(createdTime) || !Array.isArray(rawResults)) return null;
  const record = {
    id, createdAt: new Date(createdTime).toISOString(), prompt, strategy,
    agentIds: Array.isArray(value.agentIds) ? value.agentIds.slice(0, 4).map((item) => text(item, 100)).filter(Boolean) : [],
    judgeAgentId: text(value.judgeAgentId, 100),
    durationMs: finiteNumber(value.durationMs, 0, 86_400_000),
    callCount: Math.round(finiteNumber(value.callCount, 0, 1000)),
    result: { strategy, plan: normalizePlan(value.result?.plan), results: rawResults.slice(0, 4).map((item, index) => normalizeResultItem(item, value.agentIds?.[index] || "")).filter(Boolean), synthesis: normalizeSynthesis(value.result?.synthesis), quality: normalizeQuality(value.result?.quality) },
  };
  return JSON.stringify(record).length <= MAX_RECORD_CHARS ? record : null;
}
function resolveStorage(storage) { return storage ?? globalThis.localStorage; }
export function loadAgentTaskHistory(storage) {
  try {
    const raw = resolveStorage(storage)?.getItem(AGENT_TASK_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeAgentTaskHistoryRecord).filter(Boolean).slice(0, AGENT_TASK_HISTORY_LIMIT) : [];
  } catch { return []; }
}
export function saveAgentTaskHistory(record, storage) {
  const normalized = normalizeAgentTaskHistoryRecord(record);
  if (!normalized) return { ok: false, reason: "invalid", items: loadAgentTaskHistory(storage) };
  try {
    const target = resolveStorage(storage);
    if (!target?.setItem) throw new Error("storage_unavailable");
    const items = loadAgentTaskHistory(target).filter((item) => item.id !== normalized.id);
    const next = [normalized, ...items].slice(0, AGENT_TASK_HISTORY_LIMIT);
    target.setItem(AGENT_TASK_HISTORY_STORAGE_KEY, JSON.stringify(next));
    return { ok: true, items: next };
  } catch { return { ok: false, reason: "storage", items: loadAgentTaskHistory(storage) }; }
}
export function removeAgentTaskHistory(id, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target?.setItem) throw new Error("storage_unavailable");
    const next = loadAgentTaskHistory(target).filter((item) => item.id !== id);
    target.setItem(AGENT_TASK_HISTORY_STORAGE_KEY, JSON.stringify(next));
    return { ok: true, items: next };
  } catch { return { ok: false, reason: "storage", items: loadAgentTaskHistory(storage) }; }
}
export function clearAgentTaskHistory(storage) {
  try {
    const target = resolveStorage(storage);
    if (!target?.removeItem) throw new Error("storage_unavailable");
    target.removeItem(AGENT_TASK_HISTORY_STORAGE_KEY);
    return { ok: true, items: [] };
  } catch { return { ok: false, reason: "storage", items: loadAgentTaskHistory(storage) }; }
}
