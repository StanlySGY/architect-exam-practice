const endpoint = process.env.FREEPLANE_MCP_URL || 'http://127.0.0.1:6298/';
const token = process.env.FREEPLANE_MCP_TOKEN;
if (!token) throw new Error('Set FREEPLANE_MCP_TOKEN before running this script.');
let requestId = 1;
async function mcp(method, params) {
  const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }) });
  const body = await r.text(); if (!r.ok) throw new Error(`${method}: HTTP ${r.status}: ${body}`); const p = JSON.parse(body); if (p.error) throw new Error(`${method}: ${JSON.stringify(p.error)}`); return p.result;
}
const tool = (name, args) => mcp('tools/call', { name, arguments: args });
const c = (text, details) => details ? { text, details } : { text };
function flatten(branch) { const nodes = []; function visit(item, parentIndex) { const index = nodes.length; nodes.push({ index, parentIndex, content: c(item.text, item.details), ...(item.children?.length ? { foldingState: 'UNFOLD' } : {}) }); for (const child of item.children || []) visit(child, index); } visit(branch, -1); return nodes; }

const branches = [
  { text: '2.1 计算机系统概述', details: '计算机系统由硬件、软件组成；网络把地理分散且独立的计算机和通信设备连接起来，实现数据交换、资源共享和信息传递。', children: [
    { text: '硬件子系统', details: '由机械、电子、磁介质、光介质等物理实体构成，典型包括处理器、存储器、输入和输出设备。' },
    { text: '软件子系统', details: '由按特定顺序组织的数据、指令及程序文档构成；分系统软件和应用软件。' },
    { text: '硬件与软件关系', details: '硬件有形、软件无形；可编程逻辑等功能在设计时像软件、运行时又体现为硬件，边界逐渐模糊。' },
    { text: '计算机系统分类', details: '可按结构、性能、规模、软件构成、整体用途和服务对象分类；设备可能兼具多种特征，分类边界并不绝对。' },
  ] },
  { text: '2.2 计算机硬件', details: '按处理器、存储器、总线、接口、外部设备理解现代冯·诺伊曼计算机硬件。', children: [
    { text: '硬件组成', details: '冯·诺伊曼五部分为运算器、控制器、存储器、输入设备和输出设备；现实中运算器/控制器集成成处理器，I/O 通过总线和接口连接外设。' },
    { text: '处理器 CPU', details: '计算机运算和控制核心，位宽从 4 位到 64 位，经历单核、多核、异构多核、众核发展。', children: [
      { text: 'CISC 与 RISC', details: 'CISC 指令复杂，以 x86 为代表；RISC 指令精简，以 ARM、Power 为代表，后期指令集总体趋向 RISC。' },
      { text: '典型组成', details: '指令部件、运算部件、寄存器组、存取部件、Cache、MMU、完成部件及地址/数据总线；完成取指、译码、执行、结果排队和顺序控制。' },
      { text: '专用处理器', details: 'GPU 具有大量核心、适合并行计算和深度学习；DSP 面向实时信号处理，采用饱和算法、乘加和 FFT 专用指令；FPGA 可编程逻辑实现专用硬件。' },
      { text: '国产处理器', details: '教材列举龙芯、飞腾、申威、兆芯、国微、国芯、华睿、翔腾微、景嘉微等，应用于不同领域。' },
    ] },
    { text: '存储器', details: '使用半导体、磁、光等介质保存数据；典型类型包括 SRAM、DRAM、NVRAM、Flash、EPROM、Disk。', children: [
      { text: '存储层次', details: '按与处理器物理距离分片上缓存、片外缓存、主存、外存；越靠近 CPU 越快、容量越小、成本越高。' },
      { text: '片上缓存', details: '处理器核心内集成，通常 SRAM，容量较小，用于快速读取。' },
      { text: '片外缓存', details: '核心外 SRAM，容量略大，常称 L2/L3 或平台 Cache。' },
      { text: '主存/内存', details: '通常 DRAM，通过总线与处理器连接，需要不断充电维持数据，容量可从数百 MB 到数十 GB。' },
      { text: '外存', details: '磁带、磁盘、光盘、Flash 等，速度慢但容量大且掉电保持数据；不同介质寿命不同。' },
    ] },
    { text: '总线', details: '遵循特定协议、格式和控制逻辑实现部件间数据交换。', children: [
      { text: '内总线', details: '芯片内部或片上互连。' },
      { text: '系统/局部总线', details: '连接 CPU、主存和 I/O 接口；多总线系统中还包括级联局部总线。' },
      { text: '外部/通信总线', details: '连接计算机板与外设或计算机系统；通过桥进行总线协议转换。' },
      { text: '性能指标', details: '带宽、服务质量 QoS、时延、时延抖动。' },
      { text: '常见类型', details: '并行 PCI、PCIe、ATA/IDE；串行 USB、SATA、CAN、RS-232、RS-485、RapidIO、以太网。' },
    ] },
    { text: '接口', details: '同一计算机不同功能层之间的通信规则；一个总线可有多种物理接口，如以太网可用 RJ-45 或同轴电缆。', children: [
      { text: '显示接口', details: 'HDMI、DVI 等。' },
      { text: '音频接口', details: 'TRS、RCA、XLR 等。' },
      { text: '网络与外设接口', details: 'RJ-45、FC、PS/2、USB、SATA、LPT、RS-232，以及按需求定制的离散量和 A/D 接口。' },
    ] },
    { text: '外部设备', details: '非必要但通常存在的外围设备，包括所有 I/O 和部分外存；通过接口、指令和数据与计算机主体协作。', children: [
      { text: '通用外设', details: '键盘、鼠标、显示器、扫描仪、摄像头、麦克风、打印机、光驱、网卡、存储卡/盘。' },
      { text: '移动/可穿戴外设', details: '加速计、GPS、陀螺仪、感光和指纹识别设备。' },
      { text: '行业设备', details: '测温/测速仪、操作面板、红外/NFC、场强测量、功率驱动、机械臂、液压装置、油门杆和驾驶杆。' },
    ] },
  ] },
  { text: '2.3 计算机软件', details: '软件是程序、文档、数据及处理规则的集合；系统软件管理资源并提供平台，应用软件解决特定业务问题。', children: [
    { text: '软件分类', details: '系统软件包括操作系统、语言翻译系统、数据库管理系统和网络软件；应用软件按使用面分通用软件和专用软件。' },
    { text: '操作系统', details: '计算机资源管理者，是硬件之上的第一层软件，向下管理裸机，向上为系统软件、应用和用户提供接口。', children: [
      { text: '内核与配套', details: '内核提供进程、存储、文件、设备管理；配套包括 GUI、常用应用、实用程序、应用框架、编译器和程序库。' },
      { text: '操作系统作用', details: '管理运行程序并分配资源；为用户和应用提供方便接口；扩充硬件功能、提高资源共享和系统效率。' },
      { text: '主要特征', details: '并发性、共享性、虚拟性、异步性；多程序并发执行时需要调度、同步、互斥和保护。' },
      { text: '分类', details: '批处理、分时、实时、网络、分布式、嵌入式、个人计算机、服务器和移动操作系统等。' },
      { text: '实时系统', details: '在规定时间内响应并完成任务；硬实时必须满足期限，软实时允许偶尔超时但会降低服务质量。' },
    ] },
    { text: '数据库', details: '按组织与分布方式理解关系数据库、分布式数据库、DBMS 和大型数据库特征。', children: [
      { text: '关系数据库', details: '以二维关系表组织数据，具有数据独立性、共享性、完整性和安全性；核心概念包括关系、元组、属性、域、键和完整性约束。' },
      { text: '分布式数据库', details: '数据分布在多个网络节点，由统一 DBMS 管理；对用户尽量透明，需处理分布式事务、数据一致性、复制、分片和故障恢复。' },
      { text: '常用 DBMS', details: '教材介绍 Oracle、DB2、SQL Server 等大型关系数据库及其应用。' },
      { text: '大型数据库特点', details: '海量数据、高并发、复杂事务、分布式部署、可靠性/可用性、安全性、备份恢复和性能优化要求高。' },
    ] },
    { text: '文件系统', details: '操作系统负责文件命名、组织、存取、共享、保护和空间管理。', children: [
      { text: '文件与文件系统', details: '文件是具有符号名、逻辑结构和存取权限的信息集合；文件系统管理文件及其在存储介质上的组织。' },
      { text: '文件类型', details: '按用途可分普通文件、目录文件、设备文件；按内容可分文本、二进制、可执行等。' },
      { text: '结构与组织', details: '记录式、流式；顺序、索引、直接/随机等组织方式。' },
      { text: '存取与空间管理', details: '顺序、直接、索引存取；采用连续、链接、索引等文件分配及空闲空间管理。' },
      { text: '共享与保护', details: '通过访问控制、权限、加密、备份和锁机制实现共享与安全保护。' },
    ] },
    { text: '网络协议', details: '协议规定通信实体之间数据格式、语义、时序和控制规则；TCP/IP、OSI 是核心体系。' },
    { text: '中间件', details: '位于操作系统和应用之间，为分布式应用提供统一通信、事务、消息、对象、数据访问和安全服务。', children: [
      { text: '分类', details: '通信/消息中间件、事务处理中间件、数据访问中间件、对象中间件、应用服务器/业务中间件等。' },
      { text: '作用', details: '屏蔽异构平台差异，降低分布式系统开发复杂度，提高复用、互操作、可靠性和可扩展性。' },
      { text: '产品形态', details: '消息队列、交易监控、应用服务器、对象请求代理、企业服务总线等。' },
    ] },
    { text: '软件构件', details: '独立、可复用、可组装的软件单元；通过接口与容器/平台协作。', children: [
      { text: '构件组装模型', details: '顺序组装、层次组装、叠加组装；接口不匹配时使用适配器或胶水代码。' },
      { text: '标准规范', details: 'Web Services、EJB、.NET 等构件模型规定接口、元数据、部署和通用服务。' },
    ] },
    { text: '应用软件', details: '为特定应用需要设计的软件。', children: [
      { text: '通用软件', details: '办公、图形图像、工具、娱乐等可服务大量用户或多个领域的软件。' },
      { text: '专用软件', details: '面向特定行业、组织或业务流程定制的软件，如财务、人事、图书管理。' },
    ] },
  ] },
  { text: '2.4 嵌入式系统及软件', details: '嵌入式系统是嵌入对象体系、以应用为中心、软硬件协同、资源受限并强调实时性、可靠性和安全性的专用计算系统。', children: [
    { text: '组成', details: '硬件层（处理器、存储器、I/O、传感器/执行器）、嵌入式操作系统、中间件/驱动、应用软件和开发工具链。' },
    { text: '特点', details: '专用性、可裁剪、资源受限、实时性、可靠性、安全性、高确定性、软硬件一体化和生命周期约束。', children: [
      { text: '实时性', details: '对任务响应时间和截止期有明确要求，强调确定性调度和中断响应。' },
      { text: '安全与可靠', details: '安全攸关场景需容错、余度、鲁棒性、故障分析和严格验证。' },
      { text: '高确定性', details: '任务、资源、状态、错误和时限预先规划，采用静态资源分配、越界检查、状态机和静态调度。' },
    ] },
    { text: '分类', details: '按应用可分工业控制、交通、航空航天、医疗、消费电子、网络设备等；按实时性可分实时和非实时。' },
    { text: '嵌入式软件组成与开发', details: '板级支持包、驱动、嵌入式 OS、中间件、应用和固件；通常在宿主机开发、交叉编译，再下载/固化到目标机。', children: [
      { text: '与传统开发差异', details: '强调软硬件协同、代码规模、目标机测试、实时性、安全性、可靠性和专用工具。' },
      { text: '资源约束', details: '存储、计算、功耗和通信资源有限，需裁剪系统、静态分配和模块化设计。' },
    ] },
    { text: '安全攸关软件', details: '可能导致不可接受风险的软件；安全性应从系统场景自上而下分析，识别安全需求并反馈到系统需求。', children: [
      { text: '开发保证级别', details: '按软件对安全性的影响分级；级别越高，开发、验证活动和证据越多，成本也越高，不是越高越好。' },
      { text: 'DO-178B 目标/过程/数据', details: '为机载软件适航提供生命周期目标、活动及证明目标达成的软件生命周期数据；目标、过程、数据贯穿生命周期。' },
      { text: 'DO-178B 五级', details: 'A 灾难性 66 个目标；B 危害性 65；C 严重 56；D 不严重 28；E 无影响 0。' },
      { text: '三类过程', details: '软件计划过程；软件开发过程（需求、设计、编码、集成）；软件综合过程（验证、配置管理、质量保证、审定联络）。' },
      { text: '与 CMMI 区别', details: 'CMMI 从组织过程改进和能力提升出发，覆盖个人/项目/组织；DO-178 从适航审定和安全影响出发，目标更具体、过程输出数据要求更明确，聚焦软件。' },
    ] },
  ] },
  { text: '2.5 计算机网络', details: '利用通信线路把分散的计算机和通信设备连接起来，依靠网络软件与协议实现资源共享和信息传递；涵盖通信、网络、组网、网络工程。', children: [
    { text: '网络基本概念', details: '网络由节点、链路、协议和网络软件构成；重要指标包括带宽、时延、吞吐量、误码率、利用率、可靠性和安全性。', children: [
      { text: '网络功能', details: '数据通信、资源共享、分布式处理、提高可靠性、集中管理和支持协同应用。' },
      { text: '网络发展', details: '从主机互联、局域网、互联网发展到移动互联网、云计算、物联网和高速承载网络。' },
    ] },
    { text: '通信技术', details: '研究信息在信道中的传输、调制编码和资源共享。', children: [
      { text: '信道', details: '信号传输的物理或逻辑通道；关注带宽、容量、噪声、误码和传输距离。' },
      { text: '信号变换', details: '模拟/数字转换、调制/解调、编码/解码；使信号适应信道并提高抗干扰能力。' },
      { text: '复用技术', details: '频分复用、时分复用、波分复用、码分复用等，使多个信号共享同一信道。' },
      { text: '多址技术', details: 'FDMA、TDMA、CDMA、OFDMA 等，使多个用户共享通信资源。' },
    ] },
    { text: '网络技术与类型', details: '按覆盖范围和接入方式可分 LAN、WLAN、WAN、MAN、移动通信网。', children: [
      { text: 'LAN 局域网', details: '覆盖范围小、速率高、管理集中；以太网和令牌网是典型技术。' },
      { text: 'WLAN 无线局域网', details: '以 IEEE 802.11 系列为主，使用无线电频段；需关注速率、覆盖、干扰与安全。' },
      { text: 'WAN 广域网', details: '跨地域连接多个局域网，依赖运营商线路和路由设备。' },
      { text: 'MAN 城域网', details: '覆盖城市范围，典型技术包括 DQDB 等。' },
      { text: '移动通信网', details: '支持移动终端接入、蜂窝覆盖、漫游和移动数据服务，持续向 4G/5G 演进。' },
    ] },
    { text: '网络设备与工作层级', details: '集线器/中继器/网桥/交换机/路由器/防火墙在不同层次完成转发、互连和安全。', children: [
      { text: '集线器', details: '物理层设备，把一个端口收到的数据转发到所有其他端口，形成共享冲突域。' },
      { text: '中继器', details: '物理层再生信号，延伸传输距离，可连接相同逻辑链路的不同物理介质。' },
      { text: '网桥', details: '数据链路层设备，依据帧和 MAC 连接不同物理分支/介质。' },
      { text: '交换机', details: '数据链路层设备，根据 MAC 表在端口间建立独享转发通路，减少冲突、提升吞吐。' },
      { text: '路由器', details: '网络层设备，通过路由表在不同网络之间选择路径并转发数据包。' },
      { text: '防火墙', details: '网络门户安全设备，根据规则监视和过滤进出数据，硬件实现可减轻 CPU 负担。' },
    ] },
    { text: 'OSI 与 TCP/IP', details: '分层体系把复杂通信问题分解并保持层间独立。', children: [
      { text: 'OSI 七层', details: '物理层、数据链路层、网络层、传输层、会话层、表示层、应用层；每层在下层服务基础上提供增值服务。' },
      { text: 'TCP/IP 四层', details: '网络接口层、网际层、传输层、应用层；核心是 IP、TCP/UDP 和应用协议族。' },
      { text: 'TCP/IP 协议族', details: 'IP、TCP、UDP、Telnet、FTP、SMTP、NNTP、HTTP 等；提供逻辑编址、路由、域名解析、差错检测、流量控制和应用支持。' },
      { text: '重要协议', details: '网际层还有 ICMP、ARP、RARP；应用层常见 DNS、WWW、E-mail、FTP、Telnet、NFS、SNMP。' },
      { text: '地址与服务', details: '域名与 IP 一一对应；IP 有 IPv4/IPv6；WWW 以超文本、URL 和图文声界面提供互联网信息服务。' },
    ] },
    { text: '交换技术', details: '交换机学习源 MAC 与端口映射并建立转发路径。', children: [
      { text: '交换过程', details: '学习源地址→查表转发目的地址→未知目的地址泛洪→定期更新 MAC 表。' },
      { text: 'STP 与链路聚合', details: '生成树协议避免冗余链路环路；802.3ad 等链路聚合提升可靠性和带宽。' },
    ] },
    { text: '路由技术', details: '路由器提供异种网络互连、协议转换、数据路由、速率适配、广播隔离、分片重组、备份和流控。', children: [
      { text: '路由表', details: '包含网络地址、连接信息、路径信息和代价；可静态配置或由动态协议生成。' },
      { text: 'IGP', details: '自治系统内部网关协议；距离矢量适合小型网络，链路状态的 IS-IS、OSPF 更适合大型网络。' },
      { text: 'EGP/BGP', details: '自治系统之间的外部网关协议；BGP 克服早期 EGP 对复杂互联网拓扑的局限。' },
    ] },
    { text: '网络工程', details: '网络建设是综合通信、网络、信息系统和项目管理的系统工程。', children: [
      { text: '网络规划', details: '调研业务、用户、流量、可靠性和安全需求，确定建设目标、范围和总体方案。' },
      { text: '网络设计', details: '设计拓扑、地址、协议、设备、链路、冗余、QoS、安全和管理体系。' },
      { text: '网络实施', details: '设备采购、安装、配置、测试、割接、验收、文档和运行维护。' },
    ] },
  ] },
  { text: '2.6 计算机语言', details: '计算机语言由语法、语义和语用等要素构成，可从机器级到高级、建模和形式化语言理解。', children: [
    { text: '语言组成', details: '语法规定程序形式，语义规定含义，语用体现语言在实际环境中的使用；还涉及数据类型、控制结构、模块和异常等。' },
    { text: '机器语言', details: '由二进制指令组成，可直接被 CPU 执行，效率高但难编写、难移植、难维护。' },
    { text: '汇编语言', details: '用助记符表示机器指令，需汇编器翻译；比机器语言易读，但仍依赖硬件。' },
    { text: '高级语言', details: '接近自然语言和数学表达，强调抽象、可读性、可移植性和开发效率；需编译或解释执行。' },
    { text: '建模语言', details: 'UML 等用图形和规范描述系统结构、行为、需求和设计，服务分析设计沟通。' },
    { text: '形式化语言', details: '具有严格数学语法和语义，可用于规格说明、证明、验证和编译器理论，减少歧义。' },
    { text: '语言翻译方式', details: '编译：整体翻译生成目标程序；解释：逐句分析执行；混合/虚拟机方式先生成中间代码再运行。' },
  ] },
  { text: '2.7 多媒体', details: '多媒体综合文字、图形、图像、声音、视频、动画等信息形态，并通过计算机交互呈现。', children: [
    { text: '重要特征', details: '多样性、集成性、交互性、实时性、数字化、非线性和高数据量。' },
    { text: '系统组成', details: '多媒体硬件、操作系统/开发工具、媒体数据、应用软件、输入输出设备和通信网络。' },
    { text: '应用', details: '教育培训、影视娱乐、数字出版、远程会议、医疗、工业仿真、游戏、虚拟现实和网络直播。' },
    { text: '关键技术', details: '视音频采集与处理、通信传输、数据压缩、虚拟现实/增强现实。', children: [
      { text: '视音频技术', details: '摄像、采集、编码、编辑、播放、同步和显示。' },
      { text: '通信技术', details: '解决大带宽、低延迟、连续流传输和拥塞控制。' },
      { text: '数据压缩', details: '无损压缩保持全部信息，有损压缩以可接受质量损失换取更高压缩率；音视频常用专用编码标准。' },
      { text: 'VR/AR', details: 'VR 构造沉浸式虚拟环境；AR 将虚拟信息叠加到真实环境；关注三维建模、跟踪定位、渲染、交互和显示。' },
    ] },
  ] },
  { text: '2.8 系统工程', details: '系统工程采用整体、综合、跨学科方法，协调系统全生命周期的需求、架构、实现、验证、运行和退役。', children: [
    { text: '系统工程概述', details: '面向复杂系统，从利益相关者需求出发，进行分解、综合、权衡和验证，追求系统整体最优而非局部最优。' },
    { text: '霍尔三维结构', details: '时间维（规划、设计、研制、生产、安装、运行、更新等阶段）、逻辑维（明确问题、目标、方案、模型、优化、决策）、知识维（工程、管理、数学、经济等专业知识）。' },
    { text: '切克兰德方法', details: '适合软系统和社会问题，强调问题情境、相关系统、概念模型、现实比较、可行变革和行动改进的迭代。' },
    { text: '并行工程', details: '产品及其相关过程并行设计和开发，使各阶段人员早期协同，缩短周期、降低返工并提高可制造性/可维护性。' },
    { text: '综合集成法', details: '以系统整体为对象，综合专家、数据、模型、经验和计算机工具，通过人机结合实现复杂系统分析与决策。' },
    { text: 'WSR 系统方法', details: '物理（Wuli）、事理（Shili）、人理（Renli）结合；同时关注客观规律、业务过程和人的组织行为。' },
    { text: '系统工程生命周期', details: '概念、开发、生产、使用、保障、退役七阶段。', children: [
      { text: '概念阶段', details: '识别利益相关者需求、任务和约束，定义系统边界、可行方案及初始需求。' },
      { text: '开发阶段', details: '完成系统需求、功能分析分配、设计综合、实现、集成和验证确认。' },
      { text: '生产阶段', details: '制造/部署系统；变更需评估其对需求和重新验证的影响。' },
      { text: '使用阶段', details: '在预期环境运行系统交付服务，运行中的升级需评估与现有系统的融合。' },
      { text: '保障阶段', details: '提供持续能力，通过维护、改进、降成本和延寿保持运行。' },
      { text: '退役阶段', details: '退出运行、存储归档或拆除系统；退出需求应在概念阶段规划。' },
    ] },
    { text: '生命周期方法', details: '计划驱动、渐进迭代式、精益开发、敏捷开发。', children: [
      { text: '计划驱动', details: '需求→设计→构建→测试→部署，强调规定流程、文档完整性、需求可追溯和事后验证，适合大型协同项目。' },
      { text: '渐进迭代式开发 IID', details: '先提供初始能力，再连续交付；通过评估和演进响应不确定需求和新技术，适合较小/不太复杂系统。' },
      { text: '精益开发', details: '源自丰田准时化，消除浪费、不一致和不合理需求，以客户价值为中心持续改进。' },
      { text: '系统工程敏捷', details: '尽早持续交付价值、欢迎变化、短周期交付、业务和开发每日协作、面对面沟通、工作软件度量进展、自组织团队、持续反思改进。' },
    ] },
    { text: '基于模型的系统工程 MBSE', details: '从概念设计开始，用形式化、图形化、关联化模型支持需求、分析、设计、验证确认并贯穿全生命周期。', children: [
      { text: '三类图形产物', details: '需求分析：需求图、用例图、包图；功能分析与分配：顺序图、活动图、状态机图；设计综合：模块定义图、内部块图、参数图。' },
      { text: '三大支柱', details: '建模语言、建模工具、建模思路。' },
      { text: 'SysML', details: 'OMG 基于 UML 2.0 子集扩展提出的系统建模语言，用于统一系统工程建模和知识表达。' },
      { text: '建模工具', details: '支持 SysML 绘图、语法关联和模型库，可构造分布式协同环境，并与专业分析工具交换数据迭代优化。' },
      { text: '建模思路', details: '工作流程和方法，如 Harmony-SE、SYSMOD、OOSE 等；组织应结合自身特点试点探索再推广。' },
    ] },
  ] },
  { text: '2.9 系统性能', details: '系统性能是硬件、软件、部件和综合指标的集合，内容包括性能指标、性能计算、性能设计、性能评估。', children: [
    { text: '性能指标', details: '不同对象有不同指标，但应结合响应、吞吐、资源、可靠性和成本进行综合判断。', children: [
      { text: '计算机', details: '主频、运算速度/精度、内存容量、存取周期、PDR、吞吐率、响应时间、利用率、RASIS、兼容性、可扩充性、性能价格比。' },
      { text: '路由器', details: '设备/端口吞吐、线速转发、背靠背帧、路由表、背板、丢包率、时延/抖动、VPN、QoS、冗余、热插拔、协议支持和端口密度。' },
      { text: '交换机', details: '背板吞吐、缓冲、MAC 表、端口/协议/VLAN、三层/多层交换、QoS、冗余、热插拔、链路聚合、负载均衡和网管。' },
      { text: '网络', details: '设备级、网络级、应用级、用户级指标以及吞吐量。' },
      { text: '操作系统', details: '上下文切换、响应时间、吞吐量、资源利用率、可靠性和可移植性。' },
      { text: '数据库', details: '数据库大小、表/记录/索引规模、并发事务、负载均衡和最大连接数。' },
      { text: 'Web 服务器', details: '最大并发连接数、响应延迟和吞吐量。' },
    ] },
    { text: '性能计算', details: '定义法、公式法、程序检测法、仪器检测法；常用 MIPS、峰值速度和 Gibson 等效指令速度，实际常复合加权。' },
    { text: '性能设计与调整', details: '性能下降时寻找并消除瓶颈；调整前识别约束、指定负载、设定目标，循环执行收集→分析→配置→测试。', children: [
      { text: '数据库调整', details: '关注 CPU/内存、数据库设计、数据库管理、进程/线程、磁盘剩余空间和日志文件。' },
      { text: '应用调整', details: '关注可用性、响应时间、并发用户数和应用资源占用。' },
      { text: '阿姆达尔定律', details: '加速比 = 原任务时间 / 改进后时间；总加速比取决于可增强部分在总执行时间中的比例和增强加速比，局部优化受不可增强部分限制。' },
    ] },
    { text: '性能评估', details: '通过度量、建模和实验检测性能，解释结果并形成文档，为优化提供依据。', children: [
      { text: '基准测试程序', details: '准确性通常依次为真实程序、核心程序、小型基准程序、合成基准程序；典型 Dhrystone、Linpack、Whetstone、SPEC、TPC。' },
      { text: 'Web 性能评估', details: '基准性能测试、压力测试、可靠性测试；关注并发连接、延迟和吞吐。' },
      { text: '系统监视', details: '使用系统命令（UNIX/Linux 的 w、ps、last，Windows 的 netstat）、日志文件或集成命令/日志/可视化工具（如 PerfMon）。' },
    ] },
  ] },
];

