const endpoint = process.env.FREEPLANE_MCP_URL || 'http://127.0.0.1:6298/';
const token = process.env.FREEPLANE_MCP_TOKEN;
if (!token) throw new Error('Set FREEPLANE_MCP_TOKEN before running this script.');
let requestId=1;
async function mcp(method,params){const r=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:requestId++,method,params})});const b=await r.text();if(!r.ok)throw Error(`${method}: ${r.status} ${b}`);const p=JSON.parse(b);if(p.error)throw Error(JSON.stringify(p.error));return p.result;}
const tool=(name,args)=>mcp('tools/call',{name,arguments:args});
const c=(text,details)=>details?{text,details}:{text};
function flatten(branch){const a=[];function v(x,p){const i=a.length;a.push({index:i,parentIndex:p,content:c(x.text,x.details),...(x.children?.length?{foldingState:'UNFOLD'}:{})});for(const y of x.children||[])v(y,i);}v(branch,-1);return a;}
const chapter6={text:'第6章 数据库设计基础知识',details:'依据教材第6章（218-247页）整理：数据库概念、关系理论、数据库设计、应用接口和 NoSQL。',children:[
 {text:'6.1 数据库基本概念',details:'数据库是长期存储、有组织、可共享的数据集合；数据库系统由数据、DBMS、应用和管理人员构成。',children:[
  {text:'6.1.1 数据库技术的发展',details:'经历人工管理、文件系统、数据库系统、分布式/面向对象数据库和大数据/云数据库阶段。',children:[{text:'人工管理阶段',details:'数据与程序紧密绑定，冗余大、共享差、维护困难。'},{text:'文件系统阶段',details:'数据独立成文件，程序通过文件接口访问；仍存在数据冗余、不一致和缺少统一控制。'},{text:'数据库系统阶段',details:'以 DBMS 统一管理，提供数据独立性、共享、并发控制、完整性和安全。'},{text:'新型数据库阶段',details:'面向对象、分布式、并行、数据仓库、云数据库和 NoSQL 适应复杂数据与海量访问。'}]},
  {text:'6.1.2 数据模型',details:'数据模型描述数据、数据联系、语义约束和操作，是数据库设计的基础。',children:[{text:'概念模型',details:'面向用户和现实世界，常用 ER 模型表达实体、属性和联系。'},{text:'逻辑模型',details:'面向 DBMS，主要有层次、网状、关系、面向对象模型。'},{text:'物理模型',details:'面向存储实现，描述文件组织、索引、分区、存取路径和存储设备。'},{text:'三要素',details:'数据结构、数据操作、数据完整性约束。'}]},
  {text:'6.1.3 数据库管理系统 DBMS',details:'位于用户/应用与操作系统之间，负责定义、操纵、控制、维护和保护数据库。',children:[{text:'主要功能',details:'数据定义、数据操纵、查询优化、事务管理、并发控制、恢复、完整性、安全、存储管理和数据字典。'},{text:'系统组成',details:'语言处理器、查询处理器、存储管理器、事务管理器、缓冲管理器和数据库。'},{text:'DBMS 用户',details:'最终用户、应用程序员、数据库管理员 DBA 和系统开发/维护人员。'}]},
  {text:'6.1.4 数据库三级模式',details:'外模式、概念模式、内模式构成数据库抽象层次，并通过两级映像实现数据独立性。',children:[{text:'外模式/用户模式',details:'用户或应用可见的局部逻辑结构，一个数据库可有多个外模式。'},{text:'概念模式/逻辑模式',details:'全体数据的逻辑结构和联系，描述完整数据库。'},{text:'内模式/存储模式',details:'数据的物理存储组织、索引和存取路径。'},{text:'外-概念映像',details:'保证逻辑数据独立性，概念模式变化时尽量不改外模式和应用。'},{text:'概念-内映像',details:'保证物理数据独立性，存储结构变化时不改概念模式。'}]}
 ]},
 {text:'6.2 关系数据库',details:'关系模型用二维表表示实体和联系，理论基础是关系代数、关系演算、函数依赖和规范化。',children:[
  {text:'6.2.1 关系数据库基本概念',details:'关系是一张表，元组是行，属性是列，域是属性取值范围。',children:[{text:'候选键/主键',details:'候选键能唯一标识元组；选定的候选键为主键，主键值不能为空。'},{text:'外键',details:'一个关系的属性引用另一个关系的主键，用于表达联系并维护参照完整性。'},{text:'关系完整性',details:'实体完整性：主键非空且唯一；参照完整性：外键必须为空或匹配被引用主键；用户定义完整性：业务约束。'},{text:'关系模式',details:'关系名及其属性集合；关系实例是某一时刻满足约束的元组集合。'}]},
  {text:'6.2.2 关系运算',details:'关系代数通过运算组合关系，结果仍为关系。',children:[{text:'传统集合运算',details:'并、交、差、笛卡儿积；并交差要求相容关系。'},{text:'专门关系运算',details:'选择按行筛选，投影按列筛选，连接按条件合并，除法用于“全部满足”类查询。'},{text:'连接类型',details:'等值连接、自然连接、外连接；外连接保留未匹配元组。'},{text:'关系演算',details:'以谓词逻辑描述查询条件，元组演算面向元组，域演算面向属性值。'}]},
  {text:'6.2.3 关系数据库设计基本理论',details:'函数依赖揭示属性间约束，规范化通过分解减少冗余和更新异常。',children:[{text:'函数依赖',details:'X→Y 表示 X 的值唯一决定 Y；完全函数依赖、部分函数依赖、传递函数依赖是规范化分析重点。'},{text:'候选键求解',details:'根据函数依赖计算属性闭包，判断超键、候选键和主属性。'},{text:'1NF',details:'属性值不可再分，关系中每个分量必须是原子值。'},{text:'2NF',details:'在 1NF 基础上，非主属性完全依赖候选键，消除对组合键的部分依赖。'},{text:'3NF',details:'在 2NF 基础上，非主属性不传递依赖候选键。'},{text:'BCNF',details:'每个决定因素都是候选键，要求通常强于 3NF。'},{text:'规范化权衡',details:'分解可减少冗余和异常，但连接代价增加；反规范化可提高查询性能，需控制一致性风险。'}]}
 ]},
 {text:'6.3 数据库设计',details:'数据库设计从需求出发，经过需求分析、概念设计、逻辑设计、物理设计、实施和运行维护。',children:[
  {text:'6.3.1 基本步骤',details:'需求分析→概念结构设计→逻辑结构设计→物理结构设计→数据库实施→运行维护；各阶段反复验证和迭代。'},
  {text:'6.3.2 数据需求分析',details:'收集数据、处理和约束，识别实体、属性、联系、业务规则、数据量、增长率、访问频率和安全需求。'},
  {text:'6.3.3 概念结构设计',details:'用 ER 模型建立独立于 DBMS 的概念模式。',children:[{text:'实体',details:'具有相同属性和行为的对象集合。'},{text:'属性',details:'实体特征；可分简单/复合、单值/多值、派生属性。'},{text:'联系',details:'实体间关联，常见 1:1、1:N、M:N；联系也可有属性。'},{text:'ER 合并与优化',details:'消除命名冲突、结构冲突和冗余，统一局部视图，检查完整性和可实现性。'}]},
  {text:'6.3.4 逻辑结构设计',details:'将 ER 模型转换为目标 DBMS 支持的逻辑模型，关系模型中实体和联系通常转换为关系及外键。',children:[{text:'转换规则',details:'实体转关系；1:1 可合并或在一方加外键；1:N 外键放在 N 方；M:N 建立联系关系。'},{text:'模式优化',details:'规范化、分解、合并和视图设计，保证无损连接和依赖保持。'},{text:'完整性设计',details:'主键、外键、唯一、非空、检查约束和触发器。'}]},
  {text:'6.3.5 物理设计',details:'确定存储结构和访问路径，使空间、时间、吞吐、并发和安全目标平衡。',children:[{text:'存储组织',details:'文件、页、记录、分区、聚簇和表空间的组织。'},{text:'索引设计',details:'B+树适合范围查询，哈希适合等值查询；索引提高读性能但增加空间和更新成本。'},{text:'性能设计',details:'估算数据量和增长，优化查询、分区、缓存、并发、I/O 和备份窗口。'}]},
  {text:'6.3.6 数据库实施',details:'建立数据库、装载数据、编写应用、定义安全策略、测试事务和性能并上线。',children:[{text:'数据装载',details:'数据清洗、转换、校验、批量导入和初始化。'},{text:'测试',details:'功能、完整性、并发、恢复、安全、容量和性能测试。'},{text:'切换上线',details:'制定迁移、回滚、停机和应急方案，核对新旧系统数据。'}]},
  {text:'6.3.7 运行维护',details:'监控、备份恢复、性能调优、故障处理、权限审计、容量规划和版本升级。'}
 ]},
 {text:'6.4 应用程序与数据库的交互',details:'应用通过不同层次的接口访问数据库；接口选择影响可移植性、性能、开发效率和维护成本。',children:[
  {text:'库函数级访问接口',details:'使用 DBMS/驱动提供的函数调用连接、执行 SQL、取结果和管理事务；灵活但与具体产品耦合。'},
  {text:'嵌入式 SQL',details:'将 SQL 嵌入宿主语言，由预编译器转换；静态 SQL 效率和检查较好，动态 SQL 灵活。',children:[{text:'主变量/游标',details:'主变量交换宿主语言和 SQL 数据；游标逐行处理查询结果。'},{text:'事务控制',details:'COMMIT 提交，ROLLBACK 回滚，配合异常处理保持一致性。'}]},
  {text:'通用数据接口标准',details:'ODBC、JDBC 等通过统一 API 屏蔽数据库差异；提高移植性，但可能增加中间层开销。'},
  {text:'ORM 访问接口',details:'把对象映射为关系表和 SQL，业务代码面向对象，降低数据库知识要求。',children:[{text:'Hibernate',details:'全自动、功能强、复杂且学习成本较高。'},{text:'MyBatis',details:'半自动，SQL 可控、灵活，需开发者关注映射和 SQL。'},{text:'JPA',details:'Java 持久化标准，通过注解或 XML 描述对象-关系映射。'}]}
 ]},
 {text:'6.5 NoSQL 数据库',details:'NoSQL 泛指非关系型数据库，不以传统关系模型和完整 ACID 为唯一目标，适合海量、分布式和灵活结构数据。',children:[
  {text:'6.5.1 分类与特点',details:'按数据结构分为列式、键值、文档和图数据库。',children:[{text:'列式数据库',details:'按列族组织海量分布式数据，适合稀疏表和大规模写入；如 Cassandra、HBase。'},{text:'键值数据库',details:'以 key 定位 value，结构简单、读写快、易部署；复杂条件查询能力较弱；如 Redis。'},{text:'文档数据库',details:'以 JSON 等半结构化文档保存嵌套数据，适合网页、内容和变化结构；如 MongoDB、CouchDB。'},{text:'图数据库',details:'以节点和边表达关系，适合社交、路径、推荐和网络分析；如 Neo4j。'},{text:'共同特点',details:'易扩展、海量高性能、灵活模型、高可用，通常弱化跨实体关系和强事务。'},{text:'适用边界',details:'选择 NoSQL 需权衡一致性、事务、查询复杂度、扩展方式、运维能力和生态。'}]},
  {text:'6.5.2 NoSQL 体系框架',details:'应用通过统一 API 访问 NoSQL 集群，底层负责分片、复制、路由、故障转移和持久化。',children:[{text:'数据访问层',details:'REST、驱动或专用查询 API；很多产品没有统一 SQL。'},{text:'集群管理',details:'节点发现、分片/分区、负载均衡、复制、副本选举和故障转移。'},{text:'一致性与可用性',details:'通过副本、最终一致性、Quorum、冲突解决和 CAP 权衡可用性与一致性。'},{text:'存储层',details:'内存、日志结构、文件/对象存储；关注持久化、压缩、备份和恢复。'}]}
 ]}
]};

