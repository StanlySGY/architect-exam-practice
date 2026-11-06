# 批次 C 第 9 批 20 个学习单元来源与教学质量初审（2026-11-06）

## 结论与范围

本批按只读工作队列复核 20 个 `partial` 单元：18.4.1、18.4.2、18.5.1、18.5.2、18.5.3、18.5.4、18.5.5、18.6.1、18.6.2、18.7.1、18.7.2、18.7.3、18.8.1、18.8.2、19.3.2、19.3.4、19.3.6、19.4.1、19.4.2、19.4.3。

**20 个单元全部继续保持 `partial`。** 本轮对 what、evidence claim/scope、why/how/confusions/scenarios/examFocus 和 selfChecks 逐项检查，并与 NIST、OWASP、PostgreSQL、Apache Flink、IETF/流处理相关资料交叉审阅。来源核验只确认其限定范围内的事实，不替代指定教材版次及印刷页码的全主张覆盖核验，也不构成人工确认整单元 complete。

## 工作队列与共性信号

- 20/20 单元只有 1 条结构有效的命题级 evidence，日期均为 2026-10-09；每个单元仅登记 1 个来源 host。单条证据只能支撑记录中的有限 claim/scope，不能覆盖该单元所有陈述。
- 模板启发式命中：`why` 16/20、`scenarios` 20/20、`examFocus` 4/20；`how` 和 `confusions` 未达到已知模板匹配信号。命中是人工复核线索，不等于字段无用或事实错误。
- 第一题 20/20 均为“请不用照抄原文，解释……”的复述式问题；第二题中 14/20 使用同一安全边界脚手架、6/20 使用数据流脚手架。单元仍需更专项的题目：WPDRRC 六环节与 NIST CSF 生命周期不可互换；AAL/身份核验/授权需分开；ABAC 输入属性必须实际参与授权策略；哈希/MAC/签名证据能力不同；实体/参照/业务约束不等于 ACID；OWASP API 对象级授权要落到对象归属；Lambda 合并规则和 Kappa 重放前提需实际推演；watermark 不能保证所有迟到事件都自动进入窗口。
- 本批最重要的版本风险：课程引用 OWASP Top 10:2021 的访问控制/注入/配置缺陷分类，但 OWASP Top 10:2025 已发布，类别位置与命名发生变化。若课程讲的是 2021 版历史题，应标注版本；若讲当前应用安全风险，应更新到 2025 版。OWASP API Security Top 10:2023 是独立项目，不应把它和 Web Top 10 合并。
- OT 安全时效性：NIST SP 800-82 Rev.3（2023-09）仍是 Final；NIST 页面于 2026-09-21 标注 Rev.4 Initial Public Draft，公开评论截止 2026-11-30。Rev.4 草案不可描述成 Final 或已生效要求；在其发布最终版前，课程以 Rev.3 为正式出版参考，并跟踪草案变化。
- 两个架构主题要把“目标/术语”与“特定模型/实现”区分：WPDRRC 是课程/教材语境中的安全运营模型，NIST SP 800-61 Rev.3 是把事件响应建议融入 CSF 2.0 风险管理的出版物；Lambda/Kappa 是数据处理架构模式，不是某个消息系统、流引擎或数据库产品名称。

## 逐项复核

