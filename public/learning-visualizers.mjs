function weightedMean(rows) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (!(total > 0)) throw new RangeError("总权重必须大于 0");
  return rows.reduce((sum, row) => sum + row.weight * row.rate, 0) / total;
}
function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("比例必须是有限数字");
  return Math.max(min, Math.min(max, number));
}
export function calculateInputDomainEstimate(abnormalShare = 5) {
  const abnormal = clamp(abnormalShare, 5, 30);
  const rows = [
    { name: "常规输入", weight: 85 - abnormal, rate: 99 },
    { name: "边界输入", weight: 15, rate: 95 },
    { name: "异常输入", weight: abnormal, rate: 80 },
  ];
  return { rows, weighted: weightedMean(rows), equal: rows.reduce((sum, row) => sum + row.rate, 0) / rows.length };
}
export function calculateExecutionPathEstimate(timeoutShare = 10) {
  const timeout = clamp(timeoutShare, 5, 30);
  const rows = [
    { name: "常规路径", weight: 80 - timeout, rate: 1 },
    { name: "边界分支", weight: 20, rate: 4 },
    { name: "超时路径", weight: timeout, rate: 20 },
  ];
  return { rows, weighted: weightedMean(rows), equal: rows.reduce((sum, row) => sum + row.rate, 0) / rows.length };
}
const pct = (value) => Number(value).toFixed(2) + "%";
function makeWeightedLab(element, config) {
  const slider = element("input", { attrs: {
    type: "range", min: String(config.min), max: String(config.max), step: "1", value: String(config.value),
    "aria-label": config.sliderLabel, "aria-describedby": config.outputId,
  } });
  const output = element("output", { text: config.value + "%", attrs: { id: config.outputId, "aria-live": "polite" } });
  const reset = element("button", { className: "small-button", text: "恢复示例", attrs: { type: "button" } });
  const segments = config.initial.rows.map((row, i) => element("span", {
    className: "learning-lab-segment learning-lab-segment-" + (i + 1), attrs: { role: "presentation" },
  }));
  const bar = element("div", { className: "learning-lab-distribution", attrs: { role: "img", "aria-label": "类别在运行剖面中的占比" } }, segments);
  const dataRows = config.initial.rows.map((row, i) => element("div", { className: "learning-lab-data-row" }, [
    element("span", { className: "learning-lab-data-name", text: row.name }),
    element("strong", { attrs: { "data-weight": String(i) }, text: row.weight + "%" }),
    element("span", { attrs: { "data-rate": String(i) }, text: config.rateLabel + " " + row.rate + "%" }),
  ]));
  const weighted = element("strong", { text: pct(config.initial.weighted) });
  const equal = element("strong", { text: pct(config.initial.equal) });
  const formula = element("code", { attrs: { "aria-live": "polite" } });
  function update() {
    const model = config.calculate(Number(slider.value));
    const share = model.rows[2].weight;
    output.textContent = share + "%";
    slider.setAttribute("aria-valuetext", share + "%");
    model.rows.forEach((row, index) => {
      segments[index].style.width = row.weight + "%";
      segments[index].setAttribute("aria-label", row.name + " " + row.weight + "%");
      dataRows[index].querySelector('[data-weight="' + index + '"]').textContent = row.weight + "%";
      dataRows[index].querySelector('[data-rate="' + index + '"]').textContent = config.rateLabel + " " + row.rate + "%";
    });
    weighted.textContent = pct(model.weighted);
    equal.textContent = pct(model.equal);
    formula.textContent = model.rows.map((row) => row.weight + "%×" + row.rate + "%").join(" + ") + " = " + pct(model.weighted);
  }
  slider.addEventListener("input", update);
  reset.addEventListener("click", () => { slider.value = String(config.value); update(); slider.focus(); });
  update();
  return element("section", { className: "learning-visualizer", attrs: { "aria-labelledby": config.titleId } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: config.kicker }),
        element("h3", { text: config.title, attrs: { id: config.titleId } }),
        element("p", { text: config.subtitle }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: config.badge }),
    ]),
    element("div", { className: "learning-lab-layout" }, [
      element("div", { className: "learning-lab-controls" }, [
        element("label", { className: "learning-lab-range" }, [
          element("span", { text: config.sliderLabel }),
          element("span", { className: "learning-lab-range-control" }, [slider, output]),
        ]),
        element("p", { className: "learning-lab-hint", text: config.hint }), reset,
      ]),
      element("div", { className: "learning-lab-visual" }, [
        element("div", { className: "learning-lab-section-title", text: "运行剖面（总和 = 100%）" }),
        bar, element("div", { className: "learning-lab-legend" }, dataRows),
      ]),
    ]),
    element("div", { className: "learning-lab-results" }, [
      element("div", { className: "learning-lab-result learning-lab-result-primary" }, [
        element("span", { text: config.weightedLabel }), weighted, element("small", { text: config.weightedNote }),
      ]),
      element("div", { className: "learning-lab-result" }, [
        element("span", { text: config.equalLabel }), equal, element("small", { text: config.equalNote }),
      ]),
    ]),
    element("div", { className: "learning-lab-formula" }, [element("span", { text: "动态计算" }), formula]),
    element("details", { className: "learning-lab-explainer" }, [
      element("summary", { text: config.explainerTitle }), element("p", { text: config.explainer }),
    ]),
  ]);
}
function inputDomainLab(element) {
  return makeWeightedLab(element, {
    initial: calculateInputDomainEstimate(5), calculate: calculateInputDomainEstimate,
    min: 5, max: 30, value: 5, outputId: "input-domain-share-value",
    sliderLabel: "异常输入在实际运行中的占比", rateLabel: "成功率",
    titleId: "input-domain-lab-title", kicker: "INTERACTIVE LAB · 01",
    title: "输入域权重实验：为什么不能简单平均？",
    subtitle: "改变异常输入在真实运行中的占比，观察整体成功率如何变化；各类别成功率保持不变。",
    badge: "自拟示例 · 非教材原题",
    hint: "边界输入固定为 15%；常规输入占比自动补足到 100%。",
    weightedLabel: "按运行剖面加权的成功率", weightedNote: "更贴近给定运行分布的简化估计",
    equalLabel: "三类简单等权平均", equalNote: "忽略了类别在实际使用中的比例",
    explainerTitle: "这组结果说明什么？",
    explainer: "测试时可以均匀抽样以照顾每个类别，但估计实际使用可靠性时，仍要考虑生产环境中的输入分布。高风险边界/异常输入不能因为出现频率低就不测；测试覆盖和运行权重回答的是两个不同问题。",
  });
}
function executionPathLab(element) {
  return makeWeightedLab(element, {
    initial: calculateExecutionPathEstimate(10), calculate: calculateExecutionPathEstimate,
    min: 5, max: 30, value: 10, outputId: "execution-path-share-value",
    sliderLabel: "超时路径在实际执行中的占比", rateLabel: "条件失效率",
    titleId: "execution-path-lab-title", kicker: "INTERACTIVE LAB · 02",
    title: "执行路径实验：覆盖到，不等于经常执行",
    subtitle: "调高超时路径的真实执行占比，观察整体失效概率如何改变；各路径条件失效率保持不变。",
    badge: "简化加权示例 · 非教材公式",
    hint: "边界分支固定为 20%；常规路径占剩余比例。三条路径互斥且完备是本示例的前提。",
    weightedLabel: "按路径使用频率加权的失效概率", weightedNote: "依赖路径权重和条件失效率估计",
    equalLabel: "三条路径简单等权平均", equalNote: "把低频、高风险路径当成与常规路径同频",
    explainerTitle: "覆盖率为什么不能代替路径概率？",
    explainer: "路径覆盖说明测试是否走到某条路径；运行剖面描述真实使用时各路径出现的频率。二者不能互相替代。本实验只是概率加权的教学简化例，不是 Shooman 分解模型的完整公式。",
  });
}
function lambdaArchitectureLab(element) {
  let mode = "stream";
  let step = 0;
  const descriptions = {
    stream: [
      "一条新事件到达系统。先识别事件来源与时间范围。",
      "速度层优先处理近期事件；批处理层仍会按计划更新历史视图。两路结果需要协调。",
      "服务层对查询方提供组合视图。必须定义去重、覆盖、更新和一致性规则。",
    ],
    rebuild: [
      "选择一个历史数据窗口，发起全量或分区重算。",
      "批处理层重新计算历史视图；实时路径可能仍在接收新事件。",
      "服务层发布更新后的视图，并处理重算期间新旧结果的衔接。",
    ],
  };
  const source = element("div", { className: "learning-lambda-node learning-lambda-source" }, [
    element("strong", { text: "输入" }), element("span", { text: "新事件 / 历史数据" }),
  ]);
  const batch = element("div", { className: "learning-lambda-node learning-lambda-batch" }, [
    element("strong", { text: "批处理层" }), element("span", { text: "历史视图 · 全量重算" }),
  ]);
  const speed = element("div", { className: "learning-lambda-node learning-lambda-speed" }, [
    element("strong", { text: "速度层" }), element("span", { text: "近期事件 · 低延迟补充" }),
  ]);
  const service = element("div", { className: "learning-lambda-node learning-lambda-service" }, [
    element("strong", { text: "服务层" }), element("span", { text: "对外提供查询视图" }),
  ]);
  const diagram = element("div", { className: "learning-lambda-diagram", attrs: {
    role: "group", "aria-label": "Lambda 架构批处理层、速度层和服务层的概念数据流",
  } }, [
    source,
    element("span", { className: "learning-lambda-arrow", text: "→", attrs: { "aria-hidden": "true" } }),
    element("div", { className: "learning-lambda-branches" }, [batch, speed]),
    element("span", { className: "learning-lambda-arrow", text: "→", attrs: { "aria-hidden": "true" } }),
    service,
  ]);
  const modeLive = element("button", { className: "learning-lab-mode is-selected", text: "新事件到达", attrs: { type: "button", "aria-pressed": "true" } });
  const modeRebuild = element("button", { className: "learning-lab-mode", text: "历史数据重算", attrs: { type: "button", "aria-pressed": "false" } });
  const modeGroup = element("div", { className: "learning-lab-mode-group", attrs: {
    role: "group", "aria-label": "选择演示场景",
  } }, [modeLive, modeRebuild]);
  const stepText = element("strong", { text: "步骤 1 / 3" });
  const explanation = element("p", { className: "learning-lambda-explanation", text: descriptions[mode][step], attrs: { "aria-live": "polite" } });
  const previous = element("button", { className: "secondary", text: "上一步", attrs: { type: "button", disabled: true } });
  const next = element("button", { className: "primary", text: "下一步", attrs: { type: "button" } });
  function update() {
    modeLive.classList.toggle("is-selected", mode === "stream");
    modeRebuild.classList.toggle("is-selected", mode === "rebuild");
    modeLive.setAttribute("aria-pressed", String(mode === "stream"));
    modeRebuild.setAttribute("aria-pressed", String(mode === "rebuild"));
    source.classList.toggle("is-active", step === 0);
    batch.classList.toggle("is-active", step === 1 && mode === "rebuild");
    speed.classList.toggle("is-active", step === 1 && mode === "stream");
    batch.classList.toggle("is-supporting", step === 1 && mode === "stream");
    speed.classList.toggle("is-supporting", step === 1 && mode === "rebuild");
    service.classList.toggle("is-active", step === 2);
    [batch, speed, service].forEach((node) => node.classList.toggle("is-muted", step === 0));
    diagram.dataset.mode = mode;
    stepText.textContent = "步骤 " + (step + 1) + " / 3";
    explanation.textContent = descriptions[mode][step];
    previous.disabled = step === 0;
    next.disabled = step === 2;
    next.textContent = step === 2 ? "已看完" : "下一步";
  }
  modeLive.addEventListener("click", () => { mode = "stream"; step = 0; update(); });
  modeRebuild.addEventListener("click", () => { mode = "rebuild"; step = 0; update(); });
  previous.addEventListener("click", () => { step = Math.max(0, step - 1); update(); });
  next.addEventListener("click", () => { step = Math.min(2, step + 1); update(); });
  update();
  return element("section", { className: "learning-visualizer learning-visualizer-lambda", attrs: {
    "aria-labelledby": "lambda-lab-title",
  } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: "INTERACTIVE LAB · 03" }),
        element("h3", { text: "Lambda 架构：两条处理路径如何汇合？", attrs: { id: "lambda-lab-title" } }),
        element("p", { text: "切换实时事件与历史重算场景，再逐步观察数据经过哪一层。" }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: "概念流程图" }),
    ]),
    modeGroup, diagram,
    element("div", { className: "learning-lambda-step" }, [
      element("div", { className: "learning-lambda-step-heading" }, [stepText, element("span", { text: "跟着数据走" })]),
      explanation,
      element("div", { className: "learning-lambda-controls" }, [previous, next]),
    ]),
    element("details", { className: "learning-lab-explainer" }, [
      element("summary", { text: "架构权衡与考试表达" }),
      element("p", { text: "Lambda 架构把历史批处理与近期速度处理分开，再由服务层提供查询结果。作答时不能只画三层，还要说明双路径带来的结果协调、一致性、重复逻辑和运维复杂度。此图是职责关系示意，不代表固定的物理部署拓扑。" }),
    ]),
  ]);
}
function makeConceptVisualizer(element, config) {
  const timeline = config.timeline ?? config.nodes.map((node, index) => ({ nodeIndex: index, flowIndex: index }));
  let activeStep = 0;
  let timer = null;
  let root = null;
  const detailStep = element("span", { className: "learning-concept-detail-step" });
  const detailTitle = element("strong", { className: "learning-concept-detail-title" });
  const detail = element("p", { className: "learning-concept-detail-text" });
  const focus = element("small", { className: "learning-concept-detail-focus" });
  const nodes = config.nodes.map((node, index) => {
    const button = element("button", { className: "learning-concept-node", attrs: {
      type: "button", "aria-pressed": String(index === 0),
      "aria-label": "查看 " + node.title + " 的解释",
    } }, [
      element("span", { className: "learning-concept-node-index", text: String(index + 1).padStart(2, "0") }),
      element("strong", { text: node.title }),
      element("small", { text: node.short }),
    ]);
    button.addEventListener("click", () => {
      pause();
      const firstStep = timeline.findIndex((step) => step.nodeIndex === index);
      activeStep = firstStep < 0 ? 0 : firstStep;
      update();
    });
    return button;
  });
  const flowSteps = [];
  const flowArrows = [];
  const flowChildren = [];
  config.flow.forEach((label, index) => {
    if (index) {
      const arrow = element("span", { className: "learning-concept-flow-arrow", text: config.separator || "→", attrs: { "aria-hidden": "true" } });
      flowArrows.push(arrow);
      flowChildren.push(arrow);
    }
    const step = element("span", { className: "learning-concept-flow-step", text: label });
    flowSteps.push(step);
    flowChildren.push(step);
  });
  const flow = element("div", { className: "learning-concept-flowline", attrs: {
    role: "img", "aria-label": config.flowLabel,
  } }, flowChildren);
  const previous = element("button", { className: "learning-concept-player-button", text: "上一步", attrs: { type: "button" } });
  const play = element("button", { className: "learning-concept-player-button is-primary", text: "播放讲解", attrs: { type: "button" } });
  const next = element("button", { className: "learning-concept-player-button", text: "下一步", attrs: { type: "button" } });
  const speed = element("select", { className: "learning-concept-player-speed", attrs: { "aria-label": "播放速度" } }, [
    element("option", { text: "慢速", attrs: { value: "2600" } }),
    element("option", { text: "正常", attrs: { value: "1800", selected: true } }),
    element("option", { text: "快速", attrs: { value: "1100" } }),
  ]);
  const progressLabel = element("span", { className: "learning-concept-progress-label" });
  const progressFill = element("span", { className: "learning-concept-progress-fill" });
  const progress = element("div", { className: "learning-concept-progress", attrs: { "aria-hidden": "true" } }, [progressFill]);
  function pause() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    play.textContent = "播放讲解";
    play.classList.remove("is-playing");
  }
  function setStep(index) {
    activeStep = Math.max(0, Math.min(timeline.length - 1, index));
    update();
  }
  function playFromHere() {
    if (timer !== null) {
      pause();
      return;
    }
    if (activeStep >= timeline.length - 1) setStep(0);
    play.textContent = "暂停讲解";
    play.classList.add("is-playing");
    timer = setInterval(() => {
      if (!root?.isConnected) {
        pause();
        return;
      }
      if (activeStep >= timeline.length - 1) {
        pause();
        return;
      }
      setStep(activeStep + 1);
      if (activeStep >= timeline.length - 1) pause();
    }, Number(speed.value) || 1800);
  }
  function update() {
    const current = timeline[activeStep];
    const node = config.nodes[current.nodeIndex] ?? config.nodes[0];
    nodes.forEach((button, index) => {
      button.classList.toggle("is-active", index === current.nodeIndex);
      button.setAttribute("aria-pressed", String(index === current.nodeIndex));
    });
    flowSteps.forEach((step, index) => {
      const selected = index === current.flowIndex;
      step.classList.toggle("is-active", selected);
      if (selected) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    const previousFlow = activeStep > 0 ? timeline[activeStep - 1].flowIndex : current.flowIndex;
    flowArrows.forEach((arrow, index) => {
      arrow.classList.toggle("is-active", Math.abs(current.flowIndex - previousFlow) === 1 && index === Math.min(current.flowIndex, previousFlow));
    });
    detailStep.textContent = (current.phase ? current.phase + " · " : "") + "步骤 " + (activeStep + 1) + " / " + timeline.length;
    detailTitle.textContent = current.title || node.title;
    detail.textContent = current.narration || node.detail;
    focus.textContent = current.focus || node.focus;
    progressLabel.textContent = (activeStep + 1) + " / " + timeline.length;
    progressFill.style.width = ((activeStep + 1) / timeline.length * 100) + "%";
    previous.disabled = activeStep === 0;
    next.disabled = activeStep === timeline.length - 1;
  }
  previous.addEventListener("click", () => { pause(); setStep(activeStep - 1); });
  next.addEventListener("click", () => { pause(); setStep(activeStep + 1); });
  play.addEventListener("click", playFromHere);
  speed.addEventListener("change", () => {
    if (timer !== null) {
      pause();
      playFromHere();
    }
  });
  update();
  root = element("section", { className: "learning-visualizer learning-visualizer-concept", attrs: {
    "aria-labelledby": config.titleId,
  } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: config.kicker }),
        element("h3", { text: config.title, attrs: { id: config.titleId } }),
        element("p", { text: config.subtitle }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: config.badge }),
    ]),
    element("div", { className: "learning-concept-flow-wrap" }, [
      element("span", { className: "learning-concept-overline", text: config.flowHeading || "知识关系主线" }),
      flow,
    ]),
    element("div", { className: "learning-concept-player" }, [
      element("div", { className: "learning-concept-player-controls" }, [previous, play, next, speed]),
      element("div", { className: "learning-concept-player-progress" }, [progress, progressLabel]),
    ]),
    element("div", { className: "learning-concept-node-grid", attrs: {
      role: "group", "aria-label": config.nodeGroupLabel,
    } }, nodes),
    element("div", { className: "learning-concept-detail", attrs: { "aria-live": "polite", "aria-atomic": "true" } }, [
      detailStep, detailTitle, detail, focus,
    ]),
    element("div", { className: "learning-concept-boundary" }, [
      element("strong", { text: config.boundaryTitle || "理解边界" }),
      element("p", { text: config.boundary }),
    ]),
  ]);
  return root;
}

