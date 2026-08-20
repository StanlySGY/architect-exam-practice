const endpoint = process.env.FREEPLANE_MCP_URL || 'http://127.0.0.1:6298/';
const token = process.env.FREEPLANE_MCP_TOKEN;

if (!token) {
  throw new Error('Set FREEPLANE_MCP_TOKEN before running this script.');
}

let requestId = 1;

async function mcp(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId++, method, params }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}: ${body}`);
  const payload = JSON.parse(body);
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function tool(name, args) {
  return mcp('tools/call', { name, arguments: args });
}

function content(text, details) {
  return details ? { text, details } : { text };
}

function flatten(branch) {
  const nodes = [];
  function visit(item, parentIndex) {
    const index = nodes.length;
    nodes.push({
      index,
      parentIndex,
      content: content(item.text, item.details),
      ...(item.children?.length ? { foldingState: 'UNFOLD' } : {}),
    });
    for (const child of item.children || []) visit(child, index);
  }
  visit(branch, -1);
  return nodes;
}

const branches = [
  {
    text: '3.1 信息系统概述',
    details: '从定义、发展、分类、生命周期、建设原则与开发方法建立全章基础。',
    children: [
      {
        text: '定义与组成',
        details: '以处理信息流为目的的人机一体化系统；由硬件、网络与通信设备、软件、信息资源、用户和规章制度构成。',
        children: [
          { text: '技术定义', details: '由支持决策与控制的相关要素组成，完成信息收集、检索、加工处理和信息服务。' },
          { text: '核心任务', details: '把原始数据收集、加工、存储为有意义的信息，并按不同方式提供给各类用户。' },
          { text: '人机系统本质', details: '计算机只是组成部分；输入数据、解释和使用输出结果仍由人完成，问题提出与解答依赖人机交互。' },
          { text: '与计算机的区别', details: '计算机提供存储和处理能力；信息系统还包含人、流程、制度、信息资源及其组织方式。' },
        ],
      },
      {
        text: '五项基本功能',
        details: '输入、存储、处理、输出、控制，构成信息从采集到使用的闭环。',
        children: [
          { text: '输入', details: '取决于系统目标、系统能力和信息环境许可，负责获取原始数据。' },
          { text: '存储', details: '保存信息资料和数据，支撑后续查询、处理与共享。' },
          { text: '处理', details: '利用数据处理工具加工数据；教材关联数据仓库、OLAP 和数据挖掘技术。' },
          { text: '输出', details: '向用户提供所需信息；前述功能最终都为实现最佳输出服务。' },
          { text: '控制', details: '管理信息处理设备，并通过程序控制加工、传输和输出等环节。' },
        ],
      },
      {
        text: '信息化',
        details: '在宏观信息政策指导下，开发利用信息资源，满足社会信息需求并推进信息社会的过程。',
        children: [
          { text: '核心与依托', details: '以信息资源开发利用为核心，以网络、通信等高新技术为依托。' },
          { text: '影响', details: '不仅引起生产力变革，也伴随生产关系的重大变革。' },
        ],
      },
      {
        text: '诺兰六阶段模型',
        details: '组织由手工系统走向计算机信息系统的规律，考察技术、应用、计划与控制策略、用户状况四方面。',
        children: [
          { text: '初始阶段', details: '计算机主要作报表统计或打字机；用户少，常先出现在财务部门。' },
          { text: '传播阶段', details: '应用需求和投入快速增加；数据处理发展，同时出现冗余、不一致、难共享和低效率。' },
          { text: '控制阶段', details: '开始整体控制 IT 建设，成立领导小组、采用数据库；虽有部门网络化，仍存在部门壁垒和信息孤岛。' },
          { text: '集成阶段', details: '重新规划，建设基础数据库与统一管理系统；资源从单点分散走向企业内集成共享。' },
          { text: '数据管理阶段', details: '高层认识到信息战略价值，统一数据库平台、数据管理体系和信息管理平台。' },
          { text: '成熟阶段', details: '系统支持从事务处理到高效决策的各层需求，整合内外部资源以增强竞争力。' },
          { text: '阶段分界与考点', details: '前 3 阶段具计算机时代特征，后 3 阶段具信息时代特征；转折点是信息资源规划时机。' },
        ],
      },
      {
        text: '信息系统分类',
        details: '传统系统从低级到高级、从局部到全局、从简单到复杂：TPS/DPS、MIS、DSS、ES、OAS。',
        children: [
          { text: 'TPS/DPS', details: '面向财会、销售、物资、生产等局部事务；不形成企业整体管理。' },
          { text: 'MIS', details: '以基层业务为基础，联系各业务系统，面向企业整体管理与各级管理者。' },
          { text: 'DSS', details: '基于数据和模型，解决半结构化与非结构化决策问题，服务高层决策。' },
          { text: 'ES', details: '应用领域专家知识和推理判断，模拟专家决策来解决复杂领域问题。' },
          { text: 'OAS', details: '人机结合的办公事务管理系统，提升办公质量与效率。' },
          { text: '综合与新型系统', details: '各类系统相互促进并可融合；制造业常见 ERP（资源）、WMS（仓储）、MES/SFC（制造过程）、PDM（研发产品数据）。' },
        ],
      },
      {
        text: '生命周期',
        details: '产生、开发、运行、消亡四阶段；开发阶段是关键。',
        children: [
          { text: '产生阶段', details: '概念产生：根据经营管理需要提出初步想法；需求分析：深入调研并形成需求分析报告。' },
          { text: '开发阶段总览', details: '依次为总体规划、系统分析、系统设计、系统实施、系统验收。' , children: [
            { text: '总体规划', details: '以需求分析为基础；明确系统战略地位、指导开发、优化资源；包括目标、总体架构、组织与流程、实施计划、技术规范。' },
            { text: '系统分析', details: '以业务流程分析为基础，形成供设计使用的逻辑模型；包括组织功能、业务流程、数据与数据流程、初步方案。' },
            { text: '系统设计', details: '形成实施方案：架构、数据库、处理流程、功能模块、安全控制、队伍与组织、管理流程设计。' },
            { text: '系统实施', details: '将设计文本转为可运行的软件与网络系统；用户参与尤为重要，之后用户逐步成为主导。' },
            { text: '系统验收', details: '试运行暴露性能和用户友好性问题，据此验收。' },
          ] },
          { text: '运行阶段', details: '验收移交后进入正式运行；长期运行是检验系统质量的试金石，正常运行离不开维护。', children: [
            { text: '排错性维护', details: '纠正运行中发现的错误。' },
            { text: '适应性维护', details: '适应环境、技术或业务变化。' },
            { text: '完善性维护', details: '改进性能或扩展功能以满足新需求。' },
            { text: '预防性维护', details: '提前改善可维护性、降低潜在故障。' },
          ] },
          { text: '消亡阶段', details: '旧系统难以适应需求或维护成本过高时被替代；应重视数据迁移、平稳切换与资料归档。' },
        ],
      },
      {
        text: '建设原则',
        details: '保证系统建设与管理目标、用户需求和工程实践一致。',
        children: [
          { text: '高层管理人员介入', details: '高层负责战略、资源协调和重大决策，信息系统建设不能脱离管理层支持。' },
          { text: '用户参与开发', details: '用户掌握业务与需求；从分析到实施都应参与，以提高可用性与接受度。' },
          { text: '自顶向下规划', details: '先服从企业总体目标和全局架构，再分解实施，避免局部优化与信息孤岛。' },
          { text: '工程化', details: '按工程方法组织开发，重视标准、文档、质量、进度、成本和风险控制。' },
          { text: '其他原则', details: '强调适用性、可扩展性、可靠性、安全性、经济性以及分步实施。' },
        ],
      },
      {
        text: '开发方法',
        details: '按问题特性、需求稳定性和组织能力选择，常见结构化、原型、面向对象、面向服务方法。',
        children: [
          { text: '结构化方法', details: '以生命周期为基础，自顶向下分解、逐步求精；适合需求较明确的系统，强调模型、文档和阶段评审。' },
          { text: '原型法', details: '快速构造原型、与用户反复交流并迭代；适合需求不清或交互性强场景，注意避免把原型直接当成成品。' },
          { text: '面向对象方法', details: '用对象封装数据与行为，利用抽象、封装、继承、多态；便于复用和应对复杂现实世界模型。' },
          { text: '面向服务方法', details: '以可复用、松耦合、可组合的服务组织业务能力；支持跨系统集成和业务流程编排。' },
        ],
      },
    ],
  },
  {
    text: '3.2 业务处理系统（TPS）',
    details: '面向日常业务事务，强调高效、准确、可靠地处理大量重复性数据。',
    children: [
      { text: '概念与目标', details: 'TPS（Transaction Processing System）又称数据处理系统，收集、存储、检索和处理组织日常交易数据，形成基础业务信息。', children: [
        { text: '典型事务', details: '订单、销售、采购、库存收发、工资、账务、生产记录等结构化、重复性业务。' },
        { text: '在组织中的位置', details: '处于操作层，是 MIS、DSS 等上层系统的重要数据来源。' },
      ] },
      { text: '功能', details: '围绕数据生命周期形成五项功能。', children: [
        { text: '数据输入', details: '从单据、终端、条码或接口采集；应校验完整性、合法性、格式与权限。' },
        { text: '数据处理', details: '包括分类、排序、计算、汇总、更新等；可采用批处理或联机实时处理。' },
        { text: '数据库维护', details: '维护主数据和交易数据，保证准确性、一致性、完整性与可恢复性。' },
        { text: '文件和报表产生', details: '输出业务凭证、明细、汇总报表与管理报表，为业务执行与管理提供依据。' },
        { text: '查询处理', details: '按条件检索和显示当前或历史事务信息，满足日常核对与追踪。' },
      ] },
      { text: '特点', details: '处理量大、事务频繁、规则明确；对准确性、及时性、可靠性、安全性要求高。', children: [
        { text: '结构化与程序化', details: '输入、处理规则和输出通常明确，适合标准化流程。' },
        { text: '性能与一致性', details: '应保证高吞吐、并发控制、事务完整性和故障恢复。' },
        { text: '数据基础作用', details: '业务数据沉淀后支撑 MIS 的管理汇总与 DSS 的分析决策。' },
      ] },
    ],
  },
  {
    text: '3.3 管理信息系统（MIS）',
    details: '以企业整体管理为背景，在基层业务系统之上提供收集、加工、传递与使用管理信息的人机系统。',
    children: [
      { text: '概念与定位', details: 'MIS 以计算机为处理手段、通信设备为传输工具，为管理决策提供信息服务；强调企业全局、总体任务和业务系统间信息联系。', children: [
        { text: '与 TPS 的关系', details: 'TPS 处理基层事务；MIS 对业务数据进行汇总、综合和管理使用，面向各级管理者。' },
        { text: '信息范围', details: '教材指出其信息收集仍更多侧重企业内部。' },
      ] },
      { text: '功能', details: '完成管理信息的收集、传输、存储、加工、维护和使用，并支持计划、组织、领导、控制等管理活动。', children: [
        { text: '数据处理与报告', details: '将业务数据加工为例行报告、汇总报告、异常报告和查询结果。' },
        { text: '计划与控制支持', details: '为目标制定、资源配置、执行监控、偏差分析与纠偏提供信息。' },
        { text: '跨部门协同', details: '通过统一数据和信息联系减少部门割裂，服务企业总体目标。' },
      ] },
      { text: '组成', details: 'MIS 由人、硬件、软件、数据、规程和网络通信等相互作用的要素构成。', children: [
        { text: '人员与组织', details: '包括管理者、业务人员、信息系统人员；明确职责、权限、培训与运行制度。' },
        { text: '数据与信息资源', details: '业务数据、主数据、历史数据和管理信息是系统运行基础。' },
        { text: '技术与规程', details: '硬件、软件、通信网络提供能力；规程保证数据采集、处理、维护和使用规范。' },
      ] },
      { text: '管理层次', details: '通常按运行控制、管理控制、战略计划等层次提供不同粒度、周期与汇总程度的信息。' },
    ],
  },
  {
    text: '3.4 决策支持系统（DSS）',
    details: 'DSS 是利用数据、模型和知识帮助决策者解决半结构化、非结构化问题的交互式系统。',
    children: [
      { text: '发展与定义', details: 'DSS 是 MIS 应用概念的深化，突出面向高层决策、交互分析和模型辅助。', children: [
        { text: '决策问题类型', details: '结构化问题可按既定规则处理；半结构化和非结构化问题需综合数据、模型、经验与人的判断，DSS 重点支持后两类。' },
        { text: '三种形态', details: '专用 DSS：解决特定领域问题；DSS 工具：语言、操作系统或数据库等基础工具；DSS 生成器：构建专用 DSS 的通用平台。' },
      ] },
      { text: '基本模式', details: '以“人机交互”为中心，决策者在数据、模型和方法支持下进行分析、比较、判断和选择。' },
      { text: '结构', details: '一般包括数据库、模型库、方法库、知识库和会话（人机交互）部件。', children: [
        { text: '数据库', details: '集成内部和外部数据，为查询、统计和分析提供数据基础。' },
        { text: '模型库与方法库', details: '保存预测、优化、模拟、评价等模型与方法，支持假设分析和方案比较。' },
        { text: '知识库', details: '沉淀规则、经验和启发式知识，增强智能分析能力。' },
        { text: '会话部件', details: '提供用户与系统交互界面，支持提问、建模、分析和结果呈现。' },
      ] },
      { text: '功能', details: '帮助决策者发现问题、分析问题、构造方案、比较方案和选择方案；不是替代人的最终决策。', children: [
        { text: '数据分析', details: '查询、汇总、钻取、OLAP 与可视化，识别趋势、异常和关联。' },
        { text: '模型分析', details: '进行预测、模拟、优化、敏感性分析和“假设-结果”推演。' },
        { text: '方案评价', details: '对多方案进行指标比较，为管理者提供可解释的决策依据。' },
      ] },
      { text: '特点', details: '交互性、灵活性、面向问题、模型驱动、辅助性；强调支持而非代替决策者。' },
      { text: '实现要点', details: '数据重组与确认、数据字典、数据挖掘与智能体、模型建立。', children: [
        { text: '数据重组和确认', details: '把分散数据转换为面向分析的统一、可信数据。' },
        { text: '数据字典', details: '统一数据定义、口径、来源和使用规则，避免分析歧义。' },
        { text: '数据挖掘和智能体', details: '从海量数据发现模式与知识，可由智能体持续监测与提示。' },
        { text: '模型建立', details: '根据决策问题建立数学、统计、仿真或评价模型，并验证适用性。' },
      ] },
    ],
  },
  {
    text: '3.5 专家系统（ES）',
    details: 'ES 是含有特定领域大量专家知识与经验、能推理判断并模拟专家决策过程的智能程序系统。',
    children: [
      { text: '概念', details: '由领域专家提供知识和经验，运用人工智能与计算机技术解决通常需人类专家处理的复杂问题。', children: [
        { text: '人工智能关系', details: '人工智能研究使机器表现出类似人类智能的能力；专家系统是 AI 的典型应用，以知识表示和推理为核心。' },
        { text: '适用边界', details: '适合知识相对稳定、可表达为规则或模型的特定领域；不等同于通用智能。' },
      ] },
      { text: '特点', details: '以知识和推理为核心，在特定领域提供接近专家水平的辅助。', children: [
        { text: '超越时间限制', details: '专家知识可长期保存，随时可用，不受个人在场和工作时段限制。' },
        { text: '操作成本低廉', details: '知识获取完成后可重复使用，降低获得专家建议的边际成本。' },
        { text: '易传递与复制', details: '可复制部署，使专家经验覆盖更多地点和用户。' },
        { text: '处理手段一致', details: '同样输入按相同知识与推理规则处理，输出稳定一致。' },
        { text: '善于克服难题', details: '在复杂诊断、判断、配置等问题中，能综合规则与经验提供建议。' },
        { text: '仅适用特定领域', details: '专业性是优势也是边界，离开知识覆盖范围可能不能给出可靠结论。' },
      ] },
      { text: '组成', details: '知识库、综合数据库、推理机、知识获取、解释程序、人机接口构成典型 ES。', children: [
        { text: '知识库', details: '保存领域事实、规则、经验和启发式知识，是系统智能的主要来源。' },
        { text: '综合数据库', details: '保存求解过程中使用的当前事实、案例和中间结果。' },
        { text: '推理机', details: '按推理策略匹配和执行知识，通常可采用正向或反向推理。' },
        { text: '知识获取', details: '从专家、文献、数据中提取、表示、验证并维护知识，是构建难点。' },
        { text: '解释程序', details: '说明“为什么提问”和“如何得出结论”，提高可信度与可审计性。' },
        { text: '人机接口', details: '支持用户输入事实、获取结论、追问解释和反馈。' },
      ] },
    ],
  },
  {
    text: '3.6 办公自动化系统（OAS）',
    details: 'OAS 是融合计算机、通信和管理技术的人机结合办公事务管理系统，目标是提高办公质量与效率。',
    children: [
      { text: '办公活动与概念', details: '办公活动包括信息采集、处理、传递、存储及辅助决策；OAS 将文字、图像、语音、通信等技术用于办公室工作。', children: [
        { text: '核心目标', details: '改善工作环境，提升办公事务处理质量、效率和协同能力。' },
        { text: '技术基础', details: '计算机、文字处理、声音/图像识别、数值计算、光学、微电子、通信和管理科学等。' },
      ] },
      { text: '功能', details: '由低到高包括事务处理、信息管理和辅助决策。', children: [
        { text: '事务处理', details: '文档制作、收发、登记、流转、档案、日程、会议等日常办公工作。' },
        { text: '信息管理', details: '组织、检索、共享办公信息，支持跨部门沟通、协作与知识积累。' },
        { text: '辅助决策', details: '向管理人员提供统计、分析、查询和沟通支持，提升办公决策质量。' },
      ] },
      { text: '组成', details: '由计算机设备、办公设备、数据通信与网络设备、软件系统组成。', children: [
        { text: '计算机设备', details: '服务器、终端、存储及相关外围设备，承担计算和数据处理。' },
        { text: '办公设备', details: '打印、扫描、复印、传真、音视频等设备，实现文档与多媒体办公。' },
        { text: '通信网络设备', details: '局域网、广域网、交换与通信设备，保证信息传输与协同。' },
        { text: '软件系统', details: '办公套件、工作流、文档管理、邮件/协同、数据库与安全管理软件。' },
      ] },
    ],
  },
  {
    text: '3.7 企业资源规划（ERP）',
    details: 'ERP 是基于信息技术与先进管理思想，对企业物流、资金流、信息流全面集成管理的平台；源于 MRP II。',
    children: [
      { text: '概念与演进', details: 'Gartner 于 1990 年提出；从 MRP II 发展而来，突破传统企业边界，以供应链优化资源并提升核心竞争力。', children: [
        { text: '三流集成', details: '物流、资金流、信息流是企业资源的三大流；ERP 对三流进行全面集成管理。' },
        { text: '管理思想而非仅软件', details: '集成内外部资源，为决策、计划、控制与业绩评价提供系统化管理平台。' },
        { text: '与 MRP II 的区别', details: 'MRP II 核心是物流、主线是计划；ERP 更强调财务成本控制，扩展到质量、设备、分销、运输、多工厂和供应链。' },
      ] },
      { text: '计划层次与核心模块', details: 'ERP 通过预测和分层计划把市场需求转换为生产、采购与执行活动。', children: [
        { text: '生产预测', details: '支撑经营计划、生产计划大纲和主生产计划；常用德尔菲、移动平均、指数平滑、非线性最小二乘等方法。' },
        { text: '销售管理', details: '连接企业与市场，为客户服务并获得利润；属于高层决策计划的重要内容。' },
        { text: '经营计划/生产计划大纲（PP）', details: '按经营目标与可用资源确定一定时期产量，是战略规划细化并指导 MPS 的承上启下层。' },
        { text: '主生产计划（MPS）', details: '明确生产什么、生产多少、何时交货；以生产计划大纲为准，是 MRP 的依据。' },
        { text: '物料需求计划（MRP）', details: '由最终产品需求分解零部件和材料的数量、时期，生成自制与采购计划；是生产管理核心。' },
        { text: '能力需求计划（CRP）', details: '核算 MRP 所需能力，比较需求与现有产能，及早发现瓶颈。' },
        { text: '车间作业计划（PAC）', details: '以制造订单为基础，按交货期、优先级及设备/人员/物料能力下达车间；属于执行层，常见 JIT 模式。' },
        { text: '采购与库存管理', details: '采购覆盖订单产生至收货的组织、实施和控制；库存管理物料进、出、存。' },
        { text: '质量与设备管理', details: 'TQM 强调全过程、全员质量责任；设备管理覆盖设备全寿命周期的物资和价值运动。' },
        { text: '财务管理', details: '以货币形式反映和监督经济活动，分类汇总业务数据，贯穿资金运动。' },
        { text: '扩展模块', details: 'CRM、分销资源管理、SCM、电子商务等可独立实施，也可与 ERP 集成。' },
      ] },
      { text: '功能与价值', details: '支持多层面、全方位管理，扩大行业和供应链边界。', children: [
        { text: '支持各层决策', details: '协同财务、营销、制造、质量、服务、工程等子系统；实时分析质量、市场、客户满意度和经营业绩。' },
        { text: '行业化解决方案', details: '从制造业扩展到商业零售、金融、能源、公共事业、工程建筑等，并结合行业特殊需求。' },
        { text: '跨企业供应链', details: '管理范围扩展至原料、加工、配送、流通和最终消费者；统一计划促成上下游协同与整体成本优势。' },
      ] },
    ],
  },
  {
    text: '3.8 典型信息系统架构模型',
    details: '本节以电子政务、企业信息化与电子商务为代表，说明信息系统与组织流程、战略和生态的融合。',
    children: [
      {
        text: '政府信息化与电子政务',
        details: '利用信息技术集成政府管理与服务，优化组织结构和工作流程，突破时间、空间和部门分隔，实现公务、政务、商务、事务一体化。',
        children: [
          { text: '三项组成', details: '政府内部电子化网络办公；政府部门间信息共享与实时通信；政府与居民间双向信息交流。' },
          { text: '五类互动主体关系', details: '围绕政府、企（事）业单位、居民展开。', children: [
            { text: '政府与政府（G2G）', details: '中央与地方、部门之间及与公务员互动；涉及基础信息、计划管理、通信网络、财务 MIS、DSS 与执行系统。' },
            { text: '政府对企业（G2B）', details: '发布政策法规和行政规定，办理营业执照、许可证、合格证、质量认证等。' },
            { text: '政府对居民（G2C）', details: '提供规定、办事程序、公共安全、户籍证照及学校、医院、图书馆、公园等公共服务信息。' },
            { text: '企业对政府（B2G）', details: '纳税、统计报表、工程投标、供货服务、反馈经营困难、提出建议和申请援助。' },
            { text: '居民对政府（C2G）', details: '缴税费、填报表、缴罚款；更重要的是参政议政、民意反馈以及报警、急救等紧急服务。' },
          ] },
          { text: '技术形式与成熟路径', details: '以互联网为基础设施，强调政府服务功能；业务按轻重缓急持续、分批建设。', children: [
            { text: '起步：信息发布', details: '网站发布法规、指南、机构、人员、联系方式等静态信息。' },
            { text: '单向互动', details: '发布动态服务信息，并向用户提供某种形式的服务。' },
            { text: '双向互动', details: '用户可在线获取、填写并提交表单，例如网上报税表。' },
            { text: '网上事务处理', details: '政府在线受理、审批并完成划账/退款等完整业务闭环，标志相应业务趋于成熟。' },
          ] },
          { text: '六类应用领域', details: '面向社会；政府部门间；政府部门内部；涉核心数据；政府电子化采购；电子社区。', children: [
            { text: '面向社会', details: '网站发布与查询、信访建议反馈、数据收集统计、公共服务、项目申报、法规文件发布。' },
            { text: '政府部门之间', details: '公文审核传递、视频会议、多媒体数据交换、同级部门信息交换。' },
            { text: '政府部门内部', details: '公文流转审核、专项业务管理、日程会议机关事务、面向不同层级的统计分析。' },
            { text: '核心数据应用', details: '机要和秘密文件、领导事务、重大事件决策、国家重大事务数据分析处理。' },
            { text: '电子化采购', details: '政府电子商务。' },
            { text: '电子社区', details: '城市社区管理中应用信息手段。' },
          ] },
        ],
      },
      {
        text: '企业信息化与电子商务',
        details: '企业通过深入开发和广泛利用信息资源，实现生产自动化、管理网络化、决策智能化和商务电子化，提升效益和竞争力。',
        children: [
          { text: '概念与本质', details: '信息技术从局部到全局、从战术到战略渗透到流程管理；核心是知识挖掘与编码、业务流程管理。', children: [
            { text: '实施方向', details: '自上而下：与制度、组织、管理创新结合；自下而上：以业务人员直接受益和使用水平提升为基础。' },
            { text: '过程特征', details: '空间上从无到有、由点到面；时间上阶段性、渐进性，由战术逐步深化到战略。' },
          ] },
          { text: '目的', details: '优化业务活动、提高竞争能力、保证平稳有效运作、快速响应机会与紧急情况，并向内外部用户提供有价值信息。', children: [
            { text: '技术创新', details: '以 CAD、互联网和生产技术与信息技术融合，加快创新技术向生产转化并提升产品竞争力。' },
            { text: '管理创新', details: '重组管理流程，管理范围从财务资金扩展到技术、物资、人力、研发制造、CRM、SCM 与电子商务。' },
            { text: '制度创新', details: '建设现代企业制度、明确岗位责任与监管体系，基于及时市场信息实施科学管理。' },
          ] },
          { text: '规划：技术与业务融合', details: '不是把手工作业简单自动化，而是在企业战略、业务运作、管理运作三个层面融合。', children: [
            { text: '战略层面', details: '分析现行策略与未来方向、内外供应链和管理模式，找出战略关键要素及其 IT 驱动因素。' },
            { text: '业务运作层面', details: '识别创造价值的关键流程和关键业务需求，决定未来系统主要功能；与关键流程融合是投资回报和成败的重要衡量。' },
            { text: '管理运作层面', details: '提出应用功能与信息技术体系，支撑管理模式和组织架构适应信息化。' },
            { text: '战略数据模型', details: '数据库模型描述日常事务数据及关系；数据仓库模型描述高层决策所需信息及关系；数据库模型是基础。' },
            { text: '实施策略', details: '信息化是多种类、多层次系统建设、集成和应用过程，需全面规划、分步实施，不能一蹴而就。' },
          ] },
          { text: '常用方法', details: '根据企业特点组合采用，以业务价值和可持续实施为导向。', children: [
            { text: '业务流程重构（BPR）', details: '利用信息与网络技术对组织结构和工作方式进行彻底、根本性的重新设计，以适应市场和信息社会。' },
            { text: '核心业务应用', details: '围绕企业赖以竞争和生存的核心业务优先应用计算机与网络技术。' },
            { text: '信息系统建设', details: '对多数企业而言是信息化的重点和关键，也是最普遍的方法。' },
            { text: '主题数据库', details: '面向企业业务主题和核心业务；适合流程复杂的大企业，避免全覆盖系统难成功及局部开发造成信息孤岛。' },
            { text: '资源管理', details: '借助 ERP、SCM 等对企业资源进行规划、整合和优化。' },
            { text: '人力资本投资', details: '把优秀员工视为可产生投资收益的资本；尤其适用于咨询、软件开发等知识密集型企业。' },
          ] },
        ],
      },
    ],
  },
];

const selected = await tool('getSelectedMapAndNodeIdentifiers', {
  request: { selectionCollectionMode: 'SINGLE' },
});
const selection = JSON.parse(selected.content[0].text);
const mapIdentifier = selection.mapIdentifier;
const anchorNodeIdentifier = selection.nodeIdentifier;

let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER_NODE_ID;
if (!chapterNodeIdentifier) {
  await tool('createNodes', {
    request: {
      mapIdentifier,
      userSummary: '创建《系统架构设计师教程（第2版）》第三章详细思维导图根节点',
      anchorPlacement: { anchorNodeIdentifier, placementMode: 'LAST_CHILD' },
      nodes: [{
        index: 0,
        parentIndex: -1,
        content: content('第3章 信息系统基础知识', '依据《系统架构设计师教程（第2版）》第 3 章（105-144 页）整理：概念、发展、典型系统、ERP、电子政务与企业信息化。'),
        foldingState: 'UNFOLD',
      }],
    },
  });
  const lookup = await tool('searchNodes', {
    request: {
      mapIdentifier,
      queryText: '第3章 信息系统基础知识',
      matchingMode: 'EQUALS',
      caseSensitivity: 'CASE_SENSITIVE',
      limit: 10,
    },
  });
  const lookupPayload = JSON.parse(lookup.content[0].text);
  const matches = lookupPayload.items || lookupPayload.nodes || lookupPayload.results || [];
  chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) {
    throw new Error(`Unable to locate the newly created chapter node: ${lookup.content[0].text}`);
  }
}

let created = 1;
for (const branch of branches) {
  const result = await tool('createNodes', {
    request: {
      mapIdentifier,
      userSummary: `导入 ${branch.text} 的详细知识节点`,
      anchorPlacement: { anchorNodeIdentifier: chapterNodeIdentifier, placementMode: 'LAST_CHILD' },
      nodes: flatten(branch),
    },
  });
  created += flatten(branch).length;
}

const verification = await tool('readNodesWithDescendantsAsPlainText', {
  request: {
    mapIdentifier,
    nodeIdentifiers: [chapterNodeIdentifier],
    fullContentDepth: 4,
    additionalSummaryDepth: 0,
    maxCharacters: 100000,
  },
});

console.log(JSON.stringify({
  mapIdentifier,
  chapterNodeIdentifier,
  createdNodeCount: created,
  verification: verification.content[0].text,
}, null, 2));
