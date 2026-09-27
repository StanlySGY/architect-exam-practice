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
    text: '5.1 软件工程',
    details: '软件工程用系统化、严格约束、可量化的工程方法开发、运行和维护软件，目标是提高质量、控制成本、降低风险。',
    children: [
      { text: '软件危机与工程化起源', details: '20 世纪 60 年代软件规模和复杂度增长，1968 年 NATO 会议提出软件危机，随后提出软件工程概念。', children: [
        { text: '危机表现', details: '进度难预测、成本难控制、功能难满足期望、质量无法保证、难维护、缺少文档。' },
        { text: '工程化要解决的问题', details: '把个人化编程转为有过程、有规范、有文档、有度量和可管理的软件生产。' },
      ] },
      { text: '软件工程定义', details: 'Boehm：设计构造程序及其开发/运行/维护文档；IEEE：将系统化、严格约束、可量化方法应用于软件开发运行维护，并研究这些方法；Bauer：以经济手段获得可靠软件的工程原则。' },
      { text: '软件过程 P-D-C-A', details: 'P（Plan）规格说明：规定功能和运行限制；D（Do）开发：实现规格；C（Check）确认：验证满足用户需求；A（Action）演进：运行中持续改进。' },
      { text: '软件生命周期与过程模型', details: '软件从需求、设计、开发到运行维护直至淘汰；过程模型为生命周期活动提供有序的工作规程。', children: [
        { text: '瀑布模型', details: '需求分析→系统设计→程序设计→编码实现→单元测试→集成测试→系统测试→运行维护；前一阶段输出是后一阶段输入，每阶段有里程碑审查。', children: [
          { text: '优点', details: '阶段边界清晰，便于组织管理、方法和工具研究，文档与评审明确。' },
          { text: '缺点', details: '需求完整正确难以一次确定；严格串行导致可运行系统反馈晚；假设每阶段一次性无遗漏完成，现实中不成立；迟来的变更代价大。' },
        ] },
        { text: '原型化模型', details: '先快速构造包含关键问题和大致功能/性能的原型，与用户反馈迭代，再确认需求并开发目标软件。', children: [
          { text: '原型开发途径', details: '模拟界面与交互；真正开发原型；参考一个或多个运行中的类似软件。' },
          { text: '适用条件', details: '用户认识模糊、交互/报表需求不确定；需要合适工具和环境，原型应逐步收敛。' },
          { text: '风险与类型', details: '大型系统原型可能复杂；抛弃型原型用于需求确认后废弃，演化性原型持续完善成为产品。' },
        ] },
        { text: '螺旋模型', details: '生命周期模型与原型模型结合，适合大型软件和高风险项目；每圈迭代产生更接近目标的新版本。', children: [
          { text: '四个活动', details: '目标设定（目标、约束、计划）→风险分析（识别、评估、解决）→开发与有效性验证→评审并决定是否进入下一回路。' },
          { text: '特点', details: '风险驱动、迭代逼近、可组合规格/过程/面向对象方法；若迭代不能收敛到可接受范围，项目可能夭折。' },
        ] },
      ] },
      { text: '敏捷模型', details: '面对需求快速变化和短交付周期，2001 年形成敏捷宣言；强调反馈、适应变化和持续交付。', children: [
        { text: '两大特点', details: '适应性而非预设性：欢迎变化并用反馈控制不可预测过程；面向人而非面向过程：发挥开发者创造力与技术判断。' },
        { text: '核心思想', details: '拥抱变化；以人为本并在无过程控制与繁琐控制之间平衡；迭代增量、小版本发布，按需求优先级和风险安排。' },
        { text: 'XP 极限编程', details: '轻量、灵巧但严谨；价值观为交流、朴素、反馈、勇气；将复杂过程拆为小周期，持续与客户沟通和调整。' },
        { text: 'Crystal 水晶系列', details: 'Cockburn 提出的人本敏捷系列；包含共同核心元素，并按项目规模和环境选择不同成员。' },
        { text: 'Scrum', details: '侧重项目管理；产品 Backlog 按商业价值排序，短周期 Sprint 从中选择 Sprint Backlog，每次交付潜在可交付增量。' },
        { text: 'FDD 特征驱动开发', details: '迭代模型，强调人、过程、技术；角色包括项目经理、首席架构师、开发经理、主程序员、程序员、领域专家。', children: [
          { text: '五个核心过程', details: '开发整体对象模型→构造特征列表→计划特征开发→特征设计→特征构建。' },
        ] },
      ] },
      { text: '统一过程模型 RUP', details: 'Rational 公司提出的重量级、指导性过程；提供指南、模板和实例，采用二维模型。', children: [
        { text: '九个核心工作流', details: '业务建模、需求、分析与设计、实现、测试、部署、配置与变更管理、项目管理、环境。' },
        { text: '四个阶段', details: '初始：产品愿景/业务模型/范围；细化：架构、计划、资源；构造：实现产品并演进需求架构计划；移交：交付用户。' },
        { text: '循环与迭代', details: '每个 Cycle 产生一个新版本；阶段由一个或多个 Iteration 组成，每次迭代针对不同用例进行完整分析、设计、实现、测试和部署。' },
        { text: '里程碑', details: '阶段结束前评估工作，未通过时决定取消项目或继续工作。' },
        { text: '核心概念', details: '角色（Who：职责）、活动（How：独立工作单元）、制品（What：活动产生的信息）、工作流（When：有意义的活动序列）。' },
        { text: 'RUP 特点', details: '用例驱动、以体系结构为中心、迭代与增量。' , children: [
          { text: '4+1 视图', details: '用例视图（行为）；逻辑视图（功能）；实现视图（代码组织）；进程视图（性能、并发、吞吐）；部署视图（安装、拓扑）。' },
          { text: '迭代增量收益', details: '早期处理关键风险；以架构指导开发；更好应对需求变更；早得可运行系统；改善团队工作过程。' },
        ] },
      ] },
      { text: '软件能力成熟度模型 CMM/CMMI', details: 'CMM 是软件过程改进的概念模型；CMMI 由 SEI 组织开发，用于过程改进和软件能力评估，提供循序渐进的成熟度框架。', children: [
        { text: 'Level 1 初始级', details: '过程随意混乱，成功依赖个人能力和英雄主义；常能交付但经常超预算、超成本。' },
        { text: 'Level 2 已管理级', details: '策划、文档化、执行、监督和控制项目级过程，建立目标并管理成本、进度、质量。' },
        { text: 'Level 3 已定义级', details: '根据组织特点定义并制度化标准流程，积累项目经验和组织资产。' },
        { text: 'Level 4 量化管理级', details: '建立产品/服务质量和过程性能的定量目标；与三级的关键差异是过程性能可预测。' },
        { text: 'Level 5 优化级', details: '用多项目数据关注组织绩效，通过增量式和创新式过程、技术改进持续优化。' },
      ] },
    ],
  },
  {
    text: '5.2 需求工程',
    details: '需求工程系统描述待开发系统的行为特征和约束，目标是确定客户需求并定义系统全部外部特征，贯穿生命周期。',
    children: [
      { text: '需求层次与内容', details: '业务需求反映组织/客户高层目标；用户需求描述用户必须完成的任务和期望；功能需求定义系统必须实现的功能；非功能需求描述性能、质量、标准、接口和设计/过程约束。' },
      { text: '需求工程活动', details: '需求获取→需求分析（建立概念模型）→需求规格/文档化→需求确认与验证→需求管理。', children: [
        { text: '需求验证检查', details: '有效性、一致性、可行性、可验证性，以及完整性、正确性、可测试性。' },
        { text: '需求基线', details: '需求文档评审批准后形成基线，是客户与开发者关于计划功能和非功能需求的约定。' },
      ] },
      { text: '需求获取步骤', details: '需求陈述应说明“做什么”而不是“怎样做”。', children: [
        { text: '建立高层业务模型', details: '理解应用领域、描述用户业务过程并形成初始需求，后续迭代完善。' },
        { text: '定义范围和高层需求', details: '在所有涉众间建立共同愿景；用上下文图、顶层用例图表现边界和交互者。' },
        { text: '识别用户角色和代表', details: '涉众包括用户、客户、测试、维护、市场等；角色也可为外部应用或硬件。' },
        { text: '获取具体需求', details: '面向每类涉众取得完整、详细需求。' },
        { text: '确定业务工作流', details: '识别业务流程、规则和当前应用系统中的实际工作方式。' },
        { text: '整理与总结', details: '形成综合需求及实现条件和标准，覆盖功能、性能、环境、可靠性、安全、界面、资源、成本和进度。' },
      ] },
      { text: '需求获取方法', details: '方法要组合使用，并把信息转化为模型和可评审文档。', children: [
        { text: '用户面谈', details: '最常见、有效；需要计划准备，事后复查记录并澄清问题。' },
        { text: '需求专题讨论会', details: '集中涉众快速达成共识，解决冲突和行政问题，形成初步系统定义。' },
        { text: '问卷调查', details: '确认假设、收集统计倾向；不擅长探索新领域和追问模糊回答。' },
        { text: '现场观察', details: '观察用户实际执行业务，发现手工流程和原系统中的细节。' },
        { text: '原型化', details: '用快速原型和多次反馈处理界面、报表等高度不确定需求。' },
        { text: '头脑风暴', details: '针对新业务和高不确定流程发散创意，在碰撞中形成需求。' },
      ] },
      { text: '需求变更', details: '变更不可避免，但无控制变更会造成进度拖延、成本增加和质量下降；迟到变更影响尤其大。', children: [
        { text: '变更控制过程', details: '识别问题→分析问题并形成变更描述→影响分析和成本计算→决策→按过程模型实现并更新需求。' },
        { text: '计划驱动与敏捷差异', details: '计划驱动通常回溯需求分析、设计和实现；敏捷通常把变更纳入下一迭代。' },
        { text: '控制策略', details: '所有变更走流程；未批准不得设计实现；变更由 CCB 决定；相关风险承担者应知情；保留原始变更请求；集成变更可追踪到批准请求。' },
      ] },
      { text: '变更控制委员会 CCB', details: '项目所有者权益代表，是裁定接受哪些变更的决策机构而非作业机构；通常含用户、项目管理、开发、测试/质量、客户、文档、支持、配置管理代表。', children: [
        { text: '决策要点', details: '明确法定出席人数、决策机制、主席否决权；权衡收益（节省资金、满意度、竞争优势、提前上市）与代价（费用、延期、质量/功能下降）。' },
        { text: '决策后活动', details: '及时更新请求状态；重大变更需与管理层和客户重新协商交付时间、人力、低优先级需求和质量折中。' },
      ] },
      { text: '需求追踪', details: '建立需求与其他需求、架构、设计部件、源代码、测试、帮助文件和文档之间的联系，形成水平可追踪性。', children: [
        { text: '作用', details: '支持变更影响分析，确认实现需求所需工作；提供从需求到产品实现的查阅能力。' },
        { text: '追踪关系', details: '需求之间的依赖、需求到设计/代码/测试的链路，保证基线状态和实现覆盖。' },
      ] },
    ],
  },
  {
    text: '5.3 系统分析与设计',
    details: '包括结构化方法和面向对象方法；从需求模型建立分析模型、设计架构与模块，并落实到编码和数据持久化。',
    children: [
      { text: '结构化方法', details: '以数据流为中心，自顶向下、逐步求精、模块化，常分结构化分析、结构化设计、结构化编程和数据库设计。', children: [
        { text: '结构化分析 SA', details: '分析业务并建立当前物理 DFD→逻辑 DFD→新逻辑系统、数据字典和基元描述→人机接口及目标物理 DFD→成本/风险分析→方案选择→需求规约。' },
        { text: '数据流图 DFD', details: '用数据流、处理、数据存储、外部项表示数据在系统中的流动和变换。', children: [
          { text: '数据流', details: '箭头表示数据流向，标注内容；可描述来源、去向、平均流量和高峰期流量。' },
          { text: '处理', details: '变换输入数据为输出数据，需明确处理功能和处理要求。' },
          { text: '数据存储', details: '保存数据结构，是数据流来源/去向；记录数据量、访问频率、批处理/联机、检索/更新等方式。' },
          { text: '外部项', details: '数据源或终点，表示系统外部的数据提供者或使用者。' },
          { text: '构造层次', details: '明确目标和范围→顶层 DFD→第一层分解→层次结构→检查确认。' },
        ] },
        { text: '数据字典', details: '对 DFD 中数据项、结构、流、存储和处理过程做精确定义，是模型一致性基础。', children: [
          { text: '数据项/结构', details: '数据项是不可再分的基本数据单元；数据结构描述数据项的组合关系。' },
          { text: '数据流/存储', details: '数据流描述传输路径、来源、去向和流量；存储描述组成、数量和存取方式。' },
          { text: '处理过程', details: '描述名称、输入、输出和功能/频度/响应时间要求；“做什么”而不是“怎么做”。' },
        ] },
        { text: '结构化设计 SD', details: '以 SRS、DFD、数据字典为基础；概要设计确定系统结构、模块、功能、接口和调用关系，详细设计实现算法和局部数据结构。', children: [
          { text: '信息隐藏与抽象', details: '通过封装隐藏实现细节，模块作为黑盒；用过程、数据、控制抽象分层管理复杂性。' },
          { text: '模块化', details: '模块是可组合、分解和变换的基本单位，具有功能、逻辑、状态；先确定外部特性再确定内部特性。' },
          { text: '耦合（低到高）', details: '非直接耦合→数据耦合→标记耦合→控制耦合→通信耦合→公共耦合→内容耦合；应尽量降低模块间联系强度。' },
          { text: '内聚（高到低）', details: '功能内聚→顺序内聚→通信内聚→过程内聚→时间内聚→逻辑内聚→偶然内聚；应追求高内聚。' },
          { text: '设计原则', details: '高内聚、低耦合；使模块独立、可理解、可维护和易于单独开发。' },
          { text: '系统结构图 SC', details: '概要设计工具，表示功能实现、模块层次、调用和通信；可由 DFD 按规则导出初始结构。' },
          { text: '详细设计工具', details: '图形：流程图、PAD、NS 图；表格：操作与条件表；语言：伪码/PDL。PAD 结构清晰、支持自顶向下且可表示逻辑与数据结构。' },
        ] },
        { text: '结构化编程', details: '使用顺序、选择、循环三种基本控制结构进行自顶向下、逐步求精的程序设计，减少任意跳转并提高可读性。' },
        { text: '数据库设计中的 ER 模型', details: '实体是可区分事物；属性描述实体特性；联系表示实体内/实体间关联。联系类型包括 1:1、1:N、M:N。', children: [
          { text: 'ER 建模步骤', details: '确定实体集→选择属性→确定联系→确定关键字→确定联系基数并绘制 ER 图。' },
        ] },
      ] },
      { text: '面向对象方法', details: '把系统建模为相互协作的对象和类，类封装数据与操作，对象通过消息通信。', children: [
        { text: 'OOA 原则', details: '抽象、封装、继承、分类、聚合、关联、消息通信、粒度控制、行为分析。' },
        { text: '面向对象分析步骤', details: '确定对象和类→确定结构（泛化/特化等）→确定主题→确定属性→确定方法。' },
        { text: '面向对象设计', details: '将分析模型落实为协作类和对象，常见实体类、控制类、边界类。', children: [
          { text: '实体类', details: '保存业务领域中的持久信息和核心业务数据。' },
          { text: '控制类', details: '协调用例流程、业务逻辑和实体对象之间的交互。' },
          { text: '边界类', details: '处理用户界面、外部系统接口和输入输出边界。' },
        ] },
        { text: '面向对象编程 OOP', details: '对象是程序基本模块；基本特征为封装、继承、多态。', children: [
          { text: '封装', details: '把数据及相关操作组装为类/对象，隐藏实现细节，追求高内聚、低耦合。' },
          { text: '继承', details: '特殊类复用一般类属性和服务；可分单继承/多继承，也有取代、包含、受限、特化等分类。' },
          { text: '多态', details: '不同对象接收同一消息表现不同动作；调用方式相同而具体实现不同。' },
        ] },
        { text: '数据持久化与数据库', details: '把内存对象保存到永久存储；持久层使数据使用者与数据实体解耦。', children: [
          { text: 'ORM', details: '对象/关系映射，把对象持久化到关系数据库，代表框架有 Hibernate、iBatis、JDO。' },
          { text: 'Hibernate', details: '对 JDBC 做轻量对象封装，POJO 与表映射，可自动生成并执行 SQL。' },
          { text: 'iBatis', details: 'Java 对象到 SQL/参数/结果集映射，SQL 多由开发者编写，简单灵活。' },
          { text: 'JDO', details: 'Java 对象持久化标准 API，透明存储且可适配关系库、文件、XML、对象库等底层。' },
        ] },
      ] },
    ],
  },
  {
    text: '5.4 软件测试',
    details: '通过人工或自动手段运行/检查软件，比较预期与实际，发现错误、验证需求、支持集成和质量评估；测试贯穿整个开发过程。',
    children: [
      { text: '测试目的', details: '发现错误；验证软件成分由低层到高层的组装；确认满足任务书和系统定义文档；为质量模型和风险评估提供依据。' },
      { text: '按执行状态分类', details: '静态测试不运行程序，通过需求、设计、源码分析/审查发现错误；动态测试运行程序，构造用例、执行并分析结果。' },
      { text: '按内部结构分类', details: '黑盒、白盒、灰盒测试。', children: [
        { text: '黑盒测试', details: '不考虑内部结构，依据需求规格设计用例，检查功能和界面；需要量化测试行为。' },
        { text: '白盒测试', details: '依据程序逻辑和内部结构设计用例，检查路径和逻辑；常用控制流、数据流、路径、变异分析，覆盖语句/判定/分支/路径。' },
        { text: '灰盒测试', details: '介于黑盒和白盒之间，关注输出正确性也参考内部逻辑；比白盒高效、比黑盒适用更广但不完整。' },
      ] },
      { text: '按执行方式分类', details: '人工测试由人驱动；自动化测试在预设条件下自动运行被测程序并分析结果。' },
      { text: '测试阶段', details: '由局部到整体、由开发者验证到用户验收。', children: [
        { text: '单元测试', details: '针对模块发现功能不满足和编码错误；常先静态分析/代码审查，再结合黑盒用例与白盒覆盖，可靠性高的模块可要求组合/路径覆盖。' },
        { text: '集成测试', details: '对已按设计组装的模块测试，重点发现接口和结构组装问题；通常结合白盒与黑盒。' },
        { text: '系统测试', details: '通常采用黑盒验证软件需求；包含功能、性能、健壮性、安装/卸载、界面、压力、可靠性、安全性等；由独立测试组执行并进行回归测试。' },
        { text: '性能测试', details: '用工具模拟正常、峰值和异常负载；负载测试观察负载增加时指标变化，压力测试寻找瓶颈或不可接受性能点。' },
        { text: '验收测试', details: '交付前由用户依据需求、合同和技术协议验证有效性和可靠性；通过后可发布。' },
        { text: 'Alpha/Beta', details: 'Alpha 在开发环境或模拟环境由用户测试；Beta 在实际环境由多个用户测试并反馈错误。' },
        { text: 'A/B 测试', details: '随机让相似访客访问两个或多个版本，收集体验和业务数据，选择效果最佳版本。' },
        { text: 'Web 测试', details: '针对分布、异构、并发、平台无关的 Web 应用，需可靠验证浏览器端和服务器端功能/性能。' },
        { text: '链接测试', details: '验证链接是否指向正确页面、目标页面是否存在、系统是否存在孤立页面。' },
        { text: '表单测试', details: '验证提交按钮、成功反馈、服务器保存、后台解释使用、提交完整性、默认值和取值约束。' },
      ] },
    ],
  },
  {
    text: '5.5 净室软件工程（CSE）',
    details: '应用数学和统计学，以严格工程过程在测试前建立并验证正确性，追求零缺陷或接近零缺陷，而不是事后大量排错。',
    children: [
      { text: '核心哲学', details: '第一次正确书写代码增量，在测试前完成正确性验证，结合统计质量控制减少高成本缺陷消除。' },
      { text: '理论基础', details: '函数理论和抽样理论。', children: [
        { text: '函数理论', details: '程序可视为从所有可能输入序列（定义域）到输出集合（值域）的映射；规范是函数规范。', children: [
          { text: '完备性', details: '定义域每个输入都有至少一个输出；程序必须定义所有可能输入。' },
          { text: '一致性', details: '同一输入至多对应一个输出。' },
          { text: '正确性', details: '可基于完备性和一致性等函数性质进行推理验证。' },
        ] },
        { text: '抽样理论', details: '无法穷举所有软件使用情况，把可能使用情况视为总体，用统计学抽取样本测试并推断性能可靠性。' },
      ] },
      { text: '技术手段', details: '统计过程控制下的增量开发、基于函数的规范与设计、正确性验证、统计测试与软件认证。', children: [
        { text: '增量开发', details: '把整体过程分为小的累积增量，受控迭代；团队每次聚焦一部分工作。' },
        { text: '盒子结构', details: '黑盒（外部行为视图）→状态盒（有限状态机视图）→明盒（过程视图）；支持信息隐藏和实现分离。' },
        { text: '正确性验证', details: 'CSE 核心机制，用形式化推理在测试前发现和消除错误。' },
        { text: '统计测试与认证', details: '建立使用模型，从无限总体中生成随机测试样本，推导预期操作性能。' },
      ] },
      { text: '应用与缺点', details: 'IBM、NASA、美国陆军等实践显示质量和生产率收益；但理论化、数学要求高、验证耗时且成本高，传统模块测试缺失在现实环境中有风险。' },
    ],
  },
  {
    text: '5.6 基于构件的软件工程（CBSE）',
    details: '以可复用构件组装系统，体现“购买而不是重新构造”，将重点从实现转为集成，以降低开发和维护成本。',
    children: [
      { text: '构件特征', details: '用于 CBSE 的构件应具备可组装、可部署、文档化、独立、标准化特征。', children: [
        { text: '可组装型', details: '外部交互通过公开定义接口，封装自身信息。' },
        { text: '可部署性', details: '自包含、二进制形式，可在支持其构件模型的平台上独立运行，无需部署前编译。' },
        { text: '文档化', details: '完整文档使用户能够判断是否满足需求。' },
        { text: '独立性', details: '无特殊构件即可组装部署；若依赖服务必须明确声明。' },
        { text: '标准化', details: '遵循某种标准化构件模型以保证互操作性。' },
      ] },
      { text: '构件模型', details: '规定构件实现、接口、文档化、开发和部署标准；主流有 Web Services、EJB、.NET 模型。', children: [
        { text: '接口', details: '规定操作名、参数、异常等构件交互要素。' },
        { text: '使用信息与元数据', details: '提供全局唯一名字/句柄和接口、属性等元数据，用于发现服务和配置构件。' },
        { text: '部署', details: '规定如何打包为独立可执行实体及包内容、二进制组成。' },
        { text: '通用服务与容器', details: '平台服务支持分布式通信互操作；支持服务提供认证等共性能力；容器以接口和实现承载这些服务。' },
      ] },
      { text: 'CBSE 过程', details: '系统需求概览→识别候选构件→根据构件修改需求→体系结构设计→构件定制与适配→组装构件创建系统。', children: [
        { text: '与传统过程差异', details: '早期需要较完整需求以识别复用构件；根据可用构件调整需求；架构完成后再次搜索/精化；开发主要是集成和适配。' },
        { text: '架构阶段重要性', details: '选择构件模型和实现平台，模型与平台会决定并限制可选构件范围。' },
      ] },
      { text: '构件组装方式', details: '直接集成或使用胶水代码整合构件。', children: [
        { text: '顺序组装', details: '按顺序调用已有构件；前一构件输出必须与后一构件输入兼容。' },
        { text: '层次组装', details: '调用构件直接使用被调用构件服务；提供接口必须与请求接口兼容。' },
        { text: '叠加组装', details: '多个构件合并形成新构件并提供新接口，原构件互不依赖和调用。' },
        { text: '接口不兼容', details: '参数不兼容、操作不兼容、操作不完备。' },
        { text: '适配器', details: '将一个接口转换为另一个接口，解决构件不匹配；选择组装方式还需考虑功能、非功能需求和可替换性。' },
      ] },
    ],
  },
  {
    text: '5.7 软件项目管理',
    details: '围绕 People、Product、Process、Project 管理软件工程项目，使其在预定成本、进度和质量内完成。',
    children: [
      { text: '项目管理概述', details: '软件是纯知识产品，进度、质量、生产率难估计；系统复杂性使风险难预见。管理覆盖范围、风险、资源、任务、里程碑、工作量、成本和进度，从概念开始直到过程结束。' },
      { text: '软件进度管理', details: '确保项目按期完成，过程包括活动定义、活动排序、资源估计、历时估计、制定进度计划和进度控制。', children: [
        { text: '工作分解结构 WBS', details: '按可交付成果将项目分解为项目→任务→工作→日常活动；是进度、资源、成本、风险和采购计划基础。', children: [
          { text: '工作包', details: 'WBS 最底层、最低层次可交付成果，由唯一主体负责。' },
          { text: '常见分解方式', details: '按产品物理结构、产品/项目功能、实施过程、实施单位、项目目标或部分能力分解。' },
          { text: '分解要求', details: '工作包可控；不宜过细，树形一般不超过 6 层；每包有交付成果和明确完成标准；有利于责任分配。' },
        ] },
        { text: '任务活动图', details: '定义活动并明确前驱、持续时间、必须完成日期、里程碑/交付成果及先后关系；是进度和成本管理基础，常用甘特图展示。' },
      ] },
      { text: '软件配置管理 SCM', details: '识别、组织和控制修改，贯穿整个软件过程；目标是标识变更、控制变更、保证正确实现并报告，减少错误、提高效率。', children: [
        { text: '版本控制', details: '管理代码、配置文件、文档等变更，记录时间、人员和内容；支持版本追踪、多人并行、同步通信、分支与合并。' },
        { text: '变更控制', details: '不是阻止变更而是有序管理；变更来源包括客户范围/需求等外部要求和修复测试错误等内部要求，外部需求变更通常影响最大。' },
      ] },
      { text: '软件质量管理', details: '软件质量是软件与明确/隐含需求、开发标准和专业软件应有特征的一致程度。', children: [
        { text: '三组质量因素', details: '产品运行：正确性、健壮性、效率、完整性、可用性、风险；产品修改：可理解性、可维修性、灵活性、可测试性；产品转移：可移植性、可再用性、互运行性。' },
        { text: '软件质量保证 SQA', details: '建立有计划、有系统的方法，保证标准、步骤、实践和方法被采用；通过产品/活动评审审计使过程对管理层可见。', children: [
          { text: 'SQA 目标', details: '预防缺陷；尽早捕获刚引入的缺陷；作用于过程而非只查最终产品；贯穿所有活动。' },
          { text: 'SQA 任务', details: '审计与评审工作产品、工具和设备；发布质量报告；及时处理不符合问题。' },
          { text: '独立性', details: '以第三方角度监控计划、标准和规程执行，向开发人员和管理层提供质量与过程信息。' },
        ] },
        { text: '软件质量认证', details: '检验企业整体质量体系和持续提供合格软件的能力。', children: [
          { text: 'ISO 9000/9001', details: 'ISO 9000 是一组标准；ISO 9001 证实组织提供满足顾客和法规要求产品的能力，覆盖设计、开发、生产、安装和服务。' },
          { text: 'CMM/CMMI', details: '作为软件生产过程标准和成熟度评估标准，指导企业过程改进和能力认证。' },
        ] },
      ] },
      { text: '软件风险管理', details: '识别风险，评估发生概率和影响，制定规划管理风险；目标是预防风险，避免进度、成本和项目目标受损。', children: [
        { text: 'Boehm 体系', details: '风险估计：风险辨识、风险分析、风险排序；风险控制：风险管理计划、风险处理、风险监督。偏重理论。' },
        { text: 'Charette 体系', details: '风险分析：辨识、估计、评价；风险管理：计划、控制、监督。与 Boehm 接近，偏重理论。' },
        { text: 'CMU-SEI 体系', details: '包括 SRE、CRM（持续风险管理）、TRM（团队风险管理）并与 CMM 配合；基于实践的全面体系，把软件需求方纳入风险管理要素。' },
      ] },
    ],
  },
];

