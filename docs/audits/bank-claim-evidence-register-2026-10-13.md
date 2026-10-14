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

登记现包含 126 个审查记录、341 个原文目标定位；其中 23 个记录关联公开来源，其他记录涉及内部定义/算术/单位约定、考试频率预测、示例论文结果及尚无实测依据的性能断言。精确定位通过只表示登记仍指向该条文字；来源支持范围内的命题也不等于整道题答案已获权威验证。独立的答案风险队列仍列出 157 条候选、来源映射队列仍列出 1,595 条候选；这两个总数尚未与本登记逐条去重对账，不能当成“剩余未审条数”。

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

## 续查批次：模拟论文项目成果指标扩展核查（2026-10-14）

- mock-essay-microservices-outcome-metrics：微服务迁移模拟提纲把吞吐量提升5倍、发布周期由月级缩短到天级、可用性99.95%→99.99%、平均响应时间降低60%、发布频率提升20倍作为成果。它们是虚构练习场景的数据，不是已核实项目实绩。
- mock-essay-atam-case-outcomes：架构评估模拟提纲中的等保三级认证、响应时间低于1.5秒及成功对接30多个部门，没有真实系统或认证/性能/集成证据。应保留为明确标记的示例场景。
- mock-essay-cloudnative-migration-outcomes：云原生迁移提纲中的弹性扩展能力提升10倍、运维效率提升5倍未定义指标或前后基线。
- mock-essay-legal-rag-outcomes：法律RAG提纲中的问答准确率88%、法律依据引用准确率95%、日均服务1000+咨询缺少评估集、引用审核协议及运营统计。
- mock-essay-modifiability-outcomes：可修改性提纲中的需求响应周期从2周缩短至3天、缺陷率降低40%未提供样本、分母或统计窗口。
- mock-essay-serverless-outcomes：Serverless提纲中的成本降低60%、发布频率提升5倍没有成本口径、同等负载对照或发布日志。

以上数字可作为假设的写作练习设定，但应在学习内容中明确标识为模拟示例；如果用于真实项目论述，应替换为本人能提供数据支持的结果。

## 续查批次：模拟项目的业务成果、合规与自动化指标（2026-10-14）

- mock-essay-domain-services-outcomes：模拟领域服务迁移中的吞吐提升5倍、发布频率由月级到日级、故障影响范围缩小80%，没有压测、部署日志和故障统计支撑。
- mock-essay-zero-trust-outcomes：模拟零信任场景中的安全事件减少70%、VPN投诉下降90%缺少事件定义、分母和观察窗口；“等保2.0合规达标”需要可核验的测评证据。
- mock-essay-agent-automation-outcomes：文档处理效率提升10倍、报表从小时缩短至分钟、IT运维工单自动处理率60%，没有任务样本、端到端耗时及工单自动成功的判定口径。
- mock-essay-predictive-maintenance-outcomes：故障预测准确率92%、非计划停机减少60%、优化周期从2周降至2天、培训时间缩短50%及维护成本降低35%，没有验证集、对照数据或成本口径。
- mock-essay-federated-learning-outcomes：欺诈识别率提升15%缺少基线与测试集；“数据合规零风险”属于没有威胁模型支撑的绝对化保证。
- mock-essay-monolith-migration-outcomes：发布频率从月级到周级、可用性达到99.95%没有发布记录和可用性计量窗口。
- mock-essay-maintainability-outcomes：平均缺陷修复时间从5天降到1天、变更引入缺陷率降低60%没有缺陷样本与统计口径。
- mock-essay-data-governance-outcomes：数据需求周期从3个月降至2周、质量达标率从60%提升到95%没有流程起止定义、规则版本或前后统计数据。

这些条目均来自模拟论文写作提纲，按无实测支撑的示例成果登记；新增记录保持 answerVerification=not-established。
## 续查批次：AI、零信任、实时系统与训练集群的成果数字（2026-10-14）