const chapter7={text:'第7章 系统架构设计基础知识',details:'依据教材第7章（248-269页）整理：软件架构概念、架构驱动开发、架构风格、架构复用和特定领域架构。',children:[
 {text:'7.1 软件架构概念',details:'软件架构是系统组织结构及其行为、构件、连接件和约束的抽象，决定系统主要质量属性。',children:[
  {text:'7.1.1 软件架构定义',details:'架构关注构件、构件之间的关系、交互机制、外部可见属性和设计原则；不同视角可形成不同架构视图。',children:[{text:'构件',details:'可独立部署或替换的计算/数据单元，承担职责。'},{text:'连接件',details:'描述构件交互的机制，如调用、消息、共享数据、事件和协议。'},{text:'配置',details:'构件和连接件的组织方式及拓扑。'},{text:'约束',details:'对结构、行为、技术和质量属性的限制。'}]},
  {text:'7.1.2 架构设计与生命周期',details:'架构活动贯穿需求、设计、实现、测试、部署、维护和演化。',children:[{text:'需求阶段',details:'识别功能需求、约束、涉众和质量属性场景，形成架构驱动因素。'},{text:'设计阶段',details:'选择风格和模式，分解构件、定义接口，验证关键质量属性。'},{text:'实现阶段',details:'架构到代码和部署映射，管理架构偏离和技术债务。'},{text:'运行演化',details:'根据新需求、缺陷、环境和技术变化演进架构，保持可追踪和一致。'}]},
  {text:'7.1.3 软件架构重要性',details:'架构是沟通共同语言、早期决策载体、质量属性控制点、复用基础和项目风险管理抓手。',children:[{text:'沟通',details:'为客户、架构师、开发、测试和运维提供共同抽象。'},{text:'质量属性',details:'性能、可靠性、安全、可修改性等许多非功能属性在架构层决定。'},{text:'风险降低',details:'早期原型和架构评估可发现高风险技术和权衡。'},{text:'复用与产品线',details:'稳定架构和构件支持跨项目复用与快速交付。'}]}
 ]},
 {text:'7.2 基于架构的软件开发方法',details:'以架构为核心组织开发活动，通过需求、设计、文档、复审、实现和演化的闭环控制质量。',children:[
  {text:'7.2.1 设计方法概述',details:'架构设计需综合功能需求、质量属性、约束、已有资产、技术和组织因素；采用迭代、风险驱动和视图化表达。'},
  {text:'7.2.2 概念与术语',details:'架构驱动因素、构件、连接件、视图、视角、模式、架构决策、风险、敏感点和权衡点。'},
  {text:'7.2.3 基于架构的开发模型',details:'需求输入驱动架构设计；架构指导实现和测试；实现反馈架构演化，形成迭代闭环。',children:[{text:'核心循环',details:'架构需求→架构设计→架构文档→架构复审→架构实现→架构演化。'},{text:'迭代特点',details:'每次迭代处理部分需求和关键风险，逐步完善架构而非一次性设计。'}]},
  {text:'7.2.4 体系结构需求',details:'识别系统功能、质量属性、约束、涉众目标和架构驱动因素；将模糊质量要求转成可验证场景。'},
  {text:'7.2.5 体系结构设计',details:'选择架构风格/模式，识别构件和连接件，分配职责，定义接口和部署，进行权衡并记录决策。'},
  {text:'7.2.6 体系结构文档化',details:'使用多个视图描述架构，使不同涉众获得所需信息。',children:[{text:'常见视图',details:'逻辑视图、进程视图、开发/实现视图、物理/部署视图、用例/场景视图。'},{text:'文档内容',details:'目标与范围、约束、架构决策、构件职责、接口、交互、部署、质量属性和已知问题。'},{text:'文档原则',details:'准确、一致、完整、可追踪、分层表达并及时维护。'}]},
  {text:'7.2.7 体系结构复审',details:'由架构师、开发、测试、运维和业务代表共同检查架构是否满足需求，重点发现风险和不一致。'},
  {text:'7.2.8 体系结构实现',details:'将架构映射为代码、构件、配置和部署；通过原型、骨架系统和集成验证关键机制。'},
  {text:'7.2.9 体系结构演化',details:'需求、技术、组织和运行反馈推动架构变化；需分析影响、管理版本、保持兼容并控制技术债务。'}
 ]},
 {text:'7.3 软件架构风格',details:'架构风格是对构件、连接件、配置和约束的可复用抽象，决定系统组织和交互方式。',children:[
  {text:'7.3.1 风格概述',details:'风格不是具体系统架构，而是可重复的结构方案；选型需结合功能、质量属性、约束和团队能力。'},
  {text:'7.3.2 数据流体系结构',details:'数据由输入流经处理构件逐步变换为输出，核心是数据处理过程。',children:[{text:'批处理风格',details:'按固定顺序处理完整数据批，阶段间传递数据。'},{text:'管道-过滤器',details:'过滤器独立变换数据，管道传递数据；可组合、复用和并行，但需统一数据格式。'},{text:'优点与局限',details:'易理解、复用、并发和扩展；不适合强交互、共享状态和复杂事务。'}]},
  {text:'7.3.3 调用/返回风格',details:'通过显式调用和返回组织控制流，典型包括主程序-子程序、面向对象和分层风格。',children:[{text:'主程序-子程序',details:'顶层程序调用子程序，适合结构化分解。'},{text:'面向对象',details:'对象封装状态和操作，通过消息协作；支持封装、继承和多态。'},{text:'分层风格',details:'每层提供服务并调用下层，支持抽象和替换；开放/封闭分层有性能与封装权衡。'}]},
  {text:'7.3.4 以数据为中心',details:'中央数据存储由多个独立构件访问，数据模式和共享机制是架构核心。',children:[{text:'仓库风格',details:'中央仓库保存持久数据，客户端读写；便于共享和集中管理。'},{text:'黑板风格',details:'知识源根据黑板状态协作，适合复杂问题求解和不确定控制。'},{text:'风险',details:'中央数据模式变化影响广，共享并发、性能和安全成为关键。'}]},
  {text:'7.3.5 虚拟机风格',details:'用虚拟机或解释器提供抽象执行环境，屏蔽底层平台差异。',children:[{text:'解释器',details:'读取并执行中间表示或脚本，易移植、可扩展但运行效率较低。'},{text:'规则系统',details:'规则库、推理机和事实库组成，适合动态规则和专家知识。'},{text:'优点',details:'跨平台、隔离、安全控制和动态扩展；代价是性能和实现复杂度。'}]},
  {text:'7.3.6 独立构件风格',details:'构件通过消息、事件或服务接口异步交互，彼此松耦合。',children:[{text:'事件驱动',details:'事件源发布事件，订阅者响应；适合异步、扩展和集成。'},{text:'消息传递',details:'通过队列、发布订阅或请求响应解耦通信双方。'},{text:'优点与局限',details:'可扩展、可替换、容错和并发好；调试、时序、事务一致性和错误处理更复杂。'}]}
 ]},
 {text:'7.4 软件架构复用',details:'在新系统中重复使用已有架构知识、模式、构件和文档，减少开发成本、风险和交付时间。',children:[{text:'7.4.1 定义与分类',details:'复用对象可分为架构决策、架构模式、参考架构、构件、框架和产品线；可分为机会复用和系统化复用。'},{text:'7.4.2 复用原因',details:'提高生产率和质量、降低风险、统一技术路线、缩短上市时间、积累组织资产。'},{text:'7.4.3 复用对象与形式',details:'白盒复用需理解并修改内部；黑盒复用只依赖接口；灰盒介于两者之间；还可复用文档、测试和部署资产。'},{text:'7.4.4 基本过程',details:'识别需求与可复用资产→评估匹配度和代价→选择/检索→适配与组装→验证→沉淀新资产。',children:[{text:'复用障碍',details:'语义不匹配、接口不兼容、质量属性不满足、文档不足、许可证和组织流程问题。'},{text:'复用治理',details:'建立资产库、分类检索、版本管理、质量认证、示例和维护责任。'}]}]},
 {text:'7.5 特定领域软件体系结构 DSSA',details:'DSSA 面向特定应用领域，提取领域共性和可变性，形成领域模型、参考架构和可复用构件。',children:[{text:'7.5.1 DSSA 定义',details:'针对一个应用领域的体系结构，描述领域内系统的共同结构、功能、质量属性和变化点。'},{text:'7.5.2 基本活动',details:'领域分析、领域设计、领域实现。',children:[{text:'领域分析',details:'识别领域范围、术语、实体、共性、可变性、业务规则和领域模型。'},{text:'领域设计',details:'建立参考架构，确定子系统、构件、接口、变化点和质量属性。'},{text:'领域实现',details:'开发可复用构件、框架、模板、生成器和配置机制。'}]},{text:'7.5.3 参与人员',details:'领域专家、领域分析师、架构师、构件开发者、应用开发者、维护人员和管理者。'},{text:'7.5.4 建立过程',details:'领域范围界定→信息收集→领域建模→参考架构设计→构件开发→评估验证→资产发布与持续演化。'}]}
]};

