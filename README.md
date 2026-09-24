# 软考章节练习室

一个面向《系统架构设计师教程（第 2 版）》的本地单用户练习应用。

应用以 Freeplane 思维导图 [`architect.mm`](./architect.mm) 为**生成题的唯一资料来源**，调用 OpenAI 兼容模型或 Claude CLI 生成章节选择题，并提供即时判题、错题间隔复习、题库管理、学习统计和数据备份。相邻仓库 [`architect-exam-bank`](../architect-exam-bank) 中的历年真题/模拟卷可作为只读题库导入，用于按考期开套卷，不参与模型出题。

> 本项目不会从 PDF 提取内容。仓库中即使存在 PDF，题目生成也只读取 `architect.mm` 中所选章节或小节的节点内容。导入的真题库版权仍归原权利人，仅供本机练习，不要公开发布。

## 功能概览

- 按章节、小节（如 `1.1`、`1.2`）和难度练习
- 使用大模型根据思维导图生成四选一题目
- 同章历史题提示、精确防重、近似题过滤和自动补题
- 每题首次作答后立即判题并由服务端锁定答案
- 刷新或关闭页面后恢复未完成练习
- 最终判卷、练习记录和错题本
- 按 1、3、7、14、30 天安排错题复习
- 连续两次复习答对后自动标记为已掌握
- 问题题目上报、停用和恢复
- 题库关键词搜索、组合筛选（含生成题/真题/模拟题来源）、分页；生成题可永久删除
- 从相邻练题台导入历年真题与模拟卷，按考期开综合知识套卷
- 案例、论文可使用导入的真题题面，复用现有 AI 评分
- 总体/章节正确率、练习趋势、薄弱知识点和错题掌握统计
- SQLite 本地持久化、JSON 备份导入导出和旧数据迁移

## 运行要求

- Node.js `>= 22.5`
- npm
- 一个 OpenAI 兼容模型接口；或者已安装并登录的 Claude CLI
- 用于生成题目的 Freeplane 思维导图 `architect.mm`

检查 Node.js 版本：

```bash
node --version
```

项目使用 Node.js 内置的 `node:sqlite`，无需额外安装 SQLite npm 包。部分 Node.js 22 版本可能显示 SQLite experimental warning；这是运行时提示，不代表启动失败。

## 快速开始

### 1. 安装

```bash
git clone <repository-url>
cd architect
npm ci
```

如果已经位于项目目录中，只需执行：

```bash
npm ci
```

### 2. 配置模型

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
ARCHITECT_LLM_BASE_URL=https://api.deepseek.com/v1
ARCHITECT_LLM_API_KEY=你的密钥
ARCHITECT_LLM_MODEL=deepseek-chat
```

`.env` 已被 Git 忽略，模型密钥只由服务端读取，不会发送给浏览器。

### 3. 启动服务

仅允许本机访问：

```bash
npm start
```

默认地址：<http://127.0.0.1:3210>

监听所有网卡（局域网或 Tailscale 访问）：

```bash
HOST=0.0.0.0 PORT=3210 npm start
```

浏览器仍应使用具体主机地址，例如：

```text
http://127.0.0.1:3210
http://192.168.1.20:3210
http://<tailscale-ip>:3210
```

请使用 `http://`，不要误用 `https://`。

健康检查：

```bash
curl http://127.0.0.1:3210/api/health
```

正常响应：

```json
{"ok":true,"service":"architect-chapter-practice"}
```

## 使用指南

### 章节练习

1. 打开首页“章节练习”。
2. 选择章节、小节和难度。
3. 如果当前范围已经有题目，直接开始练习。
4. 如果没有题目，点击“根据当前章节导图生成题目”。
5. 每题选择答案后立即显示反馈；首次答案会被锁定，不能反复猜测。
6. 完成后提交练习，查看成绩和解析。

一次练习最多取 30 道现有题目。一次模型生成请求最多生成 20 道题目；过滤重复题后数量不足时，系统最多自动尝试 3 轮。章节练习和随机模拟卷默认只抽生成题，避免导入的一千多道真题淹没章节练习。

### 真题套卷

1. 打开数据管理，点击“导入真题库”。默认读取相邻仓库 `architect-exam-bank/data/bank.json`，也可用 `ARCHITECT_BANK_FILE` 指定路径。
2. 打开“模拟考试”，在“真题套卷”中选择考期。
3. 按该考期题号顺序组卷，限时 150 分钟；交卷前可改答案，过程不显示对错。
4. 案例和论文页可按来源筛选历年真题或模拟题，交卷后仍走现有 AI 评分。