- mock-essay-rag-agent-outcomes：模拟 RAG+Agent 提纲中的问答准确率92%、平均响应时间低于3秒和推理成本降低60%，缺少评估集、延迟测量条件与费用基线。
- mock-essay-zero-trust-security-outcomes：模拟零信任提纲中的等保三级认证、18个月零安全事故、事件响应从小时级缩短到分钟级及零数据泄露，缺少认证报告、事件口径、观察窗口与响应度量记录。
- mock-essay-traffic-architecture-quality-outcomes：模拟交通调度提纲中的信号控制延迟低于500ms、可用性99.995%和稳定运行2年，缺少端到端延迟统计、可用性计量窗口及运行记录。需求中的99.99%目标应与示例成果分开。
- mock-essay-vision-model-inference-outcomes：模拟视觉质检提纲中的检出率98.5%、误检率低于1%、单次推理低于50ms，缺少独立测试集、样本定义、硬件与端到端计时。
- mock-essay-llm-training-cluster-outcomes：模拟训练集群提纲中的GPU MFU 55%+、日均训练100B+ tokens、MTBF超过48小时，没有硬件/模型配置、计数规则、作业日志或故障观测窗口。

以上新增记录均按无独立证据的模拟成果登记，answerVerification 保持 not-established；这些指标不能被当作已实测的项目成绩。
## 续查批次：模拟论文中的 2026 考试趋势预测（2026-10-14）

- unsupported-mock-essay-exam-predictions：模拟论文提纲把“大模型应用架构最可能出现”“事件驱动架构可能换角度再考”“数据治理预测热点”“多 Agent 是最前沿考试方向”“云原生大概率出题”“RAG 最可能成为 AI 论文题”等作为预测，但没有完整的官方历年试卷样本、主题分类规则或概率统计支撑。
- 建议将这些句子改为作者的备考关注建议，不要表述成确定预测；涉及过去某年度是否考过某主题的具体事实，仍需单独映射到准确试卷与题目来源。

## 续查批次：可靠性、推理优化与平台迁移成果数字（2026-10-14）

- mock-essay-resilience-availability-dr-outcomes：模拟可靠性论文中的可用性99.99%/99.995%、年停机低于52.6分钟、零重大故障、RTO/RPO、MTBF/MTTR阈值及小于15秒灾备切换缺少运行记录和演练报告。
- mock-essay-llm-inference-optimization-outcomes：模拟推理优化提纲的吞吐提升4倍、P99延迟下降60%、GPU利用率从30%升至85%缺少硬件/模型配置、负载模型与原始压测。
- mock-essay-platform-migration-performance-compliance-outcomes：模拟平台迁移提纲中的15–30%性能变化、迁移后性能达到原系统95%以上及等保三级认证，缺少同负载基准测试和合规测评材料。
- mock-essay-event-platform-outcome-metrics：追加核对日处理事件5亿+、端到端P99低于500ms和“20多个微服务零耦合”，这些说法没有流量压测证据；“零耦合”应改为耦合受控等可论证表述。
- mock-essay-legal-rag-outcomes：补充律师满意度92%目标；当前无问卷、样本量、回收率和调查周期。

这些成果数字按模拟案例中的示例值登记，不代表已验证的项目成绩。
## 续查批次：模拟成果数字、考试预测与真题主题论文提纲（2026-10-14）

以下条目为当前项目新增的 16 条审计记录。凡属写作指导中的成果数据，均需与官方题面事实及可佐证的个人项目实绩严格区分。

### 模拟论文成果与考试趋势