const chapter8={text:'第8章 系统质量属性与架构评估',details:'依据教材第8章（271-304页）整理：质量属性、质量属性场景、架构评估概念、评估方法和 ATAM 实践。',children:[
 {text:'8.1 软件系统质量属性',details:'质量属性描述系统可观察的非功能特征，通常由架构结构、交互和关键决策决定。',children:[{text:'8.1.1 质量属性概念',details:'质量属性是利益相关者对系统功能之外特征的期望，如性能、可靠性、安全性、可修改性和可用性。',children:[{text:'外部质量属性',details:'用户和运行环境可直接观察，如响应时间、吞吐量、可用性和安全行为。'},{text:'内部质量属性',details:'开发和维护过程关注，如模块化、可测试性、可理解性和可移植性。'},{text:'质量属性冲突',details:'性能与可修改性、安全与易用性、可靠性与成本等常需权衡，不存在同时最优。'}]},{text:'8.1.2 面向架构评估的质量属性',details:'架构评估关注能通过架构决策分析的属性。',children:[{text:'性能',details:'系统对事件的响应能力，常用响应时间、吞吐量、容量、资源利用率和抖动度量。'},{text:'可用性',details:'系统在需要时可正常提供服务，关注故障检测、恢复、冗余、修复和降级。'},{text:'可靠性',details:'在规定条件和时间内正确完成规定功能，关注失效率、故障隔离、容错和数据一致性。'},{text:'安全性',details:'防止未授权访问、使用、修改、泄露和破坏，涉及认证、授权、机密性、完整性和审计。'},{text:'可修改性',details:'以可接受成本修改功能、数据、接口或质量属性；关注变化局部化、耦合和影响范围。'},{text:'可测试性',details:'以可接受成本验证系统行为；关注可观测性、可控性、隔离和自动化。'},{text:'可用性/易用性',details:'用户学习、操作和获得反馈的难易程度，架构需支持界面一致性和错误恢复。'},{text:'可移植性与互操作性',details:'跨平台迁移和与外部系统协作的能力，依赖标准接口、抽象和适配层。'}]},{text:'8.1.3 质量属性场景',details:'将模糊质量要求转化为可分析、可测试的场景。',children:[{text:'六要素',details:'刺激源、刺激、环境、制品、响应、响应度量。'},{text:'刺激源',details:'产生事件的用户、系统、设备、外部系统或故障。'},{text:'刺激',details:'进入系统的事件，如请求、变更、攻击、故障或数据峰值。'},{text:'环境',details:'刺激发生时的状态，如正常、启动、过载、维护或故障模式。'},{text:'制品',details:'被刺激的系统、构件、接口、数据或配置。'},{text:'响应与度量',details:'系统采取的动作及可量化结果，如 2 秒内响应、故障后 30 秒恢复。'},{text:'场景来源',details:'一般场景、具体场景和成长场景；具体场景用于评估，成长场景用于演化和未来需求。'}]}
 ]},
 {text:'8.2 系统架构评估',details:'架构评估在早期通过场景、模型、原型和分析识别风险，判断架构是否支持关键质量属性。',children:[{text:'8.2.1 重要概念',details:'风险、非风险、敏感点、权衡点是架构评估的核心产物。',children:[{text:'风险',details:'架构决策可能导致质量属性目标无法满足的潜在问题。'},{text:'非风险',details:'架构决策已被分析并表明不会妨碍质量属性的部分。'},{text:'敏感点',details:'某个架构决策或参数对质量属性有显著影响的点。'},{text:'权衡点',details:'同时影响多个质量属性的敏感点，体现架构权衡，如缓存既提高性能又增加一致性风险。'},{text:'效用树',details:'将业务目标分解为质量属性、具体场景和优先级，用于集中评估资源。'}]},{text:'8.2.2 系统架构评估方法',details:'常见方法包括基于场景、基于度量、基于模型和基于经验/检查表的方法。',children:[{text:'场景法',details:'从涉众场景出发分析架构对质量属性的支持，代表方法 SAAM、ATAM。'},{text:'度量法',details:'建立性能、可靠性、复杂度、耦合等指标，进行定量比较。'},{text:'模型法',details:'用排队模型、可靠性模型、状态模型、仿真和形式化分析预测质量。'},{text:'检查表/经验法',details:'由专家依据模式、原则和历史问题审查架构，成本低但依赖经验。'},{text:'评估时机',details:'越早越便宜；需求和架构决策稳定后、实现前最适合进行关键评估。'}]}
 ]},
 {text:'8.3 ATAM 方法架构评估实践',details:'ATAM（Architecture Tradeoff Analysis Method）通过质量属性场景和架构方法分析风险、敏感点和权衡点，强调多方参与和沟通。',children:[{text:'ATAM 参与者与输入',details:'评估团队、架构团队、项目管理者、开发/测试/运维代表和其他利益相关者；输入包括业务驱动因素、架构文档和质量属性需求。'},{text:'阶段1：演示 Presentation',details:'架构团队介绍业务目标、架构、约束和关键决策，建立共同理解。',children:[{text:'步骤1：ATAM 方法介绍',details:'说明评估目标、范围、流程、角色、时间安排和预期产物。'},{text:'步骤2：业务驱动因素介绍',details:'说明系统使命、主要功能、业务目标、约束、涉众、质量属性优先级和成功标准。'},{text:'步骤3：架构介绍',details:'介绍架构视图、构件、连接件、部署、关键技术、关键决策及其理由。'}]},{text:'阶段2：调查和分析',details:'从质量属性场景出发构建效用树，选择高优先级场景并分析架构方法。',children:[{text:'步骤4：识别架构方法',details:'列出影响质量属性的架构风格、模式、机制和关键设计决策。'},{text:'步骤5：生成质量属性效用树',details:'将业务驱动因素分解成质量属性、场景，按重要性和难度/风险排序，确定重点场景。'},{text:'步骤6：分析架构方法',details:'针对效用树中高优先级场景，检查架构是否支持目标，记录风险、非风险、敏感点和权衡点。'}]},{text:'阶段3：测试',details:'由利益相关者提出场景并投票排序，再针对高票场景重复分析。',children:[{text:'步骤7：头脑风暴和场景投票',details:'利益相关者提出具体场景，评估团队合并重复项并组织投票，得到最重要的质量属性场景。'},{text:'步骤8：分析架构方法',details:'针对投票高优先级场景创建分析问题、研究架构响应，识别安全/性能等方面的风险、非风险、敏感点和权衡点。'},{text:'典型问题',details:'是否允许未授权访问？是否保护数据机密性？是否能在要求时间内完成任务？'}]},{text:'阶段4：报告 ATAM',details:'向利益相关者汇总并呈现评估发现，形成可执行的架构改进输入。',children:[{text:'主要产物',details:'效用树、生成的场景、分析问题、风险和非风险、敏感点、权衡点、架构方法和改进建议。'},{text:'报告用途',details:'支持架构决策、风险处理、需求澄清、项目计划和后续复审；不是简单的“通过/不通过”。'}]},{text:'ATAM 易考总结',details:'核心链路：业务驱动因素→质量属性效用树→架构方法→场景投票→风险/非风险→敏感点/权衡点→报告。'}]}
]};