| 单元 | 当前主张与 evidence 边界 | 复核发现与修订方向 |
|---|---|---|
| 18.4.1 | WPDRRC 将预警、保护、检测、响应、恢复、反击组织为六环节，人员/策略/技术为支撑要素；NIST SP 800-61 Rev.3 仅支持事件响应纳入整体网络安全风险管理、准备/检测/响应/恢复相互关联。 | NIST 800-61 Rev.3（2025-04）是 CSF 2.0 Community Profile，不是 WPDRRC 六环节的原始出处，不能把两者机械一一映射。NIST CSF 2.0 的 Govern/Identify/Protect/Detect/Respond/Recover 是组织风险管理功能，WPDRRC“预警/反击”等课程术语属于另一套模型语境。应补指定教材原始定义与出处，明确“反击”在合法授权、安全边界和应急响应中的含义，避免被理解为未经授权的主动攻击；练习题可要求说明各环节触发、职责、输入/输出和闭环反馈。 |
| 18.4.2 | 将响应流程映射至人员、策略、技术、平台与组织角色；NIST SP 800-61 Rev.3 支持组织治理、人员职责、监测、处置、恢复和持续改进协同。 | “安全运营中心/策略中心/数据中心/应急体系”不是 SP 800-61r3 规定的标准组织架构，也不应默认所有企业必须分设这些中心。应建立按规模和风险裁剪的 RACI/责任矩阵：事件指挥、分析研判、批准隔离、取证保全、系统恢复、法务/隐私、供应商和对外沟通；定义升级条件、授权边界、值班覆盖、证据留存、沟通和桌面/技术演练。平台工具不能代替人员决策和流程能力。 |
| 18.5.1 | CIA 三目标：保密性防未授权披露、完整性防未授权修改、可用性保障必要访问；真实性/可追责性等可能是额外目标。 | NIST CIA 术语可支持三目标基本含义，但“真实性”不是简单等同于完整性，“不可否认性/可追责性”也不是 CIA 的第四个必选字母。需用威胁/业务场景说明披露、篡改、破坏/拒绝服务的影响，分别匹配访问控制/加密、校验/MAC/签名/审计、冗余/备份/恢复；避免把某个机制直接等同于安全目标。 |
| 18.5.2 | 身份认证验证主体对已绑定认证器的控制，并按风险选择保证等级；NIST SP 800-63B-4 支持数字认证、认证器管理及 AAL 要求。 | 必须区分身份核验（identity proofing，SP 800-63A-4）、身份认证（authentication，SP 800-63B-4）与授权（authorization）。AAL1/2/3 是认证保证等级，不是身份核验 IAL，也不是业务权限等级。用户名/口令、密码学认证器、证书、数字签名、生物特征不能被列作同一层次的可互换认证手段；生物特征通常需与实体认证器结合，不能单独视为可独立使用的认证器。建议讲清注册绑定、验证、会话、恢复/撤销、抗钓鱼和风险适配。 |
| 18.5.3 | ABAC 根据主体、客体、请求操作和适用时的环境属性，结合策略/规则/关系做授权；NIST SP 800-162 定义支持这些输入。 | ABAC 与 DAC/MAC/RBAC 不宜写成“ABAC 的四种并列子类型”。DAC/MAC/RBAC 是不同访问控制策略模型/范式，ABAC 是以属性求值的授权方法；实现可能组合 RBAC 与属性条件。须说明主体/资源/操作/环境属性来源、可信度、策略冲突、默认拒绝、策略评估点和审计；属性丰富不代表一定比 RBAC 更安全，策略复杂度及数据质量会成为新风险。 |
| 18.5.4 | 保密性覆盖存储、处理和传输中的未授权披露；加密是方法之一，需要身份、授权与密钥管理配合。 | 区分传输中加密（如 TLS）、静态数据加密、端到端加密、字段级保护、脱敏/假名化/令牌化和访问控制。脱敏不是加密；隧道加密不自动保护端点、内存、日志或备份；加密不能独立解决授权、密钥泄露、明文导出和合法主体滥用。建议按照数据生命周期和信任边界绘制数据流，标明密钥生成/存储/轮换/吊销/备份职责及验证证据。 |
| 18.5.5 | 完整性保护信息与系统免受未授权修改/破坏；哈希、MAC、签名、版本、校验、审计与事务针对不同风险组合使用。 | 必须区分 hash、MAC、数字签名：普通哈希能检测摘要与数据不匹配，但若攻击者能同时替换数据和未受保护摘要，就不能证明来源真实性；MAC 依赖共享密钥，适合共享密钥双方完整性/认证；数字签名可由公钥验证签署者/数据完整性，但仍依赖密钥管理、身份绑定和签名范围。事务约束业务状态，审计记录变更轨迹，版本/不可变存储帮助回溯；它们互不替代。 |
| 18.6.1 | 安全评估需覆盖身份/访问、配置、数据保护、监测审计、响应、备份恢复和治理，并验证实际控制有效性；NIST CSF 2.0 支持以组织目标和目标状态评估风险管理结果。 | 区分“控制设计是否充分”与“控制在运行环境中是否有效持续执行”。制度、截图或控制项清单不是运行证据；需抽样配置/日志/工单、复核服务端授权、演练事件响应、测试备份恢复和验证告警升级。CSF 2.0 是风险结果与治理框架，不是产品认证或“一次检查即安全”的打分器；应记录范围、证据、限制、残余风险、责任人和整改计划。 |
| 18.6.2 | 实体完整性、参照完整性和业务约束维护合法数据状态；ACID 描述事务执行性质，触发器、授权、审计和校验从不同层面提供控制。 | 主键/唯一约束、外键、NOT NULL、CHECK/业务约束、事务隔离、触发器、审计是不同机制。实体完整性维护行标识/主键有效；参照完整性维护外键引用；业务约束表达组织规则；ACID 不是完整性约束的同义词。触发器若有副作用、递归或隐藏逻辑，可能增加维护和测试成本，且不应替代应用授权、事务边界、并发测试、备份恢复和审计。建议出题区分违反约束、并发竞争、事务回滚和未授权写入四类场景。 |
| 18.7.1 | 访问控制失效可造成越权读取/修改/删除或执行业务操作；OWASP 2021 evidence 支持服务端授权与默认拒绝。 | OWASP Top 10:2025 仍将 Broken Access Control 列为 A01，但将 SSRF 并入该分类等变化意味着不能继续把 Top 10:2021 当作当前版本。对 API 还要检查 OWASP API Security Top 10:2023 的 BOLA（对象级授权）、对象属性级授权和功能级授权：不仅检查“用户已登录”，还要检查用户是否拥有该订单/记录、是否可读写对应字段、是否有权限执行退款/管理操作。授权必须由服务端强制，所有读/写路径均验证对象归属、租户和业务范围。 |
| 18.7.2 | 注入来自不可信输入进入 SQL、命令或解释器语句；参数化查询/安全 API 优先于黑名单过滤。 | OWASP Top 10:2025 将 Injection 列为 A05，而不是 2021 的 A03；应明确讲的是哪个版本。SQL 参数化查询、预编译语句、上下文相关编码、模板安全 API 和避免 shell 字符串拼接是不同上下文的控制；输入验证是纵深防御，不替代参数化。也要注意 ORM/查询构造器并非在任意动态 SQL/原生查询中自动免疫；测试需覆盖 SQL、命令、模板、LDAP 等具体解释器上下文。 |
| 18.7.3 | 安全配置缺陷涉及默认账户、暴露服务、过宽权限、错误云存储策略和详细错误；可重复加固基线与自动验证。 | OWASP Top 10:2025 中 Security Misconfiguration 已从 2021 A05 移至 A02，且配置行为持续增多。基线需明确环境、平台版本和例外流程，覆盖默认凭据、调试/堆栈输出、CORS/CSP/安全头、云对象存储/IAM、容器镜像、端口/服务、密钥和日志；部署前扫描与运行时漂移检测都需要，不能仅凭“符合基线”推断业务访问控制正确。 |
| 18.8.1 | 电商安全涉及用户、商品、订单、支付、库存、物流对象授权、状态转换、幂等、数据保护与审计；OWASP API Security Top 10 可支持 API 风险分类。 | 具名业务链路应拆出 BOLA（更改订单 ID 越权访问）、对象属性级授权（改价格/折扣/收货地址）、功能级授权（普通用户调用退款/调价接口）、敏感业务流滥用（刷单/抢购/优惠券/验证码资源消耗）、支付回调伪造/重放、库存并发扣减和幂等键冲突。还需服务端价格和状态机、支付对账、密钥/签名校验、隐私保留与审计。OWASP API Top 10 是风险意识清单，不是支付合规标准或完整威胁模型。 |
| 18.8.2 | 工业云边协同要保护现场控制、工程站、边缘、远程访问、数据链路，并优先考虑人员/物理过程安全、可用性与恢复；NIST SP 800-82 Rev.3 支持 OT 特殊性能、可靠性与安全约束。 | 版本核验：Rev.3（2023-09）仍是最终版；NIST 在 2026-09-21 公布 Rev.4 IPD，评论期到 2026-11-30。Rev.4 草案不能当成正式生效要求。OT 控制必须先分析工艺安全与失效后果，再设计 IT/OT 分区与通信、只读监测/被动发现、远程维护审批、补丁窗口、工程站跳板、供应商接入、离线备份及恢复演练；不应无差别把 IT 扫描/补丁策略直接套入运行中的控制设备。 |
| 19.3.2 | Lambda 架构通过批层处理历史数据、速度层处理近期事件、服务层提供合并查询视图，面向历史重算与低延迟并存需求；现有 Databricks 资料支持模式动机。 | Lambda 通常分 Batch/Speed/Serving 三层：历史数据集可重算批视图，速度层补充批计算周期内的新事件。速度层结果可能是暂时/近似结果，待批层更新后需要覆盖或合并；“秒级”不是架构名称保证。应明确需求中的 latency、correctness/completeness、replay、成本与可追溯要求，不要笼统写成“实时且准确”。 |
| 19.3.4 | 双路径需要定义键、时间范围、去重、覆盖优先级和回补，否则可能重复计数/暂时不一致；Databricks 资料支持双路径与服务层概念，但不支持具体实现必然正确。 | 需设计 event_id/业务主键、event_time 与 processing_time、批次 cutoff、版本/修订、去重窗口、速度层临时视图和批层最终视图的覆盖规则、迟到事件修正、删除/撤销事件和回补重放。双路径合并不是 Lambda 自动提供的内建算法；“exactly once”也不是单靠 Lambda/Kafka/Flink 产品标签保证，须检查 source、checkpoint、sink 事务与外部副作用。 |
| 19.3.6 | Lambda 相对纯批处理可降低新事件可见延迟，相对纯流处理常便于全量重算，但要维护两条逻辑和结果协调；当前 evidence 支持一般权衡。 | 不宜绝对化称其“准确性更强”或“复杂度最高”。流处理也能通过保留日志重放历史；统一批流引擎/湖仓平台可减少逻辑重复，但其状态、成本、版本、吞吐和一致性取舍仍存在。评估时比较历史重放、实时延迟、逻辑复用、运维工具链、存储保留、数据质量、故障恢复与团队能力；是否采用应由需求测量而非架构名词决定。 |
| 19.4.1 | Kappa 将实时事件和历史事件视为流，用同一流处理路径生成状态/物化视图；Confluent 资料支持流处理与日志重放思路。 | Kappa 不是“所有数据天然都是事件流”也不是“无限日志”。同一流处理逻辑能否重算历史，依赖保留期/归档、可确定重放、事件顺序/分区语义、schema 版本、处理逻辑版本、外部副作用隔离和目标表切换；重放太慢会影响成本/资源。若历史原始事件未保留或需要复杂非增量重算，Kappa 未必合适。 |
| 19.4.2 | 实时处理需区分事件时间、处理时间、乱序、水位线、迟到策略和状态恢复；Fl​​ink 文档支持 event time/watermark 语义。 | Event time 是事件本身携带的业务时间，processing time 是系统实际处理时钟；watermark 是对事件时间进度的声明/估计，不能保证以后绝无更早时间戳事件。允许迟到、侧输出、窗口重算/修正策略须显式配置；水位线等待太久会增加延迟，推进过快会带来遗漏或补偿成本。还应区分吞吐、端到端延迟、窗口触发时延、checkpoint 和业务完整性。 |
| 19.4.3 | Kafka 等日志与 Flink/Storm 等流引擎组合需共同设计时间戳、分区/并行度、状态、checkpoint、重放和下游存储语义；Flink watermark 文档支持时间进度和迟到语义。 | 不要把 Kafka + Flink 当成固定架构答案。需明确 Kafka topic/partition/offset、key 与顺序范围、保留期、schema registry/兼容、consumer group、Flink source watermark 生成、并行子任务 watermark 取最小、checkpoint/barrier、状态后端、sink 幂等/事务语义、重启和重放策略。端到端 exactly-once 依赖具体 connector 和 sink 配置，需故障注入验证；多输入/空闲分区也可能拖住 watermark，需监控事件时间滞后。 |

