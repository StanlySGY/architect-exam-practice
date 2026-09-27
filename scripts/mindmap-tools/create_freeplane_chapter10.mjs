const endpoint = process.env.FREEPLANE_MCP_URL || 'http://127.0.0.1:6298/';
const token = process.env.FREEPLANE_MCP_TOKEN;
if (!token) throw new Error('Set FREEPLANE_MCP_TOKEN before running this script.');
let requestId = 1;
async function mcp(method, params) {
  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${method}: ${response.status} ${body}`);
  const payload = JSON.parse(body);
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}
const tool = (name, args) => mcp('tools/call', { name, arguments: args });
const c = (text, details) => details ? { text, details } : { text };
function flatten(branch) { const nodes=[]; function visit(item,parentIndex){const index=nodes.length;nodes.push({index,parentIndex,content:c(item.text,item.details),...(item.children?.length?{foldingState:'UNFOLD'}:{})});for(const child of item.children||[])visit(child,index);} visit(branch,-1); return nodes; }

const chapter10 = {
  text: '第10章 软件架构的演化和维护',
  details: '依据教材第10章（330-365页）整理：架构演化概念、面向对象演化操作、静态/动态演化、演化原则与评估、大型网站演进及架构维护。',
  children: [
    { text: '10.1 软件架构演化和定义的关系', details: '架构演化是为适应需求、业务、技术和运行环境变化，对软件整体结构进行持续修改和完善。', children: [
      { text: '10.1.1 演化的重要性', details: '软件架构不是一次设计后永久不变，而是在全生命周期中逐步形成和完善。', children: [
        { text: '维持系统有用性', details: '通过纠错、适应、完善和预防性修改，使系统持续满足用户和环境要求。' },
        { text: '保障质量属性', details: '架构演化直接影响性能、可靠性、安全性、可维护性和市场竞争力。' },
        { text: '控制复杂性与变化', details: '在架构层观察和控制变更的影响范围，比直接修改实现更容易发现系统级风险。' },
        { text: '降低演化成本', details: '形式化/可视化架构、整体结构与约束信息、构件耦合描述有助于分析和实施变化。' },
        { text: '贯穿生命周期', details: '覆盖架构需求、建模、文档、实现、部署和维护，形成持续反馈闭环。' },
      ] },
      { text: '10.1.2 演化和架构定义', details: '采用何种架构定义，就决定演化关注哪些架构元素。', children: [
        { text: '经典定义', details: 'SA={Components, Connectors, Constraints}，即构件、连接件和约束。' },
        { text: '构件演化', details: '增加、删除或修改计算、数据存储和重要模块；通常会引起交互消息变化。' },
        { text: '连接件演化', details: '增加、删除或改变构件间调用、消息、协议和交互流程。' },
        { text: '约束演化', details: '改变拓扑、配置、参数、安全规则、时序条件和架构不变量。' },
        { text: '波及效应', details: '区分直接受变更影响元素、间接受波及元素和不受影响元素，是影响分析的核心。' },
      ] },
    ] },
    { text: '10.2 面向对象软件架构演化过程', details: '以 UML 顺序图描述对象、消息、复合片段和约束的原子演化操作，并分析对行为正确性与时态属性的影响。', children: [
      { text: '10.2.1 对象演化', details: '对象是顺序图中的构件实体，影响动态行为的主要操作是增加和删除。', children: [
        { text: 'AO AddObject', details: '添加对象以实现新功能，或把现有职责拆出以提高灵活性和独立性。' },
        { text: 'DO DeleteObject', details: '删除对象以移除功能，或合并职责以降低架构复杂度。' },
        { text: '对象与消息联动', details: '没有任何交互的新对象对动态行为没有意义；对象演化通常伴随消息增加、删除或重定向。' },
      ] },
      { text: '10.2.2 消息演化', details: '消息是顺序图核心，源对象、目标对象和时序变化会直接改变构件交互。', children: [
        { text: 'AM AddMessage', details: '增加消息，表示对象之间增加新的交互行为。' },
        { text: 'DM DeleteMessage', details: '删除现有消息，移除交互行为，是 AM 的逆操作。' },
        { text: 'SMO SwapMessageOrder', details: '交换消息时间顺序，改变交互行为的先后依赖。' },
        { text: 'OM OverturnMessage', details: '反转消息发送者和接收者，改变交互方向。' },
        { text: 'CMM ChangeMessageModule', details: '改变消息发送或接收对象，把职责转移到其他构件。' },
        { text: '与约束关系', details: '演化可分为与约束无关、关联但不违背、关联且违背三类；第三类是错误演化。' },
        { text: '核心地位', details: '对象演化依赖消息；复合片段和约束也基于消息，因此消息演化是行为演化分析重点。' },
      ] },
      { text: '10.2.3 复合片段演化', details: '复合片段描述交互控制流，常见 ref、loop、break、alt、opt、par。', children: [
        { text: 'AF AddFragment', details: '在消息序列上增加复合片段，引入引用、循环、分支、可选或并行控制流。' },
        { text: 'DF DeleteFragment', details: '移除复合片段和对应控制流，是 AF 的逆操作。' },
        { text: 'FTC FragmentTypeChange', details: '改变片段类型，通常同时改变条件和内部消息序列，可视为删除后重新添加。' },
        { text: 'FCC FragmentConditionChange', details: '改变片段执行条件，同时修改条件成立和不成立的转移。' },
        { text: '验证重点', details: '片段变化可能改变消息可达性、顺序、并发和约束满足情况，需重新验证正确性与时态属性。' },
      ] },
      { text: '10.2.4 约束演化', details: '约束规定对象和消息必须满足的行为规则，改变约束会改变合法执行集合。', children: [
        { text: '增加约束', details: '缩小允许行为范围，可能使原本合法的交互变为不合法。' },
        { text: '删除约束', details: '扩大允许行为范围，但可能失去安全、时序或业务保证。' },
        { text: '修改约束', details: '改变约束对象、条件或范围，需要分析关联消息、片段和其他约束。' },
        { text: '一致性检查', details: '检查约束之间是否冲突、是否仍可满足，以及演化后的行为模型是否符合架构目标。' },
      ] },
    ] },
    { text: '10.3 软件架构演化方式的分类', details: '架构演化可按实现方式、研究方法和系统是否运行分类，考试重点是静态演化与动态演化。', children: [
      { text: '分类维度', details: '可按过程/函数、面向对象、构件、架构描述语言等实现粒度分类；也可按形式化、工程实践等研究方式分类。' },
      { text: '10.3.1 软件架构演化时期', details: '根据变化发生时系统所处状态分为四个时期。', children: [
        { text: '设计时演化', details: '实现前修改架构模型，成本较低、验证条件较好。' },
        { text: '运行前演化', details: '系统已实现但尚未运行，通过重新构建、配置和部署完成变化。' },
        { text: '有限制运行时演化', details: '系统运行中局部暂停或进入静止区，再替换部分构件和配置。' },
        { text: '运行时演化', details: '系统持续服务时动态调整构件、连接和配置，对一致性、状态迁移和安全要求最高。' },
      ] },
      { text: '10.3.2 软件架构静态演化', details: '系统停止运行后修改架构、实现和部署，再重新启动。', children: [
        { text: '静态演化需求', details: '缺陷修复、功能增删、平台迁移、性能优化、接口变化和技术替换。' },
        { text: '一般过程', details: '变更请求→影响分析→演化计划→架构修改→实现与测试→部署→评价和归档。' },
        { text: '原子操作', details: '构件、连接件和约束的增加、删除、替换、拆分、合并和参数修改。' },
        { text: '优点', details: '实施和验证相对简单，可统一迁移状态和依赖。' },
        { text: '局限', details: '需要停机和重新部署，不适合高可用、连续服务系统。' },
      ] },
      { text: '10.3.3 软件架构动态演化', details: '系统运行期间改变架构配置或构件，同时尽量保持服务连续。', children: [
        { text: '动态演化需求', details: '7×24 服务、负载变化、故障恢复、在线升级、移动环境、自适应与个性化。' },
        { text: '动态演化类型', details: '预定义演化按预设规则执行；非预定义演化运行时产生新配置；可分参数调整、构件替换和拓扑重配置。' },
        { text: '动态软件架构', details: '能感知环境和自身状态，根据策略在运行时规划并执行结构变化。', children: [
          { text: '反馈环', details: '监控 Monitor→分析 Analyze→计划 Plan→执行 Execute，共享知识 Knowledge（MAPE-K）。' },
          { text: '关键能力', details: '状态捕获与迁移、依赖管理、事务式重配置、回滚、正确性验证和运行监控。' },
        ] },
        { text: 'PKUAS 案例', details: '动态构件运行平台，包含容器系统、构件库/运行服务、管理工具和微内核。', children: [
          { text: '容器系统', details: '提供构件运行空间，负责类装载、实例化、销毁和生命周期管理。' },
          { text: '系统组件', details: '提供运行时基础服务和可扩展能力。' },
          { text: '工具', details: '部署、配置和监控工具帮助用户管理动态系统。' },
          { text: '微内核', details: '负责系统组件装载、配置、卸载和协同，是动态演化控制核心。' },
        ] },
        { text: '动态重配置', details: '运行时添加、删除、替换构件或修改连接，需先建立静止区，确保相关事务和调用达到可安全变更状态。' },
        { text: '主要风险', details: '状态丢失、调用中断、版本不兼容、临时不一致、回滚失败和不可预测性能。' },
      ] },
    ] },
    { text: '10.4 软件架构演化原则', details: '演化必须在成本、进度、风险、结构、质量和适应性之间保持控制。', children: [
      { text: '1 演化成本控制', details: '变更收益应覆盖设计、实现、测试、迁移和维护成本。' },
      { text: '2 进度可控', details: '明确阶段、依赖、里程碑和回退条件，避免演化无限延期。' },
      { text: '3 风险可控', details: '识别技术、数据、兼容、性能和业务连续性风险，并准备缓解措施。' },
      { text: '4 主体维持', details: '保持系统核心职责和身份，不因局部变化失去主要功能。' },
      { text: '5 总体结构优化', details: '演化不仅解决局部问题，还应改善整体结构、依赖和质量。' },
      { text: '6 平滑演化', details: '减少停机和用户冲击，支持兼容、灰度、迁移和回滚。' },
      { text: '7 目标一致', details: '演化方案必须与业务目标、质量目标和架构愿景一致。' },
      { text: '8 模块独立演化', details: '通过高内聚低耦合和稳定接口，使模块可单独修改、替换和部署。' },
      { text: '9 影响可控', details: '用依赖和追踪关系限制变更传播，明确直接与间接影响。' },
      { text: '10 复杂性可控', details: '避免为短期变化持续叠加特殊逻辑、分支和隐式依赖。' },
      { text: '11 有利于重构', details: '演化应为后续结构改善保留空间，并及时偿还技术债务。' },
      { text: '12 有利于重用', details: '抽取稳定共性，形成可复用构件、服务、模式和知识。' },
      { text: '13 遵从设计原则', details: '保持分层、封装、职责分离、接口隔离等既定原则。' },
      { text: '14 适应新技术', details: '合理采用成熟新技术，避免盲目追新或技术锁定。' },
      { text: '15 环境适应性', details: '适应硬件、操作系统、网络、法规、组织和部署环境变化。' },
      { text: '16 标准依从性', details: '遵守行业、接口、安全、数据和组织标准，提高互操作和合规性。' },
      { text: '17 质量向好', details: '演化后关键质量属性总体不应恶化，必要权衡必须显式接受。' },
      { text: '18 适应新需求', details: '支持新业务需求，同时避免破坏已有正确功能和服务承诺。' },
    ] },
    { text: '10.5 软件架构演化评估方法', details: '评估演化是否达到目标、是否引入不可接受风险，并量化不同版本的结构和质量差异。', children: [
      { text: '10.5.1 演化过程已知的评估', details: '拥有演化步骤和中间版本时，可逐步度量变化轨迹。', children: [
        { text: '评估流程', details: '确定目标与属性→收集中间版本→度量各版本→计算质量距离→分析趋势和异常→形成结论。' },
        { text: '中间版本度量', details: '对构件、连接、耦合、内聚、复杂度、性能、可靠性等指标逐版本计算。' },
        { text: '质量属性距离', details: '比较当前版本与目标/基准版本在多项质量属性上的差异。' },
        { text: '综合评估', details: '结合演化成本、风险和质量趋势判断路径是否合理，是否需要调整或回退。' },
      ] },
      { text: '10.5.2 演化过程未知的评估', details: '只有演化前后版本时，通过结构匹配和差异分析推断变化及其影响。', children: [
        { text: '版本差异', details: '识别构件、连接件、接口、配置和约束的增删改。' },
        { text: '影响推断', details: '根据依赖图、可达矩阵、语义和质量模型推断直接与间接波及。' },
        { text: '评价限制', details: '缺少过程信息会丢失设计理由和中间风险，结论可信度依赖文档和版本数据质量。' },
      ] },
    ] },
    { text: '10.6 大型网站系统架构演化实例', details: '网站架构随访问量、数据量和业务复杂度逐步演进；每一步解决当前主要瓶颈，也引入新的复杂度。', children: [
      { text: '阶段1：单体架构', details: '应用、文件和数据库部署在一台服务器；简单低成本，但容量、可靠性和扩展性有限。' },
      { text: '阶段2：垂直架构', details: '应用、文件和数据库分离到不同服务器，按资源特点独立配置，减少相互竞争。' },
      { text: '阶段3：使用缓存', details: '增加本地缓存和分布式缓存，减少数据库访问并提高热点数据响应；需处理失效、一致性和击穿。' },
      { text: '阶段4：应用服务器集群', details: '通过负载均衡把请求分发到多台无状态应用服务器，提高并发和可用性；会话需集中或无状态化。' },
      { text: '阶段5：数据库读写分离', details: '主库处理写，从库处理读，通过复制分担查询压力；需处理复制延迟、一致性和故障切换。' },
      { text: '阶段6：反向代理与 CDN', details: 'CDN 就近服务静态内容，反向代理缓存和转发请求，减少源站压力并改善跨地域响应。' },
      { text: '阶段7：分布式文件与数据库', details: '用分布式文件系统和数据库突破单机容量；优先按业务分库，单表极大时再采用数据分片。' },
      { text: '阶段8：NoSQL 与搜索引擎', details: '针对灵活结构、海量数据和复杂检索引入 NoSQL、搜索引擎，并通过统一数据访问层屏蔽多数据源。' },
      { text: '阶段9：业务拆分', details: '按产品线/业务领域把网站拆成独立应用和团队，通过链接、消息或共享数据协作。' },
      { text: '阶段10：分布式服务', details: '抽取用户、商品等公共业务为独立服务，应用聚焦界面和流程，避免所有应用直连所有数据库。' },
      { text: '演化规律', details: '容量扩展→读性能→并发→地域加速→数据扩展→业务解耦→服务复用；架构应按实际瓶颈逐步演化。' },
      { text: '反模式警示', details: '不应照搬最终复杂架构；过早分布式会增加网络、事务、运维、排障和组织成本。' },
    ] },
    { text: '10.7 软件架构维护', details: '架构维护追踪和控制演化过程，保持需求、架构、实现和版本之间的一致性。', children: [
      { text: '10.7.1 软件架构知识管理', details: '记录架构设计方案及其决策来源，使维护者理解为什么这样设计。', children: [
        { text: '架构知识定义', details: '架构知识=架构设计+架构设计决策，包括候选方案、选择理由、约束和权衡。' },
        { text: '管理内容', details: '解决方案、质量属性、决策依据、假设、风险、历史变化和经验。' },
        { text: '必要性', details: '人员变化会使隐含知识沉没和腐蚀，导致重复讨论、错误修改和技术债务。' },
        { text: '现实障碍', details: '文档成本高、短期收益不明显、缺乏培训、知识难检索和未传播给合适涉众。' },
        { text: '实践方式', details: '架构决策记录 ADR、决策日志、视图仓库、标签检索、评审和定期更新。' },
      ] },
      { text: '10.7.2 软件架构修改管理', details: '建立修改规则、类型、影响范围和副作用分析，控制变更实施。', children: [
        { text: '静止区 Region of Quiescence', details: '使待修改区域不再处理相关事务和调用，隔离变化对其他部分的影响。' },
        { text: '修改流程', details: '申请→分析→审批→实施→验证→发布→回顾，重要变更保留回滚方案。' },
        { text: '追踪关系', details: '变更应追踪到需求、决策、构件、接口、测试、部署和文档。' },
      ] },
      { text: '10.7.3 软件架构版本管理', details: '对架构模型、决策、配置和实现映射进行版本控制，为演化使用、评价和度量提供依据。', children: [
        { text: '管理对象', details: '架构视图、接口、配置、部署、约束、决策记录和依赖基线。' },
        { text: '波及量化', details: '可用邻接矩阵、可达矩阵和动态语义网络分析静态/动态演化影响。' },
        { text: '版本策略', details: '明确兼容规则、分支、合并、基线、发布标识、迁移和废弃策略。' },
      ] },
      { text: '10.7.4 可维护性度量实践', details: '从组件图解析结构数据，度量高层架构复杂性和可维护性。', children: [
        { text: 'CCN 圈复杂度', details: '度量架构独立执行路径数量，教材示例公式为 (totalE-totalN)+2L。' },
        { text: 'FFC 扇入扇出度', details: '反映组件输入输出依赖规模及控制复杂性。' },
        { text: 'CBO 模块间耦合度', details: '度量组件与其他组件的依赖程度，通常越低越易维护。' },
        { text: 'RFC 模块响应', details: '组件可能响应的内部操作和外部调用规模，过大意味着理解和测试成本增加。' },
        { text: 'TCC/LCC 内聚度', details: '紧内聚和松内聚反映组件内部元素的关联程度，内聚高通常更利于维护。' },
        { text: '度量使用原则', details: '指标用于趋势、比较和风险发现，不能脱离业务、规模和架构风格机械判断。' },
      ] },
    ] },
  ],
};

const selectionResult = await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } });
const selection = JSON.parse(selectionResult.content[0].text);
const mapIdentifier = selection.mapIdentifier;
const anchorNodeIdentifier = process.env.FREEPLANE_ROOT_NODE_ID || selection.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER10_NODE_ID;
if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: { mapIdentifier, userSummary: '创建第10章详细思维导图', anchorPlacement: { anchorNodeIdentifier, placementMode: 'LAST_CHILD' }, nodes: [{ index: 0, parentIndex: -1, content: c(chapter10.text, chapter10.details), foldingState: 'UNFOLD' }] } });
  const result = await tool('searchNodes', { request: { mapIdentifier, queryText: chapter10.text, matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const payload = JSON.parse(result.content[0].text);
  const matches = payload.items || payload.nodes || payload.results || [];
  chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error('Cannot locate chapter 10 root');
}
for (const branch of chapter10.children) await tool('createNodes', { request: { mapIdentifier, userSummary: `导入${branch.text}`, anchorPlacement: { anchorNodeIdentifier: chapterNodeIdentifier, placementMode: 'LAST_CHILD' }, nodes: flatten(branch) } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, chapter: chapter10.text }, null, 2));