导入按原题 `id` 幂等更新，不会覆盖已有生成题或练习进度。导入的真题/模拟题不能永久删除；清空题库或全部数据时也会保留它们。HTTP 导入接口不接受客户端传入的文件路径。

相邻练题台的代码许可是 MIT，但题库本身不是：不要把 `bank.json` 当作本仓库的可再分发内容，也不要公开发布导入后的题目。

### 未完成练习

- 首页会显示最近一个未完成练习。
- 可以恢复已答进度，也可以明确放弃。
- 恢复时仅返回已作答题目的反馈和答案；未作答题目仍不泄露答案。
- 创建新练习时，旧的未完成练习会自动标记为放弃。

### 错题本与间隔复习

- 答错或最终未作答的题目会进入错题本。
- 复习间隔依次为 1、3、7、14、30 天。
- 连续两次复习答对后，题目自动标记为已掌握。
- 可以在错题本中手动恢复已掌握题目的复习状态。
- 被标记为问题题目的内容不会继续进入错题复习。

### 题库管理

“题库管理”支持按以下条件组合筛选：

- 题干、知识点、选项或解析关键词
- 章节
- 小节
- 难度
- 正常/问题题状态
- 收藏
- 来源（生成题 / 历年真题 / 模拟题）

管理页面会显示完整选项、正确答案和解析，并支持：

- 将正常题目标记为问题题
- 将问题题恢复到普通题库
- 永久删除单道**生成题**

永久删除会清理该题关联的错题记录、问题报告和未完成会话引用，但会保留已经完成的历史练习汇总，因此过去的学习统计不会被重算。导入的真题和模拟题只读，页面不提供永久删除。

### 问题题目

练习中或判卷后均可上报有问题的题目。被上报的题目会：

- 退出普通章节练习
- 停止进入错题回顾
- 保留历史记录，便于审查
- 出现在数据管理和题库管理页面中

恢复题目只会恢复其题库可用状态，不会擅自重设旧错题的复习日期。

### 学习统计

“学习统计”包括：

- 已完成练习次数
- 累计答题数
- 按实际题数加权的总体正确率
- 学习天数
- 章节正确率
- 最近 12 次练习趋势
- 高频错误知识点
- 错题总数、待掌握数、已掌握数和到期复习数

知识点统计来自错题本聚合，表示高频错误次数，不代表完整的知识点正确率。

### 数据管理与备份

数据管理页面支持：

- 从相邻练题台导入历年真题和模拟卷
- 导出完整 JSON 备份
- 导入本应用生成的 JSON 备份
- 清空错题本
- 清空练习记录
- 清空题库及关联数据（保留已导入真题/模拟题）
- 清空全部学习数据（同样保留已导入真题/模拟题和对应案例、论文）

导入和清空操作均有二次确认。建议在以下操作前先导出备份：

- 大量删除题目
- 清空任意数据
- 修改数据库路径
- 升级或迁移应用

## 思维导图约定

### 唯一资料来源

模型只接收当前选中章节或小节在 `architect.mm` 中的内容，包括节点标题以及 `DETAILS` 和 `NOTE`（二者会合并进同一段资料）。不会回退读取 PDF，也不会在导图内容不足时自行使用 PDF 补充。第 12–20 章等主要写在 `NOTE` 里的章节，必须解析笔记后才能生成题目。

### 章节命名

章节根节点应使用如下格式：

```text
第1章 绪论
第16章 嵌入式系统架构设计理论与实践
```

应用会从 `第N章` 动态识别章节编号。

### 小节命名

章节的直接子节点可使用如下格式：

```text
1.1 系统架构的概念
1.2 系统架构的发展历程
1.3 系统架构设计师的职责
```

小节编号必须以当前章节号开头，例如第 1 章使用 `1.x`。保存思维导图并刷新页面后，新章节和小节即可被识别，无需修改前端代码。

### 章节目录元数据

[`data/chapters.json`](./data/chapters.json) 保存教材章节标题等基础元数据；它不作为模型生成题目的正文来源。要让某章可练习和可生成题目，该章仍必须存在于 `architect.mm` 中。

## 模型配置

### OpenAI 兼容 API（推荐）

程序会把 `ARCHITECT_LLM_BASE_URL` 规范化为 Chat Completions 地址：

- 如果地址已经以 `/chat/completions` 结尾，则直接使用。
- 否则自动追加 `/chat/completions`。

常见配置示例：

| 服务 | Base URL | 模型示例 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat` |
| Ollama | `http://127.0.0.1:11434/v1` | 本地已安装模型名 |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