function architectureOverviewVisualizer(element) {
  return makeConceptVisualizer(element, {
    titleId: "architecture-overview-visual-title", kicker: "VISUAL EXPLAINER · 01",
    title: "系统架构到底在描述什么？",
    subtitle: "从系统边界出发，识别主要元素、关系、环境和设计原则。点击每个要素，理解它对架构设计的作用。",
    badge: "教材样章支持核心定义",
    flowLabel: "系统架构描述的五个要素",
    flow: ["系统边界", "关键元素", "元素关系", "外部环境", "设计原则"],
    nodeGroupLabel: "系统架构五个描述要素",
    nodes: [
      { title: "系统边界", short: "先明确研究对象", detail: "说明系统要解决什么问题、包含哪些职责，以及与哪些外部系统或参与者交互。边界不清，组件、接口和责任划分就容易混乱。", focus: "看题先圈定范围：讨论的是整个业务系统、子系统，还是一个部署单元？" },
      { title: "关键元素", short: "识别主要组成", detail: "识别构成系统基本组织的主要元素，并说明各自承担什么职责。先按职责理解元素，再讨论使用何种框架、语言或产品实现。", focus: "不要只堆技术名词，要写清每个元素负责什么。" },
      { title: "元素关系", short: "解释如何协作", detail: "描述元素之间的调用、依赖、消息传递、数据交换或协作约束。关系会影响运行行为、故障传播和变更范围。", focus: "架构图的箭头必须有含义：方向代表什么、传递什么、由谁发起？" },
      { title: "外部环境", short: "放回真实上下文", detail: "用户、外部系统、组织流程、运行环境和约束都会影响架构选择，也可能成为接口、安全或可用性风险来源。", focus: "把外部参与者和边界外依赖标出来，避免内外职责混淆。" },
      { title: "设计原则", short: "约束设计与演化", detail: "架构还包含指导设计和后续演化的原则，帮助团队在局部变化时维持整体方向；原则本身也要接受目标、约束和质量属性检验。", focus: "说明为什么选择这种组织方式，它支持什么目标，又牺牲了什么。" },
    ],
    boundary: "本图依据教材样章支持的架构基本组织核心描述整理，是概念框架，不是某一系统的部署图。架构也不等于一张图、某个框架或中间件。",
  });
}

