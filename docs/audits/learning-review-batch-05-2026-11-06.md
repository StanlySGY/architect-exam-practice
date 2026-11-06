# 批次 C 第 5 批 20 个学习单元来源与教学质量初审（2026-11-06）

## 结论与范围

本批按当前只读工作队列复核 20 个 `partial` 单元：13.3.4、13.4.1、13.4.2、13.4.3、13.4.4、13.4.6、13.5、13.6、13.7、14.2.2、14.2.3、14.2.4、14.3.1、14.3.2、14.3.3、14.3.4、14.4、15.2、15.6、15.8。

**20 个单元全部继续保持 `partial`。** 本轮只审阅当前主张、教学字段、自检题和登记的 evidence，并对照 Fowler、Microsoft、W3C、Jakarta EE、ITU-T、NIST/CNCF、Docker、Istio、OASIS 等公开资料核验概念边界。没有修改课程 JSON、证据或状态；也没有把厂商产品文档当作指定教材的替代品。

## 工作队列与共性问题

- 20/20 单元均只有 1 条结构有效的命题级 evidence，`reviewedOn` 均为 2026-10-10，每单元只登记 1 个来源 host。单条 evidence 只支持它声明的有限主张，不能证明整单元已覆盖。
- 20/20 的 `why`、`how`、`confusions`、`examFocus`、`scenarios` 五个教学字段全部命中已知模板信号。该信号用于定位需人工复核的教学字段，不代表事实必然错误。
- 20/20 的第一道自检均是“解释本单元 what 的核心含义”通用题；第二道自检分为三组重复脚手架：13.3.4—13.7 共 9 个单元使用层次职责/依赖方向分析；14.2.2—14.4 共 8 个单元使用云原生技术栈分析；15.2、15.6、15.8 共 3 个单元使用服务识别—契约—通信—治理分析。框架与主题有一定关联，但仍不能替代具体模式、标准边界和反例题。
- 本批多个主张属于多个概念并列的课程提纲，证据则只对应其中一个概念（如 DAO/ORM/CMP、IoT 分层、云原生模式、服务注册表/ESB/微服务）；不应让一条引用跨越它无法支持的概念范围。

## 逐项复核

