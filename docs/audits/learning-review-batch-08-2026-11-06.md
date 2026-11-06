# 批次 C 第 8 批 20 个学习单元来源与教学质量初审（2026-11-06）

## 结论与范围

本批按只读工作队列复核 20 个 `partial` 单元：11.4.5、17.3.2、2.4、11.1.1、12.1.3、12.3.1、13.4.5、14.2.1、15.7、7.2.2、8.1.2、8.2.1、8.3、9.1.2、10.7.1、16.3.2、17.2.5、17.3.1、18.3.2、18.3.3。

**20 个单元全部继续保持 `partial`。** 本轮对 what、evidence claim/scope、why/how/confusions/scenarios/examFocus 和 selfChecks 逐项检查，并使用 NIST、ISO/IEC/IEEE、IETF RFC、CNCF、OASIS、CMU/SEI、NASA、PostgreSQL、Open Networking Foundation 与 The Open Group 相关资料核对。来源核验只能确认特定主张及其边界，不能替代指定教材版次和印刷页码的逐项覆盖，也不等于人工确认整单元已 complete。

## 工作队列信号

- 20/20 单元仅登记 1 个来源 host；其中 18/20 只有 1 条结构有效的命题级 evidence，11.4.5 与 17.3.2 各有 2 条。两条记录仍然只涉及有限主张，不等于完整覆盖。
- 教学模板启发式命中：`why` 11/20、`how` 4/20、`confusions` 4/20、`examFocus` 17/20、`scenarios` 18/20。模板检测是排序线索，不判定事实真伪。
- 第一题中 14/20 是通用复述提示，6/20 更贴近专项知识；第二题共用网络、质量属性、安全、技术概念等少量脚手架。总体自检质量比前几批有所改善，但仍有“用通用架构分析模板覆盖具体机制”的情况，例如 IPv6 转换分类、TOGAF/ADM 层次、ADR 最小字段、事务 ACID、ATAM 九步和可靠性指标单位应分别直接考查。
- 11.4.5、17.3.2 的第二条 evidence 扩大了覆盖，但 11.4.5 引用的 SP 800-213 Rev.1 仍为 2026 年初始公开草案（IPD），不是最终版；17.3.2 的 RFC 6144 是转换框架，具体 SIIT/NAT64 机制还需分别引用 RFC 7915/RFC 6146/RFC 6147。不能把框架性文档写成机制规范。
- 需要特别澄清的概念边界：CPS 不只是“嵌入式系统/控制系统升级版”；ISO/IEC/IEEE 42010:2022 规范架构描述，不规定架构本身或 architecting 方法；OASIS SOA-RM 明确不将“松耦合、粗粒度”作为定义性术语，因为它们是主观权衡且缺少通用度量；SDN 逻辑集中不等于物理单控制器；可用性、韧性、可靠性和容灾不能互换。

## 逐项复核