function architectureDesignFlowVisualizer(element) {
  return makeConceptVisualizer(element, {
    titleId: "architecture-design-flow-title", kicker: "VISUAL EXPLAINER · 02",
    title: "架构设计不是先选技术栈：决策链应该这样走",
    subtitle: "把需求、架构驱动因素、设计策略、职责分配、迭代和复审连起来，观察每一步如何约束下一步。",
    badge: "课程内容 + SEI 方法边界",
    flowLabel: "架构设计决策链",
    flow: ["需求与约束", "架构驱动因素", "设计策略", "职责与接口", "迭代分解", "评估复审"],
    nodeGroupLabel: "架构设计决策阶段",
    nodes: [
      { title: "需求与约束", short: "功能 / 质量 / 外部条件", detail: "同时收集功能需求、质量属性需求、外部约束，以及已有资产、技术和组织因素。性能、安全、成本和交付时间不能被功能清单替代。", focus: "常见失分点：只抄业务功能，不识别质量属性和外部约束。" },
      { title: "架构驱动因素", short: "筛选真正影响结构的要求", detail: "从输入中识别对系统结构和关键决策影响最大的因素，明确优先级、冲突和假设。它们决定设计要优先解决什么。", focus: "把题干中的高风险质量场景和硬约束提炼为驱动因素。" },
      { title: "设计策略", short: "模式 / 风格 / 战术", detail: "围绕驱动因素选择候选架构风格、设计概念、模式或策略，并解释其如何回应需求。策略是候选决策，不是脱离上下文的标准答案。", focus: "写清“因为哪个约束，所以采用哪项策略”，不要先定技术再找理由。" },
      { title: "职责与接口", short: "元素 / 连接件 / 部署", detail: "识别架构元素和连接方式，为元素分配职责，定义接口、交互和必要的部署边界，再检查跨组件约束。", focus: "把策略落到可检查的结构：谁负责、如何交互、边界在哪里。" },
      { title: "迭代分解", short: "递归细化高风险部分", detail: "架构设计是迭代和风险驱动的过程。对尚未解决的部分继续分解、做原型或验证关键机制，再根据反馈修订设计。", focus: "不是一次画完；要针对不确定性和高风险点逐步细化。" },
      { title: "评估与复审", short: "验证需求并记录取舍", detail: "检查架构是否回应驱动因素，识别风险、敏感点和权衡点；通过复审、原型和测试证据反馈设计，并记录决策理由。", focus: "案例答题可按“需求—决策—机制—风险—验证”形成闭环。" },
    ],
    boundary: "本图概括当前课程单元与 SEI Attribute-Driven Design 的共同主线；不代表所有项目必须采用完全相同的阶段名称、顺序或工具。",
  });
}

