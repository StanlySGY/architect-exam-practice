# 题库高风险命题的证据核对登记（2026-10-13）

> 这是对当前题库中少量高风险命题的逐条核查记录，不是整题答案认证。外部 `../architect-exam-bank/data/bank.json` 保持只读；脚本只检查登记的目标文本是否仍能在对应字段中精确找到。来源元数据填写完整不代表已经联网可达或证明命题。没有人工签核，所有记录的 `answerVerification` 均未设为已验证。

## 本轮处理结果

| 登记 ID | 对应条目 | 结论 | 处置 |
|---|---|---|---|
| `aws-lambda-timeout-scope` | `mock-2026年5月-模拟卷2-029` | AWS 官方文档支持普通 Lambda 函数的 900 秒（15 分钟）配置上限，但文档也列出特定 Managed Instances 异步/事件源映射场景的 5,400 秒例外。 | 保留作特定产品示例，明确普通函数与特定运行模式的范围；不能推广为所有 FaaS 的统一限制。来源：[AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)。 |
| `lora-trainable-parameter-ratio` | `mock-2026年5月-模拟卷3-068`、`mock-2026年5月-模拟卷5-065` | 原论文支持 LoRA 冻结预训练权重、训练低秩矩阵；GPT-3 175B 示例提到可训练参数可低至 0.01%。单个例子不能证明所有模型通常都落在 0.1%–1%，更不能推出任意“大模型”都可单卡微调。 | 将比例限定到具体模型、rank、目标层和设置；删去无条件的单卡能力保证，或给出可复现的模型/显存/量化条件。来源：[LoRA 原论文（arXiv:2106.09685）](https://arxiv.org/abs/2106.09685)。 |
| `wbs-100-percent-rule` | `mock-2026年5月-模拟卷4-035` | PMI 资料支持 WBS 覆盖范围内全部工作、子层汇总对应父层的 100% 规则，并强调分解层级要适合项目管理。 | 可保留 100% 规则核心解释；该来源不认证整道模拟题为真题，也不单独验证所有其他选项。来源：[PMI — Proactive Standard - Work Breakdown Structures](https://www.pmi.org/learning/library/practice-standard-work-breakdown-structures-8063)。 |
| `availability-mtbf-definition-conflict` | `mock-2026年5月-模拟卷5-002` | 解析同时写出 `MTBF/(MTBF+MTTR)` 与 `MTBF = MTTF + MTTR`，再说“更精确”公式为 `MTTF/(MTTF+MTTR)`，混用了不同的术语口径。按题目给的 999 h 与 1 h，第一种口径算得 99.9%，但解释本身需要统一定义。 | 暂不标为已核验。先明确 MTBF 指运行时间间隔还是包含修复时间的两次故障间隔，再统一公式与题干。未以任何一条未读到上下文的网络来源替代定义核对。 |
| `cpu-execution-time-calculation` | `mock-2026年5月-模拟卷6-007` | 独立复算 `6×10⁹ cycles ÷ 2.4×10⁹ cycles/s = 2.5 s`，数量级和单位一致。 | 仅标“计算已复算”；不等于真题来源或整题已核验。 |
| `amdahl-limit-calculation` | `mock-2026年5月-模拟卷7-056` | 在可并行比例 80%、处理器数趋向无穷且不另计额外开销的假设下，理论上限 `S = 1/(1−0.8) = 5`，推导一致。 | 保留“理论上限”与模型前提；不作为经验性能承诺。 |
| `cache-binary-unit-assumption` | `mock-2026年5月-模拟卷3-006` | 位数推导按 `1 GB = 2³⁰ B`、`1 KB = 2¹⁰ B` 的二进制计算约定自洽；单位缩写本身若按 SI 十进制解释则并非同一含义。 | 在题干或解析明确使用的二进制单位约定，避免将默认约定写成普遍定义。 |

## 审计机制

新增 `scripts/audit-bank-claim-evidence-register.mjs` 与 `test/bank-claim-evidence-register.test.mjs`。工具检查每一条登记能否在外部题库相应字段重新精确定位、来源元数据是否完整、处置类别是否在白名单中；不发起网络请求，不修改外部题库，也不把命题证据自动映射成 `verified` 或 `approved`。

登记现包含 11 个审查记录、17 个原文目标定位；其中 6 个记录关联公开来源，其他记录涉及内部定义/算术/单位约定与尚无实测依据的性能断言。精确定位通过只表示登记仍指向该条文字；来源支持范围内的命题也不等于整道题答案已获权威验证。未纳入本批次的 157 条风险候选与 1,595 条非模拟题来源映射候选仍维持原复核队列状态。

## 续查批次：持久化、退役依赖与历史性能案例（2026-10-13）

| 登记 ID | 当前题库目标 | 核查结果 | 处理建议 |
|---|---|---|---|
| `redis-aof-everysec-loss-bound` | `case-real-2025年上半年-3:问题3` | Redis 官方文档称 `appendfsync everysec` 每秒 fsync，灾难故障时可能丢失约一秒写入；这不应被包装为任何存储栈/故障情形下的严格绝对上限。 | 将“最多丢失1秒”改为“按秒刷盘，灾难故障时可能丢失约一秒写入”，并保留配置与故障模型限定。来源：[Redis persistence](https://redis.io/docs/latest/management/persistence/)。 |
| `codepush-retirement-and-archive` | `case-mock-2026年5月-模拟卷3-5:问题3` | Microsoft 官方资料确认 App Center 的非 Analytics/Diagnostics 功能及 CodePush 托管服务于 2025-03-31 退役；独立 CodePush Server 仓库在 2025-05-20 归档只读。自托管 fork 并非不存在，但原服务不应作为当前活跃托管方案宣传。 | 把 CodePush 标成历史/自行维护的自托管方案；删除没有测试口径的“5分钟内修复 bug”保证。来源：[Microsoft retirement notice](https://learn.microsoft.com/en-us/appcenter/retirement)、[archived upstream repository](https://github.com/microsoft/code-push-server)。 |
| `nyt-ec2-historical-throughput` | `real-2022年下半年-015` | AWS 官方 2008 年文章支持纽约时报用数百台机器在少于 36 小时内处理数据，并列出 405,000 张 TIFF、3.3 million SGML、405,000 XML 文件的工作量；该页面未在正文中直接量化输入总字节为 TB。 | 保留带年份的历史例子；将文件规模改用来源可支持的描述，或另补原始一手来源证明“TB级”容量。来源：[AWS News Blog — New York Times TimesMachine](https://aws.amazon.com/blogs/aws/new-york-times/)。 |
| `tls-latency-and-encryption-microbenchmark` | `case-mock-2026年5月-模拟卷1-1:问题2` | “TLS 加密不影响业务延迟”是绝对断言；同段的 10–50ms、1–5ms 没有硬件、TLS 版本、握手、连接复用、负载或测量依据。本条没有把无来源数字伪装成已查证事实。 | 改为目标环境的端到端基准测试建议；移除无条件数字，或附具体环境、测量方法与原始数据。 |

### 此批次的边界

- 本次累计 11 条审查记录、17 个原文目标定位。`npm run audit:claim-evidence` 支持将逐项审计结果写入 `docs/audits/bank-claim-evidence-audit-2026-10-13.json`。
- 本批次只把来源能直接支持的范围记录为支持；“历史案例有来源”不等于整道真题答案已核验，“上游仓库归档”也不等于所有社区 fork 不可运行。
- 所有新增记录的 `answerVerification` 均保持 `not-established`；没有修改外部题库、没有自动批准题目。