- unsupported-mock-essay-exam-predictions：大模型、事件驱动、数据治理、多 Agent、云原生和 RAG 等“2026年最可能出题/大概率考”的判断缺少完整官方历年试卷样本、分类规则和统计支撑，应写成备考建议而非确定预测。
- mock-essay-resilience-availability-dr-outcomes：模拟可靠性论文中的可用性99.99%/99.995%、年停机低于52.6分钟、零重大故障、RTO/RPO、MTBF/MTTR阈值及小于15秒灾备切换缺少运行记录和演练报告。
- mock-essay-llm-inference-optimization-outcomes：模拟推理优化提纲的吞吐提升4倍、P99延迟下降60%、GPU利用率从30%升至85%缺少硬件/模型配置、负载模型与原始压测。
- mock-essay-platform-migration-performance-compliance-outcomes：模拟平台迁移提纲中的15–30%性能变化、迁移后性能达到原系统95%以上及等保三级认证，缺少同负载基准测试和合规测评材料。
- real-essay-2020-defect-escape-rate-example：缺陷逃逸率低于2%没有缺陷分母、观察窗口或真实项目记录。
- real-essay-2020-bigdata-query-outcomes-example：10亿级数据规模与查询性能提升5倍没有规模口径、查询集合或基准测试。
- real-essay-2021-aop-code-reduction-example：代码量减少30%没有代码范围、基线提交或统计方法。
- real-essay-2021-integration-cycle-example：系统集成周期缩短60%没有流程起止点、样本量或对比窗口。
- real-essay-2021-release-cadence-example：发布频率从月到日没有生产部署日志和统计窗口。
- real-essay-2022-component-reuse-outcomes-example：开发效率提升50%、代码复用率70%没有效率公式或复用分母。
- real-essay-2022-maintenance-time-example：MTTR缩短40%没有故障样本、起止定义或观察窗口。
- real-essay-2022-storage-cost-query-performance-examples：存储成本降低60%、查询性能提升3倍没有同等数据量/负载的核算与压测。
- real-essay-2023-data-freshness-example：数据时效性从 T+1 提升到分钟级没有端到端指标口径和链路实测。
- real-essay-2023-low-latency-bandwidth-examples：延迟降至10ms、带宽节省70%没有测试路径、分位数与流量对照。
- real-essay-2024-dev-efficiency-example：开发效率提升40%没有工时定义、任务集或项目证据。
- real-essay-2024-cloudops-outcomes-examples：部署频率从月到日、MTTR从小时到分钟、成本降低30%没有部署/故障/成本原始记录。
- real-essay-2025-serverless-outcomes-examples：Serverless成本降低60%、发布频率提升5倍没有同负载成本基准或生产发布记录。
- real-essay-serverless-availability-cost-outcomes-illustrative：真题主题下的 Serverless 参考提纲中的可用性99.99%、扩展能力提升10倍、运维成本降低40%缺少计量窗口、容量定义和成本对照。
- real-essay-performance-tps-p99-outcomes-illustrative：TPS提升3倍、P99响应时间降至200ms以内缺少可复现压测条件与原始报告。
- real-essay-flash-sale-capacity-oversell-availability-outcomes-illustrative：百万级QPS、零超卖、可用性99.99%缺少压测报告、库存对账证据及可用性计量窗口。

### 证据边界

- sourceType=real 表示论文论题主题对应历年真题；writingPoints 中的“效果/成果”是附加的参考提纲，不是官方题面提供的项目业绩。
- 所有新增登记均保持 answerVerification=not-established。精确定位只说明审计目标仍对应题库文本，不意味着论断/答案已通过权威核验。
- 本批还合并清理了重复的 CPU 周期计算登记，避免同一目标重复统计；外部题库 ../architect-exam-bank/data/bank.json 仍保持只读。

## 续查批次：选择题计算复核与单位前提（2026-10-14）

- cache-tag-binary-prefix-calculation：256MB 主存、512KB Cache、64B 块大小的直接映射 Cache，按二进制容量换算得行数2^13、Tag为9位；计算吻合，但 MB/KB 的二进制前提应明示。
- round-robin-timeslice-calculation：5个进程、20ms时间片且不计切换开销，一轮为100ms，每个进程获得20ms CPU时间，算术一致。
- mttf-990-mttr-10-availability-calculation：按题设 MTTF=990h、MTTR=10h 的公式口径，990/(990+10)=99%，计算一致。
- two-level-index-file-size-binary-prefix-assumption：4KiB 块、4-byte 地址得到1024个地址/索引块，二级索引覆盖1024²个数据块，即4GiB；答案依赖 KiB/GiB 的二进制单位约定以及“二级索引”解释。
- real-2020-break-even-point-calculation：按题给售价、营收、可变成本比例及税率模型，贡献比例20%，固定成本250万元对应盈亏平衡销量5000台；结论依赖各比例随销量恒定的题设模型。
- availability-four-nines-downtime-calculation 已扩展登记 99.99% 可用性对应0.01%不可用比例和一年约525,960分钟的中间步骤；52.6分钟为该假设下的算术结果。