function qualityScenarioVisualizer(element) {
  return makeConceptVisualizer(element, {
    titleId: "quality-scenario-visual-title", kicker: "VISUAL EXPLAINER · 03",
    title: "把“系统要高性能”拆成能评估的质量属性场景",
    subtitle: "质量属性场景把模糊形容词变成可分析的六个要素。选择一个要素，看看它回答什么问题。",
    badge: "SEI 支持场景化方法",
    flowLabel: "质量属性场景六要素",
    flow: ["刺激源", "刺激", "环境", "制品", "响应", "响应度量"],
    nodeGroupLabel: "质量属性场景的六个要素",
    nodes: [
      { title: "刺激源", short: "谁或什么发起？", detail: "说明刺激来自哪个参与者、外部系统、设备或内部事件。来源不同，负载模式和响应责任也可能不同。", focus: "追问：是谁触发了这个要求？" },
      { title: "刺激", short: "具体发生了什么？", detail: "描述触发系统关注的事件，例如请求到达、节点故障、配置变更或未经授权的访问尝试。不要只写“性能变差”这样的结果词。", focus: "把事件写成可观察、可复现的动作。" },
      { title: "环境", short: "在什么条件下？", detail: "说明刺激发生时系统处于何种状态，例如正常运行、高峰负载、降级运行或维护窗口。相同刺激在不同环境下可能要求不同响应。", focus: "遗漏环境条件，会让测试无法复现，也让方案比较失去前提。" },
      { title: "制品", short: "影响系统的哪一部分？", detail: "指出受到刺激的系统对象，例如服务、数据存储、网络链路、部署节点或业务流程。范围越清晰，越容易把场景对应到架构决策。", focus: "把属性要求落到实际受影响的架构元素。" },
      { title: "响应", short: "系统应该如何表现？", detail: "描述系统在该条件下应采取的动作或可观察结果，例如完成请求、隔离故障、维持核心功能或拒绝越权操作。", focus: "响应要能被验证，不要只写“保持稳定”“确保安全”。" },
      { title: "响应度量", short: "如何判定达标？", detail: "为响应定义可测量的指标、阈值或检查方法。具体数值必须来自业务目标、合同、标准或项目约束，不能由图解随意编造。", focus: "没有度量口径，就难以比较方案或证明架构满足要求。" },
    ],
    boundary: "六要素是通用场景拆解框架。页面没有替你设定性能阈值或可用性目标；实际数值必须来自题干、需求或可核验来源。",
  });
}