Ollama 等无需鉴权的本地服务可以将 `ARCHITECT_LLM_API_KEY` 留空，但 `ARCHITECT_LLM_BASE_URL` 和 `ARCHITECT_LLM_MODEL` 必须配置。

### Claude CLI（可选后备）

只有明确配置以下变量时才使用 Claude CLI：

```env
ARCHITECT_LLM_PROVIDER=claude-cli
ARCHITECT_CLAUDE_COMMAND=claude
```

同时确保命令可用且已经完成登录：

```bash
claude --version
```

如果同时配置了 `ARCHITECT_LLM_BASE_URL`，程序优先使用 OpenAI 兼容 HTTP API。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP 监听地址；局域网访问可设为 `0.0.0.0` |
| `PORT` | `3210` | HTTP 端口 |
| `ARCHITECT_MINDMAP` | `architect.mm` | 思维导图路径，相对于项目根目录 |
| `ARCHITECT_DATA_FILE` | `data/state.sqlite` | SQLite 数据库路径，相对于项目根目录 |
| `ARCHITECT_LLM_BASE_URL` | 未配置 | OpenAI 兼容 API Base URL |
| `ARCHITECT_LLM_API_KEY` | 未配置 | 模型 API 密钥 |
| `ARCHITECT_LLM_MODEL` | 未配置 | 模型名称；使用 HTTP API 时必填 |
| `ARCHITECT_LLM_PROVIDER` | 未配置 | 设置为 `claude-cli` 可启用 Claude CLI |
| `ARCHITECT_CLAUDE_COMMAND` | `claude` | Claude CLI 命令或可执行文件路径 |
| `ARCHITECT_AGENT_TIMEOUT_MS` | `600000` | 单次模型请求超时，单位为毫秒 |
| `ARCHITECT_BANK_FILE` | `../architect-exam-bank/data/bank.json` | 真题库 JSON 路径，相对于项目根目录 |

项目根目录的 `.env` 会在生成器初始化时读取。操作系统中已经存在的同名环境变量优先级更高，不会被 `.env` 覆盖。修改 `.env` 后需要重启服务。

## 开发指南

### 常用命令

```bash
# 开发模式；文件变化时自动重启服务
npm run dev

# 普通启动
npm start

# 运行全部测试
npm test

# 基础语法检查
node --check server.mjs
node --check src/questions.mjs
node --check src/generator.mjs
node --check public/app.js
```

项目目前不需要前端构建步骤。浏览器直接加载 `public/` 下的原生 HTML、CSS 和 JavaScript。

### 项目结构

```text
.
├── server.mjs                 # HTTP 服务、静态资源和 API 路由
├── architect.mm                 # Freeplane 思维导图，生成题目的唯一资料源
├── data/
│   ├── chapters.json          # 教材章节基础元数据
│   └── state.sqlite           # 本地学习数据，运行后创建
├── public/
│   ├── index.html             # 页面结构
│   ├── app.js                 # 前端状态、渲染和 API 调用
│   └── styles.css             # 页面样式
├── src/
│   ├── generator.mjs          # 模型调用、提示词组装、响应解析和补题
│   ├── mindmap.mjs            # Freeplane XML 解析、章节和小节识别
│   ├── questions.mjs          # 练习、判卷、错题、统计、题库和备份业务
│   ├── import-bank.mjs        # 练题台真题库字段映射与考期目录
│   ├── store.mjs              # SQLite 持久化及旧 JSON 数据迁移
│   └── utils.mjs              # ID、时间和抽样等工具
├── test/
│   ├── practice.test.mjs      # 服务层和生成器测试
│   └── import-bank.test.mjs   # 真题库映射与套卷导入测试
├── vendor/architect-agent/      # 题目 Agent 提示词来源
├── .env.example               # 环境变量模板
└── package.json               # npm 命令及 Node.js 版本要求
```

仓库根目录的 `create_freeplane_*.mjs`、`append_*.mjs` 和 `reorder_*.mjs` 是思维导图整理辅助脚本，不参与 Web 服务的日常运行。修改或执行这些脚本前建议备份 `architect.mm`。

### 主要模块职责

- `server.mjs`：只负责 HTTP 输入输出、静态文件和路由分发。
- `PracticeService`：集中处理题库、会话、锁定答案、判卷、错题、统计和备份规则。
- `QuestionGenerator`：提取指定导图材料、调用模型、校验结构并补足去重后的题目。
- `SQLiteStore`：保留兼容的 `snapshot()` / `update()` 状态接口，并以事务写入 SQLite。
- `public/app.js`：单页界面的视图切换、数据加载和用户交互。

