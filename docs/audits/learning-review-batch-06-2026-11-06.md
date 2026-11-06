# 批次 C 第 6 批 20 个学习单元来源与教学质量初审（2026-11-06）

## 结论与范围

本批按当前只读工作队列复核 20 个 `partial` 单元：15.9、15.10、16.1.2、16.1.3、16.2.1、16.2.2、16.2.3、16.2.4、16.2.5、16.3.1、16.3.3、16.4.1、16.4.2、16.4.3、17.2.1、17.2.2、17.2.4、17.3.3、17.4.1、17.4.2。

**20 个单元全部继续保持 `partial`。** 本轮只读核对 what、现有 evidence 的 claim/scope、教学字段与自检题，并与 W3C、OASIS、NASA/NIST、FreeRTOS、SQLite、OMG、GDB、Cambridge、欧盟 CORDIS、ITU-T、Cisco、SNIA、IETF、ISO 等资料交叉核验。外部资料用于概念边界和证据适配检查，不代替指定版次教材逐页核验；没有写回课程 JSON、证据或状态。

## 工作队列与共性问题

- 20/20 单元均只有 1 条结构有效的命题级 evidence；记录日期均为 2026-10-10，每单元仅 1 个来源 host。单条 evidence 只支持其明示 claim/scope，不代表单元内其他事实也被核验。
- 20/20 的 `why`、`how`、`confusions`、`examFocus`、`scenarios` 五个核心教学字段命中已知模板信号。它是优先检查教学针对性的启发式，不直接证明事实错误。
- 20/20 第一题均为“复述 what 核心含义”的通用题。第二题分为三组：15.9、15.10 共用“服务识别—契约—通信—治理—组合—故障处理”脚手架；16 章 12 个单元共用“任务时限—资源预算—硬件接口—调度/存储/可靠性”实时系统脚手架；17 章 6 个单元共用“网络拓扑—协议—容量/时延—可靠性/安全—运维”网络脚手架。分组主题相关，但多个自检与具体内容（如数据库耐久性、GDB 工具链、GENESYS、分布式 OS、SDN）仍有偏差。
- 本批有明确的证据错配：16.4.1 的 Linux cgroup v2 资料说明单机内核资源控制，不能支持“分布式操作系统/一次开发多端部署”；17.3.3 的 RFC 7426 是信息类 RFC，且描述控制平面通常可分布式实现，不支持把 SDN 定义成必须单一物理控制器；15.9 的 W3C 资料只将 REST 交互定义为无会话状态，不是所有 Web Service 的强制规则。
- 诸如“大多数嵌入式系统具备实时特征”“三层/四层结构”“一次开发多端部署”“腰型服务架构”等表述，必须区分教材分类、具体项目/厂商实现和通用规范。

## 逐项复核