function layeredArchitectureVisualizer(element) {
  return makeConceptVisualizer(element, {
    titleId: "layered-architecture-visual-title", kicker: "VISUAL EXPLAINER · 04",
    title: "分层架构：每一层既提供服务，也依赖下一层",
    subtitle: "从上到下跟踪一次请求，再反向理解结果返回。点击层名称查看职责与常见边界。",
    badge: "课程图解 · 需结合教材",
    flowHeading: "常见四层示意 · 请求向下，结果向上",
    flowLabel: "分层架构常见四层",
    flow: ["表现层", "中间层", "访问层", "数据层"],
    timeline: [
      { nodeIndex: 0, flowIndex: 0, phase: "请求进入", title: "请求到达表现层", narration: "用户或调用方发起操作。表现层接收输入、完成必要校验，并把业务请求交给中间层。", focus: "观察请求的起点：界面负责交互，不直接承担全部业务规则。" },
      { nodeIndex: 1, flowIndex: 1, phase: "请求向下", title: "中间层组织业务", narration: "中间层执行应用流程和业务规则，决定需要哪些数据或下游能力，再通过访问层获取数据。", focus: "业务规则集中在业务职责所在的位置，避免散落到 UI 或数据库访问代码中。" },
      { nodeIndex: 2, flowIndex: 2, phase: "请求向下", title: "访问层适配数据操作", narration: "访问层把业务需要转成具体的数据访问操作，隔离业务逻辑与底层存储细节。", focus: "访问层是适配与封装边界，不等于数据库本身。" },
      { nodeIndex: 3, flowIndex: 3, phase: "到达数据层", title: "数据层读取或写入", narration: "数据层执行持久化、查询或更新。至此，请求路径到达数据端；接下来结果沿相反方向返回。", focus: "图中数据层是职责概念，实际存储产品应根据数据与访问需求选择。" },
      { nodeIndex: 2, flowIndex: 2, phase: "响应返回", title: "数据结果返回访问层", narration: "存储操作完成后，结果先回到访问层，由它处理数据映射和访问细节，再交给业务层。", focus: "请求向下、结果向上；不要把返回路径误画成新的业务请求。" },
      { nodeIndex: 1, flowIndex: 1, phase: "响应返回", title: "中间层组织业务结果", narration: "中间层根据返回的数据完成业务处理，生成应用层可消费的结果。", focus: "业务判断仍由业务层负责，数据访问层不替代业务决策。" },
      { nodeIndex: 0, flowIndex: 0, phase: "响应完成", title: "表现层返回给调用方", narration: "表现层把业务结果转换为界面或接口响应，完成一次典型的分层请求往返。", focus: "这是常见示意路径；具体系统可能有缓存、异步消息或受控跨层访问。" },
    ],
    nodeGroupLabel: "分层架构四个示意层",
    nodes: [
      { title: "表现层", short: "交互与输入输出", detail: "面向用户或调用方处理界面呈现、输入校验和交互组织，再将请求交给下层业务能力。", focus: "不要把页面展示逻辑和核心业务规则全部堆在表现层。" },
      { title: "中间层", short: "业务规则与流程", detail: "承载主要业务规则、应用流程和服务编排，协调业务操作并向下层请求数据或持久化能力。", focus: "分层的关键是职责边界，不是必须采用某个具体框架。" },
      { title: "访问层", short: "数据访问与适配", detail: "隔离业务逻辑与底层存储细节，封装查询、持久化或外部数据访问方式，便于替换和维护。", focus: "访问层不等于数据库本身，也不应把业务决策随意下沉。" },
      { title: "数据层", short: "持久化与数据管理", detail: "负责数据持久化、组织和相关数据服务。具体实现可以是关系数据库、NoSQL 或其他存储，但选择应取决于数据与访问需求。", focus: "数据层是职责层，不是某个数据库产品的代名词。" },
    ],
    boundary: "四层只是常见示意，不是固定配置。课程导图指出层数可增减或合并；层数过多会带来调用、性能、可靠性和维护成本。",
  });
}

