# architect-exam-practice 后续审计交接（2026-11-05，WSL 本地执行版）

## 当前本地状态

- 仓库：`StanlySGY/architect-exam-practice`
- WSL 路径：`/home/sgy/workspace/architect-exam-practice`
- 工作分支：`audit/whole-unit-coverage-and-scoring-calibration`
- 分支基线：`89814db35a55e6de95e48633acd7b9dc8184b830`；此前已推送的审计提交为 `29166e5`、`1a96841`、`2268126`。当前继续在同一分支追加本轮扫描、路由和 CI 改进。
- 已创建 Draft PR #1：`https://github.com/StanlySGY/architect-exam-practice/pull/1`，目标分支 `main`；保持 Draft、未合并。当前这一轮新改动仍需提交并推送，之后会触发新一轮 CI。
- 用户原有未提交修改：`data/learning-content.json`（约 404 insertions / 130 deletions）。该文件包含真实课程修订，本轮全程保留，未 stash、覆盖、回退或纳入本轮审计补丁。
- 项目指令文件：Runner 本轮未发现 AGENTS.md 等仓库指令文件。
- 服务和 SQLite 未操作；未重启应用。

## 本轮已经实际落地

1. 新建 `scripts/learning-unit-scope.mjs`，统一两个学习审计器的范围；明确报告 18 条章节导读、5 条历史兼容/父级映射排除项。
2. `scripts/audit-learning-content.mjs` 输出原始总数、纳入单元数、排除 ID/原因和整单元覆盖边界。
3. `scripts/audit-learning-verification-queue.mjs` 将旧指标 `unitsWithCompleteClaimEvidence` 改为 `unitsPassingDeclaredWholeUnitVerificationGate`，避免把已声明状态/元数据门槛说成自动化整单元事实证明。
4. 两组回归测试补充排除范围、报告边界与元数据门槛断言；并修复既有测试将全库来源交叉复核数量写死为 49 的脆弱断言，改为从实际纳入单元动态统计。该修复适配用户未提交课程数据变更，不修改课程数据。
5. 新增只读评分校准器 `scripts/evaluate-scoring-calibration.mjs`；新增 `test/scoring-calibration.test.mjs`、人工双评采集模板和校准协议。
6. 新增代表性答案风险候选初审 `docs/audits/answer-risk-triage-2026-11-05.md`；它不是静态 157 条快照的全部裁决。
7. 将案例/论文评分器校准解析适配到生产 JSON 结构，混合 rubric/prompt/grader 版本会被阻止合并计算；补充模型身份/版本/采集日期校验。
8. 将答案风险扫描升级为按案例父题、共享长题干综合题聚合；过滤明确否定数字和题目复原度元数据误报；报告保留原始命中、独立记录、父级记录和重复上下文统计。
9. 新增选择题逐项初审、案例父级复核、论文数字语义复核三份文档，并刷新当前只读答案风险队列。
10. 新增 322 个 `partial` 学习单元分批清单，拆为 64 个显式待核主张单元（97 条主张）、11 个本地 PDF 来源真实性问题、247 个整单元人工覆盖缺口。
11. 真实 Chrome 对桌面/移动导航完成验收；发现并修复 `switchView()` 使用 `replaceState` 导致浏览器后退无法恢复上个模块的问题，改为只在视图改变时 `pushState`。
12. CI 工作流升级到 `checkout@v7.0.1`、`setup-node@v7.1.0` 和 `ubuntu-26.04`，并显式设置只读 `contents: read` 权限。

## 实际基线与审计结果

- 348 条原始课程记录。
- 排除 18 条章节导读和 5 条历史兼容映射，共 23 条；剩余 325 个叶子单元。
- 3 个单元原状态为 `verified`，322 个为 `partial`。
- 325 个叶子单元有至少一条结构有效的命题级证据；11 个单元仍有本地 PDF 来源真实性警告。
- 两个审计报告现在都输出 `wholeUnitCoverageStatus=not-established-by-automated-audit`。自动化不会宣称它证明了整单元事实完整覆盖。
- 当前外置题库风险扫描：155 条原始规则命中、149 条不同题目/子问题记录、107 个父级题目；24 个父题包含多个命中记录，1 条完全重复命中在展示层抑制。分类包括 41 条技术/计算/产品边界、4 条绝对化措辞、55 条结果指标需证据、4 条考试趋势、31 条上下文待复核、19 条场景/设计参数。
- 选择题：30 条原始命中/29 条不同记录；案例题：79 条命中/74 条不同子问题记录/37 个父级案例；论文：46 条记录。六个 2019 年下半年共享长题干选择题归为同一综合题父级。