| 单元 | 当前主张与 evidence 边界 | 复核发现与修订方向 |
|---|---|---|
| 15.9 | 强调遗留系统集成、服务粒度与无状态服务；现有 W3C Web Services Architecture evidence 只支持服务描述和消息交互。 | W3C 2004 Working Group Note 将“stateless”明确用于 REST 交互：消息含义不依赖会话状态；同一文件还区分 REST-compliant 与任意 Web services，后者可暴露任意操作。因此不能把无状态写成所有 Web Service/SOA 的必备条件，也不能误写为系统资源本身不能保存状态。服务粒度需按业务内聚、变更自治、调用频率、消息大小、事务边界、网络延迟和治理复杂度权衡；遗留集成要显式识别协议/数据格式/语义/安全/事务边界。 |
| 15.10 | SOA 实施按业务目标、现状、方案、服务识别、流程、基础设施和治理展开；OASIS SOA-RM 仅支持服务识别、描述与使用关系的概念框架。 | OASIS SOA Reference Model 是技术无关的抽象参考模型，不规定唯一项目实施路线图或瀑布阶段。建议把现有顺序写为可裁剪的实施检查清单：业务能力/现状分析、服务候选与边界、契约和策略、交互/组合、基础设施与安全、治理/版本/监控、渐进迁移；各项通常迭代往返，不是一次性顺序。 |
| 16.1.2 | 典型硬件包含嵌入式处理器、存储器、总线、定时/看门狗、I/O 和外设，并在性能、成本、功耗、可靠性、环境适应性之间权衡；NASA evidence 只支持嵌入式计算机作为更大系统一部分。 | NASA RTOS 101 将嵌入式系统描述为更大系统的一部分；列举的 CPU/MCU、RAM/ROM、总线、定时器、看门狗、I/O、传感器/执行器是常见组成示例而非所有设备的固定 BOM。需分清嵌入式与实时：嵌入式强调系统集成/应用目标，实时强调功能与时间约束，二者大量重叠但不等同。成本、功耗、EMI/温度/振动、维护周期和失效安全等约束要按具体任务选择。 |
| 16.1.3 | 早期监控程序+应用程序两层，RTOS 形成硬件、BSP、实时 OS、应用四层；现有 FreeRTOS evidence 只支持 RTOS 调度/同步基础。 | “两层→四层”更适合作为教学演进示意，不是普遍历史或强制标准架构。BSP/HAL 是板级适配与初始化边界；驱动可能归 BSP、OS 内核或独立模块，应用也可能直接使用部分硬件服务。RTOS 非所有嵌入式系统必需，裸机、循环调度、事件驱动或通用 OS 也可能满足要求。建议给出层间依赖图并注明特定平台的实际归属。 |
| 16.2.1 | 声称大多数嵌入式实时系统可归纳为层次化模式和递归模式；现有 FreeRTOS evidence 只支持 task/kernel 分层，不能证明这两类穷尽分类。 | 二者可作为课程介绍的两种典型抽象：层次化按抽象/职责组织，封闭层只依赖邻接低层、开放层可调用更低层；递归模式通过重复组合/包含关系把复杂系统逐步分解到不同粒度，可自顶向下或自底向上。这里“递归”不是函数递归或必然的任务互调。公开二手考试笔记可帮助理解术语，但不是标准原始依据；需核对指定教材页码，并把“大多数”限定为课程分类，不写成所有嵌入式系统的完整架构分类。 |
| 16.2.2 | EOS 负责资源分配、调度、控制和并行协调，并列出驱动、内核、协议栈和可配置组件；FreeRTOS evidence 只支持 RTOS 内核任务调度/同步。 | 区分“RTOS kernel”与完整嵌入式 OS/运行平台。内核通常提供任务调度、同步/通信、时钟/定时器、内存和中断相关基础能力；驱动、文件系统、网络协议栈、设备管理、更新/安全服务可能作为内核外组件或按需裁剪，不是每个 EOS 必须内置全部组件。实时性取决于调度、优先级、抢占、ISR 延迟、锁/优先级反转和 WCET 分析，不能仅凭“使用 RTOS”保证截止时间。 |
| 16.2.3 | 嵌入式数据管理强调小体积、低资源、可裁剪、实时响应、可靠存储和断电恢复；SQLite footprint evidence 只支持轻量部署形态。 | “小体积/单库嵌入式”不自动意味着硬实时、抗断电或高可靠。SQLite 官方文档明确区分 journal mode 与 `PRAGMA synchronous`：WAL 下 FULL 会在每次提交后同步 WAL，NORMAL 可能在掉电/系统崩溃后丢失最近事务；rollback 模式下 FULL 对掉电持久性的保证还受文件系统影响，EXTRA 在 DELETE journal 场景补充目录同步。嵌入式存储还要评估 Flash 写放大/磨损、断电恢复、事务时延尾部、并发、损坏检测和备份；若实时关键路径不能承受不确定 I/O，应采用异步/双缓冲/日志等分层设计。 |
| 16.2.4 | 中间件位于 OS 与应用之间，屏蔽差异并降低通信/复用/集成复杂度；OMG CORBA evidence 支持 ORB 处理远程对象调用和请求路由。 | 中间件是为应用提供通信、命名、消息、事务、安全或对象请求等公共服务的软件层/设施，不是所有场景都严格安装在 OS 与应用的单一夹层。CORBA ORB 可通过 stub、IDL、marshalling 和远程请求路由提供位置透明，但会引入序列化、网络时延、版本、故障和运维复杂度。要区分分布式对象中间件、消息中间件、数据库中间件、实时中间件；一般 CORBA/中间件不能自动满足硬实时约束。 |
| 16.2.5 | 开发环境由宿主机工具、目标机运行环境及连接调试设施组成，支持编辑、编译、下载、仿真、调试和测试；GDB evidence 只支持交叉开发/目标调试基本环节。 | 说明 host/target：交叉编译器运行在宿主机但输出目标 ISA/ABI 的程序；目标机实际运行二进制；调试可经 JTAG/SWD、串口、网络 remote stub、仿真器或硬件在环。区分交叉编译、交叉链接、烧录/下载、启动加载、远程调试、目标测试和配置管理。仿真器、探针、bootloader、IDE 不一定每个项目都具备，须按 MCU/SoC、板卡和调试链路选取。 |
| 16.3.1 | 先确定全局架构决策，再围绕架构分解、实现和验证；现有 ISO/IEC/IEEE 42010 evidence 被用于支持架构共同参照。 | **来源适用范围需要纠正。** ISO/IEC/IEEE 42010:2022 规定架构描述（AD）的结构表达、框架、视点和模型种类等，不规定架构本身、架构创建流程或 architecting methods。可用它支撑“架构描述帮助利益相关方围绕关注点沟通”的主张，但“先定全局决策再分解实现验证”属于方法论，需要另引架构开发方法/过程资料。架构文档不会自动保证质量，需将质量属性场景、约束、决策记录与验证活动关联。 |
| 16.3.3 | DARTS 通过并发任务结构化设计实时系统，关注任务划分、通信和同步；现有 evidence 指向 DARTS/DA 分布式扩展。 | 需区分 DARTS（Design Approach for Real-Time Systems）与 DARTS/DA（Distributed Applications）。1989 论文摘要明确 DARTS/DA 扩展 DARTS，先建立数据流模型，再按标准分布式子系统拆分并定义接口，之后结构化并发任务和任务接口；Cambridge 的实时嵌入式软件设计章节补充 concurrent task structuring、task interfaces、communication/synchronization。不要把 DARTS/DA 的分布式步骤全当作原始 DARTS 的定义，也不能把 DARTS 当调度算法或截止时间证明。 |
| 16.4.1 | 将分布式操作系统描述为多设备协同、统一架构和“一次开发、多端部署”；当前 Linux cgroup v2 evidence 仅支持资源管理机制。 | **现有 evidence 与主张明显不匹配。** cgroup v2 用于 Linux 内核对进程/层级的资源组织和限制，不是分布式 OS 或跨设备编程模型依据。分布式 OS 的典型目标是把多个自治节点/资源通过透明性和协调机制呈现为较统一的系统视图（single-system image）；“一次开发多端部署”则更像跨设备运行时、API/SDK 兼容和应用框架能力，不等同于分布式 OS 定义。应区分 network OS、distributed OS、cluster/SSI middleware 和多设备应用框架；补具体平台官方架构及硬件/系统版本兼容矩阵。 |
| 16.4.2 | GENESYS 被描述为 ARTEMIS 专家组于 2008—2009 年提出的消息驱动、构件化和“腰型服务架构”；现有 CORDIS evidence 支持跨领域嵌入式参考架构项目目标。 | CORDIS 官方项目页记载项目 2008-01-01 至 2009-06-30、由 TU Wien 协调，纳入 FP7-ICT 项目；目标是开发可按不同领域实例化的嵌入式参考架构，关注可组合性、网络、安全、鲁棒性、诊断、资源管理、演化性及核心/可选服务。该页没有“waist architecture”或完整消息驱动结构描述，也不能支持“由 ARTEMIS 专家组提出”这一作者归属。需查 GENESYS 原项目交付物/论文，核验其层次、服务总线/腰部、消息机制和构件组合；在此之前只保留项目定位和日期。 |
| 16.4.3 | 将 IoT 视为泛化嵌入式系统，采用感知/网络/应用三层，并称 IoT OS 覆盖芯片、终端、边缘和云端；ITU-T Y.4000 evidence 只支持对象、网络、服务和应用关联。 | ITU-T Y.4000/Y.2060 正式参考模型为**四层**：应用层、服务支持与应用支持层、网络层、设备层；管理能力与安全能力关联并横跨四层。三层感知/网络/应用可作为课程或行业简化图，但不能冒充 ITU 正式模型。IoT 与嵌入式系统有广泛交集，不是严格同义或单向“泛化”关系；设备 RTOS、边缘平台、云服务编排和互操作中间件是不同部署域，“一个 IoT OS 从芯片覆盖云端”不是通用标准事实。 |
| 17.2.1 | LAN 覆盖园区、楼宇或机房并常采用分层设计；Cisco 设计指南支持接入/汇聚/核心三层园区 LAN 模型。 | NIST 将 LAN 定义为覆盖相对有限区域、以通信链路互联的设备集合。Cisco 的园区层次化设计是一个具体、经过验证的设计模型；指南明确按站点规模可只用接入+汇聚、或采用三层，不能断言所有 LAN 必须三层。还需区分二层/三层拓扑、物理/逻辑分层、VLAN 与 IP 子网、故障域和冗余设计。 |
| 17.2.2 | WAN 连接不同地域/组织，关注链路质量、路由、成本、容灾和安全；NIST evidence 只支持 WAN 相对 LAN 的覆盖/用户规模定义。 | NIST 对 WAN 的定义是服务较多独立用户、通常覆盖比 LAN 更大地理范围的物理或逻辑网络。链路质量、路由、成本、容灾和安全是设计/运营关注点，不是每一种 WAN 的固定架构组成。应按 MPLS、Internet VPN、SD-WAN、专线/运营商以太网等连接方式说明 SLA、路由收敛、双活/备份、加密和跨域管理权衡。 |
| 17.2.4 | 存储网络为服务器提供块、文件或对象存储访问；SNIA evidence 只支持对象存储的唯一标识对象组织/访问方式。 | 区分存储访问语义而不是混为“同一存储网络类型”：块存储把卷/块地址呈现给主机，常经 DAS/SAN（FC、iSCSI、NVMe-oF）；文件存储提供文件/目录与共享协议（NFS/SMB，典型 NAS）；对象存储按 object ID/API 操作对象与元数据，不等于目录文件系统。存储介质底层可相互映射，逻辑访问方式与物理设备/网络拓扑不是同一分类维度。需分别补 block、file、object 一手定义和负载适用性，不能只用 SNIA object storage 一条 evidence。 |
| 17.3.3 | SDN 以控制器集中编排、网络开放 API 实现自动化；RFC 7426 支持控制/转发抽象及控制平面概念。 | RFC 7426 是 Informational RFC，给出抽象术语而非强制 controller 产品拓扑。文中控制平面“通常是分布式的”，管理平面“通常是集中式的”；并指出不同实现中控制/管理边界不总清晰。SDN 核心在于抽象与接口化地控制网络行为、分离控制逻辑和转发执行；一个逻辑控制面可以有分布式/层级控制器，开放 API 是常见实现能力而非所有 SDN 部署的绝对定义。需区分 control plane、forwarding/data plane、management plane 与 application plane。 |
| 17.4.1 | 识别业务、用户、应用、流量、性能、可靠性、安全、管理和预算需求；ISO/IEC 25010 evidence 支持用质量模型辅助需求定义/完整性检查。 | ISO/IEC 25010:2023 是 ICT/软件产品质量模型，可用于引出质量需求、设计目标、测试目标和验收准则，不会自动识别业务目标、用户角色、业务流程、预算或流量模型。建议按利益相关方/业务目标、功能需求、质量属性、运行/管理/安全约束、容量/流量模型、成本和法规逐类采集；将“高性能/高可靠”转成可验证的响应时间分位数、吞吐量、可用性、恢复时间、丢包/抖动阈值和验收场景。NIST QoS 词条将吞吐量、带宽、时延、错误率、丢包和抖动列为可测属性，但不能混为同一指标。 |
| 17.4.2 | 在技术、性能、可靠性、兼容性、安全、可维护性和成本之间权衡；ISO/IEC 25010 evidence 支持多个质量属性评价维度。 | ISO/IEC 25010:2023 的产品质量模型有九个特性，为规格、测量和评价提供参考，并可支持需求/测试/验收；它不提供某项目属性权重或自动给出最佳方案。成本、进度、既有技术和组织能力通常是外部决策约束，不应误当作模型可直接求解的质量维度。应先明确优先级、最低门槛和质量属性场景，再比较候选方案的收益、成本、风险和 Pareto 取舍；不能“性能/可靠性/安全/可维护性/成本全部最优”。 |

