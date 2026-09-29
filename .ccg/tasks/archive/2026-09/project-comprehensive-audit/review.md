# 全项目审查结果

审查日期：2026-09-29

审查对象：当前工作区中的代码、配置、文档、测试结构和已有桌面/移动/深浅色界面截图。

边界：只读审查；未查看 `.env` 内容、本机学习数据库或 PDF；按计划未运行测试。

## 总体结论

项目是一个功能覆盖广、面向本机单用户的软考架构师学习应用。章节练习、AI 生成题、错题复习、模拟考试、真题导入、案例与论文练习、资料阅读、Wiki/知识图谱、统计、备份和模型配置已经组成较完整的学习闭环。当前版本已实现旧对标报告中列为缺项的 FSRS-6、深色主题、命令面板、置信度、学习热力图、Wiki 检索与弃答、模型退避机制、OpenAI 兼容 API 用量记录、在线 SQLite 备份以及 CI；旧报告中的固定间隔和“没有暗色模式”等判断不再适用。重试和用量记录的覆盖范围仍有缺口，详见 P2。

**评分：总体 7.8/10。** 功能完整度 8.0/10，交互体验 7.6/10，视觉与信息组织 8.0/10，安全性（本机单用户威胁模型）8.0/10，工程可维护性 7.0/10。项目已达到可日常使用的程度，但论文和单案例练习在评分成功后不会自动保存本次作答，活动会话也没有固定题目版本；这些问题影响答案保留和判分可信度，因此还不能称为完善。

## 问题分级

### P1：优先修复

1. **论文与单案例 AI 评分不会一起保存本次作答。** 论文评分请求会发送 textarea 当前内容，成功后重新加载题目，但输入框只从已保存的 `paper.draft` 回填（[app.js](/home/sgy/workspace/architect-exam-practice/public/app.js:3575)、[app.js](/home/sgy/workspace/architect-exam-practice/public/app.js:3481)）；后端评分路径只写入 grade 和模拟提交状态，不更新 draft（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:1004)、[essay.mjs](/home/sgy/workspace/architect-exam-practice/src/service/essay.mjs:135)）。单案例评分也从当前输入收集 answers 并保存评分，但作答草稿只由单独的“保存草稿”接口写入（[app.js](/home/sgy/workspace/architect-exam-practice/public/app.js:3249)、[app.js](/home/sgy/workspace/architect-exam-practice/public/app.js:3358)、[case-exam.mjs](/home/sgy/workspace/architect-exam-practice/src/service/case-exam.mjs:320)、[case-exam.mjs](/home/sgy/workspace/architect-exam-practice/src/service/case-exam.mjs:334)）。评分后刷新，输入框会恢复成上次手动保存的内容或空白，而评分结果仍保留；用户未先保存时会丢失本次作答。建议评分成功时原子化保存提交文本与评分，并明确提示保存状态。

2. **活动会话没有固定题目版本，编辑可能改变已作答题目的判分。** 会话只保存题目 ID（[sessions.mjs](/home/sgy/workspace/architect-exam-practice/src/service/sessions.mjs:296)）；恢复时按 ID 读取当前题库内容（[sessions.mjs](/home/sgy/workspace/architect-exam-practice/src/service/sessions.mjs:335)），提交时也从当前题库重新取题并计算正确答案（[sessions.mjs](/home/sgy/workspace/architect-exam-practice/src/service/sessions.mjs:554)）。题库编辑会递增题目 revision 并保留最多五份旧快照，但活动会话没有保存或校验该 revision（[bank.mjs](/home/sgy/workspace/architect-exam-practice/src/service/bank.mjs:124)）。在另一个标签页编辑题目后恢复旧练习，旧作答可能按新题干/答案判分。建议在会话中保存题目快照或不可变 revision，并用快照恢复、判卷和写入历史记录。

### P2：建议修复

