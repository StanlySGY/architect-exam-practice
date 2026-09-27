import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadDotEnv } from "../src/generator.mjs";
import { ModelConfig } from "../src/model-config.mjs";
import {
  accessTokenMatches,
  isBlockedHostname,
  isLoopbackHost,
  isPrivateAddress,
  normalizeHost,
  parseAllowedHosts,
} from "../src/security.mjs";

test("监听地址和访问令牌边界按预期识别", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("192.168.1.20"), false);
  assert.equal(normalizeHost("[::1]:3210"), "::1");
  assert.deepEqual([...parseAllowedHosts("[::1]:3210, ::1, model.example:443")], [
    "::1:3210",
    "::1",
    "model.example:443",
  ]);
  assert.equal(accessTokenMatches("secret", "secret"), true);
  assert.equal(accessTokenMatches("secret", "other"), false);
  assert.equal(accessTokenMatches("secret", "secret-longer"), false);
});

test("启动前会从项目 .env 读取访问令牌", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-security-dotenv-"));
  const previous = process.env.ARCHITECT_ACCESS_TOKEN;
  t.after(async () => {
    if (previous === undefined) delete process.env.ARCHITECT_ACCESS_TOKEN;
    else process.env.ARCHITECT_ACCESS_TOKEN = previous;
    await rm(directory, { recursive: true, force: true });
  });
  delete process.env.ARCHITECT_ACCESS_TOKEN;
  await writeFile(join(directory, ".env"), "ARCHITECT_ACCESS_TOKEN=dotenv-token\n");
  loadDotEnv(directory);
  assert.equal(process.env.ARCHITECT_ACCESS_TOKEN, "dotenv-token");
});

test("模型列表请求拒绝回环、私网和内部主机", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-security-model-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const config = new ModelConfig({
    root: directory,
    lookup: async () => [{ address: "192.168.1.8", family: 4 }],
    fetchImpl: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  await assert.rejects(
    () => config.fetchModels({ baseUrl: "http://127.0.0.1:11434/v1" }),
    (error) => error.code === "MODEL_ENDPOINT_FORBIDDEN" && error.status === 403,
  );
  await assert.rejects(
    () => config.fetchModels({ baseUrl: "http://model.example/v1" }),
    (error) => error.code === "MODEL_ENDPOINT_FORBIDDEN" && error.status === 403,
  );
  await assert.rejects(
    () => config.fetchModels({ baseUrl: "http://metadata.google.internal/v1" }),
    (error) => error.code === "MODEL_ENDPOINT_FORBIDDEN" && error.status === 403,
  );
  assert.equal(calls, 0);
});

test("模型列表请求在 DNS 校验后使用安全请求参数并限制响应体", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-security-model-public-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let requestOptions;
  const config = new ModelConfig({
    root: directory,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (url, options) => {
      requestOptions = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ data: [{ id: "model-a" }] }),
      };
    },
  });
  const result = await config.fetchModels({
    baseUrl: "https://model.example/v1/chat/completions",
    apiKey: "secret",
  });
  assert.deepEqual(result.models, ["model-a"]);
  assert.equal(result.endpoint, "https://model.example/v1/models");
  assert.equal(requestOptions.options.redirect, "error");
  assert.equal(requestOptions.options.headers.authorization, "Bearer secret");

  const tooLarge = new ModelConfig({
    root: directory,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "1000001" },
      text: async () => "{}",
    }),
  });
  await assert.rejects(
    () => tooLarge.fetchModels({ baseUrl: "https://model.example/v1" }),
    (error) => error.code === "MODEL_RESPONSE_TOO_LARGE" && error.status === 502,
  );

  const invalidResponse = new ModelConfig({
    root: directory,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "not-json",
    }),
  });
  await assert.rejects(
    () => invalidResponse.fetchModels({ baseUrl: "https://model.example/v1" }),
    (error) => error.code === "MODEL_INVALID_RESPONSE" && error.status === 502,
  );
});

test("模型配置不能通过 HTTP 保存 Claude CLI 路径", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-security-config-"));
  const previous = process.env.ARCHITECT_CLAUDE_COMMAND;
  t.after(async () => {
    if (previous === undefined) delete process.env.ARCHITECT_CLAUDE_COMMAND;
    else process.env.ARCHITECT_CLAUDE_COMMAND = previous;
    await rm(directory, { recursive: true, force: true });
  });
  process.env.ARCHITECT_CLAUDE_COMMAND = "claude";
  const config = new ModelConfig({ root: directory });
  await assert.rejects(
    () => config.save({ ARCHITECT_CLAUDE_COMMAND: "/tmp/attacker" }),
    (error) => error.code === "MODEL_COMMAND_IMMUTABLE" && error.status === 403,
  );
  const publicConfig = config.publicConfig();
  assert.equal(Object.hasOwn(publicConfig, "ARCHITECT_CLAUDE_COMMAND"), false);
});

test("模型地址安全辅助函数覆盖私有网段", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "::ffff:c0a8:0101",
    "ff02::1",
    "fd00::1",
    "fe80::1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isBlockedHostname("service.internal"), true);
  assert.equal(isBlockedHostname("api.example.com"), false);
});