本批区分纯算术复核与单位/模型敏感计算，所有新记录的答案状态均保持未建立权威核验。
## 续查批次：重复真题声明与性能曲线推断边界（2026-10-14）

- redis-aof-everysec-loss-bound：将同一条“最多丢失1秒数据”的 AOF everysec 说法补齐到 case-real-2025年下半年-4:问题2。已有 Redis 官方来源只支持“灾难故障时可能丢失约一秒写入”，不应当作所有存储栈/故障情形下的严格上限。
- security-attack-prevention-percentage-unsubstantiated：将“防止99%的黑客攻击”在 2019 年下半年重复编号的 012–017 六条选择题题干及解析重复表述全部映射；百分比缺少攻击分类、威胁模型、分母、观察窗口和测试方法。NIST 度量指南不建立 99% 的通用攻击拦截保证。
- performance-curve-single-point-does-not-prove-inflection：200ms 到 800ms 的响应时间比值为4倍，算术正确；但单个 90% 负载点不能单独确定完整曲线的拐点位置，需明确题目曲线模型或补充其他负载观测点。
- mock-essay-traffic-architecture-quality-outcomes：补充模拟交通调度提纲里的“实时延迟<200ms”和“安全加密增加30ms延迟”。二者没有测试环境、负载模型、延迟分位数或加密前后基准，仍只作未核实的示例指标。

以上补充只增加审计映射与处置说明，不修改外部题库中的原始题目/解析。
## 续查批次：冷启动范围与案例题中的考试趋势断言（2026-10-14）

- tls-latency-and-encryption-microbenchmark：将“TLS加密（不影响业务延迟）”补齐到同一案例的第1问参考答案。TLS 握手、连接复用与应用路径均可能影响端到端延迟，不能把该措辞作为所有环境下的绝对事实。
- unsupported-case-zero-trust-exam-trend：零信任“是近年来安全架构热点方向”的考试趋势表述在模拟案例第1–3问重复出现，但没有可复核历年试卷样本或分类统计；建议改成备考关注主题，而非考试频率预测。
- faas-cold-start-range-needs-platform-scope：案例解析称“冷启动延迟通常为1–10秒”。AWS Lambda 官方文档说明冷启动时间可从低于100ms到超过1秒，受运行时、依赖包和初始化工作影响；这不支持把1–10秒写成所有 FaaS 的通用范围。来源：https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html

本批强调平台与测量条件的范围边界，新增的答案状态均保持 not-established。
## 续查批次：补齐计算声明映射与安全百分比重复解析（2026-10-14）

- security-attack-prevention-percentage-unsubstantiated：除六条重复真题的题干外，补齐其解析中重复出现的“防止99%的黑客攻击”文本，避免风险队列因 field=analysis 而错误显示为未映射。
- bitmap-block-count-binary-prefix-assumption：补齐“磁盘容量300GB，物理块4MB”的原始单位前提，计算仍依赖题目按1024进位的常见二进制约定。
- cache-tag-binary-prefix-calculation：补齐主存256MB按2^28字节处理的中间假设，避免只覆盖后续标记位结果而遗漏单位前提。
- availability-mtbf-definition-conflict：补齐 999/(999+1)=99.9% 的算式结果；该计算符合解析采用的 MTBF/(MTBF+MTTR) 口径，但解析中的 MTBF/MTTF 术语冲突仍需单独澄清。
- amdahl-limit-calculation：补齐“无限多处理器也不超过5倍”的结论目标；其成立前提是题设可并行比例80%和Amdahl定律模型。
- round-robin-jobs-minimum-completion-220ms：按 P1/P2 给定的 CPU 与 I/O 时间线复算，考虑两者 I/O 与另一个作业 CPU 可重叠、不计调度开销，最短完成时间为220ms。

## 续查批次：案例中的示例参数与通用规则边界（2026-10-14）

