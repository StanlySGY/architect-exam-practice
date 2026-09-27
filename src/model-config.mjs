import { readFile, writeFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";
import {
  isAllowedHost,
  isBlockedHostname,
  isPrivateAddress,
  normalizeHost,
  parseAllowedHosts,
} from "./security.mjs";

// 模型配置管理：读写 .env 中的模型相关配置，并同步到 process.env 使运行时立即生效。
// 界面保存的配置优先于启动时已有的同名环境变量。

const MODEL_KEYS = [
  "ARCHITECT_LLM_BASE_URL",
  "ARCHITECT_LLM_API_KEY",
  "ARCHITECT_LLM_MODEL",
  "ARCHITECT_LLM_MODELS",
  "ARCHITECT_LLM_PROVIDER",
  "ARCHITECT_LLM_PROVIDERS",
  "ARCHITECT_LLM_AGENTS",
  "ARCHITECT_LLM_DEFAULT_AGENT",
  "ARCHITECT_CLAUDE_COMMAND",
];

const MASK_PREFIX = "********";
const MAX_MODEL_RESPONSE_BYTES = 1_000_000;
const MAX_MODEL_LIST_LENGTH = 500;

function requestPinnedModelList(url, address, headers, timeoutMs = 30_000) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { ...headers, host: url.host },
        ...(url.protocol === "https:" ? { servername: normalizeHost(url.hostname) } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_MODEL_RESPONSE_BYTES && !settled) {
            settled = true;
            request.destroy();
            rejectRequest(Object.assign(new Error("模型列表响应过大"), {
              status: 502,
              code: "MODEL_RESPONSE_TOO_LARGE",
            }));
            return;
          }
          if (!settled) chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks).toString("utf8");
          const headersMap = new Map(
            Object.entries(response.headers).map(([key, value]) => [
              key.toLowerCase(),
              Array.isArray(value) ? value.join(",") : String(value ?? ""),
            ]),
          );
          resolveRequest({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: { get: (name) => headersMap.get(String(name).toLowerCase()) ?? null },
            body: null,
            text: async () => body,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      request.destroy();
      rejectRequest(Object.assign(new Error("模型列表请求超时"), {
        name: "AbortError",
      }));
    });
    request.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectRequest(error);
    });
    request.end();
  });
}

export function isMaskedSecret(value) {
  return typeof value === "string" && value.startsWith(MASK_PREFIX);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter(Boolean))];
}

function makeId(prefix, index) {
  return `${prefix}-${index + 1}`;
}

export class ModelConfig {
  constructor({ root = process.cwd(), lookup = dnsLookup, fetchImpl = null } = {}) {
    this.root = root;
    this.envFile = resolve(root, ".env");
    this.lookup = lookup;
    this.fetch = fetchImpl;
  }

  // 读取当前生效的模型配置（合并 .env 与 process.env，process.env 优先）。
  read() {
    const config = {};
    for (const key of MODEL_KEYS) {
      config[key] = process.env[key] ?? "";
    }
    return config;
  }

  legacyProvider(config = this.read()) {
    const models = uniqueStrings(
      config.ARCHITECT_LLM_MODELS
        ? config.ARCHITECT_LLM_MODELS.split(",")
        : [config.ARCHITECT_LLM_MODEL],
    );
    if (!config.ARCHITECT_LLM_BASE_URL && !config.ARCHITECT_LLM_API_KEY && !config.ARCHITECT_LLM_MODEL && config.ARCHITECT_LLM_PROVIDER !== "claude-cli") {
      return null;
    }
    return {
      id: "legacy-provider",
      name: config.ARCHITECT_LLM_PROVIDER === "claude-cli" ? "Claude CLI" : "兼容 .env 供应商",
      type: config.ARCHITECT_LLM_PROVIDER === "claude-cli" ? "claude-cli" : "openai-compatible",
      baseUrl: config.ARCHITECT_LLM_BASE_URL || "",
      apiKey: config.ARCHITECT_LLM_API_KEY || "",
      models,
      defaultModel: config.ARCHITECT_LLM_MODEL || models[0] || "",
    };
  }