| 单元 | 当前主张与 evidence 边界 | 复核发现与修订方向 |
|---|---|---|
| 13.3.4 | 业务框架被概括为提供组件装配、依赖注入、事务、缓存、日志、异常、权限和消息等通用能力；当前 evidence 只支持依赖注入降低组件对具体实现的耦合。 | DI 只是框架能力之一，并不意味着所有业务框架都内置或统一管理上述全部能力。以 .NET 为例，DI 与配置、日志、Options 集成，但其他能力分属不同扩展/基础设施。补充 DI 的接口抽象、注册、注入、生命周期（Transient/Scoped/Singleton）及生命周期误用风险；把事务、缓存、鉴权、消息等作为可组合能力而非框架必备清单。 |
| 13.4.1 | 教材主题并列直接访问、DAO、Data Mapper、离线数据模式和 ORM；现有 EF Core evidence 只支持对象/关系映射。 | 这些不是同义模式：直接访问可能让业务逻辑直接持有 SQL/连接；DAO 或 Table/Row Data Gateway 封装数据源接口；Data Mapper 在领域对象与数据源之间转换并尽量隔离二者；ORM 则是一类自动化映射机制，通常还涉及身份映射、变更跟踪、工作单元等行为。所谓“离线数据模式”必须回到教材确认其具体术语（可能涉及 Unit of Work、Identity Map 或断开连接后的对象状态），不能只用 EF Core 一条链接覆盖。 |
| 13.4.2 | 以统一 DataAccess 接口封装 SQL Server、Oracle、OleDb，由工厂按数据库类型创建访问对象；ADO.NET DbProviderFactory evidence 支持 provider factory 创建对应 provider 类型对象。 | 工厂抽象的是创建特定 provider 的连接/命令等对象，不会自动统一 SQL 方言、类型映射、事务隔离级别、分页语法、批处理或数据库特性。应区分“创建对象的工厂”“统一数据访问接口”和“真正跨库可移植的 SQL/行为契约”；切换 provider 仍需适配和兼容性测试。 |
| 13.4.3 | ORM 映射对象与数据库操作，Hibernate 为 Java ORM 示例，另列 CMP；现有 Hibernate evidence 只支持 Hibernate 对 Java 对象的持久化映射。 | ORM 与 CMP 不应并列为两个同层级同义产品。CMP 特指传统 EJB Entity Bean 的 container-managed persistence；它把字段/关系映射和持久化操作交给 EJB 容器管理，是历史 EJB 2.x 语境。现代 Java 持久化应另讲 Jakarta Persistence（JPA 旧称）与 Hibernate 实现关系。Jakarta Enterprise Beans 中 Entity Beans 已从 Jakarta EE Platform 10 平台组合中移除，但作为 Enterprise Beans 可选特性仍保留；不要把它写成现代 ORM 的通用定义。 |
| 13.4.4 | XML Schema 约束 XML 文档结构、内容和数据类型，并称其“逐步替代 DTD”；现有 W3C XSD evidence 支持结构/类型约束。 | XSD 1.1 的 Structures 与 Datatypes 是 W3C Recommendation；其类型系统提供超出 DTD 的数据类型描述能力，但不能据此称其在所有 XML 场景完全替代 DTD。应比较元素/属性结构、数据类型、命名空间、约束表达、实体/记号等能力，并区分语法/结构校验与业务语义校验；XSD 校验通过不等于业务规则成立。 |
| 13.4.6 | 连接创建、复用、关闭和并发控制，使用连接池减少创建连接开销；PgBouncer evidence 支持连接池复用。 | 需区分应用侧连接对象生命周期与池管理的底层物理连接。关闭池化连接通常是归还连接，不等于关闭物理会话；池化策略也会改变会话状态可见性。PgBouncer 有 session、transaction、statement 三种池化模式；statement 模式不允许跨多个语句的事务，transaction 模式只在事务期间分配服务端连接。不能把“连接池必然提升性能”写成无条件结论，需结合连接成本、并发、数据库上限和池等待/耗尽来评估。 |
| 13.5 | 数据架构规划/设计聚焦数据库与类设计、数据库与 XML 设计融合；现有 EF Core evidence 仅支持对象与关系数据映射。 | 需要分别说明领域对象/类模型与关系模型的映射（身份、关系、继承、值对象、事务和并发）以及 XML 数据模型/Schema 与数据库结构之间的数据交换、映射或存储策略。ORM 不会自动覆盖 XML 设计；当前证据未支持 XML—数据库融合方法，也未给出教材中的具体模式/图例，应标为待教材页码确认。 |
| 13.6 | 将 IoT 架构概括为感知层、网络层、应用层；ITU-T Y.4000/Y.2060 evidence 目前只支持 IoT 对象、连接和服务的跨层协同。 | **与 ITU-T Y.4000/Y.2060 的正式参考模型不一致。** ITU 模型有四层：应用层、服务支持和应用支持层、网络层、设备层；设备层包含设备与网关能力，管理能力与安全能力横跨四层。三层“感知/网络/应用”可作为其他教材/行业的简化模型，但必须明确标注来源/简化口径，不能说成 ITU-T 模型。ITU-T 记录显示 Y.2060 于 2016-02-05 重新编号为 Y.4000，未作修改，当前状态仍 In force。 |
| 13.7 | 通过典型案例综合分析分层架构与 IoT 架构取舍；42010 evidence 仅支持从系统情境、利益相关方关注点、约束和关系开展架构分析。 | 当前单元未给案例名称、背景、边界、架构图或结果，无法对“典型案例”做事实复核。建议用明确案例包：问题背景/利益相关方、设备与网关、连接与协议、平台支持能力、应用、管理和安全、性能/成本/运维约束、候选方案权衡。42010 是架构描述规范，不是 IoT 三层/四层模型的来源。 |
| 14.2.2 | 云原生以业务价值与云平台能力为导向，强调自动化、松耦合、弹性和韧性；CNCF evidence 支持自动化/弹性/可扩展应用。 | CNCF 2024 批准的 Cloud Native Definition v1.1 强调跨公有、私有和混合云环境，程序化、可重复、规模化地开发/构建/部署工作负载；系统应松耦合、安全、韧性、可管理、可持续且可观测。应避免“用了云平台即可云原生”或“自动实现业务价值”；需说明组织/交付实践与系统属性。 |
| 14.2.3 | 云原生常见模式用于解耦、弹性、治理和平台化；现有 Azure 架构模式目录只证明通用架构模式可解决常见问题。 | 通用架构模式不等于全部云原生模式。CNCF v1.1 列出的典型技术/架构组合包括容器、服务网格、多租户、微服务、不可变基础设施、Serverless、声明式 API，且清单非穷尽。建议按问题分类：发布/部署、弹性与故障隔离、通信、配置与治理、可观测性、数据与状态；每个模式列适用条件、代价和反例，而不是罗列产品名。 |
| 14.2.4 | 云原生改造若只迁移技术而不改变设计会产生新复杂性；CNCF evidence 仅支持云原生不是单纯托管位置。 | 该警示合理但不能写成所有迁移必然结果。Rehost/lift-and-shift 在时限、数据中心退出或短期风险控制场景可能有价值，但它不会自动获得云原生弹性、自动化和自治边界；重构引入分布式通信、故障、数据一致性和平台治理成本。应区分“迁移目标/策略/工作负载约束”，明确何时先迁、何时重构、如何衡量成本收益。 |
| 14.3.1 | 容器用操作系统级隔离封装应用及依赖、共享宿主机内核，启动快、密度高、可移植；Docker evidence 支持封装和共享内核。 | 应与虚拟机对照：VM 通常运行自己的 Guest OS/内核，由 Hypervisor 提供硬件虚拟化边界；容器作为进程共享宿主机内核，常减少启动/资源开销，但其隔离边界与 VM 不相同。不要把可移植性写成跨 CPU 架构、内核或运行时环境完全无条件；镜像、架构、权限、卷、网络和内核能力都会影响可移植性与安全性。 |
| 14.3.2 | 微服务以业务能力为边界，服务独立开发/部署/扩展并通过轻量协议协作；Microsoft evidence 支持围绕业务能力的服务和明确接口。 | 边界宜用业务能力与 DDD bounded context 界定；服务应有数据/领域模型所有权，独立部署需满足低耦合、团队自治和数据边界。轻量协议不是唯一要求，也不保证每个服务都能独立扩展；同步/异步、API/消息、数据一致性、分布式运维都要依业务权衡。避免“把单体切小”就等于微服务。 |
| 14.3.3 | Serverless 由平台管理服务器、运行时、扩缩与计费，开发者关注函数/业务代码；Azure evidence 支持平台接管基础设施管理。 | Serverless 不代表没有服务器，而是把底层服务器/容量/补丁等运维责任交给云服务商。函数计算只是形式之一；托管数据库、消息、API、工作流等也可组成 Serverless 应用。扩缩与计费模式依服务/套餐而异，不能承诺所有平台都按函数调用计费、零空闲成本或完全无运维责任。 |
| 14.3.4 | 服务网格通过 Sidecar 或节点代理接管服务间通信；Istio evidence 支持数据平面代理与控制平面。 | 方向成立，但“Sidecar 或节点代理”需要明确实现与版本。当前 Istio 文档区分 Sidecar 数据平面和 Ambient：Ambient 使用节点级 ztunnel 处理 L4，按需使用 Waypoint 处理 L7；二者可在同一 mesh 中共存。服务网格主要治理服务间网络流量、安全和遥测，不承接业务领域规则；也需要评估资源开销、运维、调试与配置复杂度。 |
| 14.4 | 案例观察业务拆分、平台能力、数据治理、弹性、高可用、DevOps 和组织协同；CNCF evidence 只支持云原生强调技术与运行实践。 | 该 what 是分析检查表，不是可核验案例。应补具体组织/系统案例和一手资料，记录改造前后架构、业务约束、数据治理、发布流程、平台责任边界、SLO/可用性指标、成本与团队协作变化。不能从 CNCF 的定义推出案例确实实现了这些目标。 |
| 15.2 | SOA 被划为萌芽、标准化、成熟应用三个阶段，并从 Web Service 扩展到企业级服务治理；OASIS SOA Reference Model 只支持技术无关的概念基础。 | OASIS SOA-RM v1.0 是 2006 年通过的抽象参考模型，明确不绑定具体标准、技术或实现。它讨论服务、可见性、交互、服务描述、契约与策略，不能证明课程中的三阶段历史时间线。Web Service 是实现 SOA 的技术路线之一，不等于 SOA 本身；应把历史分期标为课程叙事并补历史来源。 |
| 15.6 | 参考架构按集成对象和控制目标划分服务；OASIS SOA-RM 只支持服务、可见性、描述和交互等通用概念。 | 现有 what 缺少参考架构名称、服务类别清单和分类定义，OASIS 通用参考模型不能证明这套“集成对象/控制目标”分类。需回查教材的具体架构（如行业/产品参考架构）、列明服务类别、输入输出与控制责任，并标注是标准分类、厂商分类还是课程归纳。 |
| 15.8 | 将服务注册表模式、ESB 模式、案例研究和微服务模式并列；Istio evidence 只支持服务网格的治理能力。 | 这四项并非同一分类轴：服务注册表/发现是服务描述与查找机制；ESB 是集中式中介/集成模式，负责路由、转换、协议适配等消息中介；微服务是围绕业务能力拆分并独立部署的架构风格；案例研究是教学/分析材料，不是架构模式。服务网格又是微服务间通信治理的基础设施层，不等同 ESB。建议拆成“服务发现/注册、消息/集成中介、微服务自治边界、服务网格通信治理”四类并对照。 |