const s = JSON.parse((await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } })).content[0].text);
const mapIdentifier = s.mapIdentifier;
const anchor = process.env.FREEPLANE_ROOT_NODE_ID || s.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER2_NODE_ID;
if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: { mapIdentifier, userSummary: '创建第二章计算机系统基础知识详细思维导图根节点', anchorPlacement: { anchorNodeIdentifier: anchor, placementMode: 'LAST_CHILD' }, nodes: [{ index: 0, parentIndex: -1, content: c('第2章 计算机系统基础知识', '依据《系统架构设计师教程（第2版）》第 2 章（24-104 页）整理：硬件、软件、嵌入式、网络、语言、多媒体、系统工程与性能。'), foldingState: 'UNFOLD' }] } });
  const lookup = await tool('searchNodes', { request: { mapIdentifier, queryText: '第2章 计算机系统基础知识', matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const p = JSON.parse(lookup.content[0].text); const matches = p.items || p.nodes || p.results || []; chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error(`Cannot locate chapter 2 root: ${lookup.content[0].text}`);
}
let created = 1;
for (const branch of branches) { const nodes = flatten(branch); await tool('createNodes', { request: { mapIdentifier, userSummary: `导入 ${branch.text} 的详细知识节点`, anchorPlacement: { anchorNodeIdentifier: chapterNodeIdentifier, placementMode: 'LAST_CHILD' }, nodes } }); created += nodes.length; }
const verification = await tool('readNodesWithDescendantsAsPlainText', { request: { mapIdentifier, nodeIdentifiers: [chapterNodeIdentifier], fullContentDepth: 4, additionalSummaryDepth: 0, maxCharacters: 6000 } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, createdNodeCount: created, verificationPreview: verification.content[0].text.slice(0, 5000) }, null, 2));