1. **题库导入存在 ID 冲突覆盖风险。** 导入时用所有现存题目的 ID 建立索引（[data.mjs](/home/sgy/workspace/architect-exam-practice/src/service/data.mjs:363)），外部题目 ID 原样保留（[import-bank.mjs](/home/sgy/workspace/architect-exam-practice/src/import-bank.mjs:92)）；相同 ID 会走“更新”路径并把导入题内容写到现有记录上（[data.mjs](/home/sgy/workspace/architect-exam-practice/src/service/data.mjs:370)）。如果它与生成题 ID 相同，生成题会被改成导入题。建议给导入题 ID 加稳定来源命名空间，并在导入前校验重复 ID 与跨来源冲突。

2. **OpenAI 兼容接口的网络错误和超时不会进入重试。** `withRetries()` 会识别网络失败和超时错误码（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:128)），但 `fetch()` 抛出的 `TypeError` 和 `AbortError` 直到重试包装之外才被转换成这些错误码（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:218)、[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:286)），普通请求流程中只有 HTTP 429/5xx 会进入重试。JSON Schema 降级后的第二次 `fetch()` 也在重试包装之外，网络错误、超时、限流或服务错误都会直接失败。当前注释宣称覆盖网络抖动，建议在重试边界内统一错误分类，并为这些分支补覆盖。

3. **论文 AI 评分没有校验总分范围和维度合计。** 后端只检查 `total_score` 是 number（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:980)），Schema 未限定 `total_score`、`max_score` 或各维度 `score` 的上下界（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:923)）。即便 Schema 生效也不会约束分数范围或总分与维度之和一致；兼容网关降级为 `json_object` 时，还可能缺少 `max_score`。这些情况下结果可能被直接展示。建议按评分维度定义验证上下限，并由后端计算或核对总分。

4. **Claude CLI 的 token 用量没有进入用量统计。** OpenAI 兼容 API 分支只有在响应包含 usage 时才调用 `recordUsage()`（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:1390)、[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:1431)）；Claude CLI 分支直接返回命令输出，没有读取 usage 或调用记账逻辑（[generator.mjs](/home/sgy/workspace/architect-exam-practice/src/generator.mjs:1408)）。这与 README“每次模型调用记录 token 用量”的表述不符（[README.md](/home/sgy/workspace/architect-exam-practice/README.md:26)）。建议解析 CLI usage，或明确用量面板只统计实际返回 usage 的供应商。当前统计也只保留最近 500 条（[data.mjs](/home/sgy/workspace/architect-exam-practice/src/service/data.mjs:136)）。

5. **首页复习说明仍显示旧的固定间隔。** 首页文案称按 `1、3、7、14、30` 天推进（[index.html](/home/sgy/workspace/architect-exam-practice/public/index.html:157)），而当前复习实际由 FSRS-6 和用户评分调度，README 已描述新行为（[README.md](/home/sgy/workspace/architect-exam-practice/README.md:17)）。这会让用户对下次复习日期和评分按钮产生错误预期，应改为描述动态间隔。

6. **模型配置文件权限可以更严格。** `writeEnv()` 最终直接调用 `writeFile()`，没有指定权限或收紧已有权限（[model-config.mjs](/home/sgy/workspace/architect-exam-practice/src/model-config.mjs:359)、[model-config.mjs](/home/sgy/workspace/architect-exam-practice/src/model-config.mjs:384)）。当前 `.env` 为 `0644`，但父目录 `/home/sgy` 为 `0750` 且组内只有当前用户，所以本机其他普通账户目前无法读取；如果项目迁至共享目录或父目录权限放宽，密钥会暴露给可遍历该目录的用户。建议写入时收紧到 `0600`。

7. **前端主脚本和 HTTP 路由仍集中在大文件中。** `public/app.js` 约 5,429 行，`server.mjs` 约 885 行。当前按服务域拆分的方向是合理的，但单体前端脚本和路由分发会增加回归定位、代码审查及后续协作成本。建议随功能迭代渐进拆成 ES 模块和独立路由模块，不需要一次性重写。