| 单元 | 当前主张与 evidence 边界 | 复核发现与修订方向 |
|---|---|---|
| 11.4.5 | 边缘节点处于现场和多租户环境，需保护设备、平台、应用、数据、网络与运维链路。原 evidence 有 NIST SP 800-213 Final 和 SP 800-213 Rev.1 IPD 两条。 | SP 800-213（2021 Final）支持从设备能力和风险视角建立 IoT 设备安全要求；Rev.1（2026-06-24）把 IoT product 作为系统元素，说明采购/集成可改变系统风险评估，但截至本轮仍标记 Initial Public Draft，不能称“新标准已生效”。Rev.1 公开征求意见已于 2026-08-24 截止。应把边缘端安全拆成物理防护/设备身份与启动链、补丁与漏洞管理、平台隔离和租户边界、应用/API、数据生命周期、网络分区和远程运维；按实际 threat model 和设备能力选控制，不给所有边缘节点套一张固定清单。 |
| 17.3.2 | 通过双栈、隧道、翻译和协议转换逐步完成 IPv4 向 IPv6 演进；RFC 4213 支持双栈和配置隧道，RFC 6144 提供转换框架。 | “隧道”和“翻译”应进一步拆分。RFC 7915 是 SIIT（无状态 IP/ICMP 转换算法），并取代 RFC 6145；RFC 6146 规定 stateful NAT64，通常与 RFC 6147 DNS64 配合，让 IPv6-only 客户端访问 IPv4-only 服务器。它们与双栈、隧道解决的问题不同：双栈两套协议并行；隧道通过封装穿越不支持目标协议的网络；翻译跨地址族转换报文/会话。建议增加适用条件、状态维护、DNS 依赖、端到端可达性、日志/ACL/MTU/故障定位和安全代价；不要将 RFC 6144 当作 NAT64/SIIT 的逐项实现规范。 |
| 2.4 | 嵌入式系统是嵌入对象体系、应用中心、软硬件协同、资源受限，并强调实时、可靠、安全的专用计算系统；现有 NIST 1990 资料只支持“更大系统中的专用组成部分”。 | 1990 年会议论文不能支持现代定义中的全部特征。IEEE Technology Navigator 的说明可补充“集成于较大设备、执行特定功能、处理器/存储/I/O 与物理运行约束协同设计”；但实时性并非每个嵌入式系统的必要条件，且通用/嵌入式是连续谱，系统仍可能支持受控更新和扩展。建议区分“嵌入式”的应用/产品边界、资源约束、软硬件协同、实时属性和安全关键等级，不要把“专用”误读为不可编程或永不升级。 |
| 11.1.1 | CPS 被描述为控制系统和嵌入式系统的扩展，核心为“状态感知→实时分析→科学决策→精准执行”；NIST SP 1500-201 支持数字、模拟、物理、人类组件相互作用并由物理规律与逻辑集成实现功能。 | “扩展”表述可能过度简化。CPS 的关键是数字/计算逻辑与物理过程、人类交互及其约束的集成，不只是给嵌入式设备加网络或云。感知—分析—决策—执行是常见闭环示意，但不是 NIST 定义规定的唯一架构；要补反馈延迟、实时/时序、安全、物理过程模型、人在环/人在回路以及网络/控制失效的级联影响。建议区分 CPS、IoT、工业互联网与传统控制系统的交集，不把它们当同义词。 |
| 12.1.3 | 架构核心表述强调软件元素、元素外部可见属性和关系；ISO/IEC/IEEE 42010:2022 支持区分实体的 architecture 与表达它的 architecture description。 | 目前 evidence 没有验证课程所引“软件元素及外部可见属性”定义的确切出处/版本。该措辞是软件架构领域常见历史定义，但不要把它误写成 ISO/IEC/IEEE 42010:2022 的逐字定义；2022 版明确说明它规定架构描述结构和表达，不规定架构实体本身、需求或 architecting 方法。建议追溯课程采用的 IEEE 1471 / 42010 旧版或教材原文，再明确架构、架构描述、技术栈、模块图的区别。 |
| 12.3.1 | TOGAF 是企业架构框架，ADM 是核心迭代式架构开发方法；现有 The Open Group 页面是入口页，能支持基本关系，但需要明确版本。 | TOGAF Standard 10th Edition 将 ADM 作为架构开发方法，包含 Preliminary 与 A–H 阶段、Requirements Management 居中；通过迭代和裁剪应用于不同架构工作，而非必须从头到尾一次性线性执行。The Open Group 2025 更新资料也继续包含 ADM、ADM Techniques 和 Applying the ADM。建议自检考“框架、方法、阶段、工作产品/交付物”层次，以及 ADM 如何适配企业、项目和架构分区；不能把 TOGAF 当软件产品或把 ADM 当成某张图/模板。 |
| 13.4.5 | 事务把多个操作作为整体提交或回滚，并以 ACID 描述关键性质；PostgreSQL 官方事务教程支持 all-or-nothing、并发可见性和持久记录等具体行为。 | 回滚只是事务原子性的一部分，不能等同 ACID 全部性质。原子性是全成或全败；一致性是事务前后维持所定义的不变量/约束；隔离性处理并发事务相互影响，具体异常取决于隔离级别；持久性是在提交确认后按数据库保证保存结果。应用业务规则、约束、补偿、外部消息/文件副作用不一定自动受本地数据库事务保护。建议增加并发更新和跨服务操作情境，要求指出 ACID 保证边界。 |
| 14.2.1 | 云原生架构利用容器、微服务、服务网格、Serverless、DevOps 等形成弹性、自动化和持续演进能力；CNCF evidence 支持可扩展、松耦合、韧性、可管理、可观测与自动化等方向。 | CNCF Cloud Native Definition v1.1（2024-02-26）强调公共/私有/混合云中以程序化、可重复方式构建和部署工作负载；容器、服务网格、微服务、不可变基础设施、声明式 API 是例子而非必选套餐。建议将目标（可扩展、韧性、可管理、可观测、自动化）与具体工具区分，增加复杂度、分布式故障、平台运维、成本和团队能力约束；“部署在云上”或“使用 Kubernetes”不自动意味着云原生。 |
| 15.7 | SOA 服务设计强调清晰接口、松耦合、复用、粗粒度、自治、互操作与治理；OASIS SOA-RM 支持服务能力、服务描述、接口、消费者/提供者与契约。 | 一个很重要的定义边界：OASIS SOA-RM 明确说明在该参考模型中刻意不采用“loose coupling”和“coarse-grained”作为 SOA 定义术语，因为这两者具有主观性且缺少有用的统一度量。服务应有可理解的接口/描述，说明输入、输出、语义、策略和交互约束；服务边界/粒度是架构权衡，不是越粗越好。建议把这些特征作为设计目标/质量考量而非普遍定义条件，并强调契约版本、状态、错误语义、安全与服务治理。 |
| 7.2.2 | 架构描述应表达结构及关系给涉众；视角针对关注点组织描述，视图是在该视角下形成的表达，决策/约束/风险可追溯到相关视图。 | ISO/IEC/IEEE 42010:2022 的核心对象包括涉众、关注点、视角、视图、模型种类及架构描述框架/语言；它要求架构描述能有效支持关注点，但不规定全项目统一的固定视图清单，也不规定绘图/建模方法。建议把 viewpoint 定义为构造 view 的约定，把 view 定义为架构针对涉众关注点的表达；架构描述不是架构本身，图的数量也不代表描述完整。 |
| 8.1.2 | 架构评估关注能通过架构结构、机制和决策影响的质量属性；SEI 原理支持结合各属性领域的分析技术、场景、问卷、检查表和度量开展评价。 | 不同属性需要不同分析方法，场景与度量应绑定明确环境、刺激、制品、响应和响应度量；单一吞吐量/可用率数字不能代表整体架构质量。架构评估也不是代码测试或简单检查模式清单。建议要求说明某一属性是否真的受架构决策影响、采用何种证据/模型，以及评估结论仍有哪些假设与不确定性。 |
| 8.2.1 | what 讲风险、敏感点和权衡点；selfCheck 又加入“非风险”；CMU/SEI ATAM 资料明确将 risks、non-risks、sensitivity points、tradeoff points 列为架构分析结果。 | 建议在 what 中补齐“非风险”并给出准确含义：风险是可能威胁业务目标/质量目标的架构决策或假设；非风险是经过分析后当前有证据认为不会威胁目标的决策/假设（不是“系统没有风险”）；敏感点是对某个质量属性响应有显著影响的决策/参数；权衡点是影响多个属性且改善一个可能牺牲另一个的决策。不要把四者混为一谈或把“非风险”写成永远安全。 |
| 8.3 | ATAM 通过质量属性场景和架构决策分析风险、敏感点、权衡点与多方沟通；CMU/SEI 官方整理给出九步流程。 | 九步包括介绍方法、呈现业务驱动因素、呈现架构、识别架构方法、构建质量属性效用树、分析架构方法、集体提出/排序场景、再次分析架构方法、呈现结果。它是结构化的涉众参与式分析，不是自动化基准测试或简单打分表；结果通常包括架构方法、效用树、场景、风险/非风险、敏感点、权衡点及风险主题。建议将九步/输出与 ADD 区分：ATAM评估候选架构，ADD是属性驱动的设计方法。 |
| 9.1.2 | 软件可靠性是在指定环境和时间内无故障运行的概率；证据为 NASA 技术备忘录，说明 failure intensity、mean time to next failure 与 hazard rate 等表达。 | 可靠性指标必须绑定运行剖面、环境、时间窗和观测数据。failure intensity 是单位时间内失效数变化率（需明确暴露量单位）；mean time to next failure 是时间期望；hazard rate 是在此前未失效条件下的瞬时条件失效率。它们不能无条件互换，也不等于可用性；可用性还受修复/恢复时间影响。NASA 1994 文档中的示例目标值属于其特定航空软件语境，不能推广为通用考试阈值。 |
| 10.7.1 | ADR 记录重要架构决策的背景、选择及后果，使后续团队理解设计理由并追溯；AWS 证据支持 ADR 最低包含 context、decision、consequences。 | 推荐增加备选方案、状态（proposed/accepted/superseded 等）、日期/负责人、影响范围、依赖和相关 ADR/需求链接。ADR 记录的是有长期影响的设计决策及取舍，不是完整架构文档，也不必每个实现细节都单独写；新决策替代旧决策时保留历史，不能直接覆盖旧记录。建议专项自检让学生根据一次数据库/消息总线选型写一条 ADR，并能指出背景、备选、选择和后果。 |
| 16.3.2 | ADD 以功能需求、质量属性场景和约束为输入，递归分解系统并选择架构策略；SEI 明确其可用于嵌入式系统。 | ADD 是通用质量属性驱动设计过程，不会自动保证实时性、功耗或硬件可靠性。SEI描述的步骤包括确认需求充分、选择待分解元素、识别架构驱动因素、选择设计概念，再实例化元素/分配职责/定义接口/验证细化并递归。建议明确嵌入式场景额外输入：处理器/存储/总线/外设、deadline、功耗、温度、尺寸、功能安全和硬件在环验证；将 ADD 方法步骤与具体处理器/RTOS 选型区分。 |
| 17.2.5 | SDN 将网络控制与转发功能解耦，使控制可编程；ONF 定义支持物理分离和控制多设备，逻辑集中控制可拥有全局视图。 | 逻辑集中不等于物理单点控制器。ONF SDN Architecture Overview 说明控制器可按性能、规模和可靠性需要由多个物理实例协同构成。应分清 application、control、forwarding/data plane 与 management plane；同时讨论 northbound/southbound 接口、状态一致性、控制器高可用、控制通道隔离/认证、设备失联后转发行为和配置回滚。不要把 SDN 等同于 OpenFlow；OpenFlow 是实现方式之一。 |
| 17.3.1 | 网络韧性结合故障检测、替代资源、恢复流程和业务连续性计划，降低单点/区域性中断影响；NIST Contingency Planning 支持中断后系统、业务和数据恢复及备用设备/处理/地点。 | 建议明确定义 resilience/韧性与 availability/可用性、reliability/可靠性、backup/备份、DR/灾难恢复和 business continuity/业务连续性之间的关系。冗余和快速收敛偏向降低中断概率/持续时间；备份偏向数据恢复；灾难恢复处理重大站点/区域中断；业务连续性覆盖人员、流程、供应商和人工替代。用 BIA、RTO、RPO 和演练结果证明恢复能力，避免仅列技术手段就声称“韧性”。 |
| 18.3.2 | 安全规划从组织使命和业务流程识别资产、威胁、脆弱性、依赖与影响，再按风险/优先级选择控制；NIST CSF 2.0 与 SP 800-37 RMF 支持组织背景、风险管理和控制选择。 | 需区分资产、威胁源/事件、脆弱性、可能性、影响、风险与控制。漏洞扫描结果或 CVSS 严重度不是业务风险本身；风险需考虑业务影响、威胁情境、暴露面、现有控制及组织风险容忍度。NIST CSF 2.0 Organizational Profile 的 Current/Target 状态可帮助识别差距与优先级，RMF 则提供 Prepare/Categorize/Select/Implement/Assess/Authorize/Monitor 生命周期；两者用途层次不同，不是同一个打分公式。 |
| 18.3.3 | 安全规划应形成目标架构、路线图、项目组合、预算、责任和度量；CSF 2.0 与 NIST RMF 支持治理、持续监测及风险优先级。 | 2026-06-30 NIST 发布 SP 800-18 Rev.2，定义相互关联的 system security plan、system privacy plan 和 cybersecurity supply chain risk management plan；描述系统目的、控制实施状态、角色/职责和预期行为，并与 RMF 活动关联。建议安全规划由目标架构、风险处理路线、控制责任/资源、里程碑、证据/度量和复评机制构成，同时考虑隐私和供应链计划；不要把 CSF 六项功能按瀑布阶段执行，也不要把合规检查完成视为风险已清零。 |