function soaReferenceVisualizer(element) {
  return makeConceptVisualizer(element, {
    titleId: "soa-reference-visual-title", kicker: "VISUAL EXPLAINER · 05",
    title: "SOA 参考架构：不是只有 ESB，而是一组协作服务",
    subtitle: "六类服务承担不同职责。点击模块理解它提供什么能力，以及它和其他模块如何配合。",
    badge: "课程导图 · 职责关系示意",
    flowHeading: "六类服务职责并列，ESB 提供连接能力",
    flowLabel: "SOA参考架构六类服务",
    separator: "·",
    flow: ["连接", "业务逻辑", "控制", "开发", "业务优化", "IT管理"],
    nodeGroupLabel: "SOA参考架构六类服务",
    nodes: [
      { title: "连接服务", short: "ESB 与服务互联", detail: "通过消息、事件和服务连接完成注册发现、路由、转换、协议适配和安全等工作，使服务能够协作。", focus: "ESB 是中介连接能力，不等同于某一个具体产品。" },
      { title: "业务逻辑服务", short: "封装业务能力", detail: "包括应用与信息访问、业务应用和伙伴服务，封装既有系统能力，并为新应用或外部伙伴提供可调用的业务服务。", focus: "判断服务边界时，回到业务能力和复用目标，而不只是拆分代码。" },
      { title: "控制服务", short: "协调信息、流程和交互", detail: "通过信息服务、流程服务和交互服务组织数据整合、业务流程控制与用户访问。它负责协调，而不是取代所有业务逻辑。", focus: "把业务能力提供者和流程/交互协调者区分开。" },
      { title: "开发服务", short: "支撑服务全生命周期", detail: "为建模、设计、实现和测试提供方法、组件与工具支持，帮助团队按统一方式构建和维护服务。", focus: "开发服务关注工程支撑，不是运行时业务请求的必经节点。" },
      { title: "业务创新与优化", short: "监控并改进流程", detail: "通过业务流程管理和活动监控分析运行表现、发现瓶颈，推动流程改进和业务响应优化。", focus: "服务上线不是终点，还要观察效果并根据反馈持续优化。" },
      { title: "IT 服务管理", short: "保障运行与治理", detail: "提供安全、目录、系统管理、资源虚拟化、监控、配置和运行保障等支撑能力。", focus: "治理和运维能力要纳入架构，而不是等上线后再补。" },
    ],
    boundary: "这是按课程导图整理的职责关系图，不代表所有 SOA 实现都必须照此固定拓扑部署。ESB 能力过度集中也可能形成性能瓶颈或单点风险。",
  });
}

