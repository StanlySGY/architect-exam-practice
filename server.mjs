import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { QuestionGenerator } from "./src/generator.mjs";
import { PracticeService } from "./src/questions.mjs";
import { SQLiteStore } from "./src/store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(root, "public");
const store = new SQLiteStore(
  resolve(root, process.env.RUANKAO_DATA_FILE || "data/state.sqlite"),
);
await store.init();
const practice = new PracticeService({ store, root });
await practice.init();
const generator = new QuestionGenerator({ root, service: practice });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 1_000_000) {
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

async function serveStatic(pathname, response) {
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
  response.writeHead(200, {
    "content-type": mimeTypes[extname(file)] || "application/octet-stream",
    "content-length": info.size,
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).pipe(response);
}

async function route(request, response) {
  const origin = `http://${request.headers.host || "localhost"}`;
  const url = new URL(request.url, origin);
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      service: "ruankao-chapter-practice",
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
  if (request.method === "GET" && pathname === "/api/wrong-questions") {
    return sendJson(response, 200, practice.wrongQuestions());
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
        limit: url.searchParams.get("limit") || 50,
        offset: url.searchParams.get("offset") || 0,
      }),
    );
  }
  if (request.method === "GET" && pathname === "/api/statistics") {
    return sendJson(response, 200, practice.statistics());
  }
  if (request.method === "GET" && pathname === "/api/attempts") {
    return sendJson(response, 200, { attempts: practice.attempts() });
  }
  if (request.method === "GET" && pathname === "/api/data/status") {
    return sendJson(response, 200, practice.dataSummary());
  }
  if (request.method === "GET" && pathname === "/api/data/export") {
    return sendJson(response, 200, practice.exportData());
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
    return sendJson(
      response,
      201,
      await generator.generate(await readJson(request)),
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
  return serveStatic(pathname, response);
}

export const server = createServer((request, response) => {
  route(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500)
      process.stderr.write(`${error.stack || error.message}\n`);
    sendJson(response, status, {
      error: error.message,
      code: error.code || "REQUEST_FAILED",
    });
  });
});

if (process.env.NODE_ENV !== "test") {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT) || 3210;
  server.listen(port, host, () => {
    process.stdout.write(`软考章节练习服务已启动：http://${host}:${port}\n`);
  });
}