  workspace() {
    const config = this.read();
    const configuredProviders = parseJson(config.ARCHITECT_LLM_PROVIDERS, []);
    const configuredAgents = parseJson(config.ARCHITECT_LLM_AGENTS, []);
    const legacy = this.legacyProvider(config);
    const providers = (Array.isArray(configuredProviders) ? configuredProviders : [])
      .map((provider, index) => this.normalizeProvider(provider, index))
      .filter(Boolean);
    if (!providers.length && legacy) providers.push(legacy);
    const agents = (Array.isArray(configuredAgents) ? configuredAgents : [])
      .map((agent, index) => this.normalizeAgent(agent, index, providers))
      .filter(Boolean);
    if (!agents.length && providers.length) {
      agents.push({
        id: "default-agent",
        name: "默认答题 Agent",
        description: "沿用现有模型配置的单 Agent 工作流",
        providerId: providers[0].id,
        model: providers[0].defaultModel || providers[0].models[0] || "",
        systemPrompt: "你是一个严谨的系统架构设计师备考助教。先给出结论，再列出依据和不确定性。",
        enabled: true,
      });
    }
    const defaultAgent = agents.find(
      (agent) => agent.id === config.ARCHITECT_LLM_DEFAULT_AGENT && agent.enabled,
    ) || agents.find((agent) => agent.enabled) || agents[0];
    return {
      providers,
      agents,
      defaultAgentId: defaultAgent?.id || "",
    };
  }

  normalizeProvider(provider, index = 0) {
    if (!provider || typeof provider !== "object") return null;
    const id = String(provider.id || makeId("provider", index)).trim();
    const models = uniqueStrings(provider.models);
    const defaultModel = String(provider.defaultModel || provider.model || models[0] || "").trim();
    return {
      id,
      name: String(provider.name || provider.label || `供应商 ${index + 1}`).trim(),
      type: provider.type === "claude-cli" ? "claude-cli" : "openai-compatible",
      baseUrl: String(provider.baseUrl || "").trim(),
      apiKey: String(provider.apiKey || "").trim(),
      models: uniqueStrings([...models, defaultModel]),
      defaultModel,
    };
  }

  normalizeAgent(agent, index = 0, providers = []) {
    if (!agent || typeof agent !== "object") return null;
    const providerId = String(agent.providerId || providers[0]?.id || "").trim();
    if (!providerId) return null;
    return {
      id: String(agent.id || makeId("agent", index)).trim(),
      name: String(agent.name || `Agent ${index + 1}`).trim(),
      description: String(agent.description || "").trim(),
      providerId,
      model: String(agent.model || "").trim(),
      systemPrompt: String(agent.systemPrompt || "").trim(),
      enabled: agent.enabled !== false,
    };
  }

  publicWorkspace() {
    const workspace = this.workspace();
    return {
      defaultAgentId: workspace.defaultAgentId,
      providers: workspace.providers.map((provider) => ({
        ...provider,
        apiKey: provider.apiKey
          ? provider.apiKey.length > 4
            ? `${MASK_PREFIX}${provider.apiKey.slice(-4)}`
            : MASK_PREFIX
          : "",
      })),
      agents: workspace.agents,
    };
  }

  providerCredentials(providerId, updates = {}) {
    const provider = this.workspace().providers.find((item) => item.id === providerId);
    if (!provider) return updates;
    return {
      ...provider,
      ...updates,
      apiKey: isMaskedSecret(updates.apiKey) ? provider.apiKey : updates.apiKey ?? provider.apiKey,
    };
  }

  // 对外展示用：API Key 只返回掩码，不回传明文。
  publicConfig(config = this.read()) {
    const masked = { ...config };
    const key = masked.ARCHITECT_LLM_API_KEY;
    if (key) {
      masked.ARCHITECT_LLM_API_KEY =
        key.length > 4 ? `${MASK_PREFIX}${key.slice(-4)}` : MASK_PREFIX;
    }
    delete masked.ARCHITECT_LLM_PROVIDERS;
    delete masked.ARCHITECT_LLM_AGENTS;
    delete masked.ARCHITECT_LLM_DEFAULT_AGENT;
    delete masked.ARCHITECT_CLAUDE_COMMAND;
    Object.assign(masked, this.publicWorkspace());
    return masked;
  }