## 本轮新增交付文档

- [选择题逐项初审](./audits/answer-risk-choice-adjudication-2026-11-05.md)
- [案例题父级初审](./audits/answer-risk-case-adjudication-2026-11-05.md)
- [论文指标初审](./audits/answer-risk-essay-adjudication-2026-11-05.md)
- [322 单元人工核验批次清单](./audits/learning-verification-batches-2026-11-05.md)
- [Chrome 浏览器实际验收记录](./audits/browser-acceptance-2026-11-05.md)

## 已执行验证

- `git diff --check`：通过。
- `npm run lint`：通过。
- 定向学习审计测试：76/76 通过。
- CLI 实际运行 `node scripts/audit-learning-content.mjs` 与 `node scripts/audit-learning-verification-queue.mjs`：两者成功；统计与上述基线一致。
- 全量 `npm test`：381/381 通过（2026-11-05，包含评分校准器新增测试）。

本轮新增风险扫描、评分校准和前端路由定向测试：35/35 通过（9 条风险扫描、6 条评分校准、20 条前端契约测试）。`node scripts/audit-learning-content.mjs` 与 `node scripts/audit-learning-verification-queue.mjs` 重新执行成功；322 单元互斥批次断言 64+11+247=322 且 97 条待核主张通过。空评分模板由原生进程接口确认退出码 2，状态为 `blocked-or-insufficient-anchor-samples`。

最终全量 `npm test`：390/390 通过；`git diff --check` 与 `npm run lint` 通过。空校准模板的 CLI 阻断码为 2；风险报告最终分类为技术/计算/产品边界 41、结果指标需证据 55、场景/设计参数 19、普通量化上下文 31、绝对化措辞 4、考试趋势 4。

浏览器实际验收见 `docs/audits/browser-acceptance-2026-11-05.md`：Chrome 对 12 个导航页在 1920×1080、390×844、320×740、768×1024 四种视口完成点击验证；所有文档级横向溢出为 0，Console/Runtime 异常均为 0。路由返回/前进已真实验证 `#home → #mock → back #home → forward #mock`。

## 未完成与限制

- 评分校准器必须用真实双人独立阅卷和裁决样本后才能得出有意义的校准结果；空模板预期是 blocked，不得用 AI 自评分数填充人工标签。
- 至少准备 10 份案例、10 份论文样本作为探索性起点；每份两位不同阅卷人盲评、裁决分数、AI 评分及 model/prompt/grader/rubric 版本齐备。
- 当前 155 条答案风险命中已按选择题、案例父题、论文三类形成逐项/逐父级初审文档，但“扫描命中分类”仍不是所有原题与正式答案的教材级终审；特别是 MTBF/MTTF 定义冲突、响应曲线信息不足等问题，需要与原卷/指定教材核对后才能修正式答案。
- 322 个 partial 单元仍需逐单元核对指定教材/权威一手资料和人工终审；不能因 URL 可达、AI 交叉复核或存在一条 bounded evidence 就升级。
- 浏览器验收覆盖导航、视口、横向溢出、路由返回/前进和前端运行时错误；没有运行会写入答题/学习数据或触发评分/生成模型的动作。不要启动 240 分钟考试作为回归测试。
- 没有修改相邻 `architect-exam-bank`、题目审批状态、生产 SQLite、用户学习记录/答题历史。
- 本轮本地 WSL Git 的既有分支已成功推送；当前工作区仍含新改动待提交，本轮 CI 工作流已升级至 checkout@v7.0.1 / setup-node@v7.1.0 / ubuntu-26.04，待本轮最新 HEAD 推送后重新核对 PR #1 的 Node 22/24 CI。