## 来源清单与适用边界

1. **事件响应与安全运营**
   - NIST SP 800-61 Rev.3, *Incident Response Recommendations and Considerations for Cybersecurity Risk Management: A CSF 2.0 Community Profile*（Final 2025-04-03）：https://csrc.nist.gov/pubs/sp/800/61/r3/final 。用于说明事件响应应融入 CSF 2.0 风险管理，准备、检测、响应与恢复应贯穿全周期；不是 WPDRRC 的原始定义。
   - NIST CSF 2.0：https://www.nist.gov/cyberframework 。Govern/Identify/Protect/Detect/Respond/Recover 六功能构成网络风险管理框架，不等于 WPDRRC 六环节。

2. **数字身份、访问控制与数据安全**
   - NIST SP 800-63B-4（Final 2025-07-31）：https://csrc.nist.gov/pubs/sp/800/63/b/4/final 。认证器与认证保证等级要求；身份核验另见 SP 800-63A-4。
   - NIST SP 800-63-4 总览：https://csrc.nist.gov/pubs/sp/800/63/4/final 。覆盖身份核验、认证与联邦身份的不同部分。
   - NIST SP 800-162（2019-08-02 更新后的现行记录）：https://csrc.nist.gov/pubs/sp/800/162/upd2/final 。ABAC 主体/客体/操作/环境属性与策略定义。
   - NIST CIA 术语入口：https://csrc.nist.gov/glossary/term/confidentiality_integrity_availability ；Confidentiality：https://csrc.nist.gov/glossary/term/confidentiality ；Information Security：https://csrc.nist.gov/glossary/term/information_security 。用于目标层面的概念界定，不规定具体算法或部署方案。
   - PostgreSQL Transactions Tutorial：https://www.postgresql.org/docs/current/tutorial-transactions.html 。可作事务提交/回滚和约束示例，不能代替完整的安全架构与业务不变量设计。

