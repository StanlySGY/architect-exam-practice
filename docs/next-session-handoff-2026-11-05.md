# architect-exam-practice 后续审计交接（2026-11-05，WSL 本地执行版）

## 当前本地状态

- 仓库：`StanlySGY/architect-exam-practice`
- WSL 路径：`/home/sgy/workspace/architect-exam-practice`
- 工作分支：`audit/whole-unit-coverage-and-scoring-calibration`
- 基线 HEAD：`89814db35a55e6de95e48633acd7b9dc8184b830`
- 上游：`origin/main`；本轮尚未提交或推送。
- 用户原有未提交修改：`data/learning-content.json`（约 404 insertions / 130 deletions）。该文件包含真实课程修订，本轮全程保留，未 stash、覆盖、回退或纳入本轮审计补丁。
- 项目指令文件：Runner 本轮未发现 AGENTS.md 等仓库指令文件。
- 服务和 SQLite 未操作；未重启应用。

## 本轮已经实际落地

1. 新建 `scripts/learning-unit-scope.mjs`，统一两个学习审计器的范围；明确报告 18 条章节导读、5 条历史兼容/父级映射排除项。
2. `scripts/audit-learning-content.mjs` 输出原始总数、纳入单元数、排除 ID/原因和整单元覆盖边界。
3. `scripts/audit-learning-verification-queue.mjs` 将旧指标 `unitsWithCompleteClaimEvidence` 改为 `unitsPassingDeclaredWholeUnitVerificationGate`，避免把已声明状态/元数据门槛说成自动化整单元事实证明。
4. 两组回归测试补充排除范围、报告边界与元数据门槛断言；并修复既有测试将全库来源交叉复核数量写死为 49 的脆弱断言，改为从实际纳入单元动态统计。该修复适配用户未提交课程数据变更，不修改课程数据。
5. 新增只读评分校准器 `scripts/evaluate-scoring-calibration.mjs`；新增 `test/scoring-calibration.test.mjs`、人工双评采集模板和校准协议。
6. 新增代表性答案风险候选初审 `docs/audits/answer-risk-triage-2026-11-05.md`；它不是 157 条候选的全部裁决。
7. 更新本交接文档，记录实际 WSL 分支、未提交数据保护与当前验证状态。

## 实际基线与审计结果

- 348 条原始课程记录。
- 排除 18 条章节导读和 5 条历史兼容映射，共 23 条；剩余 325 个叶子单元。
- 3 个单元原状态为 `verified`，322 个为 `partial`。
- 325 个叶子单元有至少一条结构有效的命题级证据；11 个单元仍有本地 PDF 来源真实性警告。
- 两个审计报告现在都输出 `wholeUnitCoverageStatus=not-established-by-automated-audit`。自动化不会宣称它证明了整单元事实完整覆盖。

## 已执行验证

- `git diff --check`：通过。
- `npm run lint`：通过。
- 定向学习审计测试：76/76 通过。
- CLI 实际运行 `node scripts/audit-learning-content.mjs` 与 `node scripts/audit-learning-verification-queue.mjs`：两者成功；统计与上述基线一致。
- 全量 `npm test`：381/381 通过（2026-11-05，包含评分校准器新增测试）。

评分校准器语法检查和单测通过（4/4）；空模板 CLI 已由原生进程接口确认以退出码 2 返回 `blocked-or-insufficient-anchor-samples`。包含新增 4 个校准用例的全量 `npm test` 为 381/381 通过。最终 lint/差异检查已在本轮追加复核；全量 CI、Git 提交与推送尚未完成。

## 未完成与限制

- 评分校准器必须用真实双人独立阅卷和裁决样本后才能得出有意义的校准结果；空模板预期是 blocked，不得用 AI 自评分数填充人工标签。
- 至少准备 10 份案例、10 份论文样本作为探索性起点；每份两位不同阅卷人盲评、裁决分数、AI 评分及 model/prompt/grader/rubric 版本齐备。
- 157 条答案风险候选仍未全部逐项裁决；当前只初审代表性候选。
- 322 个 partial 单元仍需逐单元核对指定教材/权威一手资料和人工终审；不能因 URL 可达、AI 交叉复核或存在一条 bounded evidence 就升级。
- 没有运行本机浏览器 UI 验收；不得声称本轮覆盖 12 个主导航、桌面/移动端或真实考试链路。不要启动 240 分钟考试，也不要触发真实模型调用作为验收。
- 没有修改相邻 `architect-exam-bank`、题目审批状态、生产 SQLite、用户学习记录/答题历史。
- GitHub Connector 先前写操作曾返回 403；优先用本地 WSL git push 实际验证，不要仅凭 API 权限失败就断言本地 Git 也没有权限。

## 下一步执行顺序

1. 复核工作区和暂存差异；**仅暂存本轮审计、测试、工具和文档文件，排除用户的 `data/learning-content.json`**。
2. 提交独立分支并推送 `origin`；推送成功才报告远端分支可见。
3. 若需要 UI 验收，另行连接 WSL 本地 Browser Use MCP，执行只读导航/状态恢复/响应式检查；不要重启服务或启动长时考试。
4. 继续对答案风险候选按父级题目去重分批复核，先处理 MTBF/MTTF 公式定义候选。