- circuit-breaker-example-parameters-need-implementation-scope：示例将失败率阈值写为50%、打开等待写为30秒。Resilience4j 文档把50%列为其默认失败率阈值，但默认打开等待时间是60秒；不同实现/系统可配置不同值。应注明库与版本，依故障模型、流量、最小样本数和恢复SLO调参。
- agent-heartbeat-and-task-timeout-examples-need-fault-model：Agent 每30秒心跳、连续3次遗漏按90秒判故障、任务5分钟超时是设计例值，取决于任务时长分布、调度暂停、网络抖动、误判代价、幂等与重试策略。
- anti-cheating-similarity-threshold-needs-validation：85%文本相似度是可调的筛查启发式，不是通用标准或自动作弊结论。Turnitin 官方说明相似度分数表示匹配比例，不等于判定抄袭；该来源不验证本系统采用的 SimHash/TF-IDF 阈值。
- zero-trust-session-and-device-posture-intervals-need-context：30分钟会话时限和5分钟设备态势上报是示例参数。NIST SP 800-63B 表明会话超时取决于认证级别、终端、环境和应用；SP 800-207 不规定统一的五分钟轮询周期。

以上值可以用于解释设计思路，但应明确标为示例配置；实际应用需依据平台实现、风险模型、运行观测与误报代价进行校准。所有新增记录的 answerVerification 保持 not-established。
## 续查批次：计算推导细节与案例配置参数的适用范围（2026-10-14）

- amdahl-limit-calculation：补充定位“即使使用无限多处理器，加速比也不超过5倍”，使理论上限公式、数字推导和结论均能单独追溯；前提仍是并行比例为80%、忽略额外开销。
- availability-mtbf-definition-conflict：补充定位 999/(999+1)=99.9% 的算术片段，继续保留 MTBF/MTTF 定义冲突，不把一段算对等同于整份解析通过核验。
- availability-four-nines-downtime-calculation：补充99.99%可用性对应0.01%不可用比例和年分钟数中间步骤，52.6分钟的结果仍依赖365.25天计量约定。
- bitmap-block-count-binary-prefix-assumption：补充定位“磁盘容量300GB，物理块4MB”，提示GB/MB若采用二进制换算应在题目中明示。
- cache-tag-binary-prefix-calculation：补充定位“主存256MB=2^28字节”，标记位9位结果依赖MB/KB均按二进制容量换算。
- round-robin-jobs-minimum-completion-220ms：题面多道作业的最短完成时间220ms，仅在题设资源分配和执行时间假设下成立；它是计算复核，不是实际作业调度测量。
- circuit-breaker-example-parameters-need-implementation-scope：Resilience4j官方文档将50%列为默认失败率阈值，但默认打开等待时间为60秒；案例给出的30秒可作为自定义参数，不是通用默认值。
- agent-heartbeat-and-task-timeout-examples-need-fault-model：30秒心跳、连续3次未收到（90秒）判故障、5分钟任务超时是示例设计值；应结合任务时长、网络抖动、误判代价、幂等和重试策略校准。
- anti-cheating-similarity-threshold-needs-validation：85%相似度应仅作可调筛查阈值；Turnitin官方说明相似度分数表示文本匹配比例，而不是自动判定抄袭或作弊，且其评分体系不验证本项目的SimHash/TF-IDF实现。
- zero-trust-session-and-device-posture-intervals-need-context：30分钟会话有效期和5分钟设备状态上报是示例参数；NIST指出会话超时取决于认证保障级别、环境、终端和应用，不存在适用于所有场景的单一时限。

本批登记总数以生成后的JSON审计报告为准；新增的配置参数记录统一使用 illustrative-parameter-needs-context，所有答案状态仍为 not-established。
## 续查批次：边缘数据压缩、跨洲时延与容量/并行估算（2026-10-14）

- edge-telemetry-volume-reduction-needs-benchmark：案例答案称边缘预处理可将数据量降低100倍以上，但没有采样率、原始/特征载荷、过滤策略或实测前后字节数，不能视作普遍效果。
- cross-continent-network-latency-range-needs-topology-scope：跨洲数据中心100–300ms属于规划估计；实际链路延迟取决于站点、路由、运营商、链路及是否按RTT计量。应在目标网络测量并注明条件。
- sharded-billing-parallel-time-is-idealized：100万商户分给10个执行器，每个约10万；两小时÷10=12分钟只代表无开销且线性缩放的理想值，真实时长受分片倾斜、I/O、协调和下游容量影响。
- vehicle-offline-buffer-capacity-needs-workload-model：车载离线缓存100MB是示例容量，需用车辆规模、消息频率、载荷大小和最大离线时长估算，再验证满盘与恢复回放行为。