## 功能与体验评估

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 练习闭环 | 较完整 | 章节/小节选题、生成与去重、即时反馈、锁定首答、恢复会话、错题回顾、历史记录和模拟考试均有对应实现。 |
| 复习与反馈 | 完整度较高 | FSRS-6 调度、四档自评和间隔预览已实现；置信度和选项级解析也接入结果视图。 |
| 真题及主观题 | 覆盖较广，保存闭环有缺口 | 支持按考期导入综合知识题、案例模拟和论文题，并提供 AI 评分；论文和单案例评分成功不会一并保存本次答案，AI 主观题评分也不宜等同正式阅卷结论。 |
| 学习支持 | 较完整 | Wiki 检索、相关条目、图谱邻域、资料阅读器、热力图、章节掌握度和 FSRS 负载均已实现。 |
| 数据管理 | 较完整 | SQLite 持久化、JSON 备份恢复、在线数据库备份、旧 JSON 迁移和操作审计均有代码路径。SQLite 目前仍以按业务集合保存 JSON 的 `app_state` 表为主（[store.mjs](/home/sgy/workspace/architect-exam-practice/src/store.mjs:94)），不是细粒度关系表；当前单用户规模够用，全文检索和更大数据量会受限。 |
| 日常交互 | 良好 | 侧栏分组、答题卡、即时反馈、深浅色、快捷键、命令面板和阅读器控制让常见操作可发现、可重复使用。桌面与移动截图整体层级清晰；移动端导航在首屏占用相对明显，复习反馈内容密度偏高，可继续精简。截图记录见 `screenshots/mobile-home.png`、`screenshots/review-feedback.png`。 |
| 可访问性 | 有基础建设 | 页面使用 `aria-live`、标签和状态属性，样式包含 `:focus-visible` 与 `prefers-reduced-motion`（[styles.css](/home/sgy/workspace/architect-exam-practice/public/styles.css:398)）。当前静态审查没有发现已配置的浏览器端到端或自动无障碍检查流程。 |

## 工程与安全

- 工程基础较此前完整：项目声明 Node.js `>=22.15`，有六组 Node 测试文件和 GitHub Actions Node 22/24 矩阵；CI 运行语法检查和 `npm test`（[ci.yml](/home/sgy/workspace/architect-exam-practice/.github/workflows/ci.yml:1)）。本次没有运行这些检查，所以不对当前测试是否通过作结论。
- 服务端默认只监听回环地址；绑定非回环地址时强制要求访问令牌，写操作还校验请求来源（[server.mjs](/home/sgy/workspace/architect-exam-practice/server.mjs:29)、[server.mjs](/home/sgy/workspace/architect-exam-practice/server.mjs:34)、[server.mjs](/home/sgy/workspace/architect-exam-practice/server.mjs:236)）。请求体限制、Host 检查和模型请求取消机制也已实现。
- 零运行时依赖降低安装与供应链负担。主要工程风险是长前端文件、服务端路由集中，以及 SQLite 内以 JSON 集合为主的状态模型，不是明显缺少核心业务模块。
- 外部双模型交叉意见未能取得：Antigravity 调用受账号地区限制返回 403；Claude wrapper 退出且未提供可用审查结果。因此本报告依据当前源码、文档、测试结构和现存界面截图完成，不把外部模型意见当作已完成的审查证据。

## 建议顺序

1. 论文和单案例评分成功时保存本次答案，再返回评分结果；同时明确草稿是否已保存。
2. 给练习会话绑定题目版本快照，并补针对“活动中编辑题目后恢复/交卷”的回归覆盖。
3. 导入题目使用来源命名空间，拒绝同批重复 ID 和与生成题冲突的 ID。
4. 在模型重试边界统一处理 fetch 网络错误和超时，并验证重试次数；补齐论文评分数值校验。
5. 更新模型用量说明以覆盖供应商差异，并更新首页 FSRS 复习说明。
6. `.env` 创建与更新时确保仅当前用户可读。
7. 后续逐步拆分 `public/app.js` 和 `server.mjs`，并增加浏览器交互与无障碍自动检查。

## 本次审查限制

- 遵循任务计划，没有运行测试、启动服务或修改应用实现。
- 未检查本机数据库、`.env` 内容及 PDF；不对本机学习数据数量或具体内容作推断。
- 视觉评价基于任务目录中已有的多视图截图，不是本次新跑的浏览器回归。