## 来源与适用边界

1. **IoT/边缘安全**
   - NIST SP 800-213（Final, 2021-11）：https://csrc.nist.gov/pubs/sp/800/213/final 。从 IoT 设备能力与组织风险管理角度建立设备网络安全要求。
   - NIST SP 800-213 Rev.1 IPD（2026-06-24）：https://csrc.nist.gov/pubs/sp/800/213/r1/ipd 。当前页面明确标为 Initial Public Draft，征求意见已于 2026-08-24 截止；不能当作 Final。
   - NIST SP 800-213A Rev.1 pre-draft（2026-08-31）：https://csrc.nist.gov/pubs/sp/800/213/a/r1/iprd 。伴随目录修订仍处预草案/意见征询阶段；不能作为最终 IoT 控制目录。

2. **IPv6 过渡**
   - IETF RFC 4213：https://www.rfc-editor.org/rfc/rfc4213.html 。双栈、配置隧道的基础过渡机制。
   - IETF RFC 6144：https://www.rfc-editor.org/rfc/rfc6144.html 。IPv4/IPv6 转换框架，信息类 RFC。
   - IETF RFC 7915：https://www.rfc-editor.org/rfc/rfc7915.html 。无状态 SIIT 报文转换算法，2016 年 Proposed Standard，Obsoletes RFC 6145。
   - IETF RFC 6146：https://www.rfc-editor.org/rfc/rfc6146.html 。Stateful NAT64。
   - IETF RFC 6147：https://www.rfc-editor.org/rfc/rfc6147.html 。DNS64 与 NAT64 协同。