const chapters=[chapter6,chapter7,chapter8];
const selectionResult=await tool('getSelectedMapAndNodeIdentifiers',{request:{selectionCollectionMode:'SINGLE'}});const selection=JSON.parse(selectionResult.content[0].text);const mapIdentifier=selection.mapIdentifier;const anchorNodeIdentifier=process.env.FREEPLANE_ROOT_NODE_ID||selection.rootNodeIdentifier;
for(const chapter of chapters){let id=process.env[`FREEPLANE_CHAPTER${chapter.text.slice(1,2)}_NODE_ID`];if(!id){await tool('createNodes',{request:{mapIdentifier,userSummary:`创建${chapter.text}根节点`,anchorPlacement:{anchorNodeIdentifier,placementMode:'LAST_CHILD'},nodes:[{index:0,parentIndex:-1,content:c(chapter.text,chapter.details),foldingState:'UNFOLD'}]}});const q=await tool('searchNodes',{request:{mapIdentifier,queryText:chapter.text,matchingMode:'EQUALS',caseSensitivity:'CASE_SENSITIVE',limit:20}});const p=JSON.parse(q.content[0].text);const ms=p.items||p.nodes||p.results||[];id=ms.at(-1)?.nodeIdentifier;if(!id)throw Error(`Cannot locate ${chapter.text}`);}for(const branch of chapter.children)await tool('createNodes',{request:{mapIdentifier,userSummary:`导入${branch.text}`,anchorPlacement:{anchorNodeIdentifier:id,placementMode:'LAST_CHILD'},nodes:flatten(branch)} });}
console.log(JSON.stringify({mapIdentifier,chapters:chapters.map(x=>x.text)},null,2));
