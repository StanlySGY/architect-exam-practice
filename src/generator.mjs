import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chapterOutline,
  findChapter,
  findSection,
  readMindMap,
} from "./mindmap.mjs";

const MAX_SOURCE_CHARACTERS = 120_000;

function loadDotEnv(root) {
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

function classifyModelHttpError(status, fallback) {
  if (status === 401 || status === 403) {
    return modelError("模型接口鉴权失败，请检查 RUANKAO_LLM_API_KEY", {
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

async function callOpenAiCompatible({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
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
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw classifyModelHttpError(response.status, body.error?.message);
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw modelError("模型接口返回为空，请检查模型配置或稍后重试", {
        status: 502,
        code: "LLM_EMPTY_RESPONSE",
      });
    }
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw modelError(
        "模型接口请求超时，请检查网络或增大 RUANKAO_AGENT_TIMEOUT_MS",
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
  }
}

function run(command, args, { input, timeoutMs = 300_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        modelError(`${command} 执行超时，请检查模型命令或增大超时时间`, {
          status: 504,
          code: "LLM_TIMEOUT",
        }),
      );
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
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
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          Object.assign(
            modelError(
              `${command} 执行失败：${Buffer.concat(stderr).toString("utf8").trim() || "未提供错误详情"}`,
              { status: 502, code: "LLM_PROVIDER_FAILED" },
            ),
          ),
        );
        return;
      }
      resolvePromise(Buffer.concat(stdout).toString("utf8"));
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
  constructor({ root = process.cwd(), service }) {
    this.root = root;
    loadDotEnv(root);
    this.service = service;
    this.running = false;
  }

  async generate({ chapter, section = "all", difficulty, count = 10 }) {
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
      const agentPrompt = await readFile(
        resolve(this.root, "vendor/ruankao-agent/agents/mcq-agent.md"),
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
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      });
      const timeoutMs = Number(process.env.RUANKAO_AGENT_TIMEOUT_MS) || 600_000;
      const runtimePrompt = `${agentPrompt}\n\n运行时约束：本程序的唯一资料来源是 ruankao.mm 思维导图。忽略上游提示中关于读取 PDF、生成 75 道全卷题目的要求，严格遵守用户消息指定的章节、难度和数量。`;
      const added = [];
      let duplicatesSkipped = 0;
      const maxAttempts = 3;
      for (
        let attempt = 1;
        attempt <= maxAttempts && added.length < size;
        attempt += 1
      ) {
        const remaining = size - added.length;
        const previousQuestions = this.service
          .generatedQuestionPrompts(chapterId)
          .map((question, index) => `${index + 1}. ${question.slice(0, 240)}`)
          .join("\n");
        const userPrompt = [
          `请为《系统架构设计师教程（第2版）》第 ${chapterId} 章“${selected.title}”${section === "all" ? "" : `的小节“${section}”`}生成 ${remaining} 道 ${difficulty} 难度的四选一选择题。`,
          "资料来源：ruankao.mm 思维导图。",
          "只允许依据下面的复习资料。不要生成资料未覆盖的事实。",
          "题干及选项组合不得与历史题目相同或仅做同义改写；应更换知识切入点、情境或考查方式。",
          "上游提示中的“75 道”和全书题型分布在本次章节练习中不适用；以本消息指定的数量、章节和难度为准。",
          "解析必须说明正确选项，并逐项解释主要干扰项。",
          "只返回一个 JSON 对象，不要输出 Markdown、代码围栏、文件说明或其他文字。JSON 顶层必须是 questions 数组，每道题必须包含 question、options、knowledge_point、correct_answer、analysis、knowledge_detail、common_mistake、memory_tip。",
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
        if (process.env.RUANKAO_LLM_BASE_URL) {
          if (!process.env.RUANKAO_LLM_MODEL) {
            throw Object.assign(
              new Error("请在 .env 中配置 RUANKAO_LLM_MODEL"),
              {
                status: 503,
                code: "LLM_NOT_CONFIGURED",
              },
            );
          }
          raw = await callOpenAiCompatible({
            baseUrl: process.env.RUANKAO_LLM_BASE_URL,
            apiKey: process.env.RUANKAO_LLM_API_KEY,
            model: process.env.RUANKAO_LLM_MODEL,
            systemPrompt: runtimePrompt,
            userPrompt,
            timeoutMs,
          });
        } else if (process.env.RUANKAO_LLM_PROVIDER === "claude-cli") {
          raw = await run(
            process.env.RUANKAO_CLAUDE_COMMAND || "claude",
            [
              "--print",
              "--output-format",
              "json",
              "--system-prompt",
              runtimePrompt,
              "--json-schema",
              schema,
              userPrompt,
            ],
            { timeoutMs },
          );
        } else {
          throw Object.assign(
            new Error("大模型尚未配置，请编辑项目根目录的 .env 后重启服务"),
            { status: 503, code: "LLM_NOT_CONFIGURED" },
          );
        }
        const result = parseAgentResult(raw);
        if (!Array.isArray(result.questions)) {
          throw Object.assign(new Error("Agent 返回结果缺少 questions 数组"), {
            status: 502,
            code: "LLM_INVALID_RESPONSE",
          });
        }
        const candidates = this.service
          .filterUniqueGeneratedQuestions(chapterId, result.questions)
          .slice(0, remaining);
        duplicatesSkipped += result.questions.length - candidates.length;
        const accepted = await this.service.addGeneratedQuestions({
          chapter: chapterId,
          difficulty,
          questions: candidates,
          section: material.section,
          source: material.source,
        });
        duplicatesSkipped += candidates.length - accepted.length;
        added.push(...accepted);
      }
      return {
        added: added.length,
        requested: size,
        duplicatesSkipped,
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

  modelStatus() {
    if (process.env.RUANKAO_LLM_BASE_URL && process.env.RUANKAO_LLM_MODEL) {
      let endpoint = process.env.RUANKAO_LLM_BASE_URL;
      try {
        const url = new URL(endpoint);
        endpoint = `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        endpoint = "已配置";
      }
      return {
        configured: true,
        provider: "openai-compatible",
        model: process.env.RUANKAO_LLM_MODEL,
        endpoint,
      };
    }
    if (process.env.RUANKAO_LLM_PROVIDER === "claude-cli") {
      return { configured: true, provider: "claude-cli", model: "Claude CLI" };
    }
    return { configured: false, provider: null, model: null };
  }

  async extractMaterial(chapter, section = "all") {
    const mindMapPath = resolve(
      this.root,
      process.env.RUANKAO_MINDMAP || "ruankao.mm",
    );
    const mindMap = await readMindMap(mindMapPath);
    if (!mindMap) {
      throw Object.assign(new Error("未找到 ruankao.mm，不能生成题目"), {
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
    const sourceNode = sectionNode || chapterNode;
    const text = chapterOutline(sourceNode);
    if (!text.trim()) {
      throw Object.assign(
        new Error(`第 ${chapter.id} 章思维导图没有可用内容`),
        { status: 409, code: "MINDMAP_CHAPTER_EMPTY" },
      );
    }
    return {
      source: "mindmap",
      section: sectionId,
      text: text.slice(0, MAX_SOURCE_CHARACTERS),
    };
  }
}