function wpdrRcVisualizer(element) {
  return makeConceptVisualizer(element, {
    titleId: "wpdrrc-visual-title", kicker: "VISUAL EXPLAINER · 06",
    title: "WPDRRC：把安全工作看成持续反馈的闭环",
    subtitle: "六个环节不是孤立名词：预警指导保护，检测触发响应，恢复与复盘再反馈到前面的策略。",
    badge: "课程导图 · 六环节闭环",
    flowLabel: "WPDRRC六个环节与反馈",
    flow: ["W 预警", "P 保护", "D 检测", "R 响应", "R 恢复", "C 反击", "反馈到 W / P"],
    nodeGroupLabel: "WPDRRC六个环节",
    nodes: [
      { title: "W · 预警 Warning", short: "监测风险信号", detail: "课程导图列出的工作包括资产监测、威胁情报、态势感知、风险评估和安全预警。预警信息帮助组织提前调整防护重点。", focus: "记忆关键词：监测、情报、态势、风险、预警。" },
      { title: "P · 保护 Protect", short: "降低暴露与风险", detail: "课程导图列出的措施包括身份管理、访问控制、加密、隔离、加固、备份和安全策略。保护措施应对应具体资产和威胁。", focus: "记忆关键词：身份、权限、加密、隔离、加固、备份。" },
      { title: "D · 检测 Detect", short: "发现异常与攻击", detail: "通过漏洞扫描、入侵检测、日志分析、行为分析和异常发现，识别防护措施未能阻止或新出现的风险。", focus: "检测不是响应本身；发现后还要研判并进入处置。" },
      { title: "R · 响应 React", short: "研判并处置事件", detail: "课程导图列出的响应工作包括告警研判、隔离、阻断、取证、通报和应急处置。需要按事件影响和组织流程协调。", focus: "记忆关键词：研判、隔离、阻断、取证、通报、处置。" },
      { title: "R · 恢复 Restore", short: "恢复业务与能力", detail: "包括故障修复、数据恢复、业务连续性、灾备切换和复盘改进。恢复之后还要检查业务是否真正回到可接受状态。", focus: "恢复不是简单重启服务，还要验证数据和业务连续性。" },
      { title: "C · 反击 Counterattack", short: "阻断攻击链并强化防御", detail: "课程导图将其描述为追踪攻击来源、阻断攻击链、开展对抗和强化防御；所有操作都必须在法律允许和明确授权范围内。", focus: "特别注意合法性和授权边界，不能把反击解释为任意攻击第三方。" },
    ],
    boundary: "人员、策略、技术是模型的三大支撑要素，不是第七个环节。图中反馈关系用于表达持续改进；具体环节定义和考试表述仍以指定教材为准。",
  });
}

function lambdaKappaComparisonVisualizer(element) {
  const dimensions = [
    { label: "处理路径", lambda: "批处理层与速度层两条路径并行，结果由服务层协调。", kappa: "统一使用流处理路径，历史数据通过事件重放进入同一处理逻辑。" },
    { label: "代码维护", lambda: "同一业务逻辑可能在批处理和实时路径各实现一份，存在重复维护风险。", kappa: "处理逻辑更集中，但需要保证流处理逻辑能覆盖业务计算要求。" },
    { label: "准确性", lambda: "批处理层可承担历史数据的最终重算；速度层结果可能是暂时或近似视图。", kappa: "依赖流语义、事件重放和状态一致性，不能因单路径就假设结果天然准确。" },
    { label: "实时性", lambda: "速度层让近期事件更快可见，但需要处理两条路径结果衔接。", kappa: "数据路径更直接；实时表现仍取决于流引擎、状态和负载。" },
    { label: "历史重算", lambda: "批处理层适合对历史数据进行全量或分区重算。", kappa: "依赖日志保留、可重放能力和流处理平台，历史回放可能带来成本。" },
    { label: "复杂度", lambda: "批层、速度层和结果协调使基础设施及运维较复杂。", kappa: "路径和代码可以更统一，但对日志、重放、状态管理和流处理能力要求更高。" },
  ];
  let active = 0;
  const detailLabel = element("span", { className: "learning-concept-detail-step" });
  const lambdaText = element("p", {});
  const kappaText = element("p", {});
  const buttons = dimensions.map((item, index) => {
    const button = element("button", { className: "learning-compare-dimension", text: item.label, attrs: {
      type: "button", "aria-pressed": String(index === 0),
    } });
    button.addEventListener("click", () => { active = index; update(); });
    return button;
  });
  const pill = (text, kind) => element("span", { className: "learning-compare-node " + kind, text });
  function update() {
    const item = dimensions[active];
    buttons.forEach((button, index) => {
      button.classList.toggle("is-active", index === active);
      button.setAttribute("aria-pressed", String(index === active));
    });
    detailLabel.textContent = "比较维度 " + (active + 1) + " / " + dimensions.length + " · " + item.label;
    lambdaText.textContent = item.lambda;
    kappaText.textContent = item.kappa;
  }
  update();
  return element("section", { className: "learning-visualizer learning-visualizer-comparison", attrs: {
    "aria-labelledby": "lambda-kappa-compare-title",
  } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: "VISUAL EXPLAINER · 07" }),
        element("h3", { text: "Lambda 与 Kappa：差别在处理路径，不是名字", attrs: { id: "lambda-kappa-compare-title" } }),
        element("p", { text: "先看两种架构的数据路径，再切换比较维度。考试中要把选择理由和业务约束对应起来。" }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: "课程图解 · 对比选择" }),
    ]),
    element("div", { className: "learning-compare-architectures" }, [
      element("div", { className: "learning-compare-architecture" }, [
        element("div", { className: "learning-compare-heading" }, [element("strong", { text: "Lambda · 批流双路径" }), element("small", { text: "历史重算 + 低延迟补充" })]),
        element("div", { className: "learning-compare-lambda-flow" }, [
          pill("事件 / 数据", "is-source"),
          element("div", { className: "learning-compare-branches" }, [pill("批处理层", "is-batch"), pill("速度层", "is-speed")]),
          pill("服务层", "is-service"),
        ]),
        element("small", { className: "learning-compare-caption", text: "两路结果需要定义合并、去重和更新规则" }),
      ]),
      element("div", { className: "learning-compare-architecture" }, [
        element("div", { className: "learning-compare-heading" }, [element("strong", { text: "Kappa · 单一流路径" }), element("small", { text: "实时处理 + 历史重放" })]),
        element("div", { className: "learning-compare-kappa-flow" }, [
          pill("事件日志 / 重放", "is-source"), pill("统一流处理", "is-speed"), pill("状态 / 查询视图", "is-service"),
        ]),
        element("small", { className: "learning-compare-caption", text: "依赖日志保留、重放能力与状态一致性" }),
      ]),
    ]),
    element("div", { className: "learning-compare-selector" }, [
      element("span", { className: "learning-concept-overline", text: "切换比较维度" }),
      element("div", { className: "learning-compare-dimensions", attrs: { role: "group", "aria-label": "选择架构比较维度" } }, buttons),
    ]),
    element("div", { className: "learning-compare-detail", attrs: { "aria-live": "polite", "aria-atomic": "true" } }, [
      detailLabel,
      element("div", { className: "learning-compare-detail-columns" }, [
        element("div", {}, [element("strong", { text: "Lambda" }), lambdaText]),
        element("div", {}, [element("strong", { text: "Kappa" }), kappaText]),
      ]),
    ]),
    element("div", { className: "learning-concept-boundary" }, [
      element("strong", { text: "如何作选择" }),
      element("p", { text: "按实时延迟、历史重算频率、日志保留与重放成本、处理逻辑是否可流化、结果一致性和团队能力综合判断。Kappa 并非天然更优；Lambda 也不是所有场景都需要。" }),
    ]),
  ]);
}