const selectionResult = await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } });
const selection = JSON.parse(selectionResult.content[0].text);
const mapIdentifier = selection.mapIdentifier;
const anchorNodeIdentifier = process.env.FREEPLANE_ROOT_NODE_ID || selection.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER5_NODE_ID;

if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: {
    mapIdentifier,
    userSummary: '创建《系统架构设计师教程（第2版）》第五章详细思维导图根节点',
    anchorPlacement: { anchorNodeIdentifier, placementMode: 'LAST_CHILD' },
    nodes: [{ index: 0, parentIndex: -1, content: c('第5章 软件工程基础知识', '依据《系统架构设计师教程（第2版）》第 5 章（175-217 页）整理：软件过程、需求工程、系统分析设计、测试、净室、构件工程和项目管理。'), foldingState: 'UNFOLD' }],
  } });
  const lookup = await tool('searchNodes', { request: { mapIdentifier, queryText: '第5章 软件工程基础知识', matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const payload = JSON.parse(lookup.content[0].text);
  const matches = payload.items || payload.nodes || payload.results || [];
  chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error(`Cannot locate chapter 5 root: ${lookup.content[0].text}`);
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

const verification = await tool('readNodesWithDescendantsAsPlainText', { request: { mapIdentifier, nodeIdentifiers: [chapterNodeIdentifier], fullContentDepth: 5, additionalSummaryDepth: 0, maxCharacters: 120000 } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, createdNodeCount: created, verification: verification.content[0].text }, null, 2));