### 数据流

```text
architect.mm
    ↓ 解析选中章节/小节
QuestionGenerator
    ↓ OpenAI 兼容 API 或 Claude CLI
结构化题目 + 服务端防重
    ↓
SQLiteStore
    ↓
PracticeService → HTTP API → 浏览器
```

### API 概览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/model-status` | 模型配置状态，不返回密钥 |
| `GET` | `/api/chapters` | 章节及导图可用状态 |
| `GET` | `/api/sections?chapter=1` | 获取章节小节 |
| `POST` | `/api/generate` | 根据导图生成题目 |
| `POST` | `/api/sessions` | 创建章节练习 |
| `GET` | `/api/sessions/active` | 获取未完成练习 |
| `DELETE` | `/api/sessions/:id` | 放弃未完成练习 |
| `POST` | `/api/check-answer` | 首次答题并即时判题 |
| `POST` | `/api/grade` | 提交并完成判卷 |
| `POST` | `/api/review-sessions` | 创建错题复习 |
| `GET` | `/api/wrong-questions` | 查询错题本 |
| `PATCH` | `/api/wrong-questions/:id/mastered` | 修改掌握状态 |
| `GET` | `/api/questions` | 筛选和分页查询完整题库 |
| `POST` | `/api/questions/:id/report` | 上报问题题目 |
| `PATCH` | `/api/questions/:id/active` | 恢复问题题目 |
| `DELETE` | `/api/questions/:id` | 永久删除题目 |
| `GET` | `/api/question-issues` | 查询问题题目 |
| `GET` | `/api/attempts` | 查询练习记录 |
| `GET` | `/api/statistics` | 查询学习统计 |
| `GET` | `/api/data/status` | 查询数据摘要 |
| `GET` | `/api/data/export` | 导出 JSON 备份 |
| `POST` | `/api/data/import` | 导入 JSON 备份 |
| `POST` | `/api/data/clear` | 分项或全部清空数据 |

管理接口 `/api/questions` 会返回完整答案和解析。练习会话接口会去除 `correctAnswer` 等答案字段；只有首次调用即时判题后才返回该题反馈。

### 测试

```bash
npm test
```

当前测试覆盖：

- 模型网络、鉴权、限流和响应格式错误
- SQLite 持久化及旧 JSON 自动迁移
- 备份导出、导入和分项清空
- 章节/小节识别和未整理章节拦截
- 练习接口答案不泄露
- 首次答案锁定和最终判卷
- 未完成练习恢复、放弃和替换
- 精确/近似重复题过滤及自动补题
- 错题间隔复习和掌握状态
- 问题题目标记、排除和恢复
- 题库筛选、搜索、分页和删除
- 学习统计聚合和空数据

修改业务规则时，应优先在 `test/practice.test.mjs` 增加对应服务层测试；修改 HTTP 路由后还应使用 `curl` 或浏览器验证真实请求。

## 数据存储与迁移

默认数据库：

```text
data/state.sqlite
```

SQLite 配置包括：

- WAL 日志模式
- `synchronous = FULL`
- 事务更新
- 单个 `app_state` 表保存结构化状态块

相关运行文件可能包括：

```text
data/state.sqlite
data/state.sqlite-wal
data/state.sqlite-shm
```

这些文件以及 `.env` 都已加入 `.gitignore`。

### 旧 JSON 自动迁移

如果首次启动 SQLite 时存在旧的：

```text
data/state.json
```

服务会自动导入其题库、会话、练习记录、错题和问题题数据，并保留：

```text
data/state.json.migrated-backup
```

迁移完成后应检查页面数据，再决定是否手动归档旧文件。

### 正确备份方式

优先使用页面“数据管理 → 导出备份”。导出的 JSON 是应用支持校验和恢复的正式备份格式。

如需直接复制 SQLite 文件，请先停止服务，再复制 `state.sqlite`；不要在服务运行时只复制主数据库文件，因为尚未 checkpoint 的数据可能位于 `state.sqlite-wal` 中。

## 注意事项

### 安全边界

这是一个**本地、单用户 MVP**，没有以下能力：

- 用户账号
- 登录认证
- 多用户权限隔离
- HTTPS
- CSRF 防护
- 请求限流
- 云同步

因此：