## 来源清单与适用边界

1. **数据访问、数据映射与 DI**
   - Martin Fowler, *Catalog of Patterns of Enterprise Application Architecture*：https://martinfowler.com/eaaCatalog/ 。用于区分 Table/Row Data Gateway、Active Record、Data Mapper、Unit of Work、Identity Map 等模式，不能代替教材对“离线数据模式”的精确命名确认。
   - Microsoft .NET Dependency Injection：https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection 。支持接口抽象、服务注册、构造函数注入及容器创建依赖；Service lifetimes：https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/service-lifetimes 。用于说明 transient/scoped/singleton 生命周期，不代表其他语言/框架都采用同一容器模型。
   - ADO.NET DbProviderFactory：https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/dbproviderfactories 。支持 provider factory 创建特定数据库 provider 的强类型连接对象，不承诺跨库语义完全一致。
   - Jakarta Persistence 3.2：https://jakarta.ee/specifications/persistence/3.2/ 。现代 Java 持久化/ORM 规范；Hibernate 是其兼容实现之一（实现版本须按产品文档核验）。
   - Jakarta Enterprise Beans 4.0：https://jakarta.ee/specifications/enterprise-beans/4.0/ 及 Core Features：https://jakarta.ee/specifications/enterprise-beans/4.0/jakarta-enterprise-beans-spec-core-4.0.html 。实体 Bean 从 Enterprise Beans 3.2 起为可选功能；Jakarta EE Platform 10 不再包含该可选特性，但 Enterprise Beans 组件规范仍有 Optional Features。Oracle 历史 EJB 2.0 CMP 文档：https://docs.oracle.com/cd/B25221_05/web.1013/b19177/cmporimp001.htm ，用于解释传统 CMP 的容器持久化语境，不作为现代 ORM 标准。

