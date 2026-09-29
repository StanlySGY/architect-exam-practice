# 全项目审查结果

审查日期：2026-09-29

审查对象：当前工作区中的代码、配置、文档、测试结构和已有桌面/移动/深浅色界面截图。

边界：只读审查；未查看 `.env` 内容、本机学习数据库或 PDF；按计划未运行测试。

## 总体结论

项目是一个功能覆盖广、面向本机单用户的软考架构师学习应用。章节练习、AI 生成题、错题复习、模拟考试、真题导入、案例与论文练习、资料阅读、Wiki/知识图谱、统计、备份和模型配置已经组成较完整的学习闭环。当前版本已实现旧对标报告中列为缺项的 FSRS-6、深色主题、命令面板、置信度、学习热力图、Wiki 检索与弃答、模型退避与用量记录、在线 SQLite 备份以及 CI；旧报告中的固定间隔和“没有暗色模式”等判断不再适用。

**评分：总体 8.0/10。** 功能完整度 8.5/10，交互体验 8.0/10，视觉与信息组织 8.0/10，安全性（本机单用户威胁模型）8.0/10，工程可维护性 7.0/10。项目已达到可日常使用的程度，但题目版本与活动会话的一致性、导入 ID 隔离和凭据文件权限仍需收尾；因此不建议把它描述成没有边界问题的“完全完善”。

## 问题分级

### P1：优先修复

1. **活动会话没有固定题目版本，编辑可能改变已作答题目的判分。** 会话只保存题目 ID（[sessions.mjs](/home/sgy/workspace/architect-exam-practice/src/service/sessions.mjs:296)）；恢复时按 ID 读取当前题库内容（[sessions.mjs](/home/sgy/workspace/architect-exam-practice/src/service/sessions.mjs:335)），提交时也从当前题库重新取题并计算正确答案（[sessions.mjs](/home/sgy/workspace/architect-exam-practice/src/service/sessions.mjs:554)）。题库编辑会递增题目 revision 并保留最多五份旧快照，但活动会话没有保存或校验该 revision（[bank.mjs](/home/sgy/workspace/architect-exam-practice/src/service/bank.mjs:124)）。在另一个标签页编辑题目后恢复旧练习，旧作答可能按新题干/答案判分。建议在会话中保存题目快照或不可变 revision，并用快照恢复、判卷和写入历史记录。


### P2：建议修复

1. **题库导入存在 ID 冲突覆盖风险。** 导入时用所有现存题目的 ID 建立索引（[data.mjs](/home/sgy/workspace/architect-exam-practice/src/service/data.mjs:363)），外部题目 ID 原样保留（[import-bank.mjs](/home/sgy/workspace/architect-exam-practice/src/import-bank.mjs:92)）；相同 ID 会走“更新”路径并把导入题内容写到现有记录上（[data.mjs](/home/sgy/workspace/architect-exam-practice/src/service/data.mjs:370)）。如果它与生成题 ID 相同，生成题会被改成导入题。建议给导入题 ID 加稳定来源命名空间，并在导入前校验重复 ID 与跨来源冲突。

2. **首页复习说明仍显示旧的固定间隔。** 首页文案称按 `1、3、7、14、30` 天推进（[index.html](/home/sgy/workspace/architect-exam-practice/public/index.html:157)），而当前复习实际由 FSRS-6 和用户评分调度，README 已描述新行为（[README.md](/home/sgy/workspace/architect-exam-practice/README.md:17)）。这会让用户对下次复习日期和评分按钮产生错误预期，应改为描述动态间隔。

3. **前端主脚本和 HTTP 路由仍集中在大文件中。** `public/app.js` 约 5,429 行，`server.mjs` 约 885 行。当前按服务域拆分的方向是合理的，但单体前端脚本和路由分发会增加回归定位、代码审查及后续协作成本。建议随功能迭代渐进拆成 ES 模块和独立路由模块，不需要一次性重写。

4. **模型配置文件权限可以更严格。** `writeEnv()` 最终直接调用 `writeFile()`，没有指定权限或收紧已有权限（[model-config.mjs](/home/sgy/workspace/architect-exam-practice/src/model-config.mjs:359)、[model-config.mjs](/home/sgy/workspace/architect-exam-practice/src/model-config.mjs:384)）。当前 `.env` 为 `0644`，但父目录 `/home/sgy` 为 `0750` 且组内只有当前用户，所以本机其他普通账户目前无法读取；如果项目迁至共享目录或父目录权限放宽，密钥会暴露给可遍历该目录的用户。建议写入时收紧到 `0600`。

## 功能与体验评估

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 练习闭环 | 较完整 | 章节/小节选题、生成与去重、即时反馈、锁定首答、恢复会话、错题回顾、历史记录和模拟考试均有对应实现。 |
| 复习与反馈 | 完整度较高 | FSRS-6 调度、四档自评和间隔预览已实现；置信度和选项级解析也接入结果视图。 |
| 真题及主观题 | 覆盖较广 | 支持按考期导入综合知识题、案例模拟和论文题，并提供 AI 评分；AI 主观题评分仍应作为学习反馈，不宜等同正式阅卷结论。 |
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

1. 给练习会话绑定题目版本快照，并补针对“活动中编辑题目后恢复/交卷”的回归覆盖。
2. 导入题目使用来源命名空间，拒绝同批重复 ID 和与生成题冲突的 ID。
3. 更新首页间隔说明，使其与 FSRS 动态调度一致。
4. `.env` 创建与更新时确保仅当前用户可读。
5. 后续逐步拆分 `public/app.js` 和 `server.mjs`，并增加浏览器交互与无障碍自动检查。

## 本次审查限制

- 遵循任务计划，没有运行测试、启动服务或修改应用实现。
- 未检查本机数据库、`.env` 内容及 PDF；不对本机学习数据数量或具体内容作推断。
- 视觉评价基于任务目录中已有的多视图截图，不是本次新跑的浏览器回归。