3. **嵌入式系统与 CPS**
   - IEEE Technology Navigator — Embedded System：https://technav.ieee.org/topic/embedded-system/ 。用于现代嵌入式系统的专用功能、较大设备集成及软硬件协同概念；并非 IEEE 标准正文。
   - NIST SP 1500-201, *Framework for Cyber-Physical Systems: Volume 1, Overview*（2017-06-26）：https://www.nist.gov/publications/framework-cyber-physical-systems-volume-1-overview 。CPS 涉及数字、模拟、物理和人类组件，按物理与逻辑集成实现功能。
   - ISO/IEC TR 13066-4 的 embedded system 术语预览（第三方 PDF）：https://previewnorm.com/iso/ISO%20IEC%20TR%2013066-4-2015%20PDF.pdf 。补充指出嵌入式系统概念处于通用计算到专用计算的连续谱；应优先对照可访问的正式标准文本。

4. **软件/企业架构、SOA 和云原生**
   - ISO/IEC/IEEE 42010:2022 官方摘要：https://www.iso.org/standard/74393.html 与 IEC 页面：https://webstore.iec.ch/en/publication/80194 。规定架构描述结构/表达、涉众关注点、视角/视图等概念关系；明确不规定架构实体本身或 architecting 过程/方法。
   - The Open Group TOGAF Standard 10th Edition — ADM 2025 update 出版物样本信息：https://www.heinen.nl/BookApi/GetSample?guid=9e5ad45e-2741-4874-831e-3bb5196c56c9 ；The Open Group 10th Edition — ADM 章节信息：https://books.google.com/books/about/The_TOGAF_Standard_10th_Edition_Architec.html?id=-5RsEAAAQBAJ 。作为出版物元数据/样本核对：ADM 是迭代式企业架构开发方法，指南支持裁剪。The Open Group 入口页本轮返回 403，指定教材页码仍待补。
   - OASIS SOA Reference Model v1.0：https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html 。描述服务、能力、接口、消费者/提供者和服务描述；并明确“loose coupling”“coarse-grained”不作为定义术语，因为其主观且无统一有用度量。
   - CNCF Cloud Native Definition v1.1：https://github.com/cncf/toc/blob/main/DEFINITION.md 。2024-02-26 批准，强调在公有/私有/混合环境中以程序化、可重复方式构建和部署可扩展工作负载。
   - CNCF Cloud Native Technology Glossary：https://glossary.cncf.io/cloud-native-tech/ 。技术类别是例子，不构成每个系统的强制清单。