## 来源清单与适用边界

1. **Web Service / SOA**
   - W3C *Web Services Architecture*（W3C Working Group Note, 2004-02-11）：https://www.w3.org/TR/ws-arch/ 。第 3.1.3 节将 stateless 归于 REST 交互，并区别 REST-compliant 与 arbitrary Web services；它不是规范性要求所有 Web Service 无状态。
   - OASIS *Reference Model for Service Oriented Architecture v1.0*（2006-10-12）：https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html 。支持服务、描述、可见性、交互、策略、契约等概念，不规定唯一实施路线。

2. **嵌入式与实时**
   - NASA *Real-Time Operating Systems (RTOS) 101*：https://www.nasa.gov/wp-content/uploads/2016/10/482489main_4100_-_rtos_101.pdf 。将实时系统的功能要求和时间要求（deadline）区分，并说明硬/软/firm 实时概念；用于解释“时间约束而非单纯速度”，不是所有嵌入式硬件的通用 BOM。
   - NIST SP 500-243 *Requirements for Real-time Extensions for the Java Platform*（1999）：https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-243.pdf 。第 1.3 节讨论 hard/soft deadline、tardiness 和应用特定的 timeliness；这是实时术语和模型来源，不是课程固定定义唯一来源。
   - FreeRTOS kernel fundamentals：https://docs.aws.amazon.com/freertos/latest/userguide/dev-guide-freertos-kernel.html 与 scheduler：https://docs.aws.amazon.com/freertos/latest/userguide/freertos-kernel-scheduler.html 。支持任务调度、优先级、同步等 RTOS 内核职责，不能外推为完整 OS 必含所有 drivers/protocol stacks。
   - FreeRTOS scheduling modes：https://github.com/FreeRTOS/FreeRTOS-Kernel-Book/blob/main/ch04.md 。用于说明 fixed-priority/preemptive/time slicing 的具体实现和可配置差异。
   - 递归模式的二手说明：https://wuguojing.cn/softexam/arch/embedded-system.html 、https://jishuzhan.net/article/1801500161696862209 。只用于辅助解释课程术语和工作流；须按指定教材原页确认，不作为标准或权威架构定义。