export function learningVisualizerNode(unit, element) {
  if (!unit || typeof element !== "function") return null;
  switch (String(unit.id)) {
    case "1.1": return architectureOverviewVisualizer(element);
    case "7.2.1": return architectureDesignFlowVisualizer(element);
    case "8.1.3": return qualityScenarioVisualizer(element);
    case "13.1": return layeredArchitectureVisualizer(element);
    case "15.3": return soaReferenceVisualizer(element);
    case "18.4.1": return wpdrRcVisualizer(element);
    case "19.5": return lambdaKappaComparisonVisualizer(element);
    case "9.2.3.6": return inputDomainLab(element);
    case "9.2.3.7": return executionPathLab(element);
    case "19.3.3": return lambdaArchitectureLab(element);
    default: return null;
  }
}

export function learningVisualizerLibraryNode(currentUnit, element) {
  if (typeof element !== "function") return null;
  const examples = [
    {
      id: "1.1", chapter: 1, chapterTitle: "绪论",
      title: "系统架构的五个描述要素", coreKnowledge: "从边界、元素、关系、环境和原则理解架构。",
    },
    {
      id: "7.2.1", chapter: 7, chapterTitle: "系统架构设计基础知识",
      title: "架构设计决策链", coreKnowledge: "把需求、架构驱动因素、策略、职责和复审连成闭环。",
    },
    {
      id: "8.1.3", chapter: 8, chapterTitle: "系统质量属性与架构评估",
      title: "质量属性场景六要素", coreKnowledge: "把抽象的质量要求转成可分析、可测试的场景。",
    },
    {
      id: "13.1", chapter: 13, chapterTitle: "层次式架构设计理论与实践",
      title: "分层架构职责与调用", coreKnowledge: "理解表现、中间、访问和数据层的职责边界。",
    },
    {
      id: "15.3", chapter: 15, chapterTitle: "面向服务架构设计理论与实践",
      title: "SOA 参考架构", coreKnowledge: "识别连接、业务逻辑、控制、开发、优化和 IT 管理服务。",
    },
    {
      id: "18.4.1", chapter: 18, chapterTitle: "安全架构设计理论与实践",
      title: "WPDRRC 安全闭环", coreKnowledge: "把预警、保护、检测、响应、恢复和反击连成反馈闭环。",
    },
    {
      id: "19.5", chapter: 19, chapterTitle: "大数据架构设计理论与实践",
      title: "Lambda / Kappa 架构对比", coreKnowledge: "围绕处理路径、实时性、重算和复杂度选择架构。",
    },
    {
      id: "9.2.3.6", chapter: 9, chapterTitle: "软件可靠性基础知识",
      title: "输入域分类模型", coreKnowledge: "按输入类别的实际使用权重估计使用可靠性。",
    },
    {
      id: "9.2.3.7", chapter: 9, chapterTitle: "软件可靠性基础知识",
      title: "执行路径分析模型", coreKnowledge: "将路径出现概率与路径条件失效概率结合。",
    },
    {
      id: "19.3.3", chapter: 19, chapterTitle: "大数据架构",
      title: "Lambda 架构分层", coreKnowledge: "理解批处理层、速度层和服务层的职责与数据流。",
    },
  ].filter((item) => item.id !== String(currentUnit?.id ?? ""));
  if (!examples.length) return null;
  return element("details", { className: "learning-visualizer-library" }, [
    element("summary", { text: "知识可视化图解与互动实验 · " + examples.length + " 个专题" }),
    element("p", {
      className: "learning-visualizer-library-intro",
      text: "这些图解覆盖架构组成、设计决策、质量属性、分层、SOA、安全闭环与大数据架构。点击图中节点查看逐点解析；自选探索不会推进课程进度，也不会生成答题记录。",
    }),
    ...examples.map((unit) => learningVisualizerNode(unit, element)),
  ]);
}
