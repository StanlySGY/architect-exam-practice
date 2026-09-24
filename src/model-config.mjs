import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// 模型配置管理：读写 .env 中的模型相关配置，并同步到 process.env 使运行时立即生效。
// 界面保存的配置优先于启动时已有的同名环境变量。

const MODEL_KEYS = [
  "RUANKAO_LLM_BASE_URL",
  "RUANKAO_LLM_API_KEY",
  "RUANKAO_LLM_MODEL",
  "RUANKAO_LLM_MODELS",
  "RUANKAO_LLM_PROVIDER",
  "RUANKAO_CLAUDE_COMMAND",
];

export class ModelConfig {
  constructor({ root = process.cwd() } = {}) {
    this.root = root;
    this.envFile = resolve(root, ".env");
  }

  // 读取当前生效的模型配置（合并 .env 与 process.env，process.env 优先）。
  read() {
    const config = {};
    for (const key of MODEL_KEYS) {
      config[key] = process.env[key] ?? "";
    }
    return config;
  }

  // 保存模型配置：写入 .env 并同步 process.env。
  async save(updates) {
    const current = this.read();
    const merged = { ...current, ...updates };
    // 空值表示清除该配置项。
    for (const key of MODEL_KEYS) {
      if (merged[key] === undefined) merged[key] = "";
    }
    await this.writeEnv(merged);
    // 同步到 process.env，使运行时立即生效。
    for (const key of MODEL_KEYS) {
      if (merged[key]) process.env[key] = merged[key];
      else delete process.env[key];
    }
    return this.read();
  }

  async writeEnv(config) {
    let contents = "";
    try {
      contents = await readFile(this.envFile, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const lines = contents.split(/\r?\n/);
    const seen = new Set();
    const output = [];
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match && MODEL_KEYS.includes(match[1])) {
        seen.add(match[1]);
        const value = config[match[1]];
        if (value) output.push(`${match[1]}=${value}`);
        continue;
      }
      output.push(line);
    }
    for (const key of MODEL_KEYS) {
      if (!seen.has(key) && config[key]) {
        output.push(`${key}=${config[key]}`);
      }
    }
    await writeFile(this.envFile, output.join("\n").replace(/\n+$/, "") + "\n");
  }

  // 调用 OpenAI 兼容的 /models 端点获取可用模型列表。
  async fetchModels({ baseUrl, apiKey }) {
    if (!baseUrl) {
      throw Object.assign(new Error("请先填写 Base URL"), { status: 400 });
    }
    const normalized = baseUrl.replace(/\/+$/, "");
    const modelsUrl = normalized.endsWith("/chat/completions")
      ? normalized.replace(/\/chat\/completions$/, "/models")
      : `${normalized}/models`;
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(modelsUrl, {
        method: "GET",
        signal: controller.signal,
        headers,
      });
      if (!response.ok) {
        throw Object.assign(
          new Error(`获取模型列表失败（HTTP ${response.status}）`),
          { status: 502 },
        );
      }
      const body = await response.json().catch(() => ({}));
      const models = Array.isArray(body.data)
        ? body.data.map((item) => item.id).filter(Boolean)
        : [];
      return { models, endpoint: modelsUrl };
    } catch (error) {
      if (error.name === "AbortError") {
        throw Object.assign(new Error("获取模型列表超时"), { status: 504 });
      }
      if (error instanceof TypeError && error.message === "fetch failed") {
        throw Object.assign(new Error("无法连接模型接口，请检查 Base URL"), {
          status: 503,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}