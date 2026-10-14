# 题库高风险命题的证据核对登记（2026-10-13）

> 这是对当前题库中少量高风险命题的逐条核查记录，不是整题答案认证。外部 `../architect-exam-bank/data/bank.json` 保持只读；脚本只检查登记的目标文本是否仍能在对应字段中精确找到。来源元数据填写完整不代表已经联网可达或证明命题。没有人工签核，所有记录的 `answerVerification` 均未设为已验证。

## 本轮处理结果

| 登记 ID | 对应条目 | 结论 | 处置 |
|---|---|---|---|
| `aws-lambda-timeout-scope` | `mock-2026年5月-模拟卷2-029` | AWS 官方文档支持普通 Lambda 函数的 900 秒（15 分钟）配置上限，但文档也列出特定 Managed Instances 异步/事件源映射场景的 5,400 秒例外。 | 保留作特定产品示例，明确普通函数与特定运行模式的范围；不能推广为所有 FaaS 的统一限制。来源：[AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)。 |
| `lora-trainable-parameter-ratio` | `mock-2026年5月-模拟卷3-068`、`mock-2026年5月-模拟卷5-065` | 原论文支持 LoRA 冻结预训练权重、训练低秩矩阵；GPT-3 175B 示例提到可训练参数可低至 0.01%。单个例子不能证明所有模型通常都落在 0.1%–1%，更不能推出任意“大模型”都可单卡微调。 | 将比例限定到具体模型、rank、目标层和设置；删去无条件的单卡能力保证，或给出可复现的模型/显存/量化条件。来源：[LoRA 原论文（arXiv:2106.09685）](https://arxiv.org/abs/2106.09685)。 |
| `wbs-100-percent-rule` | `mock-2026年5月-模拟卷4-035` | PMI 资料支持 WBS 覆盖范围内全部工作、子层汇总对应父层的 100% 规则，并强调分解层级要适合项目管理。 | 可保留 100% 规则核心解释；该来源不认证整道模拟题为真题，也不单独验证所有其他选项。来源：[PMI — Proactive Standard - Work Breakdown Structures](https://www.pmi.org/learning/library/practice-standard-work-breakdown-structures-8063)。 |
| `availability-mtbf-definition-conflict` | `mock-2026年5月-模拟卷5-002` | NASA 的稳态固有可用性公式支持 `MTBF/(MTBF+MTTR)`；`999/(999+1)=99.9%` 算术正确，但解析随后写出 `MTBF = MTTF + MTTR` 并改用 `MTTF/(MTTF+MTTR)`，没有统一平均时间的计量起止点。 | 答案 C 可在惯用固有可用性口径下成立；应重写冲突的术语解释，不因一个选项算对就宣称整题已核验。来源：[NASA — Inherent Availability formula](https://www.nasa.gov/wp-content/uploads/2023/11/170508-formulas-inherent-availability-and-reliability-with-constant-failure-and-repair-rates.pdf)、[NASA Reliability-Centered Maintenance Guide §14.3 and Glossary](https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf)。 |
| `cpu-execution-time-calculation` | `mock-2026年5月-模拟卷6-007` | 独立复算 `6×10⁹ cycles ÷ 2.4×10⁹ cycles/s = 2.5 s`，数量级和单位一致。 | 仅标“计算已复算”；不等于真题来源或整题已核验。 |
| `amdahl-limit-calculation` | `mock-2026年5月-模拟卷7-056` | 在可并行比例 80%、处理器数趋向无穷且不另计额外开销的假设下，理论上限 `S = 1/(1−0.8) = 5`，推导一致。 | 保留“理论上限”与模型前提；不作为经验性能承诺。 |
| `cache-binary-unit-assumption` | `mock-2026年5月-模拟卷3-006` | 位数推导按 `1 GB = 2³⁰ B`、`1 KB = 2¹⁰ B` 的二进制计算约定自洽；单位缩写本身若按 SI 十进制解释则并非同一含义。 | 在题干或解析明确使用的二进制单位约定，避免将默认约定写成普遍定义。 |
| `sdp-service-visibility-overgeneralization` | `mock-2026年5月-模拟卷2-055` | NIST 支持先认证/授权再建立资源会话，但未保证所有 SDP 实现都将所有服务和端口对未认证用户完全隐藏。 | 限定为常见设计目标，并说明实际可见性取决于实现/部署。来源：[NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final)。 |
| `unsupported-exam-frequency-prediction` | `mock-2026年5月-模拟卷5-002` | “几乎每年必考1题”没有完整官方历年题目序列与统计口径支撑；不将其作为已核实考试统计。 | 删除事实式频率断言，或标成作者复习判断并附逐年来源与统计口径。 |
| `security-attack-prevention-percentage-unsubstantiated` | `real-2019年下半年-012` | “防止99%的黑客攻击”缺少攻击类型、威胁模型、分母、观察期与测试方法，不能从 NIST 度量指南推出该比例。 | 定义可复现的测量条件或删除该百分比。来源：[NIST SP 800-55 Vol. 1](https://csrc.nist.gov/pubs/sp/800/55/v1/final)。 |

## 审计机制

新增 `scripts/audit-bank-claim-evidence-register.mjs` 与 `test/bank-claim-evidence-register.test.mjs`。工具检查每一条登记能否在外部题库相应字段重新精确定位、来源元数据是否完整、处置类别是否在白名单中；不发起网络请求，不修改外部题库，也不把命题证据自动映射成 `verified` 或 `approved`。

登记现包含 38 个审查记录、64 个原文目标定位；其中 18 个记录关联公开来源，其他记录涉及内部定义/算术/单位约定、考试频率预测、示例论文结果及尚无实测依据的性能断言。精确定位通过只表示登记仍指向该条文字；来源支持范围内的命题也不等于整道题答案已获权威验证。独立的答案风险队列仍列出 157 条候选、来源映射队列仍列出 1,595 条候选；这两个总数尚未与本登记逐条去重对账，不能当成“剩余未审条数”。

## 续查批次：持久化、退役依赖与历史性能案例（2026-10-13）

| 登记 ID | 当前题库目标 | 核查结果 | 处理建议 |
|---|---|---|---|
| `redis-aof-everysec-loss-bound` | `case-real-2025年上半年-3:问题3` | Redis 官方文档称 `appendfsync everysec` 每秒 fsync，灾难故障时可能丢失约一秒写入；这不应被包装为任何存储栈/故障情形下的严格绝对上限。 | 将“最多丢失1秒”改为“按秒刷盘，灾难故障时可能丢失约一秒写入”，并保留配置与故障模型限定。来源：[Redis persistence](https://redis.io/docs/latest/management/persistence/)。 |
| `codepush-retirement-and-archive` | `case-mock-2026年5月-模拟卷3-5:问题3` | Microsoft 官方资料确认 App Center 的非 Analytics/Diagnostics 功能及 CodePush 托管服务于 2025-03-31 退役；独立 CodePush Server 仓库在 2025-05-20 归档只读。自托管 fork 并非不存在，但原服务不应作为当前活跃托管方案宣传。 | 把 CodePush 标成历史/自行维护的自托管方案；删除没有测试口径的“5分钟内修复 bug”保证。来源：[Microsoft retirement notice](https://learn.microsoft.com/en-us/appcenter/retirement)、[archived upstream repository](https://github.com/microsoft/code-push-server)。 |
| `nyt-ec2-historical-throughput` | `real-2022年下半年-015` | AWS 官方 2008 年文章支持纽约时报用数百台机器在少于 36 小时内处理数据，并列出 405,000 张 TIFF、3.3 million SGML、405,000 XML 文件的工作量；该页面未在正文中直接量化输入总字节为 TB。 | 保留带年份的历史例子；将文件规模改用来源可支持的描述，或另补原始一手来源证明“TB级”容量。来源：[AWS News Blog — New York Times TimesMachine](https://aws.amazon.com/blogs/aws/new-york-times/)。 |
| `tls-latency-and-encryption-microbenchmark` | `case-mock-2026年5月-模拟卷1-1:问题2` | “TLS 加密不影响业务延迟”是绝对断言；RFC 8446 描述完整握手的消息/往返过程和恢复连接的 0-RTT 风险，但不给出普适毫秒数。该题的 10–50ms、1–5ms 没有测试前提。 | 改为目标环境的端到端基准测试建议；移除无条件数字，或附具体环境、测量方法与原始数据。来源：[RFC 8446](https://www.rfc-editor.org/rfc/rfc8446)。 |
| `aes-round-count-performance-and-quantum-strength-scope` | `case-real-2025年下半年-6:问题2` | NIST 支持 AES-128 为 10 轮、AES-256 为 14 轮；不支持把 AES-256 一概写成慢 40%。“量子有效 128 位”应注明为通用 Grover 搜索的简化估算，而非无条件安全强度认证。 | 保留轮数和密钥长度；性能百分比需附可复现基准；量子安全说法需限定模型。来源：[NIST FIPS 197](https://csrc.nist.gov/pubs/fips/197/final)、[NIST PQC FAQ](https://csrc.nist.gov/Projects/post-quantum-cryptography/faqs)。 |

### 此批次的边界

- 本次累计 32 条审查记录、50 个原文目标定位。`npm run audit:claim-evidence` 支持将逐项审计结果写入 `docs/audits/bank-claim-evidence-audit-2026-10-13.json`。
- 本批次只把来源能直接支持的范围记录为支持；“历史案例有来源”不等于整道真题答案已核验，“上游仓库归档”也不等于所有社区 fork 不可运行。
- 所有新增记录的 `answerVerification` 均保持 `not-established`；没有修改外部题库、没有自动批准题目。

## 续查批次：零信任边界、考试频率与安全指标（2026-10-13）

- `sdp-service-visibility-overgeneralization`：NIST SP 800-207 支持认证与授权先于资源会话建立、按最小权限保护资源；但它不是对每一种 SDP 产品的接口行为认证，不能支撑“所有服务与端口对所有未认证用户完全不可见”的绝对说法。
- `unsupported-exam-frequency-prediction`：把 MTTF/MTTR/MTBF 描述为“几乎每年必考1题”需要完整官方历年原卷序列和稳定分类口径。当前条目没有这类统计证据，建议改成明确的复习建议，而非事实式频率陈述。
- `security-attack-prevention-percentage-unsubstantiated`：NIST SP 800-55 Vol. 1 指导如何开发、选择和评价信息安全度量，但不提供“拦截99%黑客攻击”的通用标准。该目标至少需要攻击分类、威胁模型、分母、观察窗口和可复现测试方法。

## 续查批次：Kafka 调优边界与可计算性能指标（2026-10-13）

- `kafka-batch-tuning-with-latency-bound`：Apache Kafka 4.0 官方 producer 配置文档说明 batch size 与 linger 的工作方式及吞吐量、内存和延迟权衡。它支持将增大批次/等待时间作为调优方向，但不证明 `64KiB→256KiB` 或 `0→20ms` 对任何工作负载都最佳。应明确 Kafka 版本并基于代表性流量测吞吐、尾延迟与内存。来源：[Apache Kafka 4.0 producer configs](https://kafka.apache.org/40/configuration/producer-configs/)。
- `availability-four-nines-downtime-calculation`：按一年 365.25 天计，全年共有 525,960 分钟；99.99% 的 0.01% 不可用比例对应约 52.596 分钟。可保留算术，但要确认具体 SLA 的计量窗口与排除项。
- `throughput-tps-calculation`：36,000 次事务 / 3,600 秒 = 10 TPS，算术和单位一致；这是题面数值复算，不是系统压测结果。
- `mm1-queueing-response-time-calculation`：λ=4/min、μ=5/min 满足稳定条件 λ<μ；M/M/1 模型给出平均逗留时间 W=1 分钟、平均排队等待 Wq=0.8 分钟、服务时间 0.2 分钟。只验证模型内计算，不外推为生产环境 SLA。

## 续查批次：模拟论文中的结果性数字（2026-10-13）

- `mock-essay-resilience-outcome-metrics`：模拟混沌工程论文模板中的年可用性从 99.95% 提升至 99.99%、平均恢复从 15 分钟降至 3 分钟，没有项目数据或监控证据。作为虚构练习情景可以保留，但应标注为示例数据，不能作为已经证实的真实项目成果。
- `mock-essay-consistency-outcomes-unsubstantiated`：模拟分布式一致性论文中的“三年零资损”和“日均处理 1000 万+ 笔”没有相应系统、数据口径、审计记录或原始出处。学习内容应提醒考生用本人可佐证的项目数据替换。
- `mock-essay-dr-targets-unsubstantiated`：模拟灾备论文中的 `RTO < 30秒、RPO = 0、年可用性99.99%` 目前没有灾备演练、同步复制语义或监控证据。若是设计目标应明确写成目标；若声称实施结果，必须附证据及指标的计量窗口/排除项。

## 续查批次：真题主题写作提纲中的量化成果（2026-10-13）

- `real-essay-cloudnative-results-illustrative`：云原生写作提纲里的“发布频率提升 10 倍、可用性 99.99%”位于范文思路而非题面测得结果；当前没有发布统计口径或监控数据，须标明示例并由考生替换为本人可佐证的数据。
- `real-essay-distributed-transaction-results-illustrative`：分布式事务参考思路的“一致性 99.99%、吞吐量提升 40%”缺少一致性判定方法、分母、基线版本和压测结果；不能当成真实成绩或官方提供的数据。
- `real-essay-load-balancing-capacity-illustrative`：负载均衡写作提纲的“百万级 QPS、99.99% 可用性”需要请求形态、压测环境、持续时长、延迟分位数和可用性计量窗口。作为范例可用，但须明确标为示例，而不是已经验证的项目实绩。

## 续查批次：绝对化设计原则与考试趋势数字（2026-10-13）

- `content-coupling-principle-needs-scope`：低耦合与避免内容耦合是合理的设计原则，但“完全避免”应理解为规范性目标，而非任何真实系统都保证零耦合。Martin Fowler 的设计讨论指出模块必须通信，耦合需要控制而不是被当作一概可消除；软件工程学习指南也将设计原则定位为启发式而非不变定律。来源：[Reducing Coupling](https://martinfowler.com/ieeeSoftware/coupling.pdf)、[Software design principles](https://software-engineering-guide.github.io/chapters/02-02-software-design-principles/)。
- `unsupported-quality-attribute-exam-trend`：写作思路中“质量属性分析是每年必考题”和“需求条目数量从 2024 年 10 条增加到 12 条”没有官方历年原卷样本、计数规则或可复核统计；应删除确定性预测，年度比较则须给出年份范围与分类方法。

## 续查批次：CQRS 指标与 Kafka 精确一次语义边界（2026-10-13）

- `cqrs-query-share-stat-needs-provenance`：模拟案例里“80% 以上的订单查询是按用户维度”没有日志、统计窗口或分类口径支撑。可作为明确的题设假设用于解释 user_id 分片，但不能推广为所有电商系统的事实。
- `cqrs-read-model-lag-and-isolation-overgeneralization`：Microsoft CQRS 指南指出读写数据存储分离后需要同步且可能出现陈旧读；没有承诺同步通常小于 1 秒，也不意味着 CDC/binlog 和同步链路对 MySQL 的资源开销为零。应把 1 秒写成带测量窗口/分位数的目标或实测指标，把“完全不影响”改为“降低直接查询压力，仍需监测同步成本”。来源：[Microsoft Learn — CQRS pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)。
- `kafka-exactly-once-boundary`：Apache Kafka 文档限定精确一次语义的范围：Kafka Streams 或使用事务生产者与 `read_committed` 消费者的 Kafka 主题内读—处理—写可以实现精确一次；写入外部数据库/服务通常还需要目标系统参与协同，或用事务/幂等去重。应在参考答案里明示事务边界。来源：[Apache Kafka — Design](https://kafka.apache.org/design/)。

## 续查批次：位示图单位约定与 CPU 计算复核（2026-10-13）

- `bitmap-block-count-binary-prefix-assumption`：300GB 磁盘、4MB 物理块的位示图答案 2,400 字，在 1GB=1,024MB 的二进制换算约定下算术成立。BIPM 的 SI 前缀中 G=10⁹、M=10⁶；NIST 另列出 Gi/Mi 等二进制前缀。因此题目省略单位约定会产生歧义，应在解析明确写出采用的换算规则。来源：[BIPM — SI prefixes](https://www.bipm.org/en/measurement-units/si-prefixes)、[NIST — binary prefixes](https://physics.nist.gov/cuu/Units/binary.html)。
- `cpu-clock-cycle-time-calculation`：6×10⁹ 个周期 ÷ 2.4×10⁹ 周期/秒 = 2.5 秒，算术和量纲一致；该计算仅复核题面给定值，不验证周期数来源或实际程序运行时间。

## 续查批次：Kafka Consumer 默认参数版本差异（2026-10-13）

- `kafka-consumer-timeout-default-version-scope`：Kafka 2.4 官方消费者配置将 `session.timeout.ms` 默认值列为 10,000 ms，Kafka 3.0/4.0 文档则已是 45,000 ms（经典组协议）；Kafka 4.0 的新 consumer group protocol 由 broker 配置 session timeout。`max.poll.interval.ms` 的 300,000 ms（5 分钟）默认值在 Kafka 2.4 与 4.0 文档中均有支持。CooperativeStickyAssignor 可用于协作式再均衡，但官方升级文档要求兼容滚动迁移，而不是只切换单个成员。应把版本和协议写进解析。来源：[Kafka 2.4 consumer configs](https://kafka.apache.org/24/generated/consumer_config.html)、[Kafka 4.0 consumer configs](https://kafka.apache.org/40/generated/consumer_config.html)、[Kafka 2.4 upgrade guide](https://kafka.apache.org/24/getting-started/upgrade/)。

## 续查批次：AES 性能/量子安全表述与 TLS 延迟断言（2026-10-13）

- `tls-latency-and-encryption-microbenchmark`：RFC 8446 支持 TLS 1.3 的完整握手、恢复连接与 0-RTT 的区分；完整握手涉及网络往返，而 0-RTT 有额外重放风险。该标准没有给出 TLS 普适的毫秒级延迟，不能支持“完全不影响业务延迟”或具体 10–50ms、1–5ms 数字。来源：[RFC 8446](https://www.rfc-editor.org/rfc/rfc8446)。
- `aes-round-count-performance-and-quantum-strength-scope`：NIST FIPS 197 明确 AES-128 为 10 轮、AES-256 为 14 轮；它没有给出任何实现中 AES-256 一定比 AES-128 慢 40% 的结论。NIST 的后量子 FAQ 讨论 Grover 搜索的平方根工作量与资源假设，因此“量子有效 128 位”应被解释为特定通用暴力搜索模型的简化说法，而非不带条件的完整安全评级。应保留可核事实，删除未经基准的性能百分比并限定量子安全表述。来源：[NIST FIPS 197](https://csrc.nist.gov/pubs/fips/197/final)、[NIST PQC FAQ](https://csrc.nist.gov/Projects/post-quantum-cryptography/faqs)。
- `lora-popularity-and-exam-necessity-prediction`：LoRA 解析中的“2025–2026 年最流行”“大模型实际应用的必备知识”属于没有采用率调查或官方历年试题统计支撑的趋势/押题判断。LoRA 原论文支持其参数高效微调机制与特定实验结论，但不证明行业排名或考试必考。建议改为“代表性方法之一，建议掌握基本机制”，如声称考试趋势需给出范围和统计口径。

## 续查批次：代理延迟基准与模拟论文成果数字（2026-10-14）

- envoy-sidecar-latency-range-needs-benchmark：案例解析写出 Envoy Sidecar 单跳通常额外增加 0.5–2ms，并称对响应时间大于 50ms 的绝大多数业务可忽略。Envoy 官方基准测试指南明确指出，不存在一个可概括代理延迟开销的单一通用数值，性能取决于功能、配置、硬件、流量和测试方法。应在目标环境测量直连与代理路径，并按业务 SLO 判断开销是否可接受。来源：https://www.envoyproxy.io/docs/envoy/latest/faq/performance/how_to_benchmark_envoy
- mock-essay-event-platform-outcome-metrics：模拟事件平台提纲里的日处理事件量提升 10 倍、响应延迟降低 80% 没有基线、负载模型或压测记录。标记为模拟范例中的示例数据；考生应替换为本人项目可佐证的指标。
- mock-essay-data-quality-dcmm-outcome：模拟数据治理论文中的数据质量合格率从 72% 提升至 95% 缺少指标口径与统计窗口，通过 DCMM 三级认证也需要组织/证书层面的依据。仅可作为明确标记的虚构情景；真实项目陈述应核对指标与证书。
- mock-essay-agent-development-outcome-metrics：模拟多 Agent 开发提纲中的开发效率提升 40%、代码缺陷率降低 30% 没有效率定义、缺陷分母、前后基线或观察窗口。应标为示例结果，或补充可复核的项目度量。

### 本批次边界

- 累计登记 38 条记录、64 个原文目标定位；不代表 38 道题已通过权威答案核验。
- 本次只修改本项目的证据登记、审计报告和回归测试；外部题库 ../architect-exam-bank/data/bank.json 仍保持只读，所有新增记录的 answerVerification 保持 not-established。