## 仍需真实人工完成的闭环

1. 为校准器提供真实案例题/论文题人工双评与裁决样本；目前没有真实锚点数据，因此校准结论仍 blocked。10+10 只是探索性样本起点，不是认证。
2. 322 个 `partial` 学习单元需要指定教材/权威一手资料逐项人工终审；11 个 PDF 单元需出版社或可信馆藏来源证实文件身份。
3. 选择题 MTBF/MTTF 公式定义冲突及响应曲线信息不足等问题，需要拿原卷/指定教材作最终裁决；本轮没有修改外置正式题库。
4. 本轮 CI 工作流升级后，需在 Draft PR 更新后核对 Node 22/24 全新远端工作流结果；不得把旧 run 的通过误算为新 HEAD 已通过。
5. 维护者审阅 PR #1 后再决定是否转为 Ready for review/合并；不自动合并，不在此分支部署。


## 2026-11-05 下一阶段复核更新（PDF 来源链）

本轮已完成本地教材 PDF 与清华大学出版社官方书目/目录的交叉核对，详见：

- [教材 PDF 来源与页码交叉复核](./audits/textbook-pdf-provenance-crosscheck-2026-11-05.md)

核心发现：本地 PDF 的 ISBN 9787302619925、第二版、书名/作者和产品编号 091901-01 与出版社正式记录相符；出版社官方目录确认第 9 章 9.1.5 在 p.311、9.2.3 在 p.314、9.3 在 p.316。本地 PDF 的物理页 326/329/330/331 分别对应印刷页 311/314/315/316。出版社提供的 23 页官方样章仅覆盖前部章节；其前 21 个正文页与本地对应页的文本抽取平均相似度约 0.9872，但不覆盖第 9 章目标页，不能认证完整 PDF。

因此原 11 个 PDF 单元的证据阻塞被细化为“书目身份/页码已匹配，但本地完整文件来源真实性和印次一致性未独立认证”。11 个单元仍为 partial，未修改课程数据和状态。完整 PDF 官方哈希、出版社正版完整电子文件或可信馆藏的第 9 章扫描件仍是下一步关闭证据。

本轮仍未取得真实双人盲评数据；评分校准保持 blocked。双人盲评采集流程已补入 docs/scoring-calibration-protocol.md，需要数据负责人提供有授权、脱敏的真实答卷和双评/裁决结果。

## 2026-11-05 下一阶段复核更新（批次 C 可执行队列）

本轮对当前工作区中的 247 个批次 C 单元完成只读量化检查，并新增可重复生成的分批审阅队列：

- 新增 scripts/build-learning-review-worklist.mjs；运行 npm run audit:learning-review-worklist，可用 -- --batch-size=10 调整每批大小（10–20，默认最多 20）。
- 队列沿用共享学习单元范围，将显式 pending claims 的 64 个单元与本地 PDF 来源警告的 11 个单元留在 A/B 批次；其余 partial 叶子单元进入 C 队列。
- 排序依次按五个教学字段的已知模板句式命中数量、有效命题证据条数、最早证据复核日期和自然数字 ID 排序。
- 当前工作区结果为 247 个 C 候选、13 个批次。204 个至少命中一个模板信号，143 个命中四个或更多；242 个只有一条结构有效的证据记录。原始 evidence 数组中 224 个只有一条记录；其中一些单元另有一条记录未通过有效性筛选，不能混淆这两个口径。
- 新增 test/learning-review-worklist.test.mjs，覆盖 A/B/C 分离、排序稳定性、批次边界、候选无遗漏重复和状态不变。
- 新增 docs/audits/learning-review-worklist-method-2026-11-05.md，并在 README 增加入口。

队列只是人工复核优先级线索，不是事实正确率或教学质量评分；不会修改课程正文、证据、partial/verified 状态、SQLite、答题记录或题库。测试与 lint 需在提交前重新执行并记录最新结果。用户既有的 data/learning-content.json 未提交修改仍须原样保留，不能暂存或提交。