3. **OWASP Web/API 安全**
   - OWASP Top 10:2025 官方首页/引言：https://top10.owasp.org/2025/0x00_2025-Introduction/ 。2025 版分类为 A01 Broken Access Control、A02 Security Misconfiguration、A03 Software Supply Chain Failures、A04 Cryptographic Failures、A05 Injection、A06 Insecure Design、A07 Authentication Failures、A08 Software or Data Integrity Failures、A09 Security Logging & Alerting Failures、A10 Mishandling of Exceptional Conditions。
   - OWASP A01:2025 Broken Access Control：https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/ 。
   - OWASP A02:2025 Security Misconfiguration：https://top10.owasp.org/2025/A02_2025-Security_Misconfiguration/ 。
   - OWASP A05:2025 Injection：https://top10.owasp.org/2025/A05_2025-Injection/ 。
   - OWASP A07:2025 Authentication Failures：https://top10.owasp.org/2025/A07_2025-Authentication_Failures/ 。
   - OWASP API Security Top 10:2023：https://api-security.owasp.org/ ；风险详情：https://api-security.owasp.org/editions/2023/en/0x11-t10/ 。对象级、对象属性级、功能级授权和敏感业务流风险等内容属于 API Top 10，与 Web Top 10 是不同项目。

4. **OT/工业云边安全**
   - NIST SP 800-82 Rev.3 Final（2023-09-28）：https://csrc.nist.gov/pubs/sp/800/82/r3/final 。OT 安全需考虑独特的性能、可靠性与人员/物理安全要求。
   - NIST SP 800-82 Rev.4 Initial Public Draft（2026-09-21 planning note 指向）：https://csrc.nist.gov/pubs/sp/800/82/r4/ipd 。初始公开草案评论截止 2026-11-30；不是最终规范。

