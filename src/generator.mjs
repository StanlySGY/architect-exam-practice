import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chapterOutline,
  findChapter,
  findSection,
  nodePath,
  readMindMap,
} from "./mindmap.mjs";
import { validateEssaySample } from "./essay.mjs";

const MAX_SOURCE_CHARACTERS = 120_000;

export function loadDotEnv(root) {
  let contents;
  try {
    contents = readFileSync(resolve(root, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

function modelError(
  message,
  { status = 502, code = "MODEL_REQUEST_FAILED", cause } = {},
) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), {
    status,
    code,
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw modelError("生成已停止", {
      status: 499,
      code: "LLM_GENERATION_CANCELLED",
    });
  }
}

function classifyModelHttpError(status, fallback) {
  if (status === 401 || status === 403) {
    return modelError("模型接口鉴权失败，请检查 ARCHITECT_LLM_API_KEY", {
      status: 502,
      code: "LLM_AUTH_FAILED",
    });
  }
  if (status === 429) {
    return modelError("模型接口请求过于频繁，请稍后重试", {
      status: 503,
      code: "LLM_RATE_LIMITED",
    });
  }
  if (status >= 500) {
    return modelError(`模型服务暂时不可用（HTTP ${status}），请稍后重试`, {
      status: 503,
      code: "LLM_SERVICE_UNAVAILABLE",
    });
  }
  return modelError(fallback || `模型接口请求失败（HTTP ${status}）`, {
    status: 502,
    code: "LLM_REQUEST_REJECTED",
  });
}

function apiEndpoint(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

// 解析可用模型列表：优先 ARCHITECT_LLM_MODELS（逗号分隔），否则退回单个 ARCHITECT_LLM_MODEL。
function availableModels() {
  const multi = process.env.ARCHITECT_LLM_MODELS;
  if (multi) {
    const models = multi
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    if (models.length) return models;
  }
  return process.env.ARCHITECT_LLM_MODEL
    ? [process.env.ARCHITECT_LLM_MODEL]
    : [];
}

// 聚合 SSE 流里的增量文本。开启流式后，慢模型的字节持续到达，
// 可避免代理网关在固定窗口内无响应就掐断长生成（如 Cloudflare 524）。
async function readStreamContent(response, signal) {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  for await (const chunk of response.body) {
    throwIfAborted(signal);
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const delta = JSON.parse(payload);
        content += delta.choices?.[0]?.delta?.content ?? "";
      } catch {
        // 忽略无法解析的心跳或注释行。
      }
    }
  }
  return content;
}

async function callOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs,
  signal,
}) {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortExternal = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) abortExternal();
    else signal.addEventListener("abort", abortExternal, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const stream = process.env.ARCHITECT_LLM_STREAM === "true";
    const response = await fetch(apiEndpoint(baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        ...(stream ? { stream: true } : {}),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw classifyModelHttpError(response.status, body.error?.message);
    }
    const contentType = response.headers?.get?.("content-type") || "";
    let content;
    if (stream && contentType.includes("text/event-stream")) {
      content = await readStreamContent(response, signal);
    } else {
      const body = await response.json().catch(() => ({}));
      content = body.choices?.[0]?.message?.content;
    }
    if (typeof content !== "string" || !content.trim()) {
      throw modelError("模型接口返回为空，请检查模型配置或稍后重试", {
        status: 502,
        code: "LLM_EMPTY_RESPONSE",
      });
    }
    throwIfAborted(signal);
    return content;
  } catch (error) {
    if (signal?.aborted) {
      throw modelError("生成已停止", {
        status: 499,
        code: "LLM_GENERATION_CANCELLED",
      });
    }
    if (error.name === "AbortError") {
      throw modelError(
        "模型接口请求超时，请检查网络或增大 ARCHITECT_AGENT_TIMEOUT_MS",
        {
          status: 504,
          code: "LLM_TIMEOUT",
        },
      );
    }
    if (error instanceof TypeError && error.message === "fetch failed") {
      throw modelError("无法连接模型接口，请检查 Base URL、网络和代理设置", {
        status: 503,
        code: "LLM_NETWORK_FAILED",
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortExternal);
  }
}

function run(command, args, { input, timeoutMs = 300_000, signal } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(modelError("生成已停止", {
        status: 499,
        code: "LLM_GENERATION_CANCELLED",
      }));
      return;
    }
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timedOut = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const resolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(value);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      child.kill("SIGTERM");
      rejectOnce(modelError("生成已停止", {
        status: 499,
        code: "LLM_GENERATION_CANCELLED",
      }));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      rejectOnce(
        modelError(`${command} 执行超时，请检查模型命令或增大超时时间`, {
          status: 504,
          code: "LLM_TIMEOUT",
        }),
      );
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      rejectOnce(
        Object.assign(
          modelError(`无法启动 ${command}，请确认后备命令已安装`, {
            status: 503,
            code: "LLM_PROVIDER_UNAVAILABLE",
            cause: error,
          }),
          { cause: error },
        ),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      if (timedOut) return;
      if (code !== 0) {
        rejectOnce(
          Object.assign(
            modelError(
              `${command} 执行失败：${Buffer.concat(stderr).toString("utf8").trim() || "未提供错误详情"}`,
              { status: 502, code: "LLM_PROVIDER_FAILED" },
            ),
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

function parseAgentResult(raw) {
  const trimmed = raw.trim();
  let outer;
  try {
    outer = JSON.parse(trimmed);
  } catch {
    const fenced =
      trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ??
      trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!fenced)
      throw Object.assign(new Error("Agent 未返回 JSON"), {
        status: 502,
        code: "LLM_INVALID_RESPONSE",
      });
    try {
      return JSON.parse(fenced);
    } catch (error) {
      throw Object.assign(new Error(`Agent JSON 无法解析：${error.message}`), {
        status: 502,
        code: "LLM_INVALID_RESPONSE",
      });
    }
  }
  if (outer.structured_output) return outer.structured_output;
  if (typeof outer.result === "string") return parseAgentResult(outer.result);
  return outer;
}

export class QuestionGenerator {
  constructor({ root = process.cwd(), service, modelConfig = null }) {
    this.root = root;
    loadDotEnv(root);
    this.service = service;
    this.modelConfig = modelConfig;
    this.running = false;
  }

  async generate({ chapter, section = "all", difficulty, count = 10, model, signal }) {
    throwIfAborted(signal);
    if (this.running)
      throw Object.assign(
        new Error("已有 Agent 生成任务正在运行，请稍后重试"),
        { status: 409, code: "LLM_GENERATION_BUSY" },
      );
    const chapterId = Number(chapter);
    const selected = this.service.chapters.find(
      (item) => item.id === chapterId,
    );
    if (!selected)
      throw Object.assign(new Error("章节不存在"), { status: 400 });
    if (!["easy", "medium", "hard"].includes(difficulty))
      throw Object.assign(new Error("请选择简单、中等或困难"), { status: 400 });
    const size = Math.max(1, Math.min(20, Number(count) || 10));
    this.running = true;
    try {
      const material = await this.extractMaterial(selected, section);
      throwIfAborted(signal);
      const agentPrompt = await readFile(
        resolve(this.root, "vendor/architect-agent/agents/mcq-agent.md"),
        "utf8",
      );
      const schema = JSON.stringify({
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: size,
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: {
                  type: "object",
                  properties: {
                    A: { type: "string" },
                    B: { type: "string" },
                    C: { type: "string" },
                    D: { type: "string" },
                  },
                  required: ["A", "B", "C", "D"],
                  additionalProperties: false,
                },
                knowledge_point: { type: "string" },
                correct_answer: { type: "string", enum: ["A", "B", "C", "D"] },
                analysis: { type: "string" },
                knowledge_detail: { type: "string" },
                common_mistake: { type: "string" },
                memory_tip: { type: "string" },
                source_node: { type: "string" },
              },
              required: [
                "question",
                "options",
                "knowledge_point",
                "correct_answer",
                "analysis",
                "knowledge_detail",
                "common_mistake",
                "memory_tip",
                "source_node",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      });
      const timeoutMs = Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000;
      const runtimePrompt = `${agentPrompt}\n\n运行时约束：本程序的唯一资料来源是 architect.mm 思维导图。忽略上游提示中关于读取 PDF、生成 75 道全卷题目的要求，严格遵守用户消息指定的章节、难度和数量。`;
      const added = [];
      let duplicatesSkipped = 0;
      let invalidSourcesSkipped = 0;
      const maxAttempts = 3;
      for (
        let attempt = 1;
        attempt <= maxAttempts && added.length < size;
        attempt += 1
      ) {
        throwIfAborted(signal);
        const remaining = size - added.length;
        const previousQuestions = this.service
          .generatedQuestionPrompts(chapterId)
          .map((question, index) => `${index + 1}. ${question.slice(0, 240)}`)
          .join("\n");
        const userPrompt = [
          `请为《系统架构设计师教程（第2版）》第 ${chapterId} 章“${selected.title}”${section === "all" ? "" : `的小节“${section}”`}生成 ${remaining} 道 ${difficulty} 难度的四选一选择题。`,
          "资料来源：architect.mm 思维导图。",
          "只允许依据下面的复习资料。不要生成资料未覆盖的事实。",
          "题干及选项组合不得与历史题目相同或仅做同义改写；应更换知识切入点、情境或考查方式。",
          "上游提示中的“75 道”和全书题型分布在本次章节练习中不适用；以本消息指定的数量、章节和难度为准。",
          "解析必须说明正确选项，并逐项解释主要干扰项。",
          "每道题必须返回 source_node：该题所依据的思维导图节点标题原文。若多个节点同名，必须写出包含编号的完整节点标题（如 11.5.1 发展历程），以便唯一定位；不能猜测不存在的标题。",
          "只返回一个 JSON 对象，不要输出 Markdown、代码围栏、文件说明或其他文字。JSON 顶层必须是 questions 数组，每道题必须包含 question、options、knowledge_point、correct_answer、analysis、knowledge_detail、common_mistake、memory_tip、source_node。",
          `严格遵守以下 JSON Schema：${schema}`,
          previousQuestions
            ? `\n--- 同章历史题目（禁止重复或改写）---\n${previousQuestions}\n--- 历史题目结束 ---`
            : "",
          "",
          "--- 复习资料开始 ---",
          material.text,
          "--- 复习资料结束 ---",
        ].join("\n");
        let raw;
        raw = await this.callModel({
          runtimePrompt,
          userPrompt,
          schema,
          timeoutMs,
          model,
          signal,
        });
        throwIfAborted(signal);
        const result = parseAgentResult(raw);
        if (!Array.isArray(result.questions)) {
          throw Object.assign(new Error("Agent 返回结果缺少 questions 数组"), {
            status: 502,
            code: "LLM_INVALID_RESPONSE",
          });
        }
        const sourced = result.questions.filter((question) =>
          nodePath(material.scopeNode, question.source_node),
        );
        invalidSourcesSkipped += result.questions.length - sourced.length;
        const candidates = this.service
          .filterUniqueGeneratedQuestions(chapterId, sourced)
          .slice(0, remaining);
        duplicatesSkipped += sourced.length - candidates.length;
        throwIfAborted(signal);
        const accepted = await this.service.addGeneratedQuestions({
          chapter: chapterId,
          difficulty,
          questions: candidates,
          section: material.section,
          source: material.source,
          sourceNode: material.sourceNode,
          signal,
        });
        throwIfAborted(signal);
        duplicatesSkipped += candidates.length - accepted.length;
        added.push(...accepted);
      }
      return {
        added: added.length,
        requested: size,
        duplicatesSkipped,
        invalidSourcesSkipped,
        complete: added.length === size,
        chapter: chapterId,
        section: material.section || "all",
        difficulty,
        source: material.source,
      };
    } finally {
      this.running = false;
    }
  }

  // 生成类任务的公共骨架：互斥锁、章节校验、导图资料提取、Agent 提示词组装、
  // 模型调用与结果解析。各 generateXxx 只提供 schema、约束行与持久化回调。
  async runGenerationFlow({
    chapter,
    section = "all",
    size,
    arrayKey,
    agentFile,
    schema,
    taskLabel,
    runtimeConstraint,
    extraUserLines = [],
    persist,
    model,
    signal,
  }) {
    throwIfAborted(signal);
    if (this.running)
      throw Object.assign(
        new Error("已有 Agent 生成任务正在运行，请稍后重试"),
        { status: 409, code: "LLM_GENERATION_BUSY" },
      );
    const chapterId = Number(chapter);
    const selected = this.service.chapters.find(
      (item) => item.id === chapterId,
    );
    if (!selected)
      throw Object.assign(new Error("章节不存在"), { status: 400 });
    this.running = true;
    try {
      const material = await this.extractMaterial(selected, section);
      throwIfAborted(signal);
      const agentPrompt = await readFile(resolve(this.root, agentFile), "utf8");
      const schemaText = JSON.stringify(schema);
      const timeoutMs =
        Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000;
      const runtimePrompt = `${agentPrompt}\n\n运行时约束：本程序的唯一资料来源是 architect.mm 思维导图。${runtimeConstraint}`;
      const userPrompt = [
        `请为《系统架构设计师教程（第2版）》第 ${chapterId} 章“${selected.title}”${section === "all" ? "" : `的小节“${section}”`}生成 ${size} ${taskLabel}。`,
        "资料来源：architect.mm 思维导图。",
        "只允许依据下面的复习资料。不要生成资料未覆盖的事实。",
        ...extraUserLines,
        `只返回一个 JSON 对象，不要输出 Markdown、代码围栏或其他文字。JSON 顶层必须是 ${arrayKey} 数组。`,
        `严格遵守以下 JSON Schema：${schemaText}`,
        "",
        "--- 复习资料开始 ---",
        material.text,
        "--- 复习资料结束 ---",
      ].join("\n");
      const raw = await this.callModel({
        runtimePrompt,
        userPrompt,
        schema: schemaText,
        timeoutMs,
        model,
        signal,
      });
      throwIfAborted(signal);
      const result = parseAgentResult(raw);
      if (!Array.isArray(result[arrayKey])) {
        throw Object.assign(
          new Error(`Agent 返回结果缺少 ${arrayKey} 数组`),
          { status: 502, code: "LLM_INVALID_RESPONSE" },
        );
      }
      throwIfAborted(signal);
      const submitted = result[arrayKey].slice(0, size);
      const accepted = await persist(submitted, material, chapterId, signal);
      throwIfAborted(signal);
      // 持久化层会按标题去重（含批内与既有库），这里回传统计供界面提示。
      return {
        accepted,
        duplicatesSkipped: submitted.length - accepted.length,
        material,
        chapterId,
        size,
      };
    } finally {
      this.running = false;
    }
  }

  async generateCase({ chapter, section = "all", count = 1, model, signal }) {
    const size = Math.max(1, Math.min(5, Number(count) || 1));
    const { accepted, duplicatesSkipped, material, chapterId } =
      await this.runGenerationFlow({
      chapter,
      section,
      size,
      model,
      signal,
      arrayKey: "cases",
      agentFile: "vendor/architect-agent/agents/case-agent.md",
      taskLabel: "道案例分析题",
      runtimeConstraint: "严格遵守用户消息指定的章节和数量。",
      extraUserLines: [
        "每道案例必须包含 source_node：该案例所依据的思维导图节点标题（必须是复习资料中出现的节点标题原文）。",
      ],
      schema: {
        type: "object",
        properties: {
          cases: {
            type: "array",
            minItems: 1,
            maxItems: size,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                scenario: { type: "string" },
                knowledge_point: { type: "string" },
                source_node: { type: "string" },
                questions: {
                  type: "array",
                  minItems: 1,
                  maxItems: 5,
                  items: {
                    type: "object",
                    properties: {
                      text: { type: "string" },
                      points: { type: "integer" },
                      reference_answer: { type: "string" },
                    },
                    required: ["text", "points", "reference_answer"],
                    additionalProperties: false,
                  },
                },
              },
              required: [
                "title",
                "scenario",
                "knowledge_point",
                "source_node",
                "questions",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["cases"],
        additionalProperties: false,
      },
      persist: (cases, material, chapterId, signal) =>
        this.service.addCases({
          chapter: chapterId,
          section: material.section,
          cases,
          sourceNode: material.sourceNode,
          signal,
        }),
    });
    return {
      added: accepted.length,
      requested: size,
      duplicatesSkipped,
      chapter: chapterId,
      section: material.section || "all",
    };
  }

  modelStatus() {
    const workspace = this.modelConfig?.workspace?.();
    const defaultAgent = workspace?.agents?.find(
      (agent) => agent.id === workspace.defaultAgentId && agent.enabled,
    ) || workspace?.agents?.find((agent) => agent.enabled);
    const defaultProvider = workspace?.providers?.find(
      (provider) => provider.id === defaultAgent?.providerId,
    );
    if (defaultAgent && defaultProvider && (defaultProvider.type === "claude-cli" || (defaultProvider.baseUrl && (defaultAgent.model || defaultProvider.defaultModel)))) {
      let endpoint = defaultProvider.baseUrl;
      try {
        const url = new URL(endpoint);
        endpoint = `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        endpoint = defaultProvider.type === "claude-cli" ? "local" : "已配置";
      }
      const models = defaultProvider.type === "claude-cli"
        ? ["Claude CLI"]
        : [...new Set([...(defaultProvider.models || []), defaultAgent.model].filter(Boolean))];
      return {
        configured: true,
        provider: defaultProvider.type,
        model: defaultAgent.model || defaultProvider.defaultModel || models[0] || null,
        models,
        endpoint,
        agent: defaultAgent.name,
      };
    }
    if (process.env.ARCHITECT_LLM_BASE_URL && process.env.ARCHITECT_LLM_MODEL) {
      let endpoint = process.env.ARCHITECT_LLM_BASE_URL;
      try {
        const url = new URL(endpoint);
        endpoint = `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        endpoint = "已配置";
      }
      const models = availableModels();
      return {
        configured: true,
        provider: "openai-compatible",
        model: process.env.ARCHITECT_LLM_MODEL,
        models,
        endpoint,
      };
    }
    if (process.env.ARCHITECT_LLM_PROVIDER === "claude-cli") {
      return {
        configured: true,
        provider: "claude-cli",
        model: "Claude CLI",
        models: ["Claude CLI"],
      };
    }
    return { configured: false, provider: null, model: null, models: [] };
  }

  async generatePaper({ chapter, section = "all", count = 1, model, signal }) {
    const size = Math.max(1, Math.min(3, Number(count) || 1));
    const { accepted, duplicatesSkipped, material, chapterId } =
      await this.runGenerationFlow({
      chapter,
      section,
      size,
      model,
      signal,
      arrayKey: "papers",
      agentFile: "vendor/architect-agent/agents/paper-agent-local.md",
      taskLabel: "道论文题目",
      runtimeConstraint: "严格遵守用户消息指定的章节和数量。",
      extraUserLines: [
        "每道论文题必须包含 source_node：该题所依据的思维导图节点标题（必须是复习资料中出现的节点标题原文）。",
      ],
      schema: {
        type: "object",
        properties: {
          papers: {
            type: "array",
            minItems: 1,
            maxItems: size,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                knowledge_point: { type: "string" },
                source_node: { type: "string" },
                writing_points: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: [
                "title",
                "description",
                "knowledge_point",
                "source_node",
                "writing_points",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["papers"],
        additionalProperties: false,
      },
      persist: (papers, material, chapterId, signal) =>
        this.service.addPapers({
          chapter: chapterId,
          section: material.section,
          papers,
          sourceNode: material.sourceNode,
          signal,
        }),
    });
    return {
      added: accepted.length,
      requested: size,
      duplicatesSkipped,
      chapter: chapterId,
      section: material.section || "all",
    };
  }

  async gradePaper({ paperId, draft, model }) {
    if (this.running)
      throw Object.assign(
        new Error("已有 Agent 任务正在运行，请稍后重试"),
        { status: 409, code: "LLM_GENERATION_BUSY" },
      );
    const paper = this.service.paperList().find((item) => item.id === paperId);
    if (!paper)
      throw Object.assign(new Error("论文题目不存在"), { status: 404 });
    // 计时考试必须在调用外部模型前后都由服务端校验，避免超时请求继续消耗模型并落库。
    this.service.assertPaperMockOpen?.(paperId);
    if (!String(draft ?? "").trim()) {
      throw Object.assign(new Error("请先撰写论文内容"), { status: 400 });
    }
    const structure = validateEssaySample(paper, draft);
    if (!structure.valid) {
      throw Object.assign(
        new Error(`论文未满足书写条件：${structure.errors.join("；")}`),
        { status: 400, code: "ESSAY_STRUCTURE_INVALID" },
      );
    }
    this.running = true;
    try {
      const graderPrompt = await readFile(
        resolve(this.root, "vendor/architect-agent/agents/paper-grader.md"),
        "utf8",
      );
      const schema = JSON.stringify({
        type: "object",
        properties: {
          total_score: { type: "integer" },
          max_score: { type: "integer" },
          dimensions: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                score: { type: "integer" },
                max: { type: "integer" },
                comment: { type: "string" },
              },
              required: ["score", "max", "comment"],
            },
          },
          overall_comment: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          recommendations: { type: "array", items: { type: "string" } },
          knowledge_points: { type: "array", items: { type: "string" } },
        },
        required: [
          "total_score",
          "max_score",
          "dimensions",
          "overall_comment",
          "strengths",
          "weaknesses",
          "recommendations",
        ],
        additionalProperties: false,
      });
      const timeoutMs = Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000;
      const userPrompt = [
        `请对以下论文进行评分。论文题目：${paper.title}`,
        `题目要求：${paper.description}`,
        paper.writingPoints?.length
          ? `写作要点：\n${paper.writingPoints.map((p) => `- ${p}`).join("\n")}`
          : "",
        "",
        "--- 考生论文开始 ---",
        String(draft),
        "--- 考生论文结束 ---",
        "请按六维度评分标准评分，只返回 JSON。",
      ]
        .filter(Boolean)
        .join("\n");
      const raw = await this.callModel({
        runtimePrompt: graderPrompt,
        userPrompt,
        schema,
        timeoutMs,
        model,
      });
      const result = parseAgentResult(raw);
      if (typeof result.total_score !== "number") {
        throw Object.assign(new Error("评分结果格式无效"), {
          status: 502,
          code: "LLM_INVALID_RESPONSE",
        });
      }
      const knowledgePoints = (Array.isArray(result.knowledge_points)
        ? result.knowledge_points
        : []
      )
        .map((p) => String(p).trim())
        .filter(Boolean)
        .slice(0, 6);
      const grade = {
        ...result,
        knowledgePoints,
        wikiEntries: this.service.matchWikiEntries(knowledgePoints),
        structureWarnings: structure.warnings,
        gradedAt: new Date().toISOString(),
      };
      delete grade.knowledge_points;
      // 截止校验已在方法入口完成；模型评分耗时可能超过宽限期，
      // 落库时跳过重复的截止检查，避免已完成评分被丢弃。
      await this.service.savePaperGrade({ paperId, grade, allowAfterDeadline: true });
      return grade;
    } finally {
      this.running = false;
    }
  }

  // 拼装案例评分提示词：案例背景 + 小问 + 参考答案 + 考生作答 + 每问满分。
  async _gradeCasePrompt({ title, scenario, questions, answers }) {
    const graderPrompt = await readFile(
      resolve(this.root, "vendor/architect-agent/agents/case-grader.md"),
      "utf8",
    );
    const schema = JSON.stringify({
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              score: { type: "integer" },
              max: { type: "integer" },
              comment: { type: "string" },
              knowledge_points: { type: "array", items: { type: "string" } },
            },
            required: ["id", "score", "max", "comment"],
            additionalProperties: false,
          },
        },
        total_score: { type: "integer" },
        max_score: { type: "integer" },
        overall_comment: { type: "string" },
      },
      required: ["results", "total_score", "max_score", "overall_comment"],
      additionalProperties: false,
    });
    const questionLines = questions.map((question, index) => {
      const userAnswer = String(answers?.[question.id] ?? "").trim();
      return [
        `【小问 ${index + 1}】（编号 ${question.id}，满分 ${question.points} 分）`,
        `题目：${question.text}`,
        `参考答案：${question.referenceAnswer || "（无参考答案，请按题意合理给分）"}`,
        `考生作答：${userAnswer || "（未作答，计 0 分）"}`,
      ].join("\n");
    });
    const userPrompt = [
      `请对以下案例作答逐问评分。案例题目：${title}`,
      `案例背景：${scenario}`,
      "",
      ...questionLines.flatMap((lines) => [lines, ""]),
      "请按得分点制逐问评分并汇总总分，只返回 JSON。",
    ].join("\n");
    return { graderPrompt, schema, userPrompt };
  }

  // 校验模型返回的逐问评分：id 与小问一一对应、score 为不超过满分的数字。
  _validateCaseGrade(result, questions, answers = {}) {
    if (!Array.isArray(result.results) || typeof result.total_score !== "number") {
      throw Object.assign(new Error("评分结果格式无效"), {
        status: 502,
        code: "LLM_INVALID_RESPONSE",
      });
    }
    const byId = new Map(
      result.results.map((item) => [String(item.id), item]),
    );
    const normalized = questions.map((question) => {
      const item = byId.get(String(question.id));
      const max = Number(question.points) || 0;
      const score = Math.max(0, Math.min(max, Number(item?.score ?? 0) || 0));
      return {
        id: question.id,
        text: question.text,
        score,
        max,
        comment: String(item?.comment ?? "").trim(),
        knowledgePoints: (Array.isArray(item?.knowledge_points) ? item.knowledge_points : [])
          .map((p) => String(p).trim())
          .filter(Boolean)
          .slice(0, 4),
        answered: Boolean(String(answers?.[question.id] ?? "").trim()),
      };
    });
    return {
      results: normalized,
      total_score: normalized.reduce((sum, item) => sum + item.score, 0),
      max_score: normalized.reduce((sum, item) => sum + item.max, 0),
      overall_comment: String(result.overall_comment ?? "").trim(),
    };
  }

  async gradeCaseWithAI({ caseItem, answers, model }) {
    if (this.running)
      throw Object.assign(
        new Error("已有 Agent 任务正在运行，请稍后重试"),
        { status: 409, code: "LLM_GENERATION_BUSY" },
      );
    this.running = true;
    try {
      const { graderPrompt, schema, userPrompt } = await this._gradeCasePrompt({
        title: caseItem.title,
        scenario: caseItem.scenario,
        questions: caseItem.questions,
        answers,
      });
      const timeoutMs = Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000;
      const raw = await this.callModel({
        runtimePrompt: graderPrompt,
        userPrompt,
        schema,
        timeoutMs,
        model,
      });
      const result = parseAgentResult(raw);
      const grade = this._validateCaseGrade(result, caseItem.questions, answers);
      // 按模型标注的命中知识点关联知识库条目，方便错题回溯到 Wiki。
      const wikiEntries = this.service.matchWikiEntries(
        grade.results.flatMap((item) => item.knowledgePoints),
      );
      const graded = {
        caseId: caseItem.id,
        title: caseItem.title,
        ...grade,
        wikiEntries,
        gradedAt: new Date().toISOString(),
      };
      // 与模拟卷判分对齐：单案例评分也持久化，刷新后可回看。
      await this.service.saveCaseGrade({ caseId: caseItem.id, grade: graded });
      return graded;
    } finally {
      this.running = false;
    }
  }

  // 案例模拟卷交卷：整卷一次性送模型评分，并持久化到模拟卷记录。
  async gradeCaseExam({ exam, cases, model }) {
    if (this.running)
      throw Object.assign(
        new Error("已有 Agent 任务正在运行，请稍后重试"),
        { status: 409, code: "LLM_GENERATION_BUSY" },
      );
    this.running = true;
    try {
      const perCase = [];
      for (const caseItem of cases) {
        const answers = exam.drafts?.[caseItem.id] ?? {};
        const { graderPrompt, schema, userPrompt } = await this._gradeCasePrompt(
          {
            title: caseItem.title,
            scenario: caseItem.scenario,
            questions: caseItem.questions,
            answers,
          },
        );
        const timeoutMs =
          Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000;
        const raw = await this.callModel({
          runtimePrompt: graderPrompt,
          userPrompt,
          schema,
          timeoutMs,
          model,
        });
        const result = parseAgentResult(raw);
        const validated = this._validateCaseGrade(
          result,
          caseItem.questions,
          answers,
        );
        const wikiEntries = this.service.matchWikiEntries(
          validated.results.flatMap((item) => item.knowledgePoints),
        );
        perCase.push({
          caseId: caseItem.id,
          title: caseItem.title,
          ...validated,
          wikiEntries,
        });
      }
      const grade = {
        cases: perCase,
        total_score: perCase.reduce((sum, item) => sum + item.total_score, 0),
        max_score: perCase.reduce((sum, item) => sum + item.max_score, 0),
        gradedAt: new Date().toISOString(),
      };
      await this.service.saveCaseExamGrade({ examId: exam.id, grade });
      return grade;
    } finally {
      this.running = false;
    }
  }

  // 知识库问答：先让模型从条目标题里挑相关条目，再基于选中条目作答并返回引用。
  async answerFromWiki({ question, model }) {
    if (this.running)
      throw Object.assign(
        new Error("已有 Agent 任务正在运行，请稍后重试"),
        { status: 409, code: "LLM_GENERATION_BUSY" },
      );
    const trimmed = String(question ?? "").trim();
    if (!trimmed) {
      throw Object.assign(new Error("请先输入问题"), { status: 400 });
    }
    const entries = this.service.wikiList();
    if (!entries.length) {
      throw Object.assign(
        new Error("知识库还是空的，请先生成知识点条目"),
        { status: 400 },
      );
    }
    this.running = true;
    try {
      const qaPrompt = await readFile(
        resolve(this.root, "vendor/architect-agent/agents/wiki-qa.md"),
        "utf8",
      );
      const timeoutMs =
        Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000;
      // 第一阶段：只挑条目，不答题。相关条目最多 5 个，控制上下文规模。
      const selectionRaw = await this.callModel({
        runtimePrompt: `${qaPrompt}\n\n运行时约束：本次调用是选题阶段，只负责从标题清单里挑出与问题相关的条目标题，不要回答问题本身。`,
        userPrompt: [
          `考生问题：${trimmed}`,
          "已有知识点条目标题：",
          ...entries.map((entry) => `- ${entry.title}`),
          '请只返回一个 JSON 对象：{"titles":["与问题最相关的条目标题原文"]}，最多 5 个；没有相关条目就返回空数组。',
        ].join("\n"),
        schema: JSON.stringify({
          type: "object",
          properties: { titles: { type: "array", items: { type: "string" } } },
          required: ["titles"],
          additionalProperties: false,
        }),
        timeoutMs,
        model,
      });
      const selection = parseAgentResult(selectionRaw);
      const titles = (Array.isArray(selection.titles) ? selection.titles : [])
        .map((title) => String(title).trim())
        .filter(Boolean)
        .slice(0, 5);
      // 标题解析走统一入口（精确 → 包含 → 相似度），并对同一去重。
      const picked = [];
      const seenIds = new Set();
      for (const title of titles) {
        const entry = this.service.resolveWikiEntry(title, { entries });
        if (entry && !seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          picked.push(entry);
        }
      }
      if (!picked.length) {
        return {
          question: trimmed,
          answer:
            "知识库中暂无与该问题相关的条目，请先在知识库页生成对应章节的知识点，再来提问。",
          references: [],
        };
      }
      // 第二阶段：基于选中条目的全文作答。
      const context = picked
        .map((entry) =>
          [
            `【条目】${entry.title}（第 ${entry.chapter} 章）`,
            `概念解释：${entry.summary}`,
            entry.keyPoints?.length
              ? `关键要点：\n${entry.keyPoints.map((p) => `- ${p}`).join("\n")}`
              : "",
            entry.commonMistakes?.length
              ? `常见误区：\n${entry.commonMistakes.map((p) => `- ${p}`).join("\n")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        )
        .join("\n\n");
      const answerRaw = await this.callModel({
        runtimePrompt: qaPrompt,
        userPrompt: [
          `考生问题：${trimmed}`,
          "只允许依据下面的知识库条目作答，引用条目时写出条目标题。",
          "",
          "--- 知识库条目开始 ---",
          context,
          "--- 知识库条目结束 ---",
          "请给出面向考生的简洁解答；条目未覆盖的内容要明确说明。",
        ].join("\n"),
        schema: JSON.stringify({
          type: "object",
          properties: {
            answer: { type: "string" },
            used_titles: { type: "array", items: { type: "string" } },
          },
          required: ["answer", "used_titles"],
          additionalProperties: false,
        }),
        timeoutMs,
        model,
      });
      const answerResult = parseAgentResult(answerRaw);
      const answer = String(answerResult.answer ?? "").trim();
      const usedTitles = (
        Array.isArray(answerResult.used_titles) ? answerResult.used_titles : []
      )
        .map((title) => String(title).trim())
        .filter(Boolean);
      const references = this.service.matchWikiEntries(
        usedTitles.length ? usedTitles : picked.map((entry) => entry.title),
        5,
      );
      return { question: trimmed, answer, references };
    } finally {
      this.running = false;
    }
  }

  resolveAgentRuntime({ agentId, model } = {}) {
    if (!agentId && this.modelConfig) {
      const workspace = this.modelConfig.workspace();
      agentId = workspace.agents.find((agent) => agent.id === workspace.defaultAgentId && agent.enabled)?.id
        || workspace.agents.find((agent) => agent.enabled)?.id;
    }
    if (agentId && this.modelConfig) {
      const workspace = this.modelConfig.workspace();
      const agent = workspace.agents.find((item) => item.id === agentId && item.enabled);
      if (!agent) {
        throw Object.assign(new Error("所选 Agent 不存在或已停用"), {
          status: 400,
          code: "AGENT_NOT_AVAILABLE",
        });
      }
      const provider = workspace.providers.find((item) => item.id === agent.providerId);
      if (!provider) {
        throw Object.assign(new Error("Agent 绑定的模型供应商不存在"), {
          status: 400,
          code: "AGENT_PROVIDER_NOT_FOUND",
        });
      }
      return {
        agent,
        provider,
        model: model || agent.model || provider.defaultModel || provider.models[0] || "",
      };
    }
    return {
      agent: null,
      provider: {
        type: process.env.ARCHITECT_LLM_PROVIDER === "claude-cli" ? "claude-cli" : "openai-compatible",
        baseUrl: process.env.ARCHITECT_LLM_BASE_URL || "",
        apiKey: process.env.ARCHITECT_LLM_API_KEY || "",
      },
      model: model || process.env.ARCHITECT_LLM_MODEL || "",
    };
  }

  async callModel({ runtimePrompt, userPrompt, schema, timeoutMs, model, agentId, signal }) {
    const runtime = this.resolveAgentRuntime({ agentId, model });
    if (runtime.provider.baseUrl && runtime.provider.type !== "claude-cli") {
      const selectedModel = runtime.model;
      if (!selectedModel) {
        throw Object.assign(
          new Error("请为当前 Agent 配置默认模型"),
          { status: 503, code: "LLM_NOT_CONFIGURED" },
        );
      }
      return callOpenAiCompatible({
        baseUrl: runtime.provider.baseUrl,
        apiKey: runtime.provider.apiKey,
        model: selectedModel,
        systemPrompt: [runtime.agent?.systemPrompt, runtimePrompt].filter(Boolean).join("\n\n"),
        userPrompt,
        timeoutMs,
        signal,
      });
    }
    if (runtime.provider.type === "claude-cli") {
      return run(
        process.env.ARCHITECT_CLAUDE_COMMAND || "claude",
        [
          "--print",
          "--output-format",
          "json",
          "--system-prompt",
          [runtime.agent?.systemPrompt, runtimePrompt].filter(Boolean).join("\n\n"),
          "--json-schema",
          schema,
          userPrompt,
        ],
        { timeoutMs, signal },
      );
    }
    throw Object.assign(
      new Error("大模型尚未配置，请在数据管理中配置供应商和 Agent"),
      { status: 503, code: "LLM_NOT_CONFIGURED" },
    );
  }

  async runAgentTask({
    prompt,
    strategy = "single",
    agentIds = [],
    judgeAgentId,
    signal,
  } = {}) {
    throwIfAborted(signal);
    const trimmedPrompt = String(prompt ?? "").trim();
    if (!trimmedPrompt) {
      throw Object.assign(new Error("请先输入任务内容"), { status: 400, code: "AGENT_PROMPT_REQUIRED" });
    }
    if (trimmedPrompt.length > 16_000) {
      throw Object.assign(new Error("任务内容不能超过 16000 个字符"), { status: 413, code: "AGENT_PROMPT_TOO_LARGE" });
    }
    if (!["single", "parallel", "battle"].includes(strategy)) {
      throw Object.assign(new Error("未知的 Agent 协作策略"), { status: 400, code: "AGENT_STRATEGY_INVALID" });
    }
    if (this.running) {
      throw Object.assign(new Error("已有 Agent 任务正在运行，请稍后重试"), { status: 409, code: "LLM_GENERATION_BUSY" });
    }
    const workspace = this.modelConfig?.workspace?.() ?? { agents: [] };
    const enabledAgents = workspace.agents.filter((agent) => agent.enabled);
    const requestedIds = Array.isArray(agentIds) ? agentIds.map(String) : [];
    const selectedAgents = enabledAgents.filter((agent) => requestedIds.includes(agent.id));
    const agents = selectedAgents.length
      ? selectedAgents
      : [enabledAgents.find((agent) => agent.id === workspace.defaultAgentId) || enabledAgents[0]].filter(Boolean);
    if (!agents.length) {
      throw Object.assign(new Error("请先配置并启用至少一个 Agent"), { status: 400, code: "AGENT_NOT_CONFIGURED" });
    }
    if (strategy !== "single" && agents.length < 2) {
      throw Object.assign(new Error("并行或对战至少需要选择两个已启用的 Agent"), { status: 400, code: "AGENT_COLLABORATION_REQUIRES_TWO" });
    }
    const callAgent = async (agent, taskPrompt = trimmedPrompt) => {
      throwIfAborted(signal);
      const raw = await this.callModel({
        agentId: agent.id,
        runtimePrompt: "你正在参与一个受控的 Agent 协作任务。请只根据任务内容作答，区分事实、推断和不确定性。",
        userPrompt: taskPrompt,
        schema: JSON.stringify({
          type: "object",
          properties: {
            answer: { type: "string" },
            confidence: { type: "number" },
            key_points: { type: "array", items: { type: "string" } },
            concerns: { type: "array", items: { type: "string" } },
          },
          required: ["answer", "confidence", "key_points", "concerns"],
          additionalProperties: false,
        }),
        timeoutMs: Number(process.env.ARCHITECT_AGENT_TIMEOUT_MS) || 600_000,
        signal,
      });
      throwIfAborted(signal);
      const result = parseAgentResult(raw);
      return {
        agentId: agent.id,
        agentName: agent.name,
        model: this.resolveAgentRuntime({ agentId: agent.id }).model,
        answer: String(result.answer || "").trim(),
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
        keyPoints: Array.isArray(result.key_points) ? result.key_points.map(String).filter(Boolean) : [],
        concerns: Array.isArray(result.concerns) ? result.concerns.map(String).filter(Boolean) : [],
      };
    };
    this.running = true;
    try {
      const settled = await Promise.allSettled(
        (strategy === "single" ? agents.slice(0, 1) : agents.slice(0, 4)).map((agent) => callAgent(agent)),
      );
      throwIfAborted(signal);
      const results = settled.map((item, index) =>
        item.status === "fulfilled"
          ? item.value
          : { agentId: agents[index].id, agentName: agents[index].name, error: item.reason?.message || "调用失败" },
      );
      const successful = results.filter((result) => !result.error);
      if (!successful.length) {
        throw Object.assign(new Error("所有选中的 Agent 都调用失败"), { status: 502, code: "AGENT_ALL_FAILED" });
      }
      let synthesis = null;
      if (strategy === "battle" && successful.length >= 2) {
        throwIfAborted(signal);
        const judge = enabledAgents.find((agent) => agent.id === judgeAgentId) || agents[0];
        const comparison = successful
          .map((result) => `【${result.agentName}】\n${result.answer}\n关注点：${result.concerns.join("；")}`)
          .join("\n\n");
        const judged = await callAgent(
          judge,
          `${trimmedPrompt}\n\n请评审以下多个候选答案，指出各自优缺点，给出一个综合后的最终答案。\n${comparison}`,
        );
        throwIfAborted(signal);
        synthesis = { ...judged, mode: "battle", judgedBy: judge.name };
      }
      return { strategy, results, synthesis };
    } finally {
      this.running = false;
    }
  }

  async generateWiki({ chapter, section = "all", count = 5, model, signal }) {
    const size = Math.max(1, Math.min(20, Number(count) || 5));
    // 把已有条目标题喂给模型，让 related 优先引用现有条目，形成可解析的双链。
    // 全量注入：语料规模下成本可忽略，截断会让后建章节看不到早期标题。
    const existingTitles = this.service
      .wikiList()
      .map((entry) => entry.title)
      .filter(Boolean);
    const { accepted, duplicatesSkipped, material, chapterId } =
      await this.runGenerationFlow({
      chapter,
      section,
      size,
      model,
      signal,
      arrayKey: "entries",
      agentFile: "vendor/architect-agent/agents/wiki-agent.md",
      taskLabel: "个知识点 Wiki 条目",
      runtimeConstraint: "严格遵守用户消息指定的章节和数量。",
      extraUserLines: [
        "每个条目必须包含 source_node：该知识点所依据的思维导图节点标题（必须是复习资料中出现的节点标题原文）。",
        existingTitles.length
          ? `已有知识点条目标题：${existingTitles.join("、")}。related 优先从中选取并使用标题原文，不要为同一知识点重复建页；遇到同名歧义必须拆成两个不同标题的条目并互相引用。`
          : "",
      ],
      schema: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            minItems: 1,
            maxItems: size,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                key_points: { type: "array", items: { type: "string" } },
                common_mistakes: { type: "array", items: { type: "string" } },
                related: { type: "array", items: { type: "string" } },
                source_node: { type: "string" },
              },
              required: [
                "title",
                "summary",
                "key_points",
                "common_mistakes",
                "related",
                "source_node",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["entries"],
        additionalProperties: false,
      },
      persist: (entries, material, chapterId, signal) =>
        this.service.addWikiEntries({
          chapter: chapterId,
          section: material.section,
          entries,
          sourceNode: material.sourceNode,
          signal,
        }),
    });
    return {
      added: accepted.length,
      requested: size,
      duplicatesSkipped,
      chapter: chapterId,
      section: material.section || "all",
    };
  }

  async extractMaterial(chapter, section = "all") {
    const mindMapPath = resolve(
      this.root,
      process.env.ARCHITECT_MINDMAP || "architect.mm",
    );
    const mindMap = await readMindMap(mindMapPath);
    if (!mindMap) {
      throw Object.assign(new Error("未找到 architect.mm，不能生成题目"), {
        status: 409,
        code: "MINDMAP_NOT_FOUND",
      });
    }
    const chapterNode = findChapter(mindMap, chapter.id);
    if (!chapterNode) {
      throw Object.assign(
        new Error(`第 ${chapter.id} 章尚未加入思维导图，请先完成该章导图`),
        { status: 409, code: "MINDMAP_CHAPTER_MISSING" },
      );
    }
    const sectionId = section === "all" || !section ? null : String(section);
    const sectionNode = sectionId ? findSection(chapterNode, sectionId) : null;
    if (sectionId && !sectionNode) {
      throw Object.assign(new Error(`第 ${sectionId} 小节尚未加入思维导图`), {
        status: 409,
        code: "MINDMAP_SECTION_MISSING",
      });
    }
    const contentNode = sectionNode || chapterNode;
    const text = chapterOutline(contentNode);
    if (!text.trim()) {
      throw Object.assign(
        new Error(`第 ${chapter.id} 章思维导图没有可用内容`),
        { status: 409, code: "MINDMAP_CHAPTER_EMPTY" },
      );
    }
    return {
      source: "mindmap",
      section: sectionId,
      sourceNode: chapterNode,
      scopeNode: contentNode,
      text: text.slice(0, MAX_SOURCE_CHARACTERS),
    };
  }
}