新增条目均区分设计示例、理想计算与实测结果，没有将这些参数提升为通用事实或已核实项目成绩。
## 续查批次：软件维护类型比例的历史来源与适用范围（2026-10-14）

- software-maintenance-effort-distribution-needs-historical-scope：写作提纲将改正性维护约20%、适应性约25%、完善性约50%、预防性约5%列作维护工作量分布。University at Albany 的维护演化教学参考指出，传统教材中的类似分布是完善性50%、适应性25%、改正性21%、预防性4%，并注明这些比例基于20世纪80年代初的研究，未必反映当前情况；另一份课程笔记以约20/25/50/5呈现该教学估计。
- 处置建议：保留“约”及历史/教学估计的边界，不将其写成所有项目通用的事实；具体组织应基于工单、工时和维护类别定义重新统计。来源：https://www.albany.edu/faculty/offutt/classes/maintEssays/maintEvolutionOverview.html 以及 https://www.dequidt.me/teaching/software-maintenance/lectures/010_intro/

## 续查批次：案例参考答案的跨小问重复文本定位（2026-10-14）

- 本批没有新增命题风险类别，而是将已登记的高风险声明补齐到同一案例中其他小问参考答案里，避免同一段综合参考答案因重复挂载在不同子题下而在定位审计中漏报。
- 本次新增 36 个精确定位，其中覆盖 CodePush 退役与修复时效、TLS 延迟绝对断言、Kafka 批处理参数、架构质量属性押题、CQRS 同步时延、Kafka exactly-once、熔断参数、Agent 心跳/超时、反作弊相似度、Envoy Sidecar 延迟、零信任会话、跨洲链路时延、分片账单理想时间与车辆离线缓冲容量。
- 这些扩展只增加 itemId/field/claimNeedle 的追踪位置，不新增审查记录，不改变结论或答案核验状态；外部题库仍保持只读。
## 续查批次：模型显存、在线评测限制与特征服务性能目标（2026-10-14）

- llm-70b-weight-memory-estimates-are-not-total-vram：70B 参数按 FP32/INT8/理想 INT4 权重分别估算为280/70/35GB，字节数计算可复算，但只表示权重近似占用，不包括KV cache、量化元数据、激活、运行时缓冲和并发开销。
- llm-quantization-speed-and-quality-numbers-need-benchmark：INT8加速2–3倍且精度损失0.5–1%、INT4加速4–5倍且损失2–3%没有注明模型、硬件、推理引擎、量化配置或评测集，不可视为通用固定收益。
- feature-store-p50-p99-targets-need-load-test：特征API的p50<10ms与p99<50ms是设计目标示例，没有压测数据支撑；如作为SLO承诺需报告代表性负载与原始分布。
- realtime-feature-prediction-100ms-target-needs-benchmark：伪代码里的100ms内返回未定义计时边界，不能作为平台已达到的端到端时延结果。
- online-judge-sandbox-limits-are-configurable-examples：CPU 5秒、wall time 10秒、内存256MB是在线评测沙箱示例限额，需按题目、语言、硬件和隔离方案校准。
- rule-engine-five-percent-canary-is-configurable：规则灰度的5%流量是示例阶梯，不是通用最佳值；应结合风险、请求量、观察窗口和自动回滚阈值校准。

本批中权重容量按参数量×每参数字节数复算为 calculation-only；速度、质量和延迟目标均没有独立测量证据，答案状态保持 not-established。

### 共享案例参考答案的重复定位

部分案例子题的 reference_answer 包含重复的长篇参考内容；本轮把已有审计目标扩展定位到这些文本确实重复出现的子题字段。新增定位用于明确字段覆盖，不应简单解释为独立缺陷数量。

## 续查批次：风险阈值、SLO 示例与第三方复原度自述（2026-10-14）