5. **Lambda/Kappa 与流处理**
   - AWS, *Lambda Architecture for Batch and Stream Processing*（archived whitepaper）：https://d1.awsstatic.com/whitepapers/lambda-architecure-on-for-aws.pdf 。说明 Batch、Speed、Serving 三层及双路径概念；属于架构教学材料。
   - Springer 综述章节, *Big Data Processing, Analysis and Applications in Mobile Cellular Networks*（Lambda/Kappa 对比）：https://link.springer.com/chapter/10.1007/978-3-030-16272-6_6 。描述批/速度/服务层、Kappa 单一流路径、历史重放前提及两者取舍；不是所有实现的必然性能证明。
   - Jay Kreps, *I ♥ Logs: Event Data, Stream Processing, and Data Integration*（2014，日志重放/流处理替代双路径的原始思路）：https://www.oreilly.com/library/view/i-heart-logs/9781491909379/ 。解释长期保留可重放事件日志、用新流处理任务重新计算和切换结果表；不构成所有系统都可采用 Kappa 的证明。
   - Apache Flink, *Timely Stream Processing*（稳定版文档）：https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/time/ 。事件时间、水位线、迟到数据、窗口与事件时间进度。  
   - Apache Flink, *Debugging Windows & Event Time*：https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/debugging/debugging_event_time/ 。用于理解水位线监测和多输入流低水位线排障。
   - Apache Flink, *Generating Watermarks*：https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/event-time/generating_watermarks/ 。按具体 Flink 版本核对事件时间戳分配与水位线生成策略。

