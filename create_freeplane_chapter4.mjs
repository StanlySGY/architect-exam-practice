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
    text: '4.1 信息安全基础知识',
    details: '信息安全保障信息及其处理、传输、存储和使用过程，核心是保护机密性、完整性、可用性，并使信息流和安全事件可控制、可追查。',
    children: [
      { text: '4.1.1 信息安全的概念', details: '信息安全包含五个基本要素，保护范围包括设备、数据、内容和行为。', children: [
        { text: '五个基本要素', details: '机密性、完整性、可用性、可控性、可审查性。', children: [
          { text: '机密性', details: '确保信息不暴露给未授权实体或进程；典型手段是身份认证、访问控制和加密。' },
          { text: '完整性', details: '只有获准主体才能修改信息，并能发现数据是否被篡改；典型手段是摘要、MAC、数字签名和权限控制。' },
          { text: '可用性', details: '授权实体需要时能够访问信息和服务；重点防范故障、资源耗尽和拒绝服务攻击。' },
          { text: '可控性', details: '能够控制授权范围内的信息流向和行为方式，避免信息越权传播或违规使用。' },
          { text: '可审查性', details: '记录并追踪安全相关行为，为事件调查、责任认定和合规审计提供依据。' },
        ] },
        { text: '设备安全', details: '设备是信息系统安全的物质基础。', children: [
          { text: '稳定性', details: '设备在一定时间内不发生故障的概率。' },
          { text: '可靠性', details: '设备在一定时间内正常执行规定任务的概率。' },
          { text: '可用性', details: '设备处于可正常使用状态的概率；常与维修时间和故障恢复能力相关。' },
        ] },
        { text: '数据安全', details: '保护数据免受未授权泄露、篡改和毁坏。', children: [
          { text: '数据秘密性', details: '数据不被未授权者知晓。' },
          { text: '数据完整性', details: '数据正确、真实、完整且未被非法改变。' },
          { text: '数据可用性', details: '授权者能够按需正常使用数据。' },
        ] },
        { text: '内容安全', details: '信息内容满足政治、法律和道德层面的要求，防止违法、有害或违背公共规范的信息传播。' },
        { text: '行为安全', details: '系统最终通过行为向用户提供服务，应保证行为过程和结果不危害信息安全。', children: [
          { text: '行为秘密性', details: '行为过程和结果不泄露需要保护的数据。' },
          { text: '行为完整性', details: '行为按预期执行，过程和结果不破坏数据完整性。' },
          { text: '行为可控性', details: '行为偏离预期时能够发现、限制、纠正和恢复。' },
        ] },
      ] },
      { text: '4.1.2 信息存储安全', details: '覆盖信息使用安全、安全监控、病毒防治、数据加密和防非法攻击等方面。', children: [
        { text: '用户标识与验证', details: '访问控制的基础，用于确认访问系统者的身份合法性。', children: [
          { text: '生物/物理特征', details: '签名、指纹、语音等；特征不易转移，但需考虑误识率、隐私和模板保护。' },
          { text: '持有物', details: '智能 IC 卡、磁条卡、令牌等；适合与口令组合形成多因素认证。' },
        ] },
        { text: '用户存取权限限制', details: '限制已进入系统的用户能够执行的操作，防止越权和敏感信息泄露。', children: [
          { text: '隔离控制法', details: '在数据处理环境周围建立屏障，包括物理隔离、时间隔离、逻辑隔离和密码技术隔离。' },
          { text: '限制权限法', details: '按用户类别、安全级别和职责授权，对目录、文件、缓冲区和临时数据实施最小权限。' },
        ] },
        { text: '系统安全监控', details: '持续监控进程、登录用户、文件权限和变化、安全配置、口令文件、启动文件、可执行文件及特权用户活动。', children: [
          { text: '日志与审计', details: '记录身份、时间、对象、动作和结果，支持告警、关联分析和事后追责。' },
          { text: '监控闭环', details: '发现异常→告警→响应处置→修复漏洞→复盘与规则优化。' },
        ] },
        { text: '计算机病毒', details: '具有隐蔽性、传染性、潜伏性、触发性和破坏性。', children: [
          { text: '技术防护', details: '安装可信防病毒软件、及时更新病毒库和安全补丁、检测敏感文件、使用防火墙并正确配置系统。' },
          { text: '管理防护', details: '强口令、不同账号不同口令、重要数据定期备份、谨慎处理邮件附件、重要网络物理隔离。' },
          { text: '恢复准备', details: '离线/异地备份、恢复演练和应急预案比单纯“查杀”更能降低业务损失。' },
        ] },
      ] },
      { text: '4.1.3 网络安全', details: '网络开放性、身份隐藏和跨域连接扩大了攻击面，安全工作需要同时处理漏洞、威胁和安全目标。', children: [
        { text: '网络安全漏洞', details: '系统弱点可能来自物理接入、特权软件恶意代码、软硬件不兼容组合以及不恰当的安全策略。', children: [
          { text: '物理安全性漏洞', details: '非授权设备或人员能够物理接入网络、主机、端口或介质。' },
          { text: '软件安全漏洞', details: '设计、编码、配置或后门问题可能让攻击者获取额外权限。' },
          { text: '不兼容使用漏洞', details: '单独安全的软硬件组合后产生新的信任边界、接口或配置缺陷。' },
          { text: '安全策略问题', details: '技术组件只有在正确策略、配置和启用条件下才能形成有效防护。' },
        ] },
        { text: '五类网络安全威胁', details: '非授权访问、信息泄露或丢失、破坏数据完整性、拒绝服务、通过网络传播病毒。', children: [
          { text: '非授权访问', details: '假冒、身份攻击、非法进入、合法用户越权等绕过或滥用访问控制的行为。' },
          { text: '信息泄露或丢失', details: '传输、存储或隐蔽信道造成敏感信息外泄，也可能通过流量、频度和长度分析推断信息。' },
          { text: '破坏数据完整性', details: '非法删除、修改、插入或重放信息，使系统产生错误或有利于攻击者的响应。' },
          { text: '拒绝服务', details: '消耗或破坏计算、网络和应用资源，使合法用户无法获得服务。' },
          { text: '网络病毒传播', details: '借助网络快速扩散恶意代码，影响范围和破坏性通常高于单机感染。' },
        ] },
        { text: '安全措施的目标', details: '访问控制、认证、完整性、审计/不可抵赖、保密。', children: [
          { text: '认证 vs 访问控制', details: '认证回答“你是谁/是否真实”；访问控制回答“你能做什么”。' },
          { text: '审计与不可抵赖', details: '通过完整、可信记录和签名证据，使交易事后可证实，通信方不能轻易否认。' },
        ] },
      ] },
    ],
  },
  {
    text: '4.2 信息系统安全的作用与意义',
    details: '信息安全事关个人权益、企业经营、社会稳定、国家安全和发展；攻击已从窃密、诈骗和破坏数据发展到长期潜伏、供应链渗透和影响物理设施。',
    children: [
      { text: '个人与社会层面', details: '防止隐私泄露、网络诈骗、有害信息传播和公共服务中断，保护财产、人身和社会秩序。' },
      { text: '组织与产业层面', details: '保护商业秘密、业务连续性、知识产权、品牌信誉和合规状态，避免直接经济损失与连锁风险。' },
      { text: '国家安全层面', details: '关键信息基础设施、国防、能源、交通、金融等受到攻击时可能造成现实世界的重大后果。' },
      { text: '安全与信息化关系', details: '安全是信息化持续发展的前提，信息化越深入，组织对信息系统的依赖和潜在损失越高。' },
      { text: '总体思路', details: '统筹发展与安全，以风险为导向，形成技术、组织和管理协同的纵深防御体系。' },
    ],
  },
  {
    text: '4.3 信息安全系统的组成框架',
    details: '完整的信息安全系统由技术体系、组织机构体系和管理体系共同构建；只有技术而无组织和制度无法长期有效。',
    children: [
      { text: '4.3.1 技术体系', details: '从基础设备到网络、操作系统、数据库和终端形成多层防护。', children: [
        { text: '基础安全与物理环境', details: '密码芯片、加密卡、身份识别卡；机房、建筑、电力、机械防护、电磁干扰和电磁泄漏防护。' },
        { text: '网络安全', details: '物理隔离、防火墙、访问控制、加密传输、认证、数字签名、摘要、隧道/VPN、病毒防范、上网行为管理和安全审计。' },
        { text: '操作系统安全', details: '正确配置、及时修补且无后门木马；机制包括标识鉴别、访问控制、最小特权、可信通路、运行保障、存储/文件保护和审计。' },
        { text: '数据库安全', details: '涵盖 DBMS 和数据库应用；关注物理/逻辑完整性、元素安全、审计、访问控制、认证、可用性、推理控制、多级保护和隐蔽通道。' },
        { text: '终端安全', details: '保护终端设备、接口、数据和通信；教材举例包括电话、传真和异步数据密码设备。' },
        { text: '纵深防御', details: '不同层的控制相互补偿：边界失守后仍有身份、主机、数据和审计防线。' },
      ] },
      { text: '4.3.2 组织机构体系', details: '由机构、岗位和人事管理构成组织保障。', children: [
        { text: '决策层', details: '确定安全战略、风险偏好、资源投入和重大事件决策。' },
        { text: '管理层', details: '制定制度和方案，组织风险、合规、运维、审计和应急管理。' },
        { text: '执行层', details: '落实配置、监控、测试、响应、备份和日常安全操作。' },
        { text: '岗位与职责分离', details: '按安全事务设置岗位，明确责任边界，对高风险操作实行最小权限、双人复核或相互制约。' },
        { text: '人员全生命周期', details: '覆盖入职、在职、调岗和离职的教育、考核、授权变更和安全监管。' },
      ] },
      { text: '4.3.3 管理体系', details: '“三分技术，七分管理”强调安全能力依赖持续管理。', children: [
        { text: '法律管理', details: '依据国家法律法规规范信息系统主体及其与外界关联的行为。' },
        { text: '制度管理', details: '根据安全需求建立组织内部规章、流程、标准、责任和监督机制。' },
        { text: '培训管理', details: '提升人员意识和技能，减少误操作、社会工程和制度执行偏差，是安全落地的前提。' },
      ] },
    ],
  },
  {
    text: '4.4 信息加解密技术',
    details: '密码技术把明文转换为密文并恢复，主要保护机密性，也可结合摘要、MAC 和签名保障完整性、认证与不可抵赖。',
    children: [
      { text: '4.4.1 数据加密', details: '密码学包括设计密码体制的密码编码学和研究破译的密码分析学。', children: [
        { text: '保密通信模型', details: '发送方计算 C=E(K,P) 得到密文；接收方计算 P=D(K,C) 恢复明文。算法可公开，安全性主要依赖密钥。' },
        { text: '无条件安全', details: '即使获得任意数量密文也没有足够信息确定明文；现实系统更多追求计算上安全。' },
        { text: '计算安全', details: '理论上可能破解，但在给定时间、算力和成本下不可行；密钥长度、算法强度和实现质量共同决定安全性。' },
        { text: 'Kerckhoffs 思想', details: '系统不应依赖算法保密，算法公开仍应安全，真正需要保护的是密钥。' },
      ] },
      { text: '4.4.2 对称密钥算法', details: '加密密钥与解密密钥相同或可直接相互推导；速度快、适合大批量数据，但密钥分配和管理困难。', children: [
        { text: 'DES', details: '64 位分组、有效密钥 56 位，16 轮核心变换；密钥空间已不足，易受穷举攻击，不宜用于现代新系统。' },
        { text: '3DES', details: '常用两个密钥执行加密-解密-加密（EDE），有效密钥强度约 112 位；兼容 DES 但速度约慢三倍，现多被 AES 替代。' },
        { text: 'IDEA', details: '128 位密钥、64 位分组、8 轮迭代，可软硬件实现，曾用于多种商业产品。' },
        { text: 'AES', details: 'Rijndael 算法，支持 128/192/256 位密钥，软硬件效率高，是现代常用分组密码标准。' },
        { text: '优点', details: '运算速度快、吞吐高、实现成熟，适合文件、数据库、磁盘和网络流量加密。' },
        { text: '缺点', details: '通信双方必须安全共享密钥；用户规模增长时密钥数量、更新、撤销和泄漏影响难管理。' },
      ] },
      { text: '4.4.3 非对称密钥算法', details: '使用不同的公钥和私钥；公钥可公开，私钥必须保密，难以由公钥推导私钥。', children: [
        { text: '保密通信', details: '发送方用接收方公钥加密，只有持有对应私钥的接收方可以解密。' },
        { text: '数字签名', details: '签名者用私钥产生签名，验证者用公钥验证来源和完整性；实际通常签名消息摘要而非直接“私钥加密全文”。' },
        { text: 'RSA', details: '安全性建立在大整数因数分解困难性上；公钥为(e,n)，私钥为(d,n)，可用于加密、签名和密钥交换相关机制。' },
        { text: '优点', details: '缓解共享密钥分配问题，支持数字签名、身份认证和不可抵赖。' },
        { text: '缺点', details: '计算开销大、速度慢，不适合直接加密大量数据；还需 PKI/证书确认公钥归属。' },
      ] },
      { text: '混合加密（考试归纳）', details: '非对称算法用于认证和安全分配随机会话密钥，对称算法用该会话密钥加密业务数据，兼顾密钥管理与性能。' },
      { text: '对称与非对称对比', details: '对称：同一密钥、速度快、密钥分配难；非对称：公私钥、速度慢、便于认证和密钥交换；工程中通常混合使用。' },
    ],
  },
  {
    text: '4.5 密钥管理技术',
    details: '密钥管理覆盖产生、分配、存储、使用、轮换、备份、恢复、撤销和销毁；密码算法再强，密钥管理失控仍会导致整体失效。',
    children: [
      { text: '4.5.1 对称密钥的分配与管理', details: '目标是自动、高效分配密钥并减少系统长期驻留密钥数量。', children: [
        { text: '密钥使用控制', details: '限制密钥用途，避免同一密钥被违规用于不同算法、方向或业务。', children: [
          { text: '密钥标签', details: '用标签位标识主密钥/会话密钥、加密/解密等用途；实现简单但长度和灵活性有限。' },
          { text: '控制矢量', details: '用可变长字段描述允许用途，经散列后与主密钥结合生成保护会话密钥的密钥，使密钥与用途绑定。' },
        ] },
        { text: '四种共享密钥分配方式', details: 'A 物理发送给 B；第三方分别物理发送；用已有共享密钥加密新密钥；通过各自与可信第三方的保密信道分配。' },
        { text: '无中心方式的规模问题', details: 'N 个用户两两通信最多需 N(N-1)/2 个共享密钥，分配、更新和泄漏控制成本高。' },
        { text: 'KDC 密钥分配中心', details: '每个用户仅与 KDC 共享一个主密钥；KDC 为通信双方产生临时会话密钥，通信结束后销毁。', children: [
          { text: '主密钥', details: '用户与 KDC 长期共享，用于安全分配会话密钥；N 个用户只需 N 个主密钥。' },
          { text: '会话密钥', details: '仅用于一次或一段时间的通信，缩小长期泄漏影响。' },
          { text: '分层 KDC', details: '小范围设置本地 KDC，再由全局 KDC 连接，减少分发压力并把伪造 KDC 的危害限制在局部。' },
          { text: '有效期权衡', details: '轮换越频繁通常越安全，但会增加网络负担和通信延迟。' },
        ] },
      ] },
      { text: '4.5.2 公钥体制的密钥管理', details: '核心问题不是保密公钥，而是可信地确认“公钥属于谁”。', children: [
        { text: '公开发布', details: '用户直接广播或附带公钥，简单但任何人可能冒名发布伪造公钥。' },
        { text: '公用目录表', details: '可信管理员维护用户名与公钥的动态目录；便于查询和更新，但目录或管理员密钥失陷会影响全局。' },
        { text: '公钥管理机构', details: '用户每次请求公钥，由管理机构签名应答；控制严密但容易成为性能瓶颈和集中攻击目标。' },
        { text: '公钥证书', details: 'CA 用私钥签发含主体身份、公钥、有效期等信息的证书；接收方用 CA 公钥验证，无需每次在线联系管理机构。', children: [
          { text: '证书解决的问题', details: '把身份与公钥可信绑定，防止中间人用自己的公钥冒充他人。' },
          { text: '证书生命周期', details: '申请、签发、发布、使用、更新、撤销和过期；验证还需检查信任链、有效期和撤销状态。' },
        ] },
      ] },
      { text: '4.5.3 公钥加密分配对称密钥', details: '双方先可信交换公钥，再通过随机数完成相互认证，用公钥机制保护会话密钥，随后用对称算法进行高效通信。', children: [
        { text: '随机数/Nonce', details: '标识一次协议运行，防止旧报文重放并帮助确认响应的新鲜性。' },
        { text: '保密性', details: '会话密钥用接收方公钥保护，只有接收方私钥可解密。' },
        { text: '认证性', details: '结合发送方私钥签名或认证信息，证明会话密钥来自预期发送者。' },
        { text: '典型思想', details: '公钥算法解决认证与密钥分配，对称算法承担后续大数据量加密。' },
      ] },
    ],
  },
  {
    text: '4.6 访问控制及数字签名技术',
    details: '访问控制约束主体对客体的操作，数字签名证明消息来源和完整性，并支持不可抵赖。',
    children: [
      { text: '4.6.1 访问控制技术', details: '访问控制由主体、客体和控制策略构成，并通过认证、策略实施和审计形成闭环。', children: [
        { text: '主体 Subject', details: '执行访问动作的主动实体，可以是用户、用户组、终端、应用、服务或进程。' },
        { text: '客体 Object', details: '接受访问的被动实体，可以是文件、记录、数据库、设备、服务或其他信息资源。' },
        { text: '控制策略', details: '规定主体可对客体执行的操作以及约束条件，例如读、写、执行和管理。' },
        { text: '三个实施环节', details: '认证确认身份；策略实现执行授权规则；审计记录并监督合法用户或管理员的滥用。' },
        { text: '访问控制矩阵 ACM', details: '以主体为行、客体为列，单元格记录主体对客体的权限集合；表达直观但大型系统矩阵巨大且稀疏。' },
        { text: '访问控制表 ACL', details: '按客体保存矩阵的一列，列出哪些主体对该客体有什么权限。', children: [
          { text: '优点', details: '便于查询、修改和撤销某客体的授权，是现代系统常见实现。' },
          { text: '缺点', details: '查询或撤销某主体对所有客体的权限需要遍历大量 ACL。' },
        ] },
        { text: '能力表 Capabilities', details: '按主体保存矩阵的一行，列出该主体对各客体的能力。', children: [
          { text: '优点', details: '便于查询主体拥有的全部权限。' },
          { text: '缺点', details: '查询哪些主体能访问某客体较困难，能力本身还需防伪造和转移。' },
        ] },
        { text: '授权关系表', details: '每行保存一个非空的主体-客体-权限关系；按主体或客体建立索引可兼顾查询效率，安全数据库常采用。' },
        { text: '易混点', details: 'ACL=按客体/矩阵列；能力表=按主体/矩阵行；授权关系表=保存非空单元关系。' },
      ] },
      { text: '4.6.2 数字签名', details: '使接收者验证消息来源，发送者不能否认发送，接收者或第三方不能在不被发现的情况下篡改或伪造。', children: [
        { text: '签名条件', details: '可信、不可伪造、不可重用、签名后文件不可改变、不可抵赖。' },
        { text: '对称密钥签名', details: '通信双方借助共同信任的仲裁者验证和保存证据；依赖在线/可信仲裁者和共享密钥。' },
        { text: '公开密钥签名', details: '发送者用私钥对消息摘要签名，接收者用发送者公钥验证；通常结合证书确认公钥身份。' },
        { text: '签名不等于加密', details: '签名主要解决来源、完整性和不可抵赖，不天然提供机密性；机密性需另行加密。' },
        { text: '典型流程', details: '计算消息摘要→用私钥产生签名→发送消息和签名→接收方重新计算摘要并用公钥验证。' },
        { text: '时间戳与重放防护', details: '加入可信时间、序列号或随机数，证明签名产生时间和报文新鲜性。' },
      ] },
    ],
  },
  {
    text: '4.7 信息安全的抗攻击技术',
    details: '抗攻击不是单点产品，而是强密钥、协议加固、边界防护、监测审计、漏洞治理和应急恢复的组合。',
    children: [
      { text: '4.7.1 密钥的选择', details: '密钥强度取决于空间大小、弱钥规避和随机性。', children: [
        { text: '增大密钥空间', details: '足够的密钥长度提高穷举成本，但也要选择经过验证的算法和参数。' },
        { text: '选择强钥', details: '避免算法定义的弱钥、重复模式、默认密钥和可预测密钥。' },
        { text: '密钥随机性', details: '使用密码学安全随机数发生器，保证不可预测和足够熵；时间戳、用户名等不能直接作为密钥。' },
      ] },
      { text: '4.7.2 拒绝服务攻击与防御', details: 'DoS/DDoS 通过资源耗尽、协议缺陷或异常流量破坏可用性。', children: [
        { text: '传统 DoS', details: '单一或少量来源利用带宽、连接、CPU、内存、应用线程或协议实现缺陷使服务失效。' },
        { text: 'DDoS', details: '攻击者控制大量分布式主机同时攻击，流量大、来源分散、溯源和封堵困难。', children: [
          { text: '三级控制结构', details: '攻击者/Client 发令；主控端 Handler 控制；代理端 Agent/僵尸主机执行实际攻击。' },
        ] },
        { text: '防御方法', details: '修补漏洞、识别攻击包特征、监控敏感端口、统计流量异常、限速与连接保护、清洗/高防、弹性扩容和多层告警。' },
        { text: '防御原则', details: '在网络边界、主机协议栈和应用层分层限流；保留监控证据并准备降级、切换和恢复方案。' },
      ] },
      { text: '4.7.3 欺骗攻击与防御', details: '攻击者伪造地址、身份或响应，使通信方信任错误的对象。', children: [
        { text: 'ARP 欺骗', details: '利用主机无条件接受 ARP 应答并更新缓存的特点，伪造 IP-MAC 映射，把流量引向攻击者。', children: [
          { text: '危害', details: '中间人窃听、篡改、会话劫持或断网。' },
          { text: '防范', details: '关键映射静态绑定、交换机动态 ARP 检测、DHCP Snooping、双向绑定、网络隔离和异常 ARP 监测。' },
        ] },
        { text: 'DNS 欺骗', details: '攻击者冒充 DNS 或污染解析结果，把域名指向伪造地址。', children: [
          { text: '检测：被动监听', details: '维护请求-应答映射，发现同一请求出现多个矛盾响应。' },
          { text: '检测：虚假报文探测', details: '向非 DNS 目标发送查询，若仍收到伪造响应则表明可能存在攻击者。' },
          { text: '检测：交叉查询', details: '对返回 IP 做反向或其他可信解析交叉验证。' },
          { text: '防范归纳', details: '可信递归服务器、DNSSEC、加密 DNS 的可信配置、缓存保护和证书校验。' },
        ] },
        { text: 'IP 欺骗', details: '伪造源 IP 冒充可信主机，常与 DoS、会话预测或反射攻击结合。', children: [
          { text: '防范', details: '入口/出口过滤、反向路径检查、防火墙丢弃“外部进入但源地址为内部”的报文，避免仅按 IP 建立信任。' },
        ] },
      ] },
      { text: '4.7.4 端口扫描', details: '通过探测目标端口响应判断开放服务和操作系统特征，是攻击前信息收集手段。', children: [
        { text: '端口与 Socket', details: 'IP 地址和端口共同定位主机中的通信端点/进程。' },
        { text: '全 TCP 连接扫描', details: '完成三次握手，结果可靠但容易被日志记录。' },
        { text: 'SYN 半开放扫描', details: '收到 SYN+ACK 判断端口开放后发送 RST，不完成连接；速度快且比全连接隐蔽。' },
        { text: 'FIN 扫描', details: '向端口发送 FIN，根据关闭端口通常返回 RST、开放端口可能无响应来判断；受协议栈差异影响。' },
        { text: '第三方/代理扫描', details: '借助被控制的第三方主机扫描，以隐藏真实来源。' },
        { text: '防范', details: '关闭不必要服务、最小化暴露端口、防火墙白名单、IDS/IPS 识别扫描模式、蜜罐诱捕和审计告警。' },
      ] },
      { text: '4.7.5 强化 TCP/IP 堆栈', details: '通过协议栈配置、过滤、限流和更新降低利用协议缺陷发起 DoS 的风险。', children: [
        { text: 'SYN Flood', details: '大量伪造 SYN 使服务器维护半连接并重传，耗尽连接队列、CPU 和内存。', children: [
          { text: '防御', details: 'SYN Cookie、缩短超时、扩大/保护队列、限制单源连接速率、反欺骗过滤和上游流量清洗。' },
        ] },
        { text: 'ICMP 攻击', details: '利用超大、畸形或高频 ICMP 报文消耗资源或触发实现缺陷。', children: [
          { text: '防御', details: '补丁更新、合理限速和过滤异常 ICMP；不能一概禁用全部 ICMP，以免影响诊断和路径 MTU 等正常机制。' },
        ] },
        { text: 'SNMP 攻击', details: '弱口令、默认团体字、开放写权限或错误配置可能泄露信息、改变设备配置或被用于反射放大。', children: [
          { text: '防御', details: '优先 SNMPv3、强认证与加密、限制管理源、关闭写权限/无用服务、修改默认凭据并审计访问。' },
        ] },
      ] },
      { text: '4.7.6 系统漏洞扫描', details: '检查信息系统中可能被利用的漏洞，评估攻击可能性，为修复和安全方案提供依据。', children: [
        { text: '基于网络的扫描', details: '通过网络构造探测包并分析远程主机响应，无需在目标安装代理。', children: [
          { text: '组成模块', details: '漏洞数据库、用户配置控制台、扫描引擎、活动扫描知识库、结果存储和报告工具。' },
          { text: '优点', details: '部署成本相对低、不需目标管理员参与、不安装代理、网络变化时维护较方便。' },
          { text: '局限', details: '只能看到网络暴露面，受防火墙和服务响应影响，难检查本地配置、文件和进程细节。' },
        ] },
        { text: '基于主机的扫描', details: '在目标安装 Agent/Service，访问本地文件、配置、补丁和进程，因此检查更深入。', children: [
          { text: '优点', details: '覆盖漏洞更多、可集中管理、扫描主要在本地完成因而网络流量较小。' },
          { text: '局限', details: '需要部署和维护代理，依赖目标权限，对主机资源和兼容性有影响。' },
        ] },
        { text: '扫描后的闭环', details: '验证结果和去误报→按资产与风险定级→修复/缓解→复测→跟踪例外和残余风险。' },
      ] },
    ],
  },
  {
    text: '4.8 信息安全的保障体系与评估方法',
    details: '通过安全保护等级和风险评估确定保护目标、控制强度及持续改进方向。',
    children: [
      { text: '4.8.1 计算机信息系统安全保护等级', details: 'GB 17859—1999 将安全保护能力划分为五级，能力由自主访问控制逐步增强到形式化、结构化和强抗渗透。', children: [
        { text: '第1级 用户自主保护级', details: '对应 TCSEC C1；隔离用户与数据，提供自主访问控制，使用户保护自身和用户组信息。' },
        { text: '第2级 系统审计保护级', details: '对应 C2；增加细粒度自主访问控制、登录规程、安全事件审计和资源隔离，使用户对自身行为负责。' },
        { text: '第3级 安全标记保护级', details: '对应 B1；在第二级基础上加入安全策略模型、数据标记和主体对客体的强制访问控制。' },
        { text: '第4级 结构化保护级', details: '对应 B2；基于明确定义的形式化安全策略，访问控制覆盖全部主体客体，考虑隐蔽通道，划分关键/非关键保护元素并加强鉴别和配置管理。' },
        { text: '第5级 访问验证保护级', details: '对应 B3；满足访问监控器要求，仲裁全部访问，监控器抗篡改、足够小且可分析测试；精简非必要代码，增强审计、恢复和抗渗透。' },
        { text: '递进记忆', details: '自主保护→审计负责→安全标记/强制控制→形式化和结构化→访问监控器与高抗渗透。' },
      ] },
      { text: '4.8.2 安全风险管理', details: '风险来自威胁利用脆弱性作用于有价值资产，造成安全事件和业务影响；风险评估是建立保障体系的重要决策机制。', children: [
        { text: '风险评估准备', details: '确定范围、明确目标、建立组织结构、选择系统性方法、获得最高管理者批准并传达。' },
        { text: '评估形式', details: '自评估由系统拥有者组织；他评估由上级或主管机关发起，常具有检查和强制性质；两者均可借助专业服务机构。' },
        { text: '基本要素', details: '资产、威胁、脆弱性、风险和安全措施；相关属性包括业务战略、资产价值、安全需求、安全事件和残余风险。', children: [
          { text: '资产', details: '承载业务价值的信息、系统、应用、网络、设备、人员和服务；业务越依赖，资产安全价值通常越高。' },
          { text: '威胁', details: '可能对资产造成破坏的因素或事件，分人为有意、无意和环境因素；一项资产可面临多个威胁。' },
          { text: '脆弱性', details: '资产或控制中的弱点，本身不直接造成损失，但可能被威胁利用。' },
          { text: '安全措施', details: '抗击威胁、降低脆弱性、减少事件可能性或影响，但需要成本且可能无效或实施不当。' },
          { text: '残余风险', details: '实施控制后仍存在的风险；可能来自控制不足，也可能是权衡成本与资产价值后主动接受，需持续监视。' },
        ] },
        { text: '要素关系', details: '业务依赖资产→资产价值导出安全需求；脆弱性暴露资产→威胁利用脆弱性形成风险→风险可能演变为事件；措施满足需求并降低风险，但留下残余风险。' },
        { text: '资产识别与赋值', details: '按信息系统和业务分类资产，依据保密性、完整性、可用性损失造成的业务影响赋值，而不是仅看账面价格。' },
        { text: '影响分析', details: '考虑违法违规、业务中断、声誉损失、隐私侵犯、人身伤害、商业秘密泄露、经济损失和公共安全危害等。' },
        { text: '威胁识别', details: '结合资产环境、历史事件和攻击趋势识别威胁来源、方式、频率和可能性。' },
        { text: '脆弱性评估', details: '从物理、网络、系统、应用和管理层检查技术与管理弱点。', children: [
          { text: '方法', details: '问卷调查、人员访谈、工具扫描、手动检查、文档审查和渗透测试。' },
          { text: '注意点', details: '无对应威胁的弱点可暂不控制但必须记录；错误或无效的安全措施本身也可能成为脆弱性。' },
        ] },
        { text: '风险计算过程', details: '识别并赋值资产→分析威胁及可能性→识别脆弱性并评估严重性→计算安全事件可能性→结合资产重要性计算风险值。' },
        { text: '风险处置', details: '可选择降低、规避、转移或接受；处置后复评残余风险并进入持续监控。' },
      ] },
    ],
  },
];