3. **嵌入式存储、中间件和开发工具**
   - SQLite PRAGMA synchronous：https://www.sqlite.org/pragma.html 。解释 FULL/NORMAL/EXTRA 与 journal mode 对提交持久性和掉电风险的影响；不能证明 SQLite 提供硬实时服务。
   - OMG ORB Basics：https://www.omg.org/gettingstarted/orb_basics.htm 与 CORBA Specification：https://www.omg.org/spec/CORBA/ 。支持 ORB 的请求路由、接口描述、marshalling/remote invocation 等；具体实时性能须另查 Real-Time CORBA 和具体实现。
   - GNU GDB Remote Debugging：https://sourceware.org/gdb/current/onlinedocs/gdb.html/Remote-Debugging.html 。用于 host/target 远程调试机制；目标端 stub/探针/协议依芯片与工具链选择。

4. **架构描述与 DARTS**
   - ISO/IEC/IEEE 42010:2022：https://www.iso.org/standard/74393.html 。明确区分 architecture 与 architecture description，并且不规定创建/管理架构描述的流程、方法、技术或工具。
   - Gomaa, *A software design method for distributed real-time applications*（Journal of Systems and Software, 1989, DOI: https://doi.org/10.1016/0164-1212(89)90012-5）。摘要说明 DARTS/DA 是 DARTS 的分布式实时应用扩展，包含数据流建模、分布式子系统分解、并发任务结构化和接口定义。
   - Cambridge University Press, *Real-Time Software Design for Embedded Systems*, Chapter 13 *Concurrent Real-Time Software Task Design*（2016）：https://doi.org/10.1017/CBO9781139644532.014 。支持并发任务结构化、接口、通信和同步主题；不是调度正确性证明。

