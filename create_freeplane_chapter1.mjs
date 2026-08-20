const endpoint = process.env.FREEPLANE_MCP_URL || 'http://127.0.0.1:6298/';
const token = process.env.FREEPLANE_MCP_TOKEN;
if (!token) throw new Error('Set FREEPLANE_MCP_TOKEN before running this script.');
let requestId = 1;
async function mcp(method, params) {
  const r = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }) });
  const body = await r.text();
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}: ${body}`);
  const p = JSON.parse(body); if (p.error) throw new Error(`${method}: ${JSON.stringify(p.error)}`); return p.result;
}
const tool = (name, args) => mcp('tools/call', { name, arguments: args });
const c = (text, details) => details ? { text, details } : { text };
function flatten(branch) { const nodes = []; function visit(item, parentIndex) { const index = nodes.length; nodes.push({ index, parentIndex, content: c(item.text, item.details), ...(item.children?.length ? { foldingState: 'UNFOLD' } : {}) }); for (const child of item.children || []) visit(child, index); } visit(branch, -1); return nodes; }

const branches = [
  { text: '1.1 系统架构概述', details: '系统架构是系统整体的高层次结构、骨架和根基，连接需求、设计、实现与演化，影响可靠性、安全性、可移植性、可扩展性、可用性和可维护性。', children: [
    { text: '冯·诺伊曼结构基础', details: 'EDVAC 思想把计算机组织为运算器、控制器、存储器、输入和输出五部分；采用二进制和存储程序，使指令可自动连续执行。' },
    { text: '架构定义（IEEE 1471-2000）', details: '架构是体现在组件中的系统基本组织、组件彼此关系、组件与环境关系以及指导设计和发展的原则。', children: [
      { text: '系统', details: '为完成特定功能或一组功能而组织的组件集合，可指应用、系统、子系统、系统之系统、产品线或企业。' },
      { text: '环境/上下文', details: '决定系统的开发、运作、政策及受到的其他影响。' },
      { text: '任务', details: '一个或多个利益相关者通过系统达到的目标、用途或操作。' },
      { text: '架构要素', details: '组件、连接件、约束规范，以及指导这些内容设计和演化的原理。' },
    ] },
    { text: '架构设计的作用', details: '需求分析后的关键步骤、系统设计前的必要工作，也是系统早期质量保证的关键。', children: [
      { text: '复杂需求抽象', details: '把复杂业务和技术需求转化为可理解、可验证的高层结构。' },
      { text: '非功能属性设计', details: '处理性能、安全、可靠性、可用性、可维护性、可扩展性等跨模块质量目标。' },
      { text: '长期与扩展结构', details: '支撑长生命周期、演化和未来扩展，降低后期改造成本。' },
      { text: '组件集成与复用', details: '解决组件之间的接口、连接、约束和系统集成问题。' },
      { text: '业务流程再造', details: '通过架构抽象和技术整合支撑业务流程优化。' },
    ] },
    { text: '软件架构发展历程', details: '从软件危机和模块化实践逐步发展为有理论、模型、工具和方法支撑的学科。', children: [
      { text: '基础研究阶段（1968-1994）', details: 'NATO 软件工程会议后关注软件结构描述；模块化方法形成并积累高层结构经验。', children: [
        { text: '模块化规则', details: '高内聚、低耦合；模块大小适度；调用链不过深；接口简单精炼并具信息隐藏；尽量复用已有模块。' },
        { text: '模块化与 SOA', details: '抽象、封装、分解、层次化提升资产复用；SOA 以标准服务组件快速组装业务，拉近 IT 与业务。' },
      ] },
      { text: '概念体系与核心技术形成阶段（1995-2000）', details: 'Perry/Wolf、Shaw/Garlan 等研究推动架构定义；IEEE 1471-2000 发布，组件化和架构表示技术成熟。', children: [
        { text: '组件化与模块化区别', details: '模块化主要是逻辑切分，物理代码未必隔离；组件具有更强独立性、可组装/可插拔；应用集成则把异构应用整合为统一系统。' },
      ] },
      { text: '理论体系完善与发展阶段（1996 至今）', details: '重点包括架构描述与表示、分析设计测试、发现演化复用、基于架构开发、架构风格和动态架构。', children: [
        { text: '架构分析', details: '结构分析、功能分析和非功能分析；目标是在构造前预测质量属性。常见 SAAM、ATAM、CBAM、SBAR、ALPSM、SAEM。' },
        { text: '架构设计', details: '工件驱动、领域驱动、用例驱动、架构复用等方法生成满足需求的架构。' },
        { text: '架构测试与演化', details: '通过单元、子系统、集成、验收等层次验证架构；研究重构、动态配置和演化。' },
      ] },
      { text: '普及应用阶段（2000 至今）', details: '架构进入工程实践，影响需求、设计、实现和维护各阶段，并与组件、SOA、云、微服务、数据驱动和智能架构融合。' },
    ] },
    { text: '典型架构分类', details: '常见分层、事件驱动、微核、微服务和云架构；另有 C/S、B/S、管道-过滤器、PAC、MVC、SOA、C2 等。', children: [
      { text: '分层架构', details: '水平分层、职责清晰、通过接口通信；常见表现层、业务层、持久层、数据库层，用户请求依次经过各层。', children: [
        { text: '表现层', details: '用户界面、视觉呈现和交互。' },
        { text: '业务层', details: '实现业务逻辑。' },
        { text: '持久层', details: '提供数据访问，SQL 通常位于此层。' },
        { text: '数据库层', details: '保存数据；有时逻辑层与持久层之间增加服务层提供通用接口。' },
      ] },
      { text: '事件驱动架构', details: '组件通过状态变化产生的事件通信，适合异步、解耦和可扩展处理。', children: [
        { text: '事件队列', details: '接收事件的入口。' },
        { text: '分发器', details: '把不同事件分发给对应业务逻辑单元。' },
        { text: '事件通道', details: '连接分发器与事件处理器。' },
        { text: '事件处理器', details: '执行业务逻辑，完成后可发出新事件触发后续操作。' },
      ] },
      { text: '微核/插件架构', details: '内核只保留系统运行的最小功能，主要业务由相互独立的插件实现；插件之间通信应尽量少，避免互相依赖。' },
      { text: '微服务架构', details: 'SOA 的升级；每个服务是独立部署单元，分布式、解耦，通过 REST、SOAP 等远程协议通信。', children: [
        { text: 'RESTful API 模式', details: '服务通过 API 提供，云服务常属于此类。' },
        { text: 'RESTful 应用模式', details: '通过传统网络/应用协议提供服务，背后常是多功能应用，适合企业内部。' },
        { text: '集中消息模式', details: '消息代理提供队列、负载均衡、统一日志和异常处理；消息代理需集群化避免单点失败。' },
      ] },
      { text: '云架构', details: '通过内存数据单元和可伸缩处理单元解决扩展性、并发和中央数据库瓶颈；必须考虑数据持久化。', children: [
        { text: '处理单元', details: '封装并执行业务逻辑，访问量增加时扩容，减少时缩容。' },
        { text: '虚拟中间件', details: '负责通信、会话、数据复制、分布式处理和处理单元部署。' },
        { text: '消息中间件', details: '管理请求与会话，选择请求应分配的处理单元。' },
        { text: '数据中间件', details: '把数据复制到各处理单元并保持同步。' },
        { text: '处理中间件', details: '可选；协调不同类型处理单元协同完成请求。' },
        { text: '部署中间件', details: '启动/关闭处理单元，监控负载和响应时间，按负载自动伸缩。' },
      ] },
    ] },
    { text: '架构建模方法', details: '结构、框架、动态、过程四种模型互补；完整架构应组合使用。', children: [
      { text: '结构模型', details: '用组件、连接件、配置、约束、风格和性质刻画静态结构，核心研究架构描述语言。' },
      { text: '框架模型', details: '不关注结构细节而关注整体结构，面向特定问题建立适用框架。' },
      { text: '动态模型', details: '研究系统大颗粒行为、重配置、通信/计算建立与拆除、演化过程。' },
      { text: '过程模型', details: '研究构造系统的步骤和过程，结构是过程脚本执行的结果。' },
      { text: 'Kruchten 4+1 视图', details: '逻辑、过程、物理、开发、场景五个视角；每个视角关注一个侧面，组合后完整描述架构。' },
    ] },
    { text: '应用场景与发展未来', details: '架构风格应按问题和质量目标选择，现代大型系统通常混合多种风格。', children: [
      { text: '风格与场景', details: '管道-过滤器适合独立处理步骤；虚拟机适合解释器/专家系统；C/S、B/S 适合网络分布；插件适合可扩展应用；MVC 适合交互程序；SOA 适合企业集成；C2 适合灵活 GUI。' },
      { text: '技术演进主线', details: '模块化/面向对象编程→组件技术→面向服务开发→云技术，并融合微服务、容器、DevOps、数据驱动和智能架构。' },
      { text: '架构师关注点', details: '架构描述、建模、分析、验证和演化重用会持续影响软件开发方法与领域工程。' },
    ] },
  ] },
  { text: '1.2 系统架构设计师概述', details: '架构设计师是系统开发主体和技术领导，负责理解需求、确认非功能目标、制定规范、设计核心架构并澄清关键技术。', children: [
    { text: '架构师类型', details: '按组织/关注领域可分业务架构师、主题领域架构师、技术架构师、项目架构师、系统架构师；微软分类还包括企业架构师 EA、基础结构架构师 IA、特定技术架构师 TSA、解决方案架构师 SA。' },
    { text: '定义与成果', details: '架构师可以是人、团队或组织；是系统/产品线设计责任人，最终创建架构，连接用户需求与后续设计实现。', children: [
      { text: '负责的非功能需求', details: '可维护性、性能、复用性、可靠性、有效性、可测试性等。' },
      { text: '核心产出', details: '开发规范、总体架构、关键组件和接口设计、需求/设计/实现/部署视图、关键技术决策。' },
    ] },
    { text: '职责', details: '既是技术领导又是团队导师；拥有技术决策权，掌握平台/语言/工具，关注交付结果，确保决策被传达、理解和执行。' },
    { text: '主要任务', details: '领导和协调分析、设计、实施；推动技术决策并表达为系统架构；确定架构并推动文档化。', children: [
      { text: '三类技术职责', details: '抽象设计、非功能设计、关键技术设计。' },
      { text: '团队履职', details: '架构师角色可由团队承担；应设置首席架构师作为协调人，并通过可信顾问弥补个人知识弱点。' },
    ] },
    { text: '专业素质', details: '业务和技术平衡，既关注关键技术因素又不陷入 API 细节。', children: [
      { text: '业务领域知识', details: '理解领域概念、术语和流程，才能做正确抽象并预见变化。' },
      { text: '技术知识', details: '掌握平台、框架和技术趋势，能够评估方案而不必精通每个 API。' },
      { text: '设计技能', details: '识别关键结构、模型和规格决策，依靠多年实践形成判断。' },
      { text: '编程技能', details: '理解代码实现约束，参与一定编码并用第一手结果校验架构决策。' },
      { text: '沟通能力', details: '口头、书面、图表表达，连接利益相关者与开发团队，形成共同技术愿景。' },
      { text: '决策能力', details: '在信息不完备、时间有限时做出选择，必要时咨询他人并纠正错误决策。' },
      { text: '组织策略', details: '理解组织权力和政治环境，争取适当支持。' },
      { text: '谈判能力', details: '通过需求精炼和方案权衡降低风险，清晰说明折中后果。' },
    ] },
    { text: '知识结构十方面', details: '战略规划、业务流程建模、信息数据架构、技术架构设计实现、应用架构、基础 IT/基础设施资源、信息安全、IT 审计治理与需求、可靠性和生命周期质量、新技术与新概念分析。' },
  ] },
  { text: '1.3 如何成为好的系统架构设计师', details: '优秀架构师需要在领导、开发、系统整体、商业、战略战术权衡和沟通六方面全面发展。', children: [
    { text: '六种角色特质', details: '技术领导者、开发人员、系统综合者、企业家、战略技术专家、沟通专家。' },
    { text: '技术领导者', details: '像导师一样带团队共享技术愿景，通过讲故事、影响力、冲突引导和信任建设推动架构落地。' },
    { text: '作为开发人员', details: '了解代码、构建方式和现实约束，避免脱离问题域的“象牙塔式”技术选型。' },
    { text: '聚焦系统', details: '除代码外关注部署、自动化测试、性能、安全、可支持性及支持/安全/运营等利益相关者。' },
    { text: '企业家思维', details: '从成本、收益、隐性成本、支持情况、长期约束和风险评估技术选型，先调研再承诺。' },
    { text: '战略与战术权衡', details: '在团队敏捷性和组织一致性之间平衡，持续观察技术趋势但不盲目采用。' },
    { text: '沟通与记录', details: '使用听众熟悉的业务语言、图表、讨论、架构决策日志或 Wiki，保持技术愿景和决策可追溯。' },
    { text: '成长演化路径', details: '工程师→高级工程师→技术专家→初级架构师→中级架构师→高级架构师。', children: [
      { text: '工程师', details: '1-3 年，在指导下完成编码；积累语言、数据结构、环境、操作系统、数据库和流程基础。' },
      { text: '高级工程师', details: '3-5 年，独立完成需求、设计和编码；从知道 How 发展到理解 Why，积累理论和方案经验。' },
      { text: '技术专家', details: '4-8 年，成为领域专家，拓展技术宽度并能修改、扩展、优化架构。' },
      { text: '初级架构师', details: '5-8 年，能独立设计中小复杂系统或重构架构；关键是形成架构设计方法论。' },
      { text: '中级架构师', details: '8-10 年以上，解决高性能、高可用、可扩展、海量存储等复杂系统；关键是技术深度和理论。' },
      { text: '高级架构师', details: '10 年以上，创造新的架构模式和技术潮流；核心差异是创造性。' },
    ] },
    { text: '成长关键能力', details: '判断力：识别复杂度和脆弱点；执行力：用合适方案解决复杂度；创新力：创造新方案；持续积累经验、拓宽视野、深度思考。' },
  ] },
];

const s = JSON.parse((await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } })).content[0].text);
const mapIdentifier = s.mapIdentifier;
const anchor = process.env.FREEPLANE_ROOT_NODE_ID || s.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER1_NODE_ID;
if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: { mapIdentifier, userSummary: '创建第一章绪论详细思维导图根节点', anchorPlacement: { anchorNodeIdentifier: anchor, placementMode: 'LAST_CHILD' }, nodes: [{ index: 0, parentIndex: -1, content: c('第1章 绪论', '依据《系统架构设计师教程（第2版）》第 1 章（3-23 页）整理：系统架构、架构师职责素质与成长路径。'), foldingState: 'UNFOLD' }] } });
  const lookup = await tool('searchNodes', { request: { mapIdentifier, queryText: '第1章 绪论', matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const p = JSON.parse(lookup.content[0].text); const matches = p.items || p.nodes || p.results || []; chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error(`Cannot locate chapter 1 root: ${lookup.content[0].text}`);
}
let created = 1;
for (const branch of branches) { const nodes = flatten(branch); await tool('createNodes', { request: { mapIdentifier, userSummary: `导入 ${branch.text} 的详细知识节点`, anchorPlacement: { anchorNodeIdentifier: chapterNodeIdentifier, placementMode: 'LAST_CHILD' }, nodes } }); created += nodes.length; }
const verification = await tool('readNodesWithDescendantsAsPlainText', { request: { mapIdentifier, nodeIdentifiers: [chapterNodeIdentifier], fullContentDepth: 5, additionalSummaryDepth: 0, maxCharacters: 100000 } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, createdNodeCount: created, verification: verification.content[0].text }, null, 2));
