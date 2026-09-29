# 全项目对标审查:模块功能 × 2026 主流开源 + UI/UX 对比

审查日期:2026-09-28。方法:通读核心代码(server.mjs、src/、public/、store、generator、service 各域),实际启动应用对 14 个视图截图(`screenshots/`),并行四路外部调研(刷题/SRS、知识库/图谱、UI/UX、工程架构),对标数据为 2026-09 时点的 GitHub 星数与官方文档。本报告只评审,不改代码。

## TL;DR

功能广度和细节打磨(防重、溯源、审计、答案保护、问题题闭环)超过绝大多数同类开源刷题工具,视觉有自己的性格、不是模板脸。真正的差距集中在四处:

1. **复习算法停留在 SM-0 时代**——固定 1/3/7/14/30 阶梯;Anki 26.09 已把 SM-2 标为 legacy,FSRS-6 是 2026 事实标准。
2. **出题质检缺最后 20%**——溯源+防重很好,但解析是整段文本,无选项级错因归因,无难度校准,LLM 调用无 strict 解码/退避/记账。
3. **UI 缺 2026 基线**——无暗色、无 OKLCH token、无命令面板、复盘呈现弱。
4. **工程底座**——单 JSON blob 存储 + 8 层继承链能用但有天花板;无 CI/lint;README 落后于实现。

## 一、逐模块对比

### 1. 错题复习(差距最大,收益也最大)