- 默认建议使用 `127.0.0.1`，仅本机访问。
- 使用 `HOST=0.0.0.0` 会把服务暴露给可访问该端口的其他设备。
- 不要直接暴露到公网。
- 如需跨设备使用，优先放在可信局域网或 Tailscale 中，并配置主机防火墙。
- 题库管理、备份导出、数据导入、清空和删除 API 都没有用户鉴权。

### 答案保护范围

普通练习创建和恢复接口不会返回未作答题目的正确答案，首次答案也由服务端锁定。但本应用不是面向恶意多用户的考试系统：本机数据库所有者、服务进程所有者以及可访问题库管理接口的人都能查看答案。

### 题目质量

- 模型必须依据思维导图，但生成题仍可能存在措辞、歧义或答案错误。
- 建议使用“标记题目有误”，审查后再恢复。
- 防重采用文本规范化和 bigram 相似度，不是语义向量模型；高度改写的同义题仍可能漏过。
- 思维导图内容越清晰、层级越合理、`DETAILS`/`NOTE` 越完整，生成质量通常越高。
- 导入题库仅供本机练习；清空题库不会删除已导入真题。不要把真题库公开发布或当作 MIT 许可内容。

### 删除与清空

- 永久删除题目不可撤销。
- 清空题库会同时清理相关会话、错题和问题报告。
- 清空练习记录会影响学习统计。
- 导入备份会以备份内容替换当前学习状态，而不是增量合并。
- 执行破坏性操作前先导出备份。

### 运行限制

- 同一时间只允许一个 Agent 生成任务。
- 模型生成依赖网络、服务额度和供应商可用性。
- SQLite 状态结构适合当前本地单用户规模；若未来改为多用户或高并发，应拆分规范化数据表并增加认证和权限设计。

## 常见问题排查

### 页面打不开

1. 查看服务是否正在运行：

   ```bash
   curl http://127.0.0.1:3210/api/health
   ```

2. 检查端口监听：

   ```bash
   ss -ltnp | grep 3210
   ```

3. 确认使用 `http://` 而不是 `https://`。
4. 跨设备访问时确认使用 `HOST=0.0.0.0` 启动。
5. 检查系统防火墙、代理绕过规则和 Tailscale ACL。

### 模型显示“未配置”

- 确认 `.env` 位于项目根目录。
- 确认同时填写 `ARCHITECT_LLM_BASE_URL` 和 `ARCHITECT_LLM_MODEL`。
- Claude CLI 模式必须设置 `ARCHITECT_LLM_PROVIDER=claude-cli`。
- 修改 `.env` 后重启服务。
- 用 `/api/model-status` 检查服务端识别结果。

### 模型网络失败或超时

- 检查 Base URL 是否正确。
- 检查供应商服务状态、API 额度、代理和 DNS。
- OpenAI 兼容地址通常填写到 `/v1`，程序会自动追加 `/chat/completions`。
- 本地 Ollama 要确认模型已经下载且服务正在运行。
- 慢模型可增大 `ARCHITECT_AGENT_TIMEOUT_MS`。

### 鉴权失败或限流

- 鉴权失败：检查 API Key、模型权限和 Base URL 是否属于同一供应商。
- 限流：稍后重试，或降低单次生成数量。
- OpenRouter 等服务还需确认账户余额和目标模型可用性。

### 某章或小节无法选择

- 确认 `architect.mm` 中存在符合命名规则的章节节点。
- 小节应是章节的直接子节点，并使用 `N.x` 开头。
- 确认 `ARCHITECT_MINDMAP` 指向正确文件。
- 保存思维导图后刷新页面。
- 应用不会使用 PDF 填补缺失章节。

### SQLite 启动失败

- 确认 Node.js 版本不低于 22.5。
- 确认数据库目录可写。
- 确认没有把目录路径误填为 `ARCHITECT_DATA_FILE`。
- 如果数据库疑似损坏，先完整备份现有数据库及 WAL/SHM 文件，再尝试从页面导出的 JSON 备份恢复。

### 后台运行与日志

```bash
HOST=0.0.0.0 PORT=3210 nohup npm start \
  >/tmp/architect-practice.log 2>&1 &
```

查看日志：

```bash
tail -f /tmp/architect-practice.log
```

停止服务前建议先查找准确 PID，避免误杀其他 Node.js 进程：

```bash
pgrep -af 'node server.mjs'
kill <PID>
```

## 当前范围

项目当前定位是个人本地学习工具，暂不包含账号系统、云同步、社交排名、多人共享题库、复杂权限和生产级公网部署能力。若将来扩展为多人服务，应优先增加认证、授权、数据库规范化、审计日志、速率限制、HTTPS 和自动化迁移机制。