  // 保存模型配置：写入 .env 并同步 process.env。
  // 掩码值表示"未修改"，保留已存储的密钥。
  async save(updates) {
    const current = this.read();
    const normalized = { ...updates };
    if (
      Object.hasOwn(normalized, "ARCHITECT_CLAUDE_COMMAND") &&
      normalized.ARCHITECT_CLAUDE_COMMAND !== current.ARCHITECT_CLAUDE_COMMAND
    ) {
      throw Object.assign(new Error("Claude CLI 路径只能通过启动环境配置"), {
        status: 403,
        code: "MODEL_COMMAND_IMMUTABLE",
      });
    }
    // HTTP 配置不能改变执行路径；保留启动时读取到的值供本地 CLI 模式使用。
    delete normalized.ARCHITECT_CLAUDE_COMMAND;
    if (isMaskedSecret(normalized.ARCHITECT_LLM_API_KEY)) {
      normalized.ARCHITECT_LLM_API_KEY = current.ARCHITECT_LLM_API_KEY;
    }
    const merged = { ...current, ...normalized };
    for (const key of MODEL_KEYS) {
      if (merged[key] !== undefined && typeof merged[key] !== "string") {
        throw Object.assign(new Error(`${key} 必须是字符串`), {
          status: 400,
          code: "MODEL_CONFIG_INVALID",
        });
      }
      if (typeof merged[key] === "string" && /[\r\n]/.test(merged[key])) {
        throw Object.assign(new Error(`${key} 不能包含换行`), {
          status: 400,
          code: "MODEL_CONFIG_INVALID",
        });
      }
      if (typeof merged[key] === "string" && merged[key].length > 200_000) {
        throw Object.assign(new Error(`${key} 配置过长`), {
          status: 413,
          code: "MODEL_CONFIG_TOO_LARGE",
        });
      }
    }
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

  async saveWorkspace(input = {}) {
    const current = this.workspace();
    const rawProviders = Array.isArray(input.providers) ? input.providers : current.providers;
    const providers = rawProviders
      .map((provider, index) => {
        const normalized = this.normalizeProvider(provider, index);
        const previous = current.providers.find((item) => item.id === normalized?.id);
        if (!normalized) return null;
        if (isMaskedSecret(normalized.apiKey)) normalized.apiKey = previous?.apiKey || "";
        return normalized;
      })
      .filter(Boolean);
    const agents = (Array.isArray(input.agents) ? input.agents : current.agents)
      .map((agent, index) => this.normalizeAgent(agent, index, providers))
      .filter((agent) => providers.some((provider) => provider.id === agent.providerId));
    if (!providers.length) {
      throw Object.assign(new Error("至少保留一个模型供应商"), { status: 400, code: "MODEL_PROVIDER_REQUIRED" });
    }
    if (!agents.length) {
      throw Object.assign(new Error("至少保留一个 Agent"), { status: 400, code: "MODEL_AGENT_REQUIRED" });
    }
    const defaultAgentId = agents.some((agent) => agent.id === input.defaultAgentId && agent.enabled)
      ? input.defaultAgentId
      : agents.find((agent) => agent.enabled)?.id || agents[0].id;
    const defaultAgent = agents.find((agent) => agent.id === defaultAgentId);
    const defaultProvider = providers.find((provider) => provider.id === defaultAgent.providerId) || providers[0];
    const legacy = {
      ARCHITECT_LLM_BASE_URL: defaultProvider.baseUrl,
      ARCHITECT_LLM_API_KEY: defaultProvider.apiKey,
      ARCHITECT_LLM_MODEL: defaultAgent.model || defaultProvider.defaultModel || defaultProvider.models[0] || "",
      ARCHITECT_LLM_MODELS: defaultProvider.models.join(","),
      ARCHITECT_LLM_PROVIDER: defaultProvider.type === "claude-cli" ? "claude-cli" : "openai-compatible",
      ARCHITECT_LLM_DEFAULT_AGENT: defaultAgentId,
      ARCHITECT_LLM_PROVIDERS: JSON.stringify(providers),
      ARCHITECT_LLM_AGENTS: JSON.stringify(agents),
    };
    await this.save(legacy);
    return this.workspace();
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
      throw Object.assign(new Error("请先填写 Base URL"), {
        status: 400,
        code: "MODEL_BASE_URL_REQUIRED",
      });
    }
    let base;
    try {
      base = new URL(String(baseUrl));
    } catch {
      throw Object.assign(new Error("Base URL 格式无效"), {
        status: 400,
        code: "MODEL_BASE_URL_INVALID",
      });
    }
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
      throw Object.assign(new Error("模型地址只允许 http/https，且不能包含账号密码"), {
        status: 400,
        code: "MODEL_BASE_URL_INVALID",
      });
    }
    const pathname = base.pathname.replace(/\/+$/, "");
    base.pathname = pathname.endsWith("/chat/completions")
      ? pathname.replace(/\/chat\/completions$/, "/models")
      : `${pathname}/models`;
    base.search = "";
    base.hash = "";
    const hostname = normalizeHost(base.hostname);
    const allowedHosts = parseAllowedHosts(process.env.ARCHITECT_LLM_ALLOWED_HOSTS);
    const effectivePort = base.port || (base.protocol === "https:" ? "443" : "80");
    const allowPrivate = isAllowedHost(hostname, effectivePort, allowedHosts);
    if (isBlockedHostname(hostname) && !allowPrivate) {
      throw Object.assign(new Error("模型地址主机被禁止访问"), {
        status: 403,
        code: "MODEL_ENDPOINT_FORBIDDEN",
      });
    }
    let addresses;
    try {
      addresses = isIP(hostname)
        ? [{ address: hostname }]
        : await this.lookup(hostname, { all: true, verbatim: true });
    } catch (error) {
      throw Object.assign(new Error("无法解析模型地址主机"), {
        status: 400,
        code: "MODEL_ENDPOINT_DNS_FAILED",
        cause: error,
      });
    }
    if (!addresses?.length || (!allowPrivate && addresses.some((item) => isPrivateAddress(item.address)))) {
      throw Object.assign(new Error("模型地址解析到了本机或私有网络，已拒绝请求"), {
        status: 403,
        code: "MODEL_ENDPOINT_FORBIDDEN",
      });
    }
    const modelsUrl = base.toString();
    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = this.fetch
        ? await this.fetch(modelsUrl, {
            method: "GET",
            signal: controller.signal,
            headers,
            redirect: "error",
          })
        : await requestPinnedModelList(
            base,
            addresses.find((item) => isIP(item.address) === 4)?.address || addresses[0].address,
            headers,
          );
      if (!response.ok) {
        throw Object.assign(
          new Error(`获取模型列表失败（HTTP ${response.status}）`),
          { status: 502 },
        );
      }
      const contentLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_MODEL_RESPONSE_BYTES) {
        throw Object.assign(new Error("模型列表响应过大"), {
          status: 502,
          code: "MODEL_RESPONSE_TOO_LARGE",
        });
      }
      let raw;
      if (response.body && Symbol.asyncIterator in Object(response.body)) {
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length ?? chunk.byteLength ?? 0;
          if (size > MAX_MODEL_RESPONSE_BYTES) {
            throw Object.assign(new Error("模型列表响应过大"), {
              status: 502,
              code: "MODEL_RESPONSE_TOO_LARGE",
            });
          }
          chunks.push(Buffer.from(chunk));
        }
        raw = Buffer.concat(chunks).toString("utf8");
      } else if (typeof response.text === "function") {
        raw = await response.text();
        if (Buffer.byteLength(raw, "utf8") > MAX_MODEL_RESPONSE_BYTES) {
          throw Object.assign(new Error("模型列表响应过大"), {
            status: 502,
            code: "MODEL_RESPONSE_TOO_LARGE",
          });
        }
      } else if (typeof response.json === "function") {
        raw = JSON.stringify(await response.json());
        if (Buffer.byteLength(raw, "utf8") > MAX_MODEL_RESPONSE_BYTES) {
          throw Object.assign(new Error("模型列表响应过大"), {
            status: 502,
            code: "MODEL_RESPONSE_TOO_LARGE",
          });
        }
      } else {
        raw = "{}";
      }
      let body;
      try {
        body = JSON.parse(raw || "");
      } catch (error) {
        throw Object.assign(new Error("模型列表响应不是有效 JSON"), {
          status: 502,
          code: "MODEL_INVALID_RESPONSE",
          cause: error,
        });
      }
      if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
        throw Object.assign(new Error("模型列表响应格式无效"), {
          status: 502,
          code: "MODEL_INVALID_RESPONSE",
        });
      }
      const models = body.data
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter(Boolean)
        .slice(0, MAX_MODEL_LIST_LENGTH);
      return { models, endpoint: modelsUrl };
    } catch (error) {
      if (error.name === "AbortError") {
        throw Object.assign(new Error("获取模型列表超时"), { status: 504 });
      }
      if (error instanceof TypeError || error.code === "UND_ERR_CONNECT_TIMEOUT") {
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