5. **事务与架构评估/设计**
   - PostgreSQL 18 Transactions Tutorial：https://www.postgresql.org/docs/18/tutorial-transactions.html 。解释全有或全无、并发可见、提交持久化、回滚和 savepoint；不代替数据库隔离级别和应用业务不变量分析。
   - CMU/SEI ATAM Collection：https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/ 。给出九步 ATAM、风险/非风险/敏感点/权衡点及风险主题产物。
   - CMU/SEI ATAM 原始技术报告：https://www.sei.cmu.edu/library/the-architecture-tradeoff-analysis-method/ 。说明多个质量属性相互竞争的架构权衡。
   - CMU/SEI Quality Attribute Evaluation Principles：https://www.sei.cmu.edu/library/principles-for-evaluating-the-quality-attributes-of-a-software-architecture/ 。支持按属性选择分析技术、场景、问卷、检查表和度量。
   - CMU/SEI ADD Collection：https://www.sei.cmu.edu/library/attribute-driven-design-method-collection/ 。递归分解架构，输入包含功能要求、质量属性要求和约束；已用于信息系统与嵌入式应用。

6. **软件可靠性、ADR、SDN 和系统恢复**
   - NASA Technical Memorandum NASA-TM-104799 (1994), *Software Reliability Estimation and Prediction*：https://ntrs.nasa.gov/citations/19950005501 。定义指定环境/时间内无故障运行概率，讨论 failure intensity、mean time to next failure、hazard rate；文中阈值不得脱离航空软件语境推广。
   - AWS Prescriptive Guidance ADR FAQ：https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/faq.html 。最低包含 context、decision、consequences，建议有备选方案、状态、变更记录和 owner。
   - Open Networking Foundation SDN Definition：https://opennetworking.org/sdn-definition/ ；SDN Architecture Overview：https://opennetworking.org/wp-content/uploads/2013/02/SDN-architecture-overview-1.0.pdf 。支持控制平面与转发平面解耦、逻辑集中控制；逻辑集中控制器可以物理分布。
   - IETF RFC 7426：https://www.rfc-editor.org/rfc/rfc7426.html 。区分 control、management、application、forwarding 等平面术语。
   - NIST Contingency Planning：https://csrc.nist.gov/Topics/Security-and-Privacy/security-programs-and-operations/contingency-planning 。系统中断后的协调恢复策略与备选设备/处理/地点。