5. **分布式 OS、GENESYS 与 IoT**
   - Distributed OS / single-system-image 基础材料：https://www.oreilly.com/library/view/operating-system-concepts/9780471694663/ch16.html 、https://www.usenix.org/legacy/publications/library/proceedings/ana97/full_papers/shirriff/shirriff.html 。用于解释节点独立性、单系统视图、跨节点资源/进程管理；不支持某厂商“一次开发多端部署”承诺。
   - European Commission CORDIS, GENESYS (Grant Agreement 213322)：https://cordis.europa.eu/project/id/213322 。支持项目日期、协调机构和跨领域嵌入式参考架构目标；没有证明 waist architecture / message-driven 的具体模型。
   - ITU-T Y.4000/Y.2060 (06/2012)：https://www.itu.int/rec/T-REC-Y.4000 。正式 IoT 参考模型四层及管理/安全横切能力；Y.2060 于 2016-02-05 重编号为 Y.4000、未修改，状态 In force。

6. **网络与存储**
   - NIST LAN glossary：https://csrc.nist.gov/glossary/term/local_area_network ；WAN glossary：https://csrc.nist.gov/glossary/term/wan 。用于术语覆盖范围，不规定特定拓扑或服务质量。
   - Cisco Campus LAN Design Guide：https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/cisco-campus-lan-wlan-design-guide.html 。接入/汇聚/核心三层园区设计示例，并说明层数按部署规模取舍；厂商验证设计，不是强制标准。
   - SNIA Dictionary：https://www.snia.org/sites/default/files/snia-dictionary-pdf/SNIADictionary.pdf ；Object Storage：https://www.snia.org/education/what-is-object-storage ；NAS：https://www.snia.org/education/what-is-nas 。SNIA object-storage 定义强调对象唯一标识和 API；block/file/NAS/SAN 仍需分开补齐定义。
   - SNIA *How Block Storage is Accessed*（行业教育资料）：https://www.snia.org/sites/default/files/ESF/SNIA-Block-File-Object-Storage-Webcast-Final.pdf 。用于块地址经 DAS/SAN 和 storage controller 的示意，不能代表所有 SAN 产品和 file/object 协议。