## 下一步教学修订建议（草案，未写回 JSON）

1. **安全运营**：为 WPDRRC 找到课程采用的教材原文/出处，并与 NIST CSF 2.0、SP 800-61r3 区别讲解；以组织规模为约束设计责任矩阵、事件等级、授权隔离、取证和恢复演练。
2. **身份/访问/数据保护**：分别出题考身份核验、认证器/AAL、授权、ABAC 主客体操作环境属性；为 CIA、加密、hash、MAC、签名和数据/实体/参照完整性约束提供不同错误场景。
3. **OWASP 版本升级**：如课程讲当前 web app 风险，更新 OWASP Top 10 到 2025 并标记版本；保留 OWASP API Security Top 10:2023 做 API 专项题，突出 BOLA、对象属性级和功能级授权、敏感业务流。
4. **工业云边**：将 IT/OT 分区、物理过程安全、远程维护、补丁窗口、工程站、恢复演练分别建模；在 Rev.4 Final 发布前，清晰标注 Rev.4 为 IPD 草案。
5. **Lambda**：画 batch/speed/serving 三层并用带事件 ID、事件时间、重复/迟到/撤销事件的样本推演合并；区分最终批视图与暂时速度视图。
6. **Kappa 与 Flink**：通过事件重放演练理解单路径前提；专门题考 event time/processing time/watermark/late event/checkpoint/state/offset/idempotent sink；增加多分区空闲、乱序、重启和重算样例。
7. 所有单元先保留修订建议和 evidence 范围，不写回课程正文、evidence 或状态；必须取得指定教材版次/页码并逐项覆盖后，才由人工决定是否升级。

## 未关闭事项与保护边界

- 20 个单元全部保持 `partial`；没有指定教材版次/页码的全主张覆盖确认，也没有人工审阅签字。
- 18.4.1 的 WPDRRC 原始出处和“反击”准确考试语义仍需教材核验；18.5.2 需以 NIST 800-63-4 对照课程身份核验/AAL表述；18.7.1–18.7.3 的旧 OWASP evidence 应明确版本并评估采用 2025 版；18.8.2 Rev.4 仍处 IPD；19.3.4 具体批流视图合并实现需教材/案例材料；19.4.1–19.4.3 需按课程指定 Flink/Kafka 版本核验参数与端到端语义。
- 本轮未修改课程 JSON、evidence 或学习状态；用户原有 `data/learning-content.json` 未提交差异保持原样。
- 未修改相邻题库、SQLite、学习/答题记录、正式答案或审批状态；未执行模型生成/评分、模拟考试、部署或 PR 合并。