- redis-aof-everysec-loss-bound：补齐另一份历年案例参考答案里的“最多只丢失1秒数据（everysec策略）”。Redis官方资料支持的是灾难故障时可能丢失约一秒写入，不应当表述为所有情形下的绝对上限。
- real-essay-mtbf-target-values-are-illustrative：论文写作指导里的MTBF≥1000小时和≥500小时是可靠性目标示例，不是考试统一门槛或已测得的项目可靠性。
- fraud-risk-multiplier-threshold-needs-calibration：风控特征中的“超过用户历史平均3倍”是待校准的启发式规则，应依据带标签数据、分群表现及误报/漏报成本验证。
- llm-routing-tier-sla-values-need-benchmark：服务分级表里的P99<100ms、吞吐>1000 req/s及可用性99.99%是示例SLO，没有模型、请求长度、并发、统计窗口或压测结果，不应被解读为已实现的线上成绩。
- third-party-exam-reconstruction-percentage-is-self-reported：2024年上半年案例来源清单引用第三方页面“复原程度90%”，但没有说明计分方法、完整题目对照或官方认证；应标记为第三方自述，不把90%当作独立验证的真题完整率。

新增来源质量类别为 unverified-source-completeness-estimate，用于区分第三方来源自述与考试机构/原卷的权威确认。
## 续查批次：车联网延迟、采样比例和运维策略参数（2026-10-14）

- v2x-20ms-latency-target-needs-scenario-scope：20ms对于部分V2X安全/协同场景可能是合适目标，但不同场景标准约束存在10/20/100ms等差异；需明确是本地MEC转发、直接V2V无线链路还是端到端测量，并注明负载、消息大小和可靠性条件。来源：ETSI/3GPP TS 22.186 Release 16。
- distributed-trace-10-percent-head-sampling-is-configurable：OpenTelemetry支持可配置的trace比例采样，10%是可用配置示例；不是所有SDK的默认值，也不是所有业务的最佳比例。来源：OpenTelemetry JavaScript Sampling文档。
- flink-sliding-window-five-minute-one-minute-is-workload-specific：Flink的窗口大小和滑动间隔是显式配置参数；5分钟窗口和1分钟滑动步长是示例，需要根据事件频率、告警延迟、迟到数据和计算成本选择。来源：Apache Flink SlidingEventTimeWindows API。
- predictive-maintenance-80-percent-failure-probability-threshold-needs-calibration：七天内故障概率超过80%才生成工单是策略示例，需要概率校准、误报/漏报代价与维护能力支持。
- large-tenant-five-percent-share-is-scenario-assumption：用户数超过1000的“大租户约占5%”是分级租户方案的假设，需用实际租户分布、存储和请求负载核实。
- two-second-slow-query-alert-threshold-is-configurable：2秒慢查询阈值应依查询类型、SLO和实际延迟分布配置，不是通用数据库标准。
- exam-preload-and-autoscale-lead-times-need-traffic-model：考前10分钟预加载、考前30分钟扩容应由CDN传播、缓存预热、启动时间和预计并发压测决定。
- rice-confidence-90-percent-is-subjective-prioritization-input：RICE示例里的90% Confidence是优先级评估输入；没有校准和历史数据时，不能当作统计意义上的90%成功概率。
- reliability-mtbf-1000-hour-value-is-example-goal：真题主题写作提纲里的MTBF≥1000小时是示例可靠性目标，不是官方题面事实或测量结果；实际陈述需给出运行小时数、故障定义、观察期和估计方法。
- aws-lambda-timeout-scope已增加对essay-real-2025年下半年-1的定位：写作提纲把15分钟作为一般FaaS执行时间例子；AWS Lambda官方资料只支持特定Lambda执行模式的限制，不能据此推广为所有FaaS平台的通用上限。

新增的参数阈值均保持 answerVerification=not-established；官方标准/产品文档只用于界定适用范围，不自动验证整道题答案。
## 续查批次：MQTT 恰好一次语义、幂等键 TTL 与异常阈值（2026-10-14）