2. **XML Schema**
   - W3C XML Schema 1.1 Part 1 Structures：https://www.w3.org/TR/xmlschema11-1/
   - W3C XML Schema 1.1 Part 2 Datatypes：https://www.w3.org/TR/xmlschema11-2/
   - 两部分均为 2012-04-05 W3C Recommendation。Part 2 明确给出比 DTD 更丰富的数据类型定义能力；本轮据此纠正“所有场景完全替代 DTD”的全称表述。

3. **连接池**
   - PgBouncer 官方文档：https://www.pgbouncer.org/usage 与 https://www.pgbouncer.org/features.html 。用于说明连接复用和 session/transaction/statement 池化模式差异；它是 PostgreSQL 连接池的具体实现，不能直接套成所有数据库连接池的统一语义。

4. **物联网参考架构**
   - ITU-T Y.4000/Y.2060（06/2012）官方记录：https://www.itu.int/rec/T-REC-Y.4000
   - 原文 PDF：https://www.itu.int/rec/dologin_pub.asp?id=T-REC-Y.2060-201206-I%21%21PDF-E&lang=f&type=items
   - 本轮打开并视觉检查 Figure 4（印刷页 7）：图明确给出 application、service support and application support、network、device 四层，并在两侧绘出 management 与 security capabilities。ITU 官方记录说明 Y.2060 于 2016-02-05 重新编号为 Y.4000、无修改，当前 In force。

5. **云原生**
   - CNCF Cloud Native Definition v1.1（2024-02-26 批准）：https://github.com/cncf/toc/blob/main/DEFINITION.md
   - CNCF Glossary, Cloud Native Technology：https://glossary.cncf.io/cloud-native-tech/
   - 定义支持规模化、程序化、可重复的云原生实践和多种技术组合；非穷尽清单，不是强制的参考架构产品清单。