7. **SDN 与质量需求**
   - IETF RFC 7426, *Software-Defined Networking (SDN): Layers and Architecture Terminology*（Informational）：https://www.rfc-editor.org/rfc/rfc7426.html 。支持 control/forwarding/management/application planes 和抽象层术语；明确说明控制平面通常分布式、管理平面通常集中式，且实施边界可能不同。
   - NIST QoS glossary：https://csrc.nist.gov/glossary/term/quality_of_service ；RFC 8238：https://www.rfc-editor.org/rfc/rfc8238.html 。用于区分吞吐量/带宽、时延、抖动/PDV、丢包等可测 QoS 指标。
   - ISO/IEC 25010:2023：https://www.iso.org/standard/78176.html 。发布的产品质量模型，九项特性可辅助需求、设计、测试和验收；不替项目给出指标值和权重。

## 下一步教学修订建议（草案，未写回 JSON）

1. **SOA（15.9—15.10）**：将“无状态”限定为 REST 交互语义；补服务粒度正反例、遗留集成的协议/数据/身份/事务边界；把实施路线明确为可迭代检查清单而非 OASIS 强制阶段。
2. **嵌入式基础（16.1—16.2）**：加入 embedded vs real-time、hard/soft deadline、WCET/ISR latency；将硬件构成和硬件适配层作为可配置示例；区分 RTOS kernel/EOS、驱动/协议栈和应用层；为递归模式补分解图与指定教材页码。
3. **数据/中间件/开发链（16.2.3—16.2.5）**：数据管理补 journal/synchronous/断电场景；中间件增加 CORBA/RPC 与消息中间件的差异和额外延迟；开发环境补 host-target 架构和交叉工具链工作流。
4. **架构方法与实时设计（16.3）**：把 ISO 42010 限定为架构描述规范；补质量属性场景、决策记录和架构验证闭环；将 DARTS 与 DARTS/DA 分开讲。
5. **现代嵌入式/网络（16.4—17.3）**：分布式 OS 与跨设备开发平台分开；GENESYS 补项目原始 deliverable 并确认 waist/message-driven 用语；IoT 补 ITU 四层与管理/安全横切；LAN/WAN 补拓扑、冗余、QoS；存储补 block/file/object 访问对照；SDN 补控制/转发/管理/应用平面和逻辑集中/物理分布。
6. **需求与权衡（17.4）**：将功能、质量、运行、安全、容量、成本约束分开收集；网络性能指标给出单位、统计口径和测量点；质量属性先设最低门槛和优先级，再比较方案，不写“同时最优”。
7. 将第二道自检替换为知识点专项题：REST stateless vs server state、SOA-RM vs implementation process、hard/soft deadlines、RTOS scheduling/priority inversion、BSP ownership、SQLite WAL/rollback crash recovery、middleware overhead、host/target build、42010 scope、DARTS/DARTS-DA、distributed OS vs multi-device framework、GENESYS provenance、ITU four-layer IoT、LAN tiers optionality、WAN QoS、block/file/object、SDN planes、quality scenario tradeoffs。
8. 在获得指定教材版次/印刷页码和明确课程正文编辑授权前，只保留修订建议；不升级任何学习状态。

## 未关闭事项与状态边界

- 全部 20 个单元仍为 `partial`；没有人工签字、指定教材页码闭环或整单元覆盖确认。
- 每单元只有一条有效命题级 evidence，日期均为 2026-10-10，不足以覆盖所有材料性主张。
- 16.2.1 两种架构模式的正式教材措辞、16.4.1 的“一次开发多端部署”具体平台、16.4.2 的 GENESYS “腰型/消息驱动”原始证据、17.2.4 block/file/object 来源仍需更直接原始材料。
- NIST SP 500-243 PDF 页面文本已通过检索定位，但本轮网页截图服务对该 PDF 返回 DisabledError，未完成页面图像核验；实时硬/软时限结论只按可检索文本和 NASA 资料作初审。
- 用户原有 `data/learning-content.json` 未提交修改保持原样，本轮未修改、暂存或提交。
- 未修改相邻题库、SQLite、学习/答题记录、正式答案或审批状态；未执行模型生成/评分、模拟考试、部署或 PR 合并。