- mqtt-qos2-exactly-once-is-protocol-scoped：OASIS MQTT v5 将 QoS 2定义为协议级 exactly-once 消息交付，并把交付协议范围限定为单一发送方与单一接收方。它不自动保证下游数据库事务、实体设备动作或其他业务副作用恰好执行一次。
- redis-idempotency-dedup-ttl-24h-needs-retry-horizon：Redis SET 支持 NX 与 EX/PX 过期配置；24小时是示例 TTL，而不是官方推荐的统一保留期。应覆盖最大重试/重放窗口并考虑过期之后的重复业务请求与内存开销。
- flink-three-sigma-anomaly-rule-needs-baseline-validation：NIST 说明3σ控制限在正态分布假设下对应约0.3%的两侧越界概率，并提醒偏态分布会影响适用性。通用IoT异常检测不能不加验证地照搬固定3σ阈值。
- one-minute-vibration-200-percent-trigger-needs-sensor-calibration：一分钟内振动值增长200%是场景示例阈值，需明确相对变化口径、传感器单位/采样率、设备基线、瞬态行为和误报代价。

上述新增条目均为证据边界审计，不自动将原答案提升为 verified/approved。
## 续查批次：灰度发布、GPU利用率和论文示例指标的范围限定（2026-10-14）

- istio-canary-ten-percent-is-configurable：Istio按百分比权重转移流量是受支持的配置方式；案例的10%是示例，不是通用安全灰度比例。比例、观察期和升级/回滚阈值应结合请求量、风险与最小样本量确定。来源：Istio Traffic Shifting官方文档。
- exclusive-gpu-utilization-20-percent-needs-workload-measurement：独占GPU“利用率20%”是场景示例，没有模型、批量、请求分布或测量来源，不能推广为所有独占GPU部署的普遍利用率。
- mock-essay-chaos-engineering-baseline-slos-are-examples：混沌工程提纲的请求成功率>99.9%与P99延迟<500ms用于解释稳态假设，是样例SLO而非已测结果。
- mock-essay-quality-response-measures-are-examples：质量属性论述里的延迟<2s与可用性99.99%是响应度量写法示例，不是已实现系统的实测指标或适用于所有系统的统一目标。
- real-essay-unit-test-coverage-over-80-percent-is-project-goal：论文写作提纲里的单元测试覆盖率>80%是团队/项目实践目标示例，不是历史题面要求或普遍标准；应注明覆盖类型并配合高风险路径与断言质量评估。
- mock-essay-consistency-outcomes-unsubstantiated 已补充定位核心成果“实现交易数据零差错/系统可用性99.99%”及项目背景“日交易量1000万+笔/用户规模5000万+”，以便把这些模拟论文业绩与实测证据明确区分。
- rice-confidence-90-percent-is-subjective-prioritization-input 已补充第二个子题中的同一RICE置信度示例定位，避免只覆盖一份复用答案的单个小问。

以上指标需要明确区分示例、目标和已经测得的成果；新增条目均未提升为已核实答案。
## 续查批次：框架性能对比、迁移门槛与业务示例数据（2026-10-14）

- cross-platform-ui-frame-budget-and-bridge-overhead-need-benchmark：16ms可作为60Hz显示下约16.7ms单帧预算的近似值；序列化1ms、旧Bridge 1–2ms、Native处理5ms、React Native帧20–25ms及“Flutter性能更好”的结论没有同设备可复现基准。React Native新架构已用JSI等机制替代旧异步Bridge；不能把旧架构测量泛化到所有版本。
- database-migration-relative-performance-80-95-percent-is-policy-target：国产数据库达到Oracle整体性能80%、关键业务95%是迁移方案中的项目验收门槛示例，不是通用行业标准；应统一工作负载、数据量、并发、延迟分位数、吞吐及资源成本后对比。
- multi-region-failover-times-need-topology-scope：主备30秒至数分钟、多活秒级切换是架构情景估算；真实RTO取决于故障探测、DNS/客户端缓存、数据库提升、路由收敛、复制和重试，必须通过演练测量。
- mock-report-sales-numbers-need-dataset-evidence：示例Agent报表中的Q1销售额1.2亿元、同比增长15%没有数据集/查询/比较区间作证，应明确是生成示例，不得呈现为真实业务数据。
- real-essay-unit-test-coverage-over-80-percent-is-project-goal 已新增对“分支覆盖≥80%”的定位；测试覆盖率是团队目标示例而非通用要求，需明确覆盖度量类型且不能单独证明测试质量。

上述记录保持未核实状态；新架构/版本资料仅用于限定适用范围，不代表已通过真实环境性能测试。