- 现状:`src/service/helpers.mjs:15` 写死 `REVIEW_INTERVALS=[1,3,7,14,30]`,`src/service/sessions.mjs:591-597` 复习连对 5 次毕业,手动恢复重置阶梯。
- 对标:Anki(31.6k★,26.09.3 内置 fsrs-rs 6.6)把固定间隔类算法标为 legacy,推荐 FSRS-6(21 参数 DSR 模型,可用个人作答历史拟合参数);`ts-fsrs` 的 `scheduler.repeat()` 能在作答前预览 Again/Hard/Good/Easy 四档新间隔;FSRS Helper 的负载均衡/顺延/easy days 证明"复习工作量控制"是产品功能而不只是算法细节(https://github.com/open-spaced-repetition/ts-fsrs ,https://docs.ankiweb.net/deck-options.html)。
- 截图佐证:错题本里出现"下次回顾 2026/6/20"——逾期三个月。固定阶梯 + 无顺延机制会让欠账无限堆积,错题本越用越挫败。
- 建议:vendor `ts-fsrs`(约 800 行,保持零依赖)替换阶梯,每题存 `{difficulty, stability, due, reps, lapses}`;复习入口按 retrievability 排序;加"顺延/提前"处理积压。旧阶梯记录可一次性映射为 FSRS 初始参数。

### 2. 出题质量与防重(基本盘很好,缺最后 20%)

做得好(开源出题工具里少见):JSON Schema 校验 + `source_node` 溯源(`nodePath` 验证,不溯源即丢弃)+ 同章历史题注入提示词防改写 + bigram 近似过滤 + 3 轮自动补题(`src/generator.mjs:334-494`)。

差距:
- **结构化输出**:现在是把 schema 字符串贴进提示词 + `response_format: json_object`(`src/generator.mjs:161`),解析兜底是正则抽 `{...}`(`generator.mjs:301-312`)。2026 默认是 strict `json_schema` 约束解码;且无重试/指数退避、无 token 用量与费用记账(OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs)。
- **无选项级错因**:Eedi 把每个错误选项映射到命名 misconception,判错后直接提示"你混淆了 X 与 Y"(https://www.kaggle.com/competitions/eedi-mining-misconceptions-in-mathematics)。你的 schema 已生成 `common_mistake`,只差把粒度下沉到选项级(每个选项一条 rationale,Khan Perseus 的最小可借鉴 schema)。
- **无难度校准**:只有对错计数。Moodle 对每题算 facility index + 区分度,可自动标出"过易/过难/负区分度"的坏题(https://docs.moodle.org/en/Quiz_reports);单人场景用 Elo 式在线更新即可。
- **题目不可版本化**:改题干会污染历史统计;Moodle 是 `question_versions` 逐版本递增。问题题上报/恢复闭环已对齐 PrairieLearn 的 issue reporting,缺 resolution 状态(open→fixed→excluded)。

### 3. 知识库 + 知识图谱(完成度最高,接近主流)

做得好:233 条目、双向链接三级解析(精确→互相包含→bigram)、lint(duplicate_title/broken_related/orphan/missing_source)+ 修复建议 + 同名合并闭环(`src/service/wiki.mjs`),自研小工具里罕见;图谱有 hover 邻居高亮、搜索高亮、语义缩放标签、原地详情气泡、全屏——Obsidian graph 的核心约定基本齐了。

差距:
- **"问知识库"无检索层**、无弃答阈值;主流(RAGFlow 91k★、Graphiti/Zep 31k★)是 BM25+向量混合检索 + RRF + 引用可点击回跳 + 低置信弃答(https://github.com/infiniflow/ragflow)。
- **无 embedding**:相关条目靠字符串相似,近重复对改写无能为力;本地小模型 embedding 可同时解决"相关推荐 + 近重复"(Smart Connections 模式)。
- 图谱缺 **local graph**(从当前条目看 1–2 度邻域,Obsidian 最高频用法);着色分组已有(按章节/状态/关联度,截图确认)。
- 无社区聚类摘要(GraphRAG 用 Leiden 社区报告回答概述类问题,https://microsoft.github.io/graphrag/)。

### 4. 练习/模拟考/案例/论文

做得好:答题卡 + 即时判题 + 服务端锁首答 + 刷新恢复;模拟考 150 分钟倒计时自动交卷 + 120s 宽限(`EXAM_GRACE_SECONDS`),对齐 PrairieLearn 的 autoClose 语义;案例/论文接 AI 评分。

差距:
- **复盘呈现弱**:UWorld 是"左题右解析"双栏 + 每个选项的 rationale + 考点/参考 tab;本项目结果卡是整段 analysis + 两个 tip(`public/app.js:1127-1155`)。注意:`commonMistake`/`memoryTip` 已渲染,但 **`knowledgeDetail`(知识点详解)生成并入库后在 UI 从未展示**——白花生成成本。
- **无 confidence 标记**:Moodle CBM(确定/大概/猜测)在单人场景就是最好的错误分类器——"自信地错"= 误解,"心虚地错"= 没掌握(https://docs.moodle.org/en/Multiple_Choice_question_type)。

### 5. 学习统计

现状:汇总卡 + 章节正确率条形 + 最近 12 次柱状 + 高频错误知识点 + 知识点掌握度(截图 `stats.png`)。
对标:Anki 24.11+ 统计含 true retention、遗忘曲线、未来负载;Khan 的 attempted→proficient→mastered 掌握阶梯;刷题类通用的 GitHub 式打卡热力图。
建议:热力图(数据已有,`getStudyPlan` 里就算过 answeredByDay)+ FSRS retrievability 曲线 + 章节掌握度阶梯。

### 6. 存储 / 服务层 / 路由

- `src/store.mjs`:整库是 11 个 key 的 JSON blob,每次写全量序列化再 diff 写回。7.2MB 无压力,但 Anki/Trilium/Actual/Logseq 2.0 无一例外正规化表;要做 FTS5 搜索、题目版本、难度校准都会撞墙。迁移路径:`PRAGMA user_version` + 分表;`questionSnapshot` 冗余整题是 blob 模式的补丁。
- `synchronous=FULL` 在 WAL 下是最高 fsync 代价;SQLite 官方推荐 WAL 配 NORMAL(断电只丢最后几笔提交,不损坏)(https://www.sqlite.org/wal.html)。
- `server.mjs` 是 841 行 if 瀑布,但 auth/CSRF/Host 校验/413/415/静默取消都有,质量不错;建议收成 `{method, pattern, handler, schema}` 声明式路由表(零依赖约 100 行)。
- 服务层 8 层继承链(base→data→bank→review→sessions→…→wiki)领域拆分对,建议改显式组合(对象/函数注入),便于按域 mock 测试。

### 7. 工程化

- 零依赖在 2025-26 npm 供应链攻击背景下站得住,但 `engines` 应收紧 `>=22.15`(node:sqlite Stable 化版本)(https://nodejs.org/api/sqlite.html)。
- 无 CI、无 lint(`node --check` 只查语法)、无 coverage;`node --test` 已够用。
- README 明显落后:wiki 知识库、资料阅读器、Agent 工作台、学习计划/打卡、案例模拟卷均未入档或一笔带过。
- LLM 模块缺 usage/费用记录与 prompt 缓存(教程内容前缀稳定,是理想缓存前缀,https://developers.openai.com/api/docs/guides/prompt-caching)。

## 二、UI/UX 对比(截图见 screenshots/)

**要保持的优点**:绿+纸质感统一、衬线标题有性格;侧栏分组 + 今日进度 + 模型状态 footer;UWorld/粉笔式答题卡格子;移动端 3 列折叠(`mobile-home.png`);空状态有引导;图谱交互对齐 Obsidian;键盘 A–D + 方向键已有(`app.js:4716`)。

差距按影响排序:
1. **无暗色模式**(2026 table stakes)。路径:OKLCH 语义 token(约 12 个 `:root` 变量;`styles.css:1` 现在仅 15 个变量 + 大量硬编码 #f0f0f0/#f8dfda/#edf6df)+ `light-dark()` 函数,一份样式表两主题(https://web.dev/articles/light-dark)。
2. **复盘呈现**(见 4.4,UWorld 式双栏 + 选项级归因 + 启用 knowledgeDetail)。
3. **无 Cmd+K 命令面板**——Linear/GitHub/Obsidian 已把它变成 app-shell 默认;vanilla 150 行可实现(静态动作列表 + 模糊过滤)。
4. **键盘不完整**:缺 1–4 数字选择、Enter=下一题、空格提交,按钮无 keycap 提示(Anki 映射:https://docs.ankiweb.net/studying.html)。
5. **统计可视化**:缺热力图/掌握度阶梯(见 5)。
6. **阅读器**:TOC/字号/窄版/专注已有,缺 scroll 进度条(`animation-timeline: scroll()` 一行)、缺划线笔记、长文可选宋体正文。
7. **动效与可访问性**:视图切换 View Transitions、150–250ms 标准缓动、`prefers-reduced-motion`、`:focus-visible`、24px 命中目标(WCAG 2.2 Target Size)。
8. CJK 细节:标题 `text-wrap: balance`、`text-spacing-trim`;正文行长现状已可以。

## 三、优先级路线(价值/成本)

**P0(本周级,高值低本)**
1. FSRS-6 调度(vendor ts-fsrs)替换固定阶梯 + 顺延/积压处理
2. OKLCH token + 暗色模式
3. Cmd+K 命令面板 + 键盘补全(1–4/Enter/Space + keycap 提示)
4. strict json_schema + 重试退避 + token 记账
5. 20 行 GitHub Actions(node --check + node --test,Node 22/24 矩阵)

**P1(一月级)**
6. UWorld 式结构化复盘(启用 knowledgeDetail + 选项级 misconception 字段进生成 schema)
7. 统计升级:热力图 + 掌握度阶梯 + 真实保留率
8. 题目版本化 + issue resolution 状态机
9. wiki:本地 embedding(相关推荐/近重复)+ ask 混合检索与弃答 + local graph
10. store 正规化 + FTS5(风险最高,放在 1–2 之后)

**P2**
11. Elo 难度校准 + facility 报告;confidence 标记;阅读器划线/进度;prompt 缓存;synchronous=NORMAL;README 补齐;服务层继承链改组合

## 四、评分(10 分制)

| 维度 | 分 | 一句话 |
| --- | --- | --- |
| 功能覆盖 | 9 | 章节/模拟/案例/论文/知识库/资料全链路 |
| 出题质检 | 7 | 溯源+防重好;缺 strict 解码/难度校准/选项级归因 |
| 复习算法 | 5 | 固定阶梯 = 2015 水准,FSRS 才是 2026 标准 |
| 数据架构 | 5 | blob KV 能用但天花板明显 |
| 代码组织 | 7 | 领域拆分好;继承链与路由瀑布待收 |
| UI 视觉 | 7.5 | 有性格、干净;缺暗色/token 体系 |
| 交互 | 7 | 键盘/答题卡/图谱好;缺 palette/复盘深度/动效 |
| 工程化 | 5.5 | 无 CI/lint/coverage,README 滞后 |
| 安全(本机定位) | 8 | token/CSRF/Host/输入上限都细 |
