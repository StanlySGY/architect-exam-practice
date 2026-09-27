const endpoint = process.env.FREEPLANE_MCP_URL || 'http://127.0.0.1:6298/';
const token = process.env.FREEPLANE_MCP_TOKEN;
if (!token) throw new Error('Set FREEPLANE_MCP_TOKEN before running this script.');
let requestId = 1;

async function mcp(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}: ${body}`);
  const payload = JSON.parse(body);
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}
const tool = (name, args) => mcp('tools/call', { name, arguments: args });
const c = (text, details) => details ? { text, details } : { text };
function flatten(branch) {
  const nodes = [];
  function visit(item, parentIndex) {
    const index = nodes.length;
    nodes.push({ index, parentIndex, content: c(item.text, item.details), ...(item.children?.length ? { foldingState: 'UNFOLD' } : {}) });
    for (const child of item.children || []) visit(child, index);
  }
  visit(branch, -1);
  return nodes;
}

const branches = [
  {
    text: '16.1 嵌入式系统概述',
    details: '嵌入式系统是以应用为中心、以计算机技术为基础、软硬件可裁剪、对功能/可靠性/成本/体积/功耗有严格约束的专用计算机系统。',
    children: [
      { text: '16.1.1 发展历程', details: '嵌入式系统随集成电路、处理器、网络和智能化技术演进，软件从汇编控制逐步发展为操作系统、组件化和云边端协同。', children: [
        { text: '阶段1：单片机/SCM', details: '无操作系统，汇编编程；规模小、性能和存储有限，主要完成简单控制，通常没有复杂人机界面。' },
        { text: '阶段2：MCU 与简单操作系统', details: '集成处理器、存储器和外设，增加通信接口；使用嵌入式处理器和轻量 OS，开销小、效率高，但通用性较弱。' },
        { text: '阶段3：SoC', details: '在单芯片上集成多种处理器/控制器及外设，内核小而高效，接口和软件兼容性增强。' },
        { text: '阶段4：网络化嵌入式系统', details: '处理器集成网络接口，设备接入互联网或专用网络，支持远程监控、协同和在线升级。' },
        { text: '阶段5：智能化/云边端', details: '强调低功耗、高速、高集成、高可信和复杂环境适应；终端传感器与智能服务设备协同，形成物联网和智能制造系统。' },
      ] },
      { text: '16.1.2 硬件体系结构', details: '典型结构由嵌入式处理器、存储器、总线、定时/看门狗、I/O 接口及外部设备组成；设计要在性能、成本、功耗、可靠性和环境适应性之间权衡。', children: [
        { text: '嵌入式处理器', details: '处理器是硬件核心，负责指令执行、控制和数据处理。选型需考虑字长、主频、存储容量、功耗、外设、工具链、实时性和供应周期。', children: [
          { text: 'MPU 微处理器', details: '通用性较强，通常需要外接存储器和外设，适合复杂应用和运行完整 OS。' },
          { text: 'MCU 微控制器', details: '将 CPU、存储器、定时器和 I/O 集成在单芯片，成本低、功耗低，适合控制类终端。' },
          { text: 'DSP 数字信号处理器', details: '针对乘加、滤波、FFT 等数字信号处理优化，适合音视频、通信和控制算法。' },
          { text: 'GPU 图形处理器', details: '并行计算能力强，适合图形渲染、图像处理和部分 AI 计算。' },
          { text: 'SoC 片上系统', details: '把 CPU、GPU/DSP、存储控制器、通信和专用加速器集成在芯片上，缩小体积并降低功耗。' },
          { text: '环境适应性', details: '民用通常约 0~70℃，工业约 -40~85℃，军用范围更宽；还需考虑湿度、振动、冲击、加速度和电磁环境。' },
        ] },
        { text: '存储器', details: '存储器保存程序、数据和运行状态；需按易失性、读写方式、容量、速度、寿命、功耗和成本选择。', children: [
          { text: 'RAM 易失性存储器', details: '断电丢失内容，用于运行时程序和数据。SRAM 速度快、无需刷新但成本高；DRAM 密度高、需刷新，常用于较大容量。' },
          { text: 'ROM/非易失性存储器', details: '断电保持程序和固化数据。包括掩膜 ROM、PROM、EPROM、EEPROM、Flash 等；Flash 读写方便、容量大，是常见固件存储介质。' },
          { text: '存储器组织', details: '通常分为代码区、只读常量区、可读写数据区、堆、栈和外部存储；要处理地址空间、对齐、缓存和启动加载。' },
        ] },
        { text: '总线与总线逻辑', details: '总线连接处理器、存储器和外设，传送地址、数据和控制信号；分为片内总线、处理器/存储器总线及外部扩展总线。', children: [
          { text: '片内互联', details: 'SoC 内部常采用片上总线或 NoC，关注带宽、延迟、仲裁和功耗。' },
          { text: '外部总线', details: '连接扩展存储器、通信控制器和外部设备；接口标准决定可扩展性和互操作性。' },
          { text: '总线设计指标', details: '带宽、响应延迟、并发访问、主从关系、仲裁策略、错误检测和电气可靠性。' },
        ] },
        { text: '定时器/计数器', details: '提供系统时钟、周期任务、输入捕获、输出比较、脉宽调制和事件计数，是实时控制和调度的基础。' },
        { text: '看门狗电路', details: '硬件计数器正常计数，程序按期喂狗/复位计数；程序跑飞、死循环或卡死导致溢出，触发中断并在保留关键数据后复位重启，提高系统自恢复能力。' },
        { text: 'I/O 接口', details: '处理器通过 I/O 与被控对象交换信息；接口多数可编程。', children: [
          { text: '常见类型', details: '串行、并行、直接数据传送、中断控制、定时器/计数器、离散量、模数/数模转换接口。' },
          { text: '接口设计关注点', details: '数据格式、速率、时序、电平、缓冲、DMA、中断、错误检测和驱动抽象。' },
        ] },
        { text: '外部设备', details: '包括输入输出设备、外部存储器和调试接口，如键盘、显示器、扫描仪、打印机、移动存储器和 JTAG 调试设备。' },
      ] },
      { text: '16.1.3 嵌入式软件架构概述', details: '早期软件只有监控程序和应用程序两层；采用 RTOS 后形成硬件层、BSP、嵌入式/实时 OS、应用软件的基本分层。', children: [
        { text: '基本分层', details: '硬件层提供处理和外设；BSP 屏蔽板级差异；RTOS 管理任务和资源；应用软件实现领域功能。' },
        { text: '现代架构演进', details: '引入事件驱动、构件化、虚拟化、容器、微服务和云边端协同，但仍需适应专用目标和资源约束。' },
        { text: '架构目标', details: '可靠性、安全性、实时性、可伸缩性、可定制性、可维护性、客户体验和上市时机。' },
        { text: 'SAE AS4893 GOA', details: '通用开放式架构以层次化为主，规定软件、硬件和接口框架，提供直接接口与逻辑消息接口，重点支持开放性、可移植性、互操作性和可裁剪性。' },
      ] },
    ],
  },
  {
    text: '16.2 嵌入式系统软件架构原理与特征',
    details: '嵌入式软件通常具有强实时、资源受限、软硬件紧耦合和长期运行特征；典型基础设施包括 RTOS、嵌入式数据库、中间件和开发环境。',
    children: [
      { text: '16.2.1 两种典型架构模式', details: '大多数嵌入式实时系统可概括为层次化模式和递归模式。', children: [
        { text: '层次化模式', details: '高层抽象依赖低层更具体的实现；通过分层隐藏细节，使用者可关注不同抽象层。', children: [
          { text: '封闭型分层', details: '一层对象只能调用同层或下一底层对象；封装和移植性好，但跨层调用可能增加开销。' },
          { text: '开放型分层', details: '一层对象可调用同层或任意更低层对象；性能较好，但破坏封装，移植性不如封闭型。' },
          { text: '适用场景', details: '存在稳定高层概念且低层概念负责实现时采用；接口和约束是分层结构的关键。' },
        ] },
        { text: '递归模式', details: '用重复的包含关系分解复杂系统，每层都可继续细化；便于把复杂用例逐步求精，并在各层验证可靠性和实时性。', children: [
          { text: '自顶向下', details: '从系统层识别提供协作服务的结构对象，逐步降低抽象；容易保持与用例需求一致。' },
          { text: '自底向上', details: '先识别领域关键类和关系，再组合到子系统抽象；依赖开发者经验和可复用领域知识。' },
        ] },
      ] },
      { text: '16.2.2 嵌入式操作系统 EOS', details: 'EOS 负责嵌入式系统软硬件资源分配、任务调度、控制和并行活动协调，通常包含底层驱动、内核、驱动接口、协议栈和可配置组件。', children: [
        { text: '主要特点', details: '可裁剪、可移植、强实时、代码紧凑、高质量、强定制、标准接口、稳定而弱交互、强确定性、操作简洁、硬件适应性强、可固化。' },
        { text: '分类', details: '面向控制和通信的嵌入式实时 OS，如 VxWorks、Nucleus；面向消费电子的非实时/弱实时 OS，如 Android、iOS、Windows CE。' },
        { text: '一般架构', details: '硬件→ASP/BSP 与设备驱动→内核和可配置库→文件系统、I/O、网络、调试代理→应用 API。', children: [
          { text: 'ASP 与 BSP', details: 'ASP 是与处理器体系结构相关的驱动；BSP 是与处理器外围芯片和具体开发板相关的驱动。' },
          { text: '内核', details: '完成任务管理、内存管理、任务间通信、时钟管理和中断管理。' },
          { text: '可配置库', details: '提供运行时库、设备管理、人机接口、图形图像和 API 扩展，可静态或动态裁剪。' },
          { text: '文件系统', details: '为程序和数据提供存储能力；可按实时性和介质选择不同文件系统。' },
          { text: 'I/O 系统', details: '选择和控制输入输出设备，管理设备与主机之间的数据交换。' },
          { text: '网络系统', details: '提供 TCP/IP、UDP 等通信协议，并支持宿主机开发和设备互联。' },
        ] },
        { text: '内核架构', details: '宏内核把用户服务和内核服务置于同一空间，耦合高、调用快；微内核只保留最小核心，将驱动、文件系统和协议等移到用户态，隔离性和可靠性更好但 IPC 开销较大。' },
        { text: '任务管理', details: '包括任务/线程创建、删除、挂起、唤醒、优先级和调度；实时系统常用抢占式优先级调度，并需处理优先级反转。' },
        { text: '存储管理', details: '管理代码、数据、堆栈和设备空间；资源受限时要关注碎片、确定性、保护和内存泄漏。' },
        { text: '任务间通信', details: '通过共享内存、消息队列、邮箱、信号量、事件标志和管道实现同步与数据交换；共享数据需互斥保护。' },
        { text: '典型系统', details: 'VxWorks、Nucleus、嵌入式 Linux、QNX、FreeRTOS 等；选型要结合实时性、生态、认证、硬件和成本。' },
      ] },
      { text: '16.2.3 嵌入式数据库', details: '面向嵌入式设备的数据管理系统，强调小体积、低资源占用、可裁剪、实时响应、可靠存储和断电恢复。', children: [
        { text: '基本特征', details: '与设备紧密集成；资源占用小；支持本地数据管理、事务/并发控制、故障恢复和安全；可根据应用裁剪。' },
        { text: '按存储组织分类', details: '内存数据库、文件数据库和网络数据库。' },
        { text: '内存数据库', details: '主要数据驻留 RAM，访问速度快、实时性好；断电易失，需日志、镜像或持久化策略保证可靠性。' },
        { text: '文件数据库', details: '以文件保存数据，结构简单、部署轻量，适合单机设备；并发、事务和复杂查询能力受限。' },
        { text: '网络数据库', details: '通过网络访问集中或分布式数据库，适合设备联网和数据汇聚；依赖网络可用性并引入延迟和安全问题。' },
        { text: '一般架构', details: '应用/数据库 API→查询与事务处理→存储管理、索引、日志和恢复→文件/内存/网络介质。' },
        { text: '主要功能', details: '数据定义与查询、事务管理、并发控制、完整性约束、索引、备份恢复、同步复制、权限和加密。' },
        { text: '典型产品', details: 'SQLite、Berkeley DB、嵌入式 MySQL、eXtremeDB 等；考试重点是按应用约束选择而非背诵产品。' },
      ] },
      { text: '16.2.4 嵌入式中间件', details: '位于 OS 与应用之间，为应用提供统一服务，屏蔽底层差异，降低分布式通信、构件复用和系统集成复杂度。', children: [
        { text: '特点', details: '轻量、可裁剪、可移植、标准接口、面向服务/消息、支持实时性和可靠性；需适配资源、网络和安全约束。' },
        { text: '消息中间件', details: '以消息队列、发布/订阅、请求/响应等方式解耦发送者和接收者，支持异步通信、缓冲和多播。' },
        { text: '分布式对象中间件', details: '将远程对象封装为本地可调用接口，负责对象定位、代理、序列化、通信和异常处理。' },
        { text: '一般架构', details: '应用服务→中间件 API/代理→消息、命名、事务、安全和协议适配→网络/设备驱动。' },
        { text: '主要功能', details: '通信与协议转换、命名发现、负载/资源管理、事务、容错、日志、安全、设备抽象和服务编排。' },
        { text: '典型系统', details: 'DDS、CORBA、MQTT、AMQP、ROS/ROS2 等；实时场景重点关注确定性、QoS 和可靠传输。' },
      ] },
      { text: '16.2.5 嵌入式软件开发环境', details: '开发环境由宿主机工具、目标机运行环境和连接调试设施组成，支持编辑、编译、链接、下载、仿真、调试、测试和配置管理。', children: [
        { text: '宿主机与目标机', details: '宿主机运行编译器、IDE 和调试工具；目标机运行被测嵌入式软件；交叉开发通过下载、仿真器或调试探针连接。' },
        { text: '工具链', details: '交叉编译器、汇编器、链接器、库、构建工具、烧录工具、调试器、性能分析器和版本管理工具。' },
        { text: '开发环境分类', details: '基于裸机/监控程序、基于 RTOS、基于嵌入式 Linux/Android，以及面向 IoT 的云端协同环境。' },
        { text: '一般架构', details: '编辑与建模→编译/链接→下载/启动→在线调试→测试与性能分析→发布和升级。' },
        { text: '关键能力', details: '多目标配置、板级支持、断点/单步/观察变量、任务和中断跟踪、代码覆盖率、功耗分析、自动化构建和持续集成。' },
      ] },
    ],
  },
  {
    text: '16.3 嵌入式系统软件架构设计方法',
    details: '设计应从质量属性和实时约束出发，采用架构驱动方法、ADD 和 DARTS 等过程，把需求逐步映射为可验证的并发任务与接口。',
    children: [
      { text: '16.3.1 基于架构的软件设计与开发', details: '先确定影响全局的架构决策，再围绕架构分解、实现和验证；架构是需求、设计、组织和质量保证的共同骨架。', children: [
        { text: '基本步骤', details: '需求分析与质量属性识别→选择架构风格和模式→识别构件及连接件→分配职责和接口→实现/集成→验证质量属性→演化架构。' },
        { text: '嵌入式关注点', details: '实时性、并发、资源上限、功耗、启动时间、故障隔离、硬件适配、可升级和安全认证。' },
        { text: '验证方式', details: '模型检查、时序分析、原型测试、资源预算、故障注入、压力测试、代码审查和目标机实测。' },
      ] },
      { text: '16.3.2 属性驱动设计 ADD', details: 'ADD（Attribute-Driven Design）以质量属性场景和功能需求为输入，逐层分解架构并做出可追踪的设计决策。', children: [
        { text: '质量属性', details: '性能/实时性、可用性、可靠性、安全性、可修改性、可测试性、可移植性、可伸缩性、功耗和成本等。' },
        { text: '质量属性场景', details: '由刺激源、刺激、环境、制品、响应和响应度量组成；把“系统要快/可靠”转为可测量目标。' },
        { text: 'ADD 输入', details: '功能需求、约束、质量属性场景、已有架构/构件和技术环境。' },
        { text: 'ADD 过程', details: '选择待分解系统或构件→识别架构驱动因素→选择满足驱动因素的架构模式/机制→实例化构件并分配职责→定义接口和约束→记录决策→递归分解子构件。' },
        { text: '典型设计机制', details: '并发任务、优先级调度、缓存、复制、检查点、事务、隔离区、认证、消息队列和适配器。' },
        { text: '设计输出', details: '架构视图、构件职责、连接关系、接口协议、质量属性权衡、风险和后续验证计划。' },
      ] },
      { text: '16.3.3 实时系统设计方法 DARTS', details: 'DARTS（Design Approach for Real-Time Systems）通过并发任务结构化设计实时系统，重点解决任务划分、通信和同步。', children: [
        { text: '任务结构化准则', details: '按实时性、并发性、信息隐藏、功能内聚、资源/处理器分配和故障隔离划分任务。' },
        { text: '信息隐藏', details: '每个任务隐藏内部数据和实现，只通过定义的接口和消息交互，降低耦合并便于替换。' },
        { text: '任务架构图', details: '表示任务、设备、共享数据、消息通道、输入输出和同步关系，用于检查并发和通信结构。' },
        { text: 'DARTS 过程1：RTSA 规格', details: '从实时系统分析得到任务、事件、状态、时序、资源和接口约束，形成实时软件体系结构规格。' },
        { text: 'DARTS 过程2：划分并发任务', details: '按事件响应、周期、优先级、信息隐藏和处理资源将功能分配为并发任务，明确任务边界。' },
        { text: 'DARTS 过程3：定义接口', details: '定义任务间消息、共享数据、同步原语、设备接口、时限、数据格式和错误处理。' },
        { text: 'DARTS 过程4：设计各任务', details: '分别设计任务状态、调度、内部算法、数据结构、异常处理和与 RTOS 的映射。' },
        { text: 'DARTS 输出与验证', details: '输出任务架构、接口规格和任务设计；通过时序分析、最坏执行时间、负载测试和故障场景验证实时性与可靠性。' },
      ] },
    ],
  },
  {
    text: '16.4 典型案例分析',
    details: '案例用于把分层、微内核、分布式中间件、构件化、确定性和物联网 OS 等知识映射到实际架构。',
    children: [
      { text: '16.4.1 HarmonyOS 架构', details: '面向多设备协同的分布式操作系统，通过统一架构和分布式能力实现一次开发、多端部署。', children: [
        { text: '四层架构', details: '内核层→系统服务层→框架层→应用层；层间通过稳定接口解耦，应用通过框架和系统服务使用设备能力。' },
        { text: '内核层', details: '提供进程/线程、内存、文件、驱动、网络和安全等基础能力；支持多内核/微内核方向和不同设备资源规模。' },
        { text: '系统服务层', details: '提供分布式软总线、分布式数据管理、分布式任务调度、设备管理、公共基础服务和安全服务。' },
        { text: '框架层', details: '提供组件、能力、UI、媒体、图形、通信、AI 等开发框架，屏蔽设备差异。' },
        { text: '应用层', details: '由系统应用和第三方应用组成；通过统一能力模型实现跨设备协同和弹性部署。' },
        { text: '关键架构特征', details: '分布式架构使多设备像一个超级终端协同；确定性时延引擎保障关键任务；高性能 IPC 降低进程间通信开销；微内核提升可信安全；统一 IDE 支持一次开发、多设备部署。' },
        { text: '考试抓手', details: '记住“分布式能力、统一框架、跨设备协同、微内核安全、确定性与高性能 IPC”之间的对应关系。' },
      ] },
      { text: '16.4.2 GENESYS 跨领域安全关键架构', details: 'GENESYS 由欧洲 ARTEMIS 专家组于 2008~2009 年提出，采用面向构件、消息驱动和腰型服务架构，面向跨领域安全关键嵌入式系统。', children: [
        { text: '解决三类挑战', details: '复杂性管理：提升抽象、消息交换、抽象/分区/分段；系统健壮性：故障隔离、选择性重启、复制和全层安全；能量有效：软件迁移 ASIC、功率门控和时间触发通信。' },
        { text: '腰型服务', details: '基础平台提供最小核心服务和可选服务；服务分为领域无关、领域专用和应用专用三组。', children: [
          { text: '核心服务', details: '强制且最小、简单、确定、可认证，如全局时间和消息传输。' },
          { text: '选择服务', details: '在核心服务之上按需扩展，如安全、外部存储管理器和 Internet 网关。' },
          { text: '领域专用服务', details: '由领域特有的服务组合而成，如汽车领域的 CAN 总线服务。' },
          { text: '应用专用服务', details: '包含面向具体应用的服务和中间件。' },
        ] },
        { text: '构件化与计算/通信分离', details: '构件自包含、可替换、可多次实例化；计算构件与通信设施独立设计，基本交互采用多播单向消息，便于独立分析和容错。' },
        { text: '四类构件', details: '硬件构件、软件构件、系统构件、应用构件；硬件功能固定且非功能性能好，软件可演化，系统构件提供可复用架构服务，应用构件实现领域功能。' },
        { text: '四类消息接口', details: 'LIF 链接接口：构件间消息综合接口；LI 局部接口：构件与外部环境/I/O；TII 技术无关接口：配置和资源管理；TDI 技术相关接口：内部观察和诊断。' },
        { text: '主要优势', details: '精确构件定位、跨领域重用、开放集成、可升级扩展、遗产系统集成、芯片/设备/系统三级集成、分层服务、确定性核心和标准互联。' },
        { text: '确定性核心的价值', details: '保证及时性，降低非确定行为复杂度，便于测试和安全认证，并支持故障掩蔽。' },
      ] },
      { text: '16.4.3 物联网操作系统与 FreeRTOS', details: '物联网是泛化的嵌入式系统，关键分层为感知层、网络传输层和应用层；IoT OS 覆盖芯片、终端、边缘和云端，解耦应用与硬件。', children: [
        { text: '物联网三层', details: '感知层采集和识别对象；网络传输层完成连接、路由和协议传输；应用层提供监测、控制、分析、管理和服务。' },
        { text: 'IoT OS 覆盖范围', details: '不仅是终端内核，还可涉及芯片层、终端层、边缘层和云端层；核心作用是统一资源和设备抽象。' },
        { text: 'FreeRTOS 定位', details: '开源、轻量、广泛使用的实时物联网操作系统，由 Amazon 托管；内核和组件可裁剪，核心代码约 9000 行。' },
        { text: 'FreeRTOS 分层', details: '硬件→供应商驱动/BSP→FreeRTOS 内核与内部库→公共组件→定制服务→物联网应用。', children: [
          { text: '内核', details: '多任务调度、内存管理、任务间通信等传统 RTOS 基础功能，并向组件提供标准接口。' },
          { text: '公共组件', details: 'TCP、TLS、POSIX、Wi-Fi、BLE 等网络、外设和兼容能力。' },
          { text: '定制服务', details: 'OTA 在线升级、PKCS#11、Secure Sockets、MQTT、HTTPS、设备发现、设备影子和安全防护等。' },
          { text: '应用', details: '在上述抽象和服务上实现具体设备控制、采集、边缘协同和云端业务。' },
        ] },
        { text: 'IoT OS 主要特征', details: '内核尺寸可伸缩、整体架构可扩展、强实时、高可靠、低功耗；还需关注远程运维、安全、网络互操作和大规模设备管理。' },
        { text: '低功耗策略', details: '通过休眠/唤醒、降频、功率门控、低功耗通信和任务调度延长电池寿命。' },
        { text: '高可靠策略', details: '看门狗、自恢复、远程升级回滚、故障隔离、日志诊断和海量节点的少维护设计。' },
      ] },
    ],
  },
];

const selectionResult = await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } });
const selection = JSON.parse(selectionResult.content[0].text);
const mapIdentifier = selection.mapIdentifier;
const anchorNodeIdentifier = process.env.FREEPLANE_ROOT_NODE_ID || selection.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER16_NODE_ID;

if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: {
    mapIdentifier,
    userSummary: '创建《系统架构设计师教程（第2版）》第16章详细思维导图根节点',
    anchorPlacement: { anchorNodeIdentifier, placementMode: 'LAST_CHILD' },
    nodes: [{ index: 0, parentIndex: -1, content: c('第16章 嵌入式系统架构设计理论与实践', '依据《系统架构设计师教程（第2版）》第16章整理：嵌入式系统硬件、软件架构、EOS/数据库/中间件、ADD/DARTS 设计方法及 HarmonyOS、GENESYS、FreeRTOS 案例。'), foldingState: 'UNFOLD' }],
  } });
  const lookup = await tool('searchNodes', { request: { mapIdentifier, queryText: '第16章 嵌入式系统架构设计理论与实践', matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const payload = JSON.parse(lookup.content[0].text);
  const matches = payload.items || payload.nodes || payload.results || [];
  chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error(`Cannot locate chapter 16 root: ${lookup.content[0].text}`);
}

let created = 1;
for (const branch of branches) {
  const nodes = flatten(branch);
  await tool('createNodes', { request: {
    mapIdentifier,
    userSummary: `导入 ${branch.text} 的详细知识节点`,
    anchorPlacement: { anchorNodeIdentifier: chapterNodeIdentifier, placementMode: 'LAST_CHILD' },
    nodes,
  } });
  created += nodes.length;
}

const verification = await tool('readNodesWithDescendantsAsPlainText', { request: { mapIdentifier, nodeIdentifiers: [chapterNodeIdentifier], fullContentDepth: 6, additionalSummaryDepth: 0, maxCharacters: 160000 } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, createdNodeCount: created, verification: verification.content[0].text }, null, 2));