7. **安全风险和计划**
   - NIST CSF 2.0：https://www.nist.gov/cyberframework 。风险治理与管理的通用框架。
   - NIST CSF Organizational Profiles：https://www.nist.gov/cyberframework/profiles ；NIST SP 1301：https://csrc.nist.gov/pubs/sp/1301/final 。Current/Target Profile 帮助识别差距、优先结果和目标。
   - NIST SP 800-37 Rev.2：https://csrc.nist.gov/pubs/sp/800/37/r2/final 。RMF 七步生命周期：Prepare、Categorize、Select、Implement、Assess、Authorize、Monitor。
   - NIST SP 800-18 Rev.2（Final 2026-06-30）：https://csrc.nist.gov/pubs/sp/800/18/r2/final 。系统计划包括 security、privacy、cybersecurity supply chain risk management 三类，并说明系统目的、控制状态和角色/职责。
   - NIST SP 800-53 Release 5.2.0（2025-08-27）：https://csrc.nist.gov/news/2025/nist-releases-revision-to-sp-800-53-controls 。若课程引用较早 Update 1，应核对控制版本。

## 下一步教学修订建议（草案，未写回 JSON）

1. **边缘/IoT 与 IPv6**：把设备、平台、租户、应用、数据、远程管理分域，标明 IPD/Final 状态；把双栈、隧道、SIIT、NAT64/DNS64 的机制和适用场景分开出题。
2. **嵌入式/CPS**：使用现代定义与边界例子；突出 CPS 的数字/物理/人类集成、实时与物理安全影响，而不是“嵌入式 + 网络”的简单叙述。
3. **架构描述/TOGAF**：追溯软件架构经典定义来源版次；用 view/viewpoint/stakeholder/concern 的区分题检验 42010；TOGAF 题区分框架、ADM、阶段、迭代、裁剪和项目产物。
4. **事务、云原生和 SOA**：为 ACID 分别配并发/失败情境；CNCF 云原生定义用目标而不是组件列表讲解；明确 OASIS 不把 coarse-grained/loose coupling 作为硬性定义。
5. **质量评估/可靠性**：直接测试 ATAM 九步和四类产物；区分 ATAM 与 ADD；软件可靠性需给出环境、任务剖面、时间窗、失效数据和指标单位，区别可靠性与可用性。
6. **ADR/SDN/韧性**：给出可复用 ADR 模板字段和一次决策示例；SDN 画出逻辑集中/物理分布的控制平面；韧性题要求用 BIA、RTO/RPO、备份和演练区分方案。
7. **安全规划**：使用 CSF 2.0 Current/Target Profile 和 RMF 的不同层次；增加 SP 800-18 Rev.2 的安全/隐私/C-SCRM 三类计划；把风险识别与漏洞扫描、CVSS、业务风险排序区分。
8. 在未获得指定教材版次、页码和完整原始材料前，只记录修订建议，不改课程 JSON/evidence/status，也不自动把 partial 升级为 verified。

## 未关闭事项与保护边界

- 20 个单元全部保持 `partial`；没有指定教材版次/印刷页码的全主张覆盖确认，也没有人工审阅签字。
- 12.1.3 需要回查软件架构定义的历史原文/版本；12.3.1 需补教材 TOGAF/ADM 版次与印刷页码；9.1.2 的 NASA 指标公式和统计假设仍需指定课程教材核验。
- 11.4.5 的 SP 800-213 Rev.1 与 SP 800-213A Rev.1 仍为草案阶段，不能表述为最终版要求；17.3.2 转换机制需依据 RFC 7915/6146/6147 区分；17.2.5 需补课程采用的 SDN 参考架构版本。
- 用户原有 `data/learning-content.json` 未提交差异保持原样，本轮未修改、暂存或提交。
- 未修改相邻题库、SQLite、学习/答题记录、正式答案或审批状态；未执行模型生成/评分、模拟考试、部署或 PR 合并。
