import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import dns from "node:dns";
import { isIP, setDefaultAutoSelectFamily, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv, QuestionGenerator } from "./src/generator.mjs";
import { PracticeService } from "./src/questions.mjs";
import { SQLiteStore } from "./src/store.mjs";
import { ModelConfig, isMaskedSecret } from "./src/model-config.mjs";
import {
  accessTokenMatches,
  isLoopbackHost,
  normalizeHost,
} from "./src/security.mjs";

// WSL2 等环境下 IPv6 路由不可用，而 DNS 常把 AAAA 记录排在前面，
// 会让 Node fetch 优先尝试 IPv6 后连接超时；强制 IPv4 优先解析。
// 另外 Happy Eyeballs 默认每地址族只等 250ms，到 Cloudflare 的握手
// 经常超过该窗口导致 AggregateError ETIMEDOUT，放宽到 3 秒。
dns.setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(true);
setDefaultAutoSelectFamilyAttemptTimeout(3000);

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(root, "public");
loadDotEnv(root);
const bindHost = process.env.HOST || "127.0.0.1";
const accessToken = String(process.env.ARCHITECT_ACCESS_TOKEN || "").trim();
const remoteBind = !isLoopbackHost(bindHost);
const authRequired = Boolean(accessToken) || remoteBind;
const agentsEnabled = process.env.ARCHITECT_ENABLE_AGENTS === "true";
if (remoteBind && !accessToken) {
  throw new Error(
    "监听非本机地址时必须设置 ARCHITECT_ACCESS_TOKEN（建议使用至少 32 个随机字符）",
  );
}
const store = new SQLiteStore(
  resolve(root, process.env.ARCHITECT_DATA_FILE || "data/state.sqlite"),
);
await store.init();
const practice = new PracticeService({ store, root });
await practice.init();
const modelConfig = new ModelConfig({ root });
const generator = new QuestionGenerator({ root, service: practice, modelConfig });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 1_000_000) {
  // 拒绝非 JSON 的请求体：跨站表单只能以 text/plain 等类型提交，此检查同时挡掉 CSRF。
  const contentType = String(request.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw Object.assign(new Error("请求体必须是 application/json"), {
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes)
      throw Object.assign(new Error("请求体过大"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw Object.assign(new Error(`JSON 请求体格式错误：${error.message}`), {
      status: 400,
    });
  }
}

function cancellableRequest(request, response) {
  const controller = new AbortController();
  let completed = false;
  const abort = () => {
    if (!completed && !controller.signal.aborted) controller.abort();
  };
  const onRequestAborted = () => abort();
  const onResponseClose = () => {
    if (!response.writableEnded) abort();
  };
  if (request.aborted) abort();
  request.once("aborted", onRequestAborted);
  response.once("close", onResponseClose);
  return {
    signal: controller.signal,
    complete() {
      completed = true;
      request.removeListener("aborted", onRequestAborted);
      response.removeListener("close", onResponseClose);
    },
  };
}

async function runCancellable(request, response, operation) {
  const lifecycle = cancellableRequest(request, response);
  try {
    return await operation(lifecycle.signal);
  } finally {
    lifecycle.complete();
  }
}

const libraryFiles = new Map([
  ["/lib/figures.mjs", resolve(root, "src/figures.mjs")],
  ["/lib/markdown.mjs", resolve(root, "src/markdown.mjs")],
  ["/lib/essay.mjs", resolve(root, "src/essay.mjs")],
]);

async function serveLibrary(pathname, request, method, response) {
  const file = libraryFiles.get(pathname);
  if (!file) throw Object.assign(new Error("页面不存在"), { status: 404 });
  const info = await stat(file);
  if (notModifiedSince(request, info)) {
    response.writeHead(304, {
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": mimeTypes[".mjs"],
    "content-length": info.size,
    "last-modified": new Date(info.mtimeMs).toUTCString(),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

// no-cache 允许浏览器每次携带 If-Modified-Since 复验，未变化时返回 304，
// 避免每次刷新全量重拉静态资源。
function notModifiedSince(request, info) {
  const header = request.headers["if-modified-since"];
  if (!header) return false;
  const since = Date.parse(header);
  if (!Number.isFinite(since)) return false;
  return Math.floor(since / 1000) === Math.floor(info.mtimeMs / 1000);
}

async function serveStatic(pathname, request, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw Object.assign(new Error("URL 编码无效"), { status: 400 });
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = resolve(publicRoot, relative);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`))
    throw Object.assign(new Error("禁止访问"), { status: 403 });
  let info;
  try {
    info = await stat(file);
  } catch (error) {
    if (error.code === "ENOENT")
      throw Object.assign(new Error("页面不存在"), { status: 404 });
    throw error;
  }
  if (!info.isFile())
    throw Object.assign(new Error("页面不存在"), { status: 404 });
  if (notModifiedSince(request, info)) {
    response.writeHead(304, {
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    });
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": mimeTypes[extname(file)] || "application/octet-stream",
    "content-length": info.size,
    "last-modified": new Date(info.mtimeMs).toUTCString(),
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function hostHeaderAllowed(host) {
  if (remoteBind || !host) return true;
  const hostname = normalizeHost(host);
  return hostname === "localhost" || isIP(hostname) !== 0;
}

async function route(request, response) {
  if (!hostHeaderAllowed(request.headers.host)) {
    throw Object.assign(new Error("Host 不被允许"), {
      status: 403,
      code: "HOST_FORBIDDEN",
    });
  }
  const origin = `http://${request.headers.host || "localhost"}`;
  const url = new URL(request.url, origin);
  const { pathname } = url;
  if (pathname.startsWith("/api/") && pathname !== "/api/health" && authRequired) {
    const authorization = String(request.headers.authorization || "");
    const provided = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : String(request.headers["x-architect-token"] || "").trim();
    if (!accessTokenMatches(provided, accessToken)) {
      throw Object.assign(new Error("需要有效的访问令牌"), {
        status: 401,
        code: "AUTH_REQUIRED",
        headers: { "www-authenticate": "Bearer" },
      });
    }
  }
  if (
    pathname.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.origin
  ) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(request.headers.origin).host === request.headers.host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      throw Object.assign(new Error("跨站请求被拒绝"), {
        status: 403,
        code: "CSRF_ORIGIN_FORBIDDEN",
      });
    }
  }
  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "architect-chapter-practice",
    });
  }
  if (request.method === "GET" && pathname === "/api/chapters") {
    return sendJson(response, 200, {
      chapters: await practice.chapterListWithSources(),
    });
  }
  if (request.method === "GET" && pathname === "/api/sections") {
    return sendJson(response, 200, {
      sections: await practice.sections(url.searchParams.get("chapter")),
    });
  }
  if (request.method === "GET" && pathname === "/api/model-status") {
    return sendJson(response, 200, generator.modelStatus());
  }
  if (request.method === "GET" && pathname === "/api/model-config") {
    return sendJson(response, 200, modelConfig.publicConfig());
  }
  if (request.method === "POST" && pathname === "/api/model-config") {
    const body = await readJson(request);
    return sendJson(response, 200, modelConfig.publicConfig(await modelConfig.save(body)));
  }
  if (request.method === "POST" && pathname === "/api/model-config/workspace") {
    const body = await readJson(request);
    return sendJson(response, 200, modelConfig.publicWorkspace ? modelConfig.publicWorkspace(await modelConfig.saveWorkspace(body)) : modelConfig.publicConfig());
  }
  if (request.method === "POST" && pathname === "/api/model-config/fetch-models") {
    const body = await readJson(request);
    // 掩码或空值表示沿用已保存的密钥，而不是把掩码当作真实密钥发送。
    const provider = body.providerId
      ? modelConfig.providerCredentials(body.providerId, body)
      : body;
    const storedKey = modelConfig.read().ARCHITECT_LLM_API_KEY || "";
    const apiKey = body.providerId
      ? provider.apiKey || ""
      : isMaskedSecret(body.apiKey)
        ? storedKey
        : body.apiKey || "";
    if (provider.type === "claude-cli") {
      return sendJson(response, 200, { models: ["Claude CLI"], endpoint: "local" });
    }
    return sendJson(
      response,
      200,
      await modelConfig.fetchModels({
        baseUrl: provider.baseUrl,
        apiKey,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/agents/run") {
    if (!agentsEnabled) {
      throw Object.assign(new Error("Agent 执行能力已关闭，请通过启动环境显式开启"), {
        status: 403,
        code: "AGENT_DISABLED",
      });
    }
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await runCancellable(request, response, (signal) =>
        generator.runAgentTask({ ...body, signal }),
      ),
    );
  }
  if (request.method === "GET" && pathname === "/api/wrong-questions") {
    // 不带 limit 时返回全量记录；带 limit/offset 时按页切片（汇总仍基于全量）。
    return sendJson(response, 200, practice.wrongQuestions({
      limit: url.searchParams.has("limit")
        ? url.searchParams.get("limit")
        : null,
      offset: url.searchParams.get("offset") || 0,
    }));
  }
  if (request.method === "GET" && pathname === "/api/questions") {
    return sendJson(
      response,
      200,
      practice.questionBank({
        query: url.searchParams.get("query") || "",
        chapter: url.searchParams.get("chapter") || "all",
        section: url.searchParams.get("section") || "all",
        difficulty: url.searchParams.get("difficulty") || "all",
        status: url.searchParams.get("status") || "all",
        starred: url.searchParams.get("starred") || "all",
        sourceType: url.searchParams.get("sourceType") || "all",
        term: url.searchParams.get("term") || "all",
        limit: url.searchParams.get("limit") || 50,
        offset: url.searchParams.get("offset") || 0,
      }),
    );
  }
  if (request.method === "GET" && pathname === "/api/real-exams") {
    return sendJson(response, 200, { papers: practice.realExamCatalog() });
  }
  if (request.method === "POST" && pathname === "/api/real-exams/import") {
    return sendJson(response, 200, await practice.importArchitectBank());
  }
  if (request.method === "GET" && pathname === "/api/statistics") {
    return sendJson(response, 200, practice.statistics());
  }
  if (request.method === "GET" && pathname === "/api/exam-readiness") {
    return sendJson(response, 200, practice.examReadiness());
  }
  if (request.method === "GET" && pathname === "/api/learning-plan") {
    return sendJson(response, 200, practice.learningPlan());
  }
  if (request.method === "GET" && pathname === "/api/learning-reinforcement") {
    return sendJson(response, 200, practice.learningReinforcement(url.searchParams.get("unitId"), url.searchParams.get("limit") || 5));
  }
  if (request.method === "POST" && pathname === "/api/learning/start") {
    const body = await readJson(request);
    return sendJson(response, 200, await practice.startLearning(body.unitId));
  }
  if (request.method === "POST" && pathname === "/api/learning/check") {
    const body = await readJson(request);
    return sendJson(response, 200, await practice.recordLearningCheck(body.unitId, body.checkId, body.completed !== false));
  }
  if (request.method === "POST" && pathname === "/api/learning/complete") {
    const body = await readJson(request);
    return sendJson(response, 200, await practice.completeLearning(body.unitId, body.confidence));
  }
  if (request.method === "GET" && pathname === "/api/study-plan") {
    return sendJson(response, 200, practice.getStudyPlan());
  }
  if (request.method === "GET" && pathname === "/api/study-queue") {
    return sendJson(
      response,
      200,
      practice.studyQueue({
        limit: url.searchParams.get("limit") || 5,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/study-plan/goal") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.setDailyGoal(body.goal),
    );
  }
  if (request.method === "GET" && pathname === "/api/attempts") {
    return sendJson(response, 200, { attempts: practice.attempts() });
  }
  if (request.method === "GET" && pathname === "/api/data/status") {
    return sendJson(response, 200, practice.dataSummary());
  }
  if (request.method === "GET" && pathname === "/api/content-health") {
    return sendJson(response, 200, practice.contentHealth());
  }
  if (request.method === "GET" && pathname === "/api/data/export") {
    return sendJson(response, 200, await practice.exportData());
  }
  if (request.method === "GET" && pathname === "/api/data/diagnosis") {
    return sendJson(response, 200, practice.diagnosisExport());
  }
  if (request.method === "GET" && pathname === "/api/study-materials") {
    return sendJson(response, 200, practice.studyMaterials());
  }
  const materialMatch = pathname.match(/^\/api\/study-materials\/([^/]+)$/);
  if (request.method === "GET" && materialMatch) {
    return sendJson(
      response,
      200,
      await practice.studyMaterial(decodeURIComponent(materialMatch[1])),
    );
  }
  if (request.method === "POST" && pathname === "/api/data/import") {
    return sendJson(
      response,
      200,
      await practice.importData(await readJson(request, 50_000_000)),
    );
  }
  if (request.method === "POST" && pathname === "/api/data/clear") {
    return sendJson(
      response,
      200,
      await practice.clearData(await readJson(request)),
    );
  }
  if (request.method === "GET" && pathname === "/api/question-issues") {
    return sendJson(response, 200, { records: practice.questionIssues() });
  }
  if (request.method === "GET" && pathname === "/api/audit-log") {
    return sendJson(response, 200, { records: practice.auditLog() });
  }
  if (request.method === "POST" && pathname.endsWith("/report")) {
    const reportMatch = pathname.match(/^\/api\/questions\/([^/]+)\/report$/);
    if (reportMatch) {
      const body = await readJson(request);
      return sendJson(
        response,
        200,
        await practice.reportQuestion({
          questionId: decodeURIComponent(reportMatch[1]),
          note: body.note,
        }),
      );
    }
  }
  const restoreMatch = pathname.match(/^\/api\/questions\/([^/]+)\/active$/);
  if (request.method === "PATCH" && restoreMatch) {
    return sendJson(
      response,
      200,
      await practice.restoreQuestion(decodeURIComponent(restoreMatch[1])),
    );
  }
  const issueStatusMatch = pathname.match(
    /^\/api\/questions\/([^/]+)\/issue-status$/,
  );
  if (request.method === "PATCH" && issueStatusMatch) {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.setIssueStatus({
        questionId: decodeURIComponent(issueStatusMatch[1]),
        status: body.status,
      }),
    );
  }
  const questionEditMatch = pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (request.method === "PATCH" && questionEditMatch) {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.updateQuestion({
        questionId: decodeURIComponent(questionEditMatch[1]),
        updates: body,
      }),
    );
  }
  if (request.method === "GET" && pathname === "/api/llm-usage") {
    return sendJson(response, 200, practice.llmUsageSummary());
  }
  const starMatch = pathname.match(/^\/api\/questions\/([^/]+)\/star$/);
  if (request.method === "PATCH" && starMatch) {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.setStarred(
        decodeURIComponent(starMatch[1]),
        body.starred,
      ),
    );
  }
  if (request.method === "GET" && pathname === "/api/sessions/active") {
    return sendJson(response, 200, { session: practice.activeSession() });
  }
  if (request.method === "POST" && pathname === "/api/sessions") {
    return sendJson(
      response,
      201,
      await practice.createSession(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/review-sessions") {
    return sendJson(
      response,
      201,
      await practice.createReviewSession(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/exam-sessions") {
    return sendJson(
      response,
      201,
      await practice.createMockExamSession(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/exam-answers") {
    return sendJson(
      response,
      200,
      await practice.saveExamAnswer(await readJson(request)),
    );
  }
  if (request.method === "GET" && pathname === "/api/case-exams/active") {
    return sendJson(response, 200, { exam: practice.activeCaseExam() });
  }
  if (request.method === "GET" && pathname === "/api/case-exams") {
    return sendJson(response, 200, { exams: practice.caseExamList() });
  }
  if (request.method === "POST" && pathname === "/api/case-exams") {
    return sendJson(
      response,
      201,
      await practice.createCaseExam(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/case-exams/draft") {
    return sendJson(
      response,
      200,
      await practice.saveCaseExamDraft(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/case-exams/grade") {
    const body = await readJson(request);
    const exam = practice.activeCaseExam();
    if (!exam || exam.id !== body.examId) {
      throw Object.assign(new Error("模拟卷不存在或已结束"), { status: 404 });
    }
    const context = practice.caseExamForGrading(body.examId);
    if (!context) {
      throw Object.assign(new Error("模拟卷不存在或已结束"), { status: 404 });
    }
    return sendJson(
      response,
      200,
      await generator.gradeCaseExam({
        exam: context.exam,
        cases: context.cases,
        model: body.model,
      }),
    );
  }
  const caseExamMatch = pathname.match(/^\/api\/case-exams\/([^/]+)$/);
  if (request.method === "DELETE" && caseExamMatch) {
    return sendJson(
      response,
      200,
      await practice.abandonCaseExam(decodeURIComponent(caseExamMatch[1])),
    );
  }
  if (request.method === "POST" && pathname === "/api/check-answer") {
    return sendJson(
      response,
      200,
      await practice.checkAnswer(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/grade") {
    return sendJson(
      response,
      200,
      await practice.grade(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/generate") {
    const body = await readJson(request);
    return sendJson(
      response,
      201,
      await runCancellable(request, response, (signal) =>
        generator.generate({
          chapter: body.chapter,
          section: body.section,
          difficulty: body.difficulty,
          count: body.count,
          model: body.model,
          signal,
        }),
      ),
    );
  }
  if (request.method === "POST" && pathname === "/api/cases/generate") {
    const body = await readJson(request);
    return sendJson(
      response,
      201,
      await runCancellable(request, response, (signal) =>
        generator.generateCase({
          chapter: body.chapter,
          section: body.section,
          count: body.count,
          model: body.model,
          signal,
        }),
      ),
    );
  }
  if (request.method === "GET" && pathname === "/api/cases") {
    const sourceType = url.searchParams.get("sourceType") || "all";
    const term = url.searchParams.get("term") || "all";
    const records = practice.caseList({ sourceType, term });
    const page = url.searchParams.has("limit") || url.searchParams.has("offset")
      ? practice.casePage({
          sourceType,
          term,
          limit: url.searchParams.get("limit") || 4,
          offset: url.searchParams.get("offset") || 0,
        })
      : { records, total: records.length, offset: 0, limit: records.length };
    return sendJson(
      response,
      200,
      {
        cases: page.records,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
      },
    );
  }
  if (request.method === "POST" && pathname === "/api/cases/grade") {
    const body = await readJson(request);
    const caseItem = practice
      .caseList()
      .find((item) => item.id === body.caseId);
    if (!caseItem) {
      throw Object.assign(new Error("案例不存在"), { status: 404 });
    }
    return sendJson(
      response,
      200,
      await generator.gradeCaseWithAI({
        caseItem,
        answers: body.answers ?? {},
        model: body.model,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/cases/draft") {
    return sendJson(
      response,
      200,
      await practice.saveCaseDraft(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/papers/mock-start") {
    return sendJson(
      response,
      200,
      await practice.setPaperMockStart(await readJson(request)),
    );
  }
  if (request.method === "POST" && pathname === "/api/papers/generate") {
    const body = await readJson(request);
    return sendJson(
      response,
      201,
      await runCancellable(request, response, (signal) =>
        generator.generatePaper({
          chapter: body.chapter,
          section: body.section,
          count: body.count,
          model: body.model,
          signal,
        }),
      ),
    );
  }
  if (request.method === "GET" && pathname === "/api/papers") {
    const sourceType = url.searchParams.get("sourceType") || "all";
    const term = url.searchParams.get("term") || "all";
    const records = practice.paperList({ sourceType, term });
    const page = url.searchParams.has("limit") || url.searchParams.has("offset")
      ? practice.paperPage({
          sourceType,
          term,
          limit: url.searchParams.get("limit") || 4,
          offset: url.searchParams.get("offset") || 0,
        })
      : { records, total: records.length, offset: 0, limit: records.length };
    return sendJson(
      response,
      200,
      {
        papers: page.records,
        total: page.total,
        offset: page.offset,
        limit: page.limit,
      },
    );
  }
  if (request.method === "POST" && pathname === "/api/papers/draft") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.savePaperDraft({
        paperId: body.paperId,
        draft: body.draft,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/papers/grade") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await generator.gradePaper({
        paperId: body.paperId,
        draft: body.draft,
        model: body.model,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/wiki/generate") {
    const body = await readJson(request);
    return sendJson(
      response,
      201,
      await runCancellable(request, response, (signal) =>
        generator.generateWiki({
          chapter: body.chapter,
          section: body.section,
          count: body.count,
          model: body.model,
          signal,
        }),
      ),
    );
  }
  if (request.method === "GET" && pathname === "/api/wiki") {
    return sendJson(response, 200, { entries: practice.wikiList() });
  }
  if (request.method === "GET" && pathname === "/api/wiki/lint") {
    return sendJson(response, 200, practice.wikiLint());
  }
  if (request.method === "POST" && pathname === "/api/wiki/lint/fix") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.fixWikiRelated({
        entryId: body.entryId,
        name: body.name,
        candidate: body.candidate,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/wiki/ask") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await generator.answerFromWiki({
        question: body.question,
        model: body.model,
      }),
    );
  }
  if (request.method === "GET" && pathname === "/api/wiki/related") {
    return sendJson(
      response,
      200,
      {
        suggestions: practice.relatedWikiSuggestions({
          entryId: url.searchParams.get("entryId") || "",
          limit: url.searchParams.get("limit") || 5,
        }),
      },
    );
  }
  if (request.method === "POST" && pathname === "/api/data/backup-db") {
    return sendJson(response, 200, await practice.backupDatabase());
  }
  if (request.method === "POST" && pathname === "/api/wiki/merge") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.mergeWikiEntry({
        entryId: body.entryId,
        intoId: body.intoId,
      }),
    );
  }
  if (request.method === "PATCH" && pathname === "/api/wiki/entry") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.updateWikiEntry({
        entryId: body.entryId,
        updates: body.updates,
      }),
    );
  }
  if (request.method === "POST" && pathname === "/api/wiki/status") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.setWikiStatus({
        entryId: body.entryId,
        status: body.status,
      }),
    );
  }
  const questionMatch = pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (request.method === "DELETE" && questionMatch) {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.deleteQuestion({
        questionId: decodeURIComponent(questionMatch[1]),
        confirm: body.confirm,
      }),
    );
  }
  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (request.method === "DELETE" && sessionMatch) {
    return sendJson(
      response,
      200,
      await practice.abandonSession(decodeURIComponent(sessionMatch[1])),
    );
  }
  const masteredMatch = pathname.match(
    /^\/api\/wrong-questions\/([^/]+)\/mastered$/,
  );
  if (request.method === "PATCH" && masteredMatch) {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await practice.setMastered(
        decodeURIComponent(masteredMatch[1]),
        body.mastered,
      ),
    );
  }
  if (pathname.startsWith("/api/"))
    throw Object.assign(new Error("API 不存在"), { status: 404 });
  if (!["GET", "HEAD"].includes(request.method))
    throw Object.assign(new Error("请求方法不允许"), { status: 405 });
  if (libraryFiles.has(pathname))
    return serveLibrary(pathname, request, request.method, response);
  return serveStatic(pathname, request, response);
}

export const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    if (request.aborted || response.destroyed || error.code === "LLM_GENERATION_CANCELLED") {
      if (!response.destroyed) response.destroy();
      return;
    }
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500)
      process.stderr.write(`${error.stack || error.message}\n`);
    sendJson(
      response,
      status,
      {
        error: error.message,
        code: error.code || "REQUEST_FAILED",
      },
      error.headers,
    );
  });
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT) || 3210;
  server.listen(port, bindHost, () => {
    process.stdout.write(`软考章节练习服务已启动：http://${bindHost}:${port}\n`);
  });
}