6. **容器、微服务、Serverless、服务网格**
   - Docker, *What is a container?*：https://docs.docker.com/learn/content/what-is-a-container/ 。说明容器进程共享宿主机内核，VM 运行独立 Guest OS/内核并有不同隔离边界。
   - Microsoft, *Microservices Architecture Style*：https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices 。支持业务能力/bounded context、服务自治、私有数据、独立部署与运维的权衡。
   - AWS, *What is Serverless Computing?*：https://aws.amazon.com/what-is/serverless-computing/ 。说明服务器仍存在，只是云厂商按需提供、管理与扩缩基础设施；具体计费随服务而异。
   - Istio 当前文档：https://istio.io/latest/docs/overview/dataplane-modes/ 、https://istio.io/latest/docs/ambient/architecture/data-plane/ 。本轮访问时文档导航标示 v1.31 为 Current；Sidecar 模式与 Ambient（节点级 ztunnel、可选 Waypoint）均有文档支持，模式/功能支持应按具体 Istio 版本核验。

7. **SOA、ESB、微服务边界**
   - OASIS, *Reference Model for Service Oriented Architecture v1.0*（OASIS Standard, 2006-10-12）：https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html 。明确是技术无关的抽象模型，讨论服务、可见性、交互、服务描述、契约和策略，不规定企业 SOA 实施路线或三阶段历史。
   - IBM, *What is an Enterprise Service Bus?*：https://www.ibm.com/think/topics/esb 。用于说明 ESB 是集中式应用集成中介，可执行消息路由、数据转换、协议转换等；该来源是厂商解释，不表示所有 SOA 都必须部署 ESB。
   - Microsoft microservices 与 CNCF service mesh 文档用于区分业务能力拆分和服务间通信治理：https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/microservices 、https://glossary.cncf.io/service-mesh/ 。两者不是服务注册表或 ESB 的同义词。

## 下一步教学修订建议（草案，未写回 JSON）

1. **13.3.4—13.4.6**：建立“DI/框架能力、DAO/Gateway、Data Mapper、ORM/JPA/Hibernate、EJB CMP、连接池”的分层概念表；按创建、映射、跟踪、持久化、连接复用分别设计题目。
2. **13.5—13.7**：分别补数据库—类映射、XML Schema/数据交换和 ITU 四层参考模型；13.7 补入可核验的具名案例与架构图。
3. **14 章**：按 CNCF v1.1 讲云原生实践属性和非穷尽的技术组合；分别练习容器/VM、微服务边界、Serverless 责任边界、Sidecar/Ambient 服务网格；把迁移策略和组织改造条件纳入案例。
4. **15 章**：拆分 SOA 概念参考模型、服务注册/发现、ESB 中介、微服务架构、服务网格治理；为服务分类明确参考架构名称和分类来源，删除或限定未经来源支持的三阶段时间线。
5. 将第二道自检替换为专项题：DI 生命周期误用；DAO vs Mapper vs ORM；provider factory 不保证跨库可移植；CMP 与 JPA/ORM；XSD 与 DTD 适用边界；连接池三种复用模式；ITU 四层与三层简化模型；CNCF 云原生属性；容器 vs VM；服务自治与数据所有权；Serverless 的责任/计费边界；Istio Sidecar vs Ambient；SOA/ESB/注册表/微服务/服务网格分类辨析。
6. 在获得明确课程正文编辑授权、指定教材版次和印刷页码、及人工复核记录之前，仅保留修订建议；不升级任何课程状态。

## 未关闭事项与保护边界

- 20 个单元全部保持 `partial`；无人工签字、教材逐页核验与整单元主张覆盖记录。
- 每单元只有 1 条有效命题级 evidence，记录日期均为 2026-10-10；证据不足以覆盖单元内所有事实主张。
- 13.4.1 “离线数据模式”的教材精确术语、13.5 数据库与 XML 的具体融合方法、13.7 的具名案例、15.6 的服务分类来源仍需教材原文/标准或厂商参考架构原件。
- 用户现有 `data/learning-content.json` 未提交修改继续原样保留；本轮未修改、暂存或提交。
- 未修改相邻题库、SQLite、学习/答题记录、正式答案和审批状态；未执行模型生成/评分、模拟考试、部署或 PR 合并。
