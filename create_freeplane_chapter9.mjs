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

const chapter9 = {
  text: '第9章 软件可靠性基础知识',
  details: '依据教材第9章（305-329页）整理：软件可靠性概念与指标、建模、管理、设计、测试及评价预测。',
  children: [
    { text: '9.1 软件可靠性基本概念', details: '软件可靠性是在规定条件和规定时间内完成规定功能、不引起系统失效的能力或概率。', children: [
      { text: '9.1.1 软件可靠性定义', details: '可靠性与运行环境、输入分布、任务、缺陷和运行时间相关；软件失效是缺陷在特定输入与状态下被触发的外部表现。', children: [
        { text: '定义三要素', details: '规定条件、规定时间、规定功能；评价结果脱离这三项就没有可比性。' },
        { text: '软件与硬件差异', details: '软件可靠性问题主要来自设计缺陷而非物理磨损。', children: [
          { text: '复杂性', details: '软件逻辑和路径高度复杂，设计错误是软件失效的主要原因。' },
          { text: '无物理退化', details: '软件不会像硬件一样老化，但环境、输入和修改会改变失效表现。' },
          { text: '复制唯一性', details: '软件副本逻辑完全相同，同一缺陷会在满足触发条件时重复出现。' },
          { text: '版本更新快', details: '需求变更和缺陷修复频繁改变程序和可靠性基线，给持续评估带来困难。' },
        ] },
        { text: '缺陷、错误与失效', details: '缺陷是软件内部问题；执行缺陷可能产生错误状态；错误传播到系统边界并偏离要求时形成失效。' },
        { text: '概率描述意义', details: '输入和路径选择具有随机性，可用失效概率、可靠度和失效强度建立量化模型。' },
      ] },
      { text: '9.1.2 软件可靠性的定量描述', details: '使用时间、概率和失效数据描述可靠性。', children: [
        { text: '三种时间基准', details: '自然时间（日历时间）、运行时间（软件启动到结束）、执行时间（CPU 实际执行指令时间）；执行时间通常最精确。' },
        { text: '失效概率 F(t)', details: '从运行开始到时刻 t 已出现失效的概率；F(0)=0，随时间单调增加，长期趋向 1。' },
        { text: '可靠度 R(t)', details: '规定时间内不发生失效的概率，R(t)=1-F(t)；R(0)=1，长期趋向 0。' },
        { text: '失效强度 f(t)', details: '单位时间内发生失效的概率密度，可理解为 F(t) 对时间的导数；测试中常观察随排错而下降的趋势。' },
        { text: 'MTTF 平均失效前时间', details: '从开始运行到首次失效的期望时间，适用于不可修复对象或描述无失效运行能力。' },
        { text: 'MTTR 平均恢复前时间', details: '从故障出现到系统恢复服务的平均时间，包括检测、诊断、修复和重新投入使用。' },
        { text: 'MTBF 平均故障间隔时间', details: '可修复系统两次故障间平均时间，教材给出 MTBF=MTTF+MTTR。' },
        { text: '运行剖面 Operational Profile', details: '对系统使用条件和输入出现概率的描述，是可靠性定义中“规定条件”的具体化，也是测试用例抽样依据。' },
        { text: '度量使用前提', details: '明确软件边界、失效定义、运行环境、输入域和时间基准，并假设硬件和外部输入符合约定。' },
      ] },
      { text: '9.1.3 可靠性目标', details: '可靠性目标是用户对软件可靠性水平的定量期望，需要同时考虑失效概率和后果严重程度。', children: [
        { text: '失效严重程度类', details: '把对用户影响相近的失效归类，可按经济损失、业务能力、数据损失、人身安全等划分。' },
        { text: '成本影响', details: '包括额外运行成本、修复恢复成本、业务机会损失、赔偿和声誉损失。' },
        { text: '系统能力影响', details: '如系统崩溃、数据不可恢复、停止响应、关键操作失败或可替代的局部功能失效。' },
        { text: '目标指标', details: '常用可靠度、失效强度、MTTF/MTBF 等；不同严重等级应设置不同目标。' },
        { text: '目标制定步骤', details: '确定运行模式→定义失效及严重等级→设定失效强度/可靠度目标→平衡成本、进度和风险。' },
      ] },
      { text: '9.1.4 可靠性测试的意义', details: '严重软件失效可能导致经济、生命和国家安全损失；普通功能测试难覆盖全部路径，必须专门获取可靠性证据。', children: [
        { text: '核心价值', details: '验证可靠性目标、发现高频失效模式、获得模型数据、支持发布或继续测试的决策。' },
        { text: '现实限制', details: '软件路径数量巨大，不可能完全测试；测试结论依赖运行剖面、环境和数据质量。' },
      ] },
      { text: '9.1.5 广义与狭义可靠性测试', details: '广义测试包括整个生命周期中为提高可靠性进行的测试活动；狭义测试按运行剖面随机抽样并收集失效数据，用于可靠性评价。', children: [
        { text: '广义可靠性测试', details: '单元、集成、系统、验收、压力、恢复和故障注入等均可为可靠性提供证据。' },
        { text: '狭义可靠性测试', details: '依据实际使用概率选择测试用例，记录失效时间和严重等级，输入可靠性模型进行估计和预测。' },
        { text: '易混点', details: '面向缺陷的测试主要用于发现错误；统计可靠性测试必须按运行剖面抽样，结果才可直接反映实际使用可靠性。' },
      ] },
    ] },
    { text: '9.2 软件可靠性建模', details: '可靠性模型用数学形式描述测试与运行中的失效过程，以估计当前可靠性并预测未来失效行为。', children: [
      { text: '9.2.1 影响软件可靠性的因素', details: '软件质量、开发过程、运行环境、输入分布、缺陷数量和排错活动共同影响可靠性。', children: [
        { text: '产品因素', details: '规模、复杂度、结构、接口、算法、缺陷密度和文档质量。' },
        { text: '过程因素', details: '人员能力、方法工具、评审测试、配置管理、进度压力和质量保证。' },
        { text: '运行因素', details: '硬件/软件环境、负载、用户类型、输入概率、操作规程和维护变化。' },
        { text: '故障修复因素', details: '缺陷检测和修复效率、不完全修复、修复引入新缺陷以及版本变化。' },
      ] },
      { text: '9.2.2 软件可靠性的建模方法', details: '模型通常基于失效数据的概率分布和随机过程随时间变化的规律。', children: [
        { text: '三类基本假设', details: '代表性、独立性和相同性。', children: [
          { text: '代表性假设', details: '测试用例能代表实际运行剖面，测试数据可预测运行阶段行为。' },
          { text: '独立性假设', details: '不同时间的软件失效相互独立，一个失效不改变另一个失效发生概率。' },
          { text: '相同性假设', details: '建模时把所有失效视为同等后果，不区分严重等级；实际应用需检查此假设是否合理。' },
        ] },
        { text: '参数确定', details: '估计：从收集到的失效数据归纳参数；预测：根据产品属性和开发过程在执行前确定参数。' },
        { text: '常见输出', details: '累计平均失效数、时间区间平均失效数、任意时刻失效强度、失效间隔分布和达到目标的时间。' },
        { text: '稳定性前提', details: '预测期间程序代码、运行环境和运行剖面应基本不变；引入新功能或新缺陷后需重新估计。' },
        { text: '好模型特征', details: '假设可靠、结构简单、输出有用、能较好预测未来失效、可广泛应用且数据成本可接受。' },
      ] },
      { text: '9.2.3 可靠性模型分类', details: '教材将统计分析模型概括为十大类。', children: [
        { text: '1 种子法模型', details: '预先植入已知错误，根据原始错误与种子错误的检出比例估计残余错误；简单但种子与真实缺陷的相似性难保证。' },
        { text: '2 失效率类模型', details: '直接研究失效率或失效间隔随排错变化，如 Jelinski-Moranda、Schick-Wolverton 等。' },
        { text: '3 曲线拟合类模型', details: '用参数或非参数回归拟合复杂度、缺陷数、失效率和失效间隔数据。' },
        { text: '4 可靠性增长模型', details: '用增长函数描述检错排错过程中可靠性提高，如 Duane、Weibull、逻辑增长、Gompertz 曲线。' },
        { text: '5 程序结构分析模型', details: '将模块及调用关系组成可靠性网络，根据模块可靠性、转换概率和路径计算整体可靠性。' },
        { text: '6 输入域分类模型', details: '从输入域按实际使用概率抽样运行，以成功/失效率推断使用可靠性；关键是准确运行剖面。' },
        { text: '7 执行路径分析模型', details: '估计各逻辑路径执行概率和错误路径概率，综合得到软件使用可靠性。' },
        { text: '8 非齐次泊松过程 NHPP', details: '把单位时间失效次数建模为随时间变化的泊松过程，预测累计失效数和失效强度。' },
        { text: '9 马尔可夫过程模型', details: '用状态转移和概率描述软件缺陷消除、失效和恢复过程。' },
        { text: '10 贝叶斯模型', details: '结合失效率先验分布和当前测试失效信息更新可靠性估计，适合有历史经验和继承性较好的软件。' },
        { text: '其他分类维度', details: '可按时间域、有限/无限失效数、失效数分布、失效强度函数等分类。' },
      ] },
    ] },
    { text: '9.3 软件可靠性管理', details: '可靠性管理把可靠性目标、计划、任务、数据、评估和纠正措施贯穿软件生命周期。', children: [
      { text: '管理目标', details: '在有限成本和进度约束下达到预定可靠性目标，并使活动、证据和责任可追踪。' },
      { text: '需求分析阶段', details: '确定可靠性目标、影响因素、验收标准、管理框架、文档规范、初步计划和数据规范。' },
      { text: '概要设计阶段', details: '确定可靠性度量和验收方案，开展可靠性设计、收集数据、调整计划并形成文档。' },
      { text: '详细设计阶段', details: '深化可靠性设计，预测可靠性指标，持续收集数据和细化后续活动。' },
      { text: '编码阶段', details: '在单元测试中进行可靠性测试和排错，记录缺陷与失效数据，维护计划和文档。' },
      { text: '测试阶段', details: '在集成/系统测试中执行可靠性测试、排错、建模和评价，持续更新数据和计划。' },
      { text: '实施阶段', details: '结合验收测试验证可靠性，收集现场数据、调整模型、评价交付状态并归档文档。' },
      { text: '管理难点', details: '可靠性投入和收益难量化、标准和数据不足、计划易受进度挤压；需建立持续数据闭环。' },
    ] },
    { text: '9.4 软件可靠性设计', details: '可靠性最经济有效的控制点在设计阶段，应把容错、检错和低复杂度等能力设计进系统。', children: [
      { text: '设计原则', details: '可靠性设计是总体设计的一部分；以满足明确可靠性目标为边界，并与功能、成本、进度及其他质量属性权衡。' },
      { text: '9.4.1 容错设计技术', details: '系统在部分软件发生故障时仍能提供正确或可接受服务。', children: [
        { text: '恢复块设计', details: '一个容错单元包含主实现、验收测试和若干备选实现；主实现失败后回退状态并依次执行备选块，属于动态冗余。' },
        { text: 'N 版本程序设计', details: '多个独立团队依据同一精确需求采用不同算法、语言、工具和方法实现，运行相同输入并通过多数表决得到结果。', children: [
          { text: '关键前提', details: '需求说明完整准确，各版本设计错误尽量不相关。' },
          { text: '共同失效风险', details: '需求错误、相似思维和共同工具缺陷可能使多个版本同时失败。' },
        ] },
        { text: '冗余设计', details: '设计不同路径、算法或实现的备用模块/系统，在故障时切换；相同软件副本不能消除共同软件缺陷。' },
        { text: '成本权衡', details: '容错提高可用性但增加开发、验证、存储、内存、运行开销和系统复杂度。' },
      ] },
      { text: '9.4.2 检错技术', details: '故障发生后及时发现并报警，适合无需在线容错或不能使用冗余的部分；成本低但通常需人工或外部恢复。', children: [
        { text: '检测对象', details: '选择容易出错、影响大的检测点和有代表性、可判断的检测内容。' },
        { text: '检测延时', details: '故障到发现的时间必须满足业务处置要求，延时过长需更换检测点或方式。' },
        { text: '实现方式', details: '返回值范围检查、超时检测、状态标志、断言、校验和、心跳和一致性检查。' },
        { text: '处理方式', details: '停止并报警、局部隔离、降级运行、重试、重启或切换，取决于实时性和影响。' },
      ] },
      { text: '9.4.3 降低复杂度设计', details: '软件复杂性是缺陷的重要根源，应通过简化结构、缩短代码、优化数据流和降低模块耦合提高可靠性。', children: [
        { text: '模块复杂性', details: '模块内部数据流、控制路径、程序长度和状态数量。' },
        { text: '结构复杂性', details: '模块之间的依赖、调用、共享数据和交互程度。' },
        { text: '控制手段', details: '模块化、信息隐藏、高内聚低耦合、限制循环复杂度、清晰接口和自动静态分析。' },
        { text: '辅助分析', details: '可借鉴 FTA 故障树分析和 FMEA 失效模式与效应分析识别关键失效，但需适应软件特性。' },
      ] },
      { text: '9.4.4 系统配置技术', details: '通过系统级冗余和故障转移提高整体可靠性。', children: [
        { text: '双机热备', details: '两台服务器和共享/同步数据组成，心跳检测主机故障并把资源切换到备机。', children: [
          { text: 'Active/Standby', details: '主机工作、备机待命，恢复快但备用资源利用率较低。' },
          { text: '双机互备', details: '两台分别运行不同应用并互为备机，故障时接管对方负载，对性能要求高。' },
          { text: '双机双工', details: '两台同时运行相同应用，提供负载均衡和互备，属于集群形式。' },
        ] },
        { text: '服务器集群', details: '多台独立服务器组成单一系统，统一对外提供服务；节点或服务故障时由其他节点自动接管。' },
        { text: '系统级注意点', details: '避免共享存储、网络、仲裁和配置成为单点故障，并定期演练故障转移。' },
      ] },
    ] },
    { text: '9.5 软件可靠性测试', details: '以可靠性目标和运行剖面为基础设计并实施测试，收集可用于统计评价的失效数据。', children: [
      { text: '9.5.1 测试概述', details: '主要活动为确定可靠性目标、开发运行剖面、设计用例、实施测试和分析结果；最好在受控自动化环境由专业人员完成。' },
      { text: '9.5.2 定义软件运行剖面', details: '描述不同用户、操作和输入在实际使用中的发生概率。', children: [
        { text: '马尔可夫链使用模型', details: '状态表示软件使用状态，弧表示激励导致的转换，转换概率反映典型用户行为。' },
        { text: '用户级分层', details: '按谁或什么激励系统划分用户类别，分析不同用户的使用方式。' },
        { text: '用法级分层', details: '按系统能执行的操作和功能划分使用行为。' },
        { text: '概率来源优先级', details: '实际现场/旧版本数据最好，其次是观察与访谈、原型测试、领域专家；均匀分配是最弱方案。' },
        { text: '关键路径补充', details: '低频但高风险的起飞、降落、边界和异常路径不能只按自然概率抽样，应增加专门测试。' },
      ] },
      { text: '9.5.3 可靠性测试用例设计', details: '根据运行剖面随机或分层抽取输入，使测试频率接近实际使用，同时补充关键、边界和故障场景。', children: [
        { text: '统计抽样用例', details: '用于估计真实运行可靠性，选择概率应与运行剖面一致。' },
        { text: '高风险补充用例', details: '针对严重失效、低频关键操作、边界条件和历史缺陷进行强化。' },
        { text: '可判定性', details: '必须明确预期结果和失效判据；难以人工逐项验证时采用自动校验、过滤、断言或形式化证明。' },
      ] },
      { text: '9.5.4 可靠性测试实施', details: '在合同、需求和用户文档规定的配置下测试程序、数据及可靠性相关文档。', children: [
        { text: '累计运行时间', details: '可用多台计算机并行运行以增加累计测试时间和失效样本。' },
        { text: '错误报告与纠正系统', details: '建立错误报告、分析、修复、复测和措施跟踪的闭环。' },
        { text: '四类时间数据', details: '失效时间、失效间隔时间、分组时间内失效数、分组时间累积失效数，可相互转换。' },
        { text: '测试记录', details: '记录测试时间、用例标识、所有结果和失效数据、测试人员。' },
        { text: '测试报告', details: '包括产品标识、环境配置、测试依据、结果、问题和时间，为可靠性评价提供可审计数据。' },
      ] },
    ] },
    { text: '9.6 软件可靠性评价', details: '选择适用数学模型，处理测试和运行失效数据，评估当前可靠性、预测目标达成时间并支持发布决策。', children: [
      { text: '9.6.1 评价概述', details: '评价可用于确认是否终止测试/发布、预计达到目标所需时间和工作量，以及验证最终产品可靠性。', children: [
        { text: '三项核心工作', details: '选择可靠性模型、收集可靠性数据、进行可靠性评估和预测。' },
      ] },
      { text: '9.6.2 可靠性模型选择', details: '没有适合所有系统的最佳模型，必须按系统和评价目的选择。', children: [
        { text: '模型假设适用性', details: '逐条检查即时排错、失效独立、运行剖面稳定等假设与实际系统的差异。' },
        { text: '预测能力与质量', details: '优先选经过实践验证、成熟且对目标系统有良好预测表现的模型。' },
        { text: '输出是否满足需求', details: '需要的结果可能包括当前可靠度、MTTF、故障密度、目标日期和达到目标的成本。' },
        { text: '使用简便性', details: '数据易收集、模型易理解、工具易使用，投入不能超过可靠性计划预算。' },
      ] },
      { text: '9.6.3 可靠性数据收集', details: '可靠性数据以软件失效数据为主，应贯穿需求、设计、开发、测试和运行。', children: [
        { text: '主要困难', details: '术语规范不统一、收集缺少连续性、工具不足、数据不完整、质量和准确性难保证。' },
        { text: '改进措施', details: '及早确定模型与数据规范；制定计划并明确负责人；重视测试数据；使用数据库统一存储统计。' },
        { text: '数据质量优先', details: '不准确数据造成的评价误差可能大于模型本身误差，必须处理重复、漏报、误判和不完全修复。' },
      ] },
      { text: '9.6.4 可靠性评估和预测', details: '回答是否达到目标、何时可发布、还需投入多少、维护升级后的可靠性水平等问题。', children: [
        { text: '无失效不等于可靠度 1', details: '有限测试中没有观察到失效不能证明不存在缺陷；可在给定置信度下做保守估计。' },
        { text: '模型与统计分析结合', details: '以可靠性模型为主，并用图形分析和探索性数据分析补充、校验和修正。' },
        { text: '图形分析', details: '观察累积失效数、单位时间失效数和失效间隔时间的趋势。' },
        { text: 'EDA 探索性分析', details: '识别循环相关、短期失效激增和失效集中区间，发现修复引入缺陷、数据质量和时间定义问题。' },
        { text: '发布决策', details: '综合可靠性目标、置信度、残余风险、严重失效、修复成本和业务时机决定继续测试或发布。' },
      ] },
    ] },
  ],
};

const selectionResult = await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } });
const selection = JSON.parse(selectionResult.content[0].text);
const mapIdentifier = selection.mapIdentifier;
const anchorNodeIdentifier = process.env.FREEPLANE_ROOT_NODE_ID || selection.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER9_NODE_ID;
if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: { mapIdentifier, userSummary: '创建第9章软件可靠性详细思维导图', anchorPlacement: { anchorNodeIdentifier, placementMode: 'LAST_CHILD' }, nodes: [{ index: 0, parentIndex: -1, content: c(chapter9.text, chapter9.details), foldingState: 'UNFOLD' }] } });
  const result = await tool('searchNodes', { request: { mapIdentifier, queryText: chapter9.text, matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const payload = JSON.parse(result.content[0].text);
  const matches = payload.items || payload.nodes || payload.results || [];
  chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error('Cannot locate chapter 9 root');
}
for (const branch of chapter9.children) await tool('createNodes', { request: { mapIdentifier, userSummary: `导入${branch.text}`, anchorPlacement: { anchorNodeIdentifier: chapterNodeIdentifier, placementMode: 'LAST_CHILD' }, nodes: flatten(branch) } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, chapter: chapter9.text }, null, 2));