const selectionResult = await tool('getSelectedMapAndNodeIdentifiers', { request: { selectionCollectionMode: 'SINGLE' } });
const selection = JSON.parse(selectionResult.content[0].text);
const mapIdentifier = selection.mapIdentifier;
const anchorNodeIdentifier = process.env.FREEPLANE_ROOT_NODE_ID || selection.rootNodeIdentifier;
let chapterNodeIdentifier = process.env.FREEPLANE_CHAPTER4_NODE_ID;

if (!chapterNodeIdentifier) {
  await tool('createNodes', { request: {
    mapIdentifier,
    userSummary: '创建《系统架构设计师教程（第2版）》第四章详细思维导图根节点',
    anchorPlacement: { anchorNodeIdentifier, placementMode: 'LAST_CHILD' },
    nodes: [{ index: 0, parentIndex: -1, content: c('第4章 信息安全技术基础知识', '依据《系统架构设计师教程（第2版）》第4章（145-174页）整理：信息安全基础、保障框架、密码与密钥、访问控制、数字签名、抗攻击技术和风险评估。'), foldingState: 'UNFOLD' }],
  } });
  const lookup = await tool('searchNodes', { request: { mapIdentifier, queryText: '第4章 信息安全技术基础知识', matchingMode: 'EQUALS', caseSensitivity: 'CASE_SENSITIVE', limit: 20 } });
  const payload = JSON.parse(lookup.content[0].text);
  const matches = payload.items || payload.nodes || payload.results || [];
  chapterNodeIdentifier = matches.at(-1)?.nodeIdentifier;
  if (!chapterNodeIdentifier) throw new Error(`Cannot locate chapter 4 root: ${lookup.content[0].text}`);
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

const verification = await tool('readNodesWithDescendantsAsPlainText', { request: { mapIdentifier, nodeIdentifiers: [chapterNodeIdentifier], fullContentDepth: 6, additionalSummaryDepth: 0, maxCharacters: 180000 } });
console.log(JSON.stringify({ mapIdentifier, chapterNodeIdentifier, createdNodeCount: created, verification: verification.content[0].text }, null, 2));
