export const ROADMAP_STORAGE_KEY = "architect-beginner-roadmap-v1";
const CORE = [
["基础全景","先理解系统架构是什么",[1],"从系统、软件、架构和架构师职责入门，弄清楚架构要解决什么问题。",["阅读第1章并画系统边界图","解释架构与详细设计的区别","做10道基础辨析题并写错因"],"一张概念图和一段自己的架构定义。","materials"],
["基础全景","补齐计算机系统底座",[2],"理解处理器、存储、I/O、操作系统和性能之间的关系。",["梳理CPU、内存、存储、I/O瓶颈","复习性能指标与计算题","用吞吐量、响应时间解释系统问题"],"计算机系统层次图和三个瓶颈案例。","materials"],
["基础全景","认识信息系统与业务目标",[3],"建立业务目标、流程、信息流、系统功能和生命周期的联系。",["区分业务需求、规则、系统功能和技术方案","梳理信息系统生命周期","从业务问题提取架构驱动因素"],"业务目标到系统能力映射表。","materials"],
["基础全景","打好信息安全基础",[4],"从安全目标理解威胁、风险、身份、访问控制、密码和防护。",["区分认证、授权、审计、加密、摘要、签名","整理攻击方式和缓解措施","说明安全措施的保护对象与代价"],"威胁—风险—控制措施对照表。","materials"],
["基础全景","掌握软件工程与交付",[5],"理解需求、设计、构建、测试、配置管理和质量保证如何影响架构。",["比较生命周期模型、敏捷和DevOps","理解需求跟踪、测试、重构与技术债","按项目约束选择过程和质量活动"],"软件交付生命周期图。","materials"],
["基础全景","掌握数据库与数据设计",[6],"从需求、概念模型、逻辑模型到物理设计建立完整链路。",["练习ER建模、范式、索引、事务","比较关系、键值、文档、列族和图模型","分析分片、复制、一致性和访问模式"],"小型业务数据模型和选型理由。","materials"],
["架构设计","进入系统架构设计核心",[7],"把业务目标转成架构驱动因素，再围绕质量属性、约束和风险设计。",["识别涉众、需求、质量属性和约束","比较架构风格并写出取舍理由","练习多视图、决策记录和设计评审"],"一个含目标、视图、决策和风险的架构方案。","materials"],
["架构设计","理解质量属性与架构评估",[8],"用场景表达质量属性，理解ATAM如何揭示风险和权衡。",["把质量要求改写成可验证场景","理解敏感点、权衡点和风险点","比较两种方案的质量属性冲突"],"三个质量属性场景和风险清单。","materials"],
["架构设计","可靠性与架构演化",[9,10],"理解可靠性、容错、恢复，并分析维护、重构和技术债。",["区分可靠性、可用性、可维护性","分析冗余、故障隔离、恢复和降级","评估遗留系统演化方案"],"故障场景、恢复策略和演化方案。","materials"],
["架构设计","新技术与综合知识查漏",[11],"梳理新技术并回看基础章节薄弱点，关注概念边界和适用条件。",["整理第11章技术及其解决的问题","做跨章节题并标注错因","核对标准、版本、公式和参数"],"个人高频错因清单和待补知识地图。","materials"],
["案例实战","信息系统与分层架构案例",[12,13],"训练案例分析：提取约束，组织方案，用质量属性和证据说明方案。",["梳理信息系统和分层职责","标注案例条件、作答对象和分值","按结论—理由—机制—权衡组织答案"],"至少两道案例题及采分点复盘。","case"],
["案例实战","云原生与面向服务架构",[14,15],"比较云原生、微服务、服务治理的边界、通信、弹性和一致性。",["区分容器、编排、微服务和治理","练习服务拆分、通信、发现和容错","分析分布式复杂度与运维成本"],"架构比较表和两道案例复盘。","case"],
["案例实战","嵌入式与通信系统架构",[16,17],"关注实时性、资源限制、可靠性、协议和环境约束。",["识别实时性、功耗、带宽和时延约束","整理通信关键机制与权衡","检查答案是否回应全部题干约束"],"约束到架构决策推导表。","case"],
["案例实战","安全架构与大数据架构",[18,19],"把安全治理、数据链路、一致性、存储计算和治理要求放进系统分析。",["练习身份、边界、保护和审计","梳理大数据处理、存储和计算链路","至少两道案例并逐问复盘"],"两道完整案例答案和失分分析。","case"],
["论文冲刺","建立论文写作方法",[20],"用真实项目经验组织背景、约束、目标、方案、关键决策、结果和反思。",["建立真实项目素材卡并明确个人职责","练习背景、方案、关键技术和权衡提纲","限时写完整论文并检查切题"],"两份项目素材卡、三份提纲和一篇练习稿。","paper"],
["论文冲刺","三科联动模拟与补缺",[1,20],"综合知识、案例、论文一起训练，用模拟发现短板并回炉。",["完成综合知识限时卷并复盘","完成案例限时训练并按采分点复盘","完成论文限时训练并检查结构与真实性","整理薄弱项和下一轮安排"],"三科模拟诊断和下一轮计划。","mock"],
];
const allowedExperience = new Set(["beginner", "experienced"]);
const allowedHours = new Set([4, 6, 8, 10, 12]);
export function createStudyRoadmap(input = {}) {
  const experience = allowedExperience.has(input.experience) ? input.experience : "beginner";
  const candidate = Number(input.hoursPerWeek);
  const hoursPerWeek = allowedHours.has(candidate) ? candidate : 8;
  const totalHours = experience === "beginner" ? 144 : 112;
  const totalWeeks = Math.ceil(totalHours / hoursPerWeek);
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate ?? "")) ? String(input.startDate) : today;
  const blockAppearances = Array(CORE.length).fill(0);
  const weeks = Array.from({length: totalWeeks}, (_, index) => {
    const first = Math.floor(index * CORE.length / totalWeeks);
    const last = Math.max(first, totalWeeks > CORE.length
      ? Math.floor(((index+1)*CORE.length-1)/totalWeeks)
      : Math.floor((index+1)*CORE.length/totalWeeks)-1);
    const blocks = CORE.slice(first,last+1);
    const chapters = [...new Set(blocks.flatMap((item)=>item[2]))];
    const phases = [...new Set(blocks.map((item)=>item[0]))];
    const repeat = totalWeeks > CORE.length;
    const repeatTask = repeat ? (index - Math.ceil(first*totalWeeks/CORE.length) === 0 ? "先读教程，建立概念框架并用自己的话复述。" : "用真题/可靠练习检验理解，回顾错因并完成场景分析。") : null;
    const rotatedTasks = repeat ? blocks.flatMap((item, offset) => {
      const taskList = item[4];
      const occurrence = blockAppearances[first + offset];
      blockAppearances[first + offset] += 1;
      const taskStart = occurrence % taskList.length;
      return [taskList[taskStart], taskList[(taskStart + 1) % taskList.length]];
    }) : [];
    return {
      number:index+1, phases, phase:phases.join(" + "),
      title:blocks.map((item)=>item[1]).join(" / "),
      chapters, focus:blocks.map((item)=>item[3]).join(" "),
      tasks:repeat ? [repeatTask,...rotatedTasks] : blocks.flatMap((item)=>item[4]),
      deliverable:blocks.map((item)=>item[5]).join("；"),
      action:blocks.at(-1)[6], estimatedHours:hoursPerWeek
    };
  });
  const completedThrough = Math.max(0,Math.min(totalWeeks,Math.floor(Number(input.completedThrough)||0)));
  return {version:1,experience,hoursPerWeek,totalHours,totalWeeks,startDate,completedThrough,weeks};
}
export function getActiveRoadmapWeek(plan) {
  const value = createStudyRoadmap(plan);
  const completed = value.completedThrough >= value.totalWeeks;
  const number = completed ? value.totalWeeks : value.completedThrough+1;
  return {completed,number,week:value.weeks[number-1],percent:Math.round(value.completedThrough/value.totalWeeks*100)};
}
export function advanceStudyRoadmap(plan) {
  const value = createStudyRoadmap(plan);
  return createStudyRoadmap({...value,completedThrough:Math.min(value.totalWeeks,value.completedThrough+1)});
}
