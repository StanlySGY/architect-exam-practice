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

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function requestFlowVisualizer(element) {
  const nodeX = [90, 234, 378, 522, 666, 810];
  const nodeNames = ["用户端", "API 网关", "缓存", "服务 A", "服务 B", "数据库"];
  const scenarios = {
    normal: {
      label: "正常请求", outbound: [0, 1, 3, 5], inbound: [5, 3, 1, 0],
      states: ["发起请求", "转发请求", "未经过", "处理请求", "未启用", "读写数据"],
      message: "正常路径：请求经 API 网关进入应用服务，查询数据库，再沿调用链返回。",
      processing: "服务 A 正在处理请求并等待数据库结果。",
    },
    cacheHit: {
      label: "缓存命中", outbound: [0, 1, 2], inbound: [2, 1, 0],
      states: ["发起请求", "转发请求", "命中 ✓", "直接绕过", "直接绕过", "未访问"],
      message: "缓存命中：缓存直接返回已有数据，应用服务和数据库都不需要执行这次读取。",
      processing: "缓存已命中，正在把缓存中的结果返回给客户端。",
    },
    cacheMiss: {
      label: "缓存未命中", outbound: [0, 1, 2, 3, 5], inbound: [5, 3, 2, 1, 0],
      states: ["发起请求", "转发请求", "未命中 ×", "回源查询", "未启用", "读取数据"],
      message: "缓存未命中：请求先查缓存，再回源到应用服务和数据库；结果通常还会写回缓存。",
      processing: "缓存未命中，应用服务正在访问数据库，并准备回填缓存。",
    },
    failover: {
      label: "节点故障切换", outbound: [0, 1, 3, 4, 5], inbound: [5, 4, 1, 0],
      states: ["发起请求", "重新路由", "未启用", "超时 / 故障", "接管处理", "读取数据"],
      message: "故障切换：服务 A 超时后，网关/治理机制把请求转向服务 B；这要求超时、健康检查和重试策略配合。",
      processing: "服务 B 已接管请求，正在完成数据库访问。",
    },
  };
  let mode = "normal";
  let speedFactor = 1;
  let elapsed = 0;
  let lastFrame = 0;
  let frameHandle = null;
  let running = false;
  let lastAnnouncement = "";
  let root = null;

  const diagram = svgElement("svg", {
    class: "dynamic-architecture-svg", viewBox: "0 0 900 280", role: "group",
    "aria-label": "系统请求与响应在用户端、API 网关、缓存、应用服务和数据库之间移动的动态架构图",
  });
  const defs = svgElement("defs");
  const addMarker = (id, color) => {
    const marker = svgElement("marker", { id, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  };
  addMarker("dynamic-request-arrow", "#25866a");
  addMarker("dynamic-response-arrow", "#c18a32");
  diagram.append(defs);

  const stems = svgElement("g", { class: "dynamic-architecture-stems" });
  nodeX.forEach((x) => stems.append(svgElement("path", {
    d: `M ${x} 122 V 166 M ${x} 122 V 218`, class: "dynamic-architecture-stem",
  })));
  diagram.append(stems);
  const requestPath = svgElement("path", { class: "dynamic-architecture-route is-request", "marker-end": "url(#dynamic-request-arrow)" });
  const responsePath = svgElement("path", { class: "dynamic-architecture-route is-response", "marker-end": "url(#dynamic-response-arrow)" });
  diagram.append(requestPath, responsePath);

  const nodeGroups = nodeNames.map((name, index) => {
    const group = svgElement("g", { class: "dynamic-architecture-node", "data-node": index });
    group.append(
      svgElement("rect", { x: nodeX[index] - 58, y: 27, width: 116, height: 95, rx: 11, class: "dynamic-architecture-node-box" }),
      svgElement("circle", { cx: nodeX[index], cy: 48, r: 5, class: "dynamic-architecture-node-dot" }),
    );
    const title = svgElement("text", { x: nodeX[index], y: 76, "text-anchor": "middle", class: "dynamic-architecture-node-title" });
    title.textContent = name;
    const status = svgElement("text", { x: nodeX[index], y: 99, "text-anchor": "middle", class: "dynamic-architecture-node-status" });
    status.textContent = "待命";
    group.append(title, status);
    diagram.append(group);
    return { group, status };
  });
  const laneRequest = svgElement("text", { x: 18, y: 170, class: "dynamic-architecture-lane-label" });
  laneRequest.textContent = "请求 →";
  const laneResponse = svgElement("text", { x: 18, y: 238, class: "dynamic-architecture-lane-label is-response" });
  laneResponse.textContent = "← 响应";
  diagram.append(laneRequest, laneResponse);
  const requestPacket = svgElement("g", { class: "dynamic-architecture-packet is-request" });
  requestPacket.append(svgElement("circle", { r: 13, class: "dynamic-architecture-packet-halo" }), svgElement("circle", { r: 6, class: "dynamic-architecture-packet-core" }));
  const responsePacket = svgElement("g", { class: "dynamic-architecture-packet is-response" });
  responsePacket.append(svgElement("circle", { r: 13, class: "dynamic-architecture-packet-halo" }), svgElement("circle", { r: 6, class: "dynamic-architecture-packet-core" }));
  diagram.append(requestPacket, responsePacket);

  const sceneButtons = Object.entries(scenarios).map(([key, scenario]) => {
    const button = element("button", { className: "dynamic-flow-scene", text: scenario.label, attrs: {
      type: "button", "aria-pressed": String(key === mode),
    } });
    button.addEventListener("click", () => setMode(key));
    return { key, button };
  });
  const play = element("button", { className: "dynamic-flow-control is-primary", text: "暂停动画", attrs: { type: "button", "aria-pressed": "true" } });
  const reset = element("button", { className: "dynamic-flow-control", text: "重置", attrs: { type: "button" } });
  const speed = element("select", { className: "dynamic-flow-speed", attrs: { "aria-label": "动态示意图播放速度" } }, [
    element("option", { text: "慢速", attrs: { value: "0.65" } }),
    element("option", { text: "正常", attrs: { value: "1", selected: true } }),
    element("option", { text: "快速", attrs: { value: "1.5" } }),
  ]);
  const liveStage = element("strong", { className: "dynamic-flow-stage", text: "请求正在发出…", attrs: { "aria-live": "polite", "aria-atomic": "true" } });
  const explanation = element("p", { className: "dynamic-flow-explanation", text: scenarios[mode].message });
  const motionState = element("span", { className: "dynamic-flow-motion-state", text: "动态运行中" });
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  function routeData(indices, y) {
    return indices.map((index, step) => `${step === 0 ? "M" : "L"} ${nodeX[index]} ${y}`).join(" ");
  }
  function setMode(nextMode) {
    if (!scenarios[nextMode]) return;
    mode = nextMode;
    const scenario = scenarios[mode];
    requestPath.setAttribute("d", routeData(scenario.outbound, 166));
    responsePath.setAttribute("d", routeData(scenario.inbound, 218));
    nodeGroups.forEach(({ group, status }, index) => {
      group.classList.toggle("is-bypassed", scenario.states[index].includes("绕过") || ["未启用", "未访问", "未经过"].includes(scenario.states[index]));
      group.classList.toggle("is-failed", scenario.states[index].includes("故障"));
      group.classList.toggle("is-takeover", scenario.states[index].includes("接管"));
      status.textContent = scenario.states[index];
    });
    sceneButtons.forEach(({ key, button }) => button.setAttribute("aria-pressed", String(key === mode)));
    explanation.textContent = scenario.message;
    elapsed = 0;
    lastFrame = 0;
    lastAnnouncement = "";
    updateFrame(0);
  }
  function placePacket(packet, path, progress) {
    const length = path.getTotalLength();
    if (progress === null || !length) {
      packet.setAttribute("visibility", "hidden");
      return;
    }
    const point = path.getPointAtLength(length * Math.max(0, Math.min(1, progress)));
    packet.setAttribute("transform", `translate(${point.x} ${point.y})`);
    packet.setAttribute("visibility", "visible");
  }
  function updateFrame(time) {
    const cycle = 6800;
    const phase = (time % cycle) / cycle;
    const scenario = scenarios[mode];
    let activeIndex = scenario.outbound[0];
    let announcement = "";
    if (phase < 0.43) {
      const progress = phase / 0.43;
      placePacket(requestPacket, requestPath, progress);
      placePacket(responsePacket, responsePath, null);
      const index = Math.min(scenario.outbound.length - 1, Math.floor(progress * scenario.outbound.length));
      activeIndex = scenario.outbound[index];
      announcement = `请求包正在经过：${nodeNames[activeIndex]}`;
    } else if (phase < 0.53) {
      placePacket(requestPacket, requestPath, null);
      placePacket(responsePacket, responsePath, null);
      activeIndex = scenario.outbound[scenario.outbound.length - 1];
      announcement = scenario.processing;
    } else if (phase < 0.96) {
      const progress = (phase - 0.53) / 0.43;
      placePacket(requestPacket, requestPath, null);
      placePacket(responsePacket, responsePath, progress);
      const index = Math.min(scenario.inbound.length - 1, Math.floor(progress * scenario.inbound.length));
      activeIndex = scenario.inbound[index];
      announcement = `响应包正在返回：${nodeNames[activeIndex]}`;
    } else {
      placePacket(requestPacket, requestPath, null);
      placePacket(responsePacket, responsePath, null);
      activeIndex = 0;
      announcement = "本轮请求完成，下一轮即将开始。";
    }
    nodeGroups.forEach(({ group }, index) => group.classList.toggle("is-current", index === activeIndex));
    if (announcement !== lastAnnouncement) {
      liveStage.textContent = announcement;
      lastAnnouncement = announcement;
    }
    diagram.dataset.phase = phase.toFixed(3);
    diagram.dataset.activeNode = String(activeIndex);
    diagram.dataset.running = String(running);
  }
  function tick(now) {
    if (!running) return;
    if (!root?.isConnected) {
      running = false;
      frameHandle = null;
      return;
    }
    if (lastFrame) elapsed += Math.min(80, now - lastFrame) * speedFactor;
    lastFrame = now;
    updateFrame(elapsed);
    frameHandle = requestAnimationFrame(tick);
  }
  function pause() {
    running = false;
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    lastFrame = 0;
    play.textContent = "播放动画";
    play.setAttribute("aria-pressed", "false");
    motionState.textContent = "已暂停";
    diagram.dataset.running = "false";
  }
  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    play.textContent = "暂停动画";
    play.setAttribute("aria-pressed", "true");
    motionState.textContent = "动态运行中";
    frameHandle = requestAnimationFrame(tick);
  }
  play.addEventListener("click", () => { if (running) pause(); else start(); });
  reset.addEventListener("click", () => {
    elapsed = 0;
    lastFrame = 0;
    updateFrame(0);
    liveStage.textContent = "请求从用户端重新开始。";
    lastAnnouncement = liveStage.textContent;
  });
  speed.addEventListener("change", () => {
    speedFactor = Number(speed.value) || 1;
    lastFrame = 0;
    updateFrame(elapsed);
  });

  root = element("section", { className: "learning-visualizer learning-visualizer-dynamic", attrs: {
    "aria-labelledby": "architecture-dynamic-title",
  } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: "LIVE ARCHITECTURE · 01" }),
        element("h3", { text: "看一笔请求如何穿过系统架构", attrs: { id: "architecture-dynamic-title" } }),
        element("p", { text: "图中的请求包和响应包会沿连线持续移动。切换场景，观察缓存如何缩短路径，以及服务故障后请求如何改道。" }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: "实时数据流模拟" }),
    ]),
    element("div", { className: "dynamic-flow-scenes", attrs: { role: "group", "aria-label": "选择动态网络场景" } }, sceneButtons.map(({ button }) => button)),
    element("div", { className: "dynamic-flow-canvas" }, [
      diagram,
      element("div", { className: "dynamic-flow-legend" }, [
        element("span", {}, [element("i", { className: "dynamic-flow-legend-dot is-request" }), "请求包"]),
        element("span", {}, [element("i", { className: "dynamic-flow-legend-dot is-response" }), "响应包"]),
        motionState,
      ]),
    ]),
    element("div", { className: "dynamic-flow-toolbar" }, [
      element("div", { className: "dynamic-flow-controls" }, [play, reset, speed]),
      liveStage,
    ]),
    explanation,
    element("p", { className: "dynamic-flow-boundary", text: "这是用于理解请求路径的教学拓扑，不代表教材规定的固定部署结构。缓存策略、重试次数、超时阈值和故障转移能力都应由实际系统需求决定。" }),
    element("div", { className: "dynamic-flow-concepts" }, ["系统边界", "关键元素", "元素关系", "外部环境", "设计原则"].map((label) => element("span", { text: label }))),
  ]);
  setMode(mode);
  if (reducedMotion) {
    running = false;
    play.textContent = "播放动画";
    play.setAttribute("aria-pressed", "false");
    motionState.textContent = "系统已减少动态效果；可手动播放";
  } else {
    start();
  }
  return root;
}

function architectureOverviewVisualizer(element) {
  return requestFlowVisualizer(element);
}

function lambdaStreamVisualizer(element) {
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  let running = false;
  let frameHandle = null;
  let lastFrame = 0;
  let elapsed = 0;
  let speedFactor = 1;
  let mode = "stream";
  let root = null;
  const diagram = svgElement("svg", {
    class: "lambda-live-svg", viewBox: "0 0 860 330", role: "group",
    "aria-label": "Lambda 架构实时数据沿速度层、历史数据沿批处理层，两路结果汇合到服务层",
  });
  const defs = svgElement("defs");
  const addMarker = (id, color) => {
    const marker = svgElement("marker", { id, viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto" });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  };
  addMarker("lambda-live-speed-arrow", "#25866a");
  addMarker("lambda-live-batch-arrow", "#c18a32");
  diagram.append(defs);
  const route = (className, d, color) => {
    const path = svgElement("path", { class: className, d, stroke: color, "marker-end": className.includes("batch") ? "url(#lambda-live-batch-arrow)" : "url(#lambda-live-speed-arrow)" });
    diagram.append(path);
    return path;
  };
  const sourceToBatch = route("lambda-live-route is-batch", "M 190 145 Q 255 78 330 82", "#c18a32");
  const batchToService = route("lambda-live-route is-batch", "M 505 82 Q 585 82 660 145", "#c18a32");
  const sourceToSpeed = route("lambda-live-route is-speed", "M 190 185 Q 255 252 330 248", "#25866a");
  const speedToService = route("lambda-live-route is-speed", "M 505 248 Q 585 248 660 185", "#25866a");
  const createNode = (x, y, w, h, title, subtitle, kind) => {
    const group = svgElement("g", { class: "lambda-live-node " + kind });
    group.append(svgElement("rect", { x, y, width: w, height: h, rx: 12, class: "lambda-live-node-box" }));
    const dot = svgElement("circle", { cx: x + 17, cy: y + 19, r: 5, class: "lambda-live-node-dot" });
    const heading = svgElement("text", { x: x + w / 2, y: y + 43, "text-anchor": "middle", class: "lambda-live-node-title" });
    heading.textContent = title;
    const note = svgElement("text", { x: x + w / 2, y: y + 65, "text-anchor": "middle", class: "lambda-live-node-note" });
    note.textContent = subtitle;
    group.append(dot, heading, note);
    diagram.append(group);
    return group;
  };
  const source = createNode(50, 115, 140, 100, "数据源", "事件日志 / 历史数据", "is-source");
  const batch = createNode(330, 35, 175, 95, "批处理层", "历史全量 / 分区计算", "is-batch");
  const speed = createNode(330, 200, 175, 95, "速度层", "近期事件 / 低延迟", "is-speed");
  const service = createNode(660, 115, 160, 100, "服务层", "合并视图 / 对外查询", "is-service");
  const packet = (kind) => {
    const group = svgElement("g", { class: "lambda-live-packet " + kind });
    group.append(svgElement("circle", { r: 12, class: "lambda-live-packet-halo" }), svgElement("circle", { r: 5.5, class: "lambda-live-packet-core" }));
    diagram.append(group);
    return group;
  };
  const streamPackets = [packet("is-speed"), packet("is-speed is-secondary")];
  const batchPackets = [packet("is-batch"), packet("is-batch is-secondary"), packet("is-batch is-tertiary")];
  const modeStream = element("button", { className: "lambda-live-scene is-selected", text: "新事件持续到达", attrs: { type: "button", "aria-pressed": "true" } });
  const modeReplay = element("button", { className: "lambda-live-scene", text: "历史数据重算", attrs: { type: "button", "aria-pressed": "false" } });
  const play = element("button", { className: "dynamic-flow-control is-primary", text: "暂停动画", attrs: { type: "button", "aria-pressed": "true" } });
  const reset = element("button", { className: "dynamic-flow-control", text: "重置", attrs: { type: "button" } });
  const speedSelect = element("select", { className: "dynamic-flow-speed", attrs: { "aria-label": "Lambda 数据流播放速度" } }, [
    element("option", { text: "慢速", attrs: { value: "0.65" } }),
    element("option", { text: "正常", attrs: { value: "1", selected: true } }),
    element("option", { text: "快速", attrs: { value: "1.5" } }),
  ]);
  const stage = element("strong", { className: "dynamic-flow-stage", text: "实时事件沿速度层流动", attrs: { "aria-live": "polite" } });
  const status = element("span", { className: "dynamic-flow-motion-state", text: "动态运行中" });
  const explanation = element("p", { className: "dynamic-flow-explanation", text: "速度层持续处理新事件，让近期数据快速可见；批处理层在后台计算历史视图，两路结果在服务层协调。" });
  const segments = {
    speed: [sourceToSpeed, speedToService],
    batch: [sourceToBatch, batchToService],
  };
  const lengths = Object.fromEntries(Object.entries(segments).map(([key, paths]) => [key, paths.map((path) => path.getTotalLength())]));
  function locate(paths, segmentLengths, progress) {
    const total = segmentLengths.reduce((sum, value) => sum + value, 0);
    let remaining = Math.max(0, Math.min(.999999, progress)) * total;
    for (let index = 0; index < paths.length; index++) {
      if (remaining <= segmentLengths[index]) return paths[index].getPointAtLength(remaining);
      remaining -= segmentLengths[index];
    }
    return paths.at(-1).getPointAtLength(segmentLengths.at(-1));
  }
  function move(packetNode, pathKey, progress) {
    const point = locate(segments[pathKey], lengths[pathKey], progress);
    packetNode.setAttribute("transform", `translate(${point.x} ${point.y})`);
  }
  function setMode(nextMode) {
    mode = nextMode;
    modeStream.classList.toggle("is-selected", mode === "stream");
    modeReplay.classList.toggle("is-selected", mode === "rebuild");
    modeStream.setAttribute("aria-pressed", String(mode === "stream"));
    modeReplay.setAttribute("aria-pressed", String(mode === "rebuild"));
    explanation.textContent = mode === "stream"
      ? "速度层持续处理新事件，让近期数据快速可见；批处理层在后台计算历史视图，两路结果在服务层协调。"
      : "历史重算：批处理层集中回放历史数据，多个批次依次进入服务层；速度层仍可接收实时事件，必须处理新旧结果的衔接。";
    stage.textContent = mode === "stream" ? "实时事件沿速度层流动" : "历史批次正在重算并发布";
    elapsed = 0;
    lastFrame = 0;
    updateFrame(0);
  }
  function updateFrame(time) {
    const streamPeriod = 3000;
    const batchPeriod = mode === "stream" ? 7200 : 4600;
    streamPackets.forEach((item, index) => move(item, "speed", ((time / streamPeriod) + index * .52) % 1));
    batchPackets.forEach((item, index) => {
      const progress = ((time / batchPeriod) + index * (mode === "stream" ? .34 : .22)) % 1;
      move(item, "batch", progress);
      item.style.opacity = mode === "stream" && index > 0 ? ".34" : "1";
    });
    const batchActive = mode === "rebuild" || Math.floor(time / batchPeriod) !== Math.floor(Math.max(0, time - 80) / batchPeriod);
    source.classList.add("is-active");
    batch.classList.toggle("is-active", batchActive);
    speed.classList.add("is-active");
    service.classList.toggle("is-active", Math.sin((time % 2600) / 2600 * Math.PI * 2) > .25);
    diagram.dataset.running = String(running);
    diagram.dataset.mode = mode;
    diagram.dataset.elapsed = String(Math.round(time));
  }
  function tick(now) {
    if (!running) return;
    if (!root?.isConnected) { running = false; frameHandle = null; return; }
    if (lastFrame) elapsed += Math.min(80, now - lastFrame) * speedFactor;
    lastFrame = now;
    updateFrame(elapsed);
    frameHandle = requestAnimationFrame(tick);
  }
  function pause() {
    running = false;
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    lastFrame = 0;
    play.textContent = "播放动画";
    play.setAttribute("aria-pressed", "false");
    status.textContent = "已暂停";
    diagram.dataset.running = "false";
  }
  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    play.textContent = "暂停动画";
    play.setAttribute("aria-pressed", "true");
    status.textContent = "动态运行中";
    frameHandle = requestAnimationFrame(tick);
  }
  modeStream.addEventListener("click", () => setMode("stream"));
  modeReplay.addEventListener("click", () => setMode("rebuild"));
  play.addEventListener("click", () => { if (running) pause(); else start(); });
  reset.addEventListener("click", () => { elapsed = 0; lastFrame = 0; updateFrame(0); });
  speedSelect.addEventListener("change", () => { speedFactor = Number(speedSelect.value) || 1; lastFrame = 0; updateFrame(elapsed); });
  root = element("section", { className: "learning-visualizer learning-visualizer-dynamic learning-visualizer-lambda-live", attrs: {
    "aria-labelledby": "lambda-live-title",
  } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: "LIVE DATA FLOW · 02" }),
        element("h3", { text: "Lambda 架构：实时流和历史批次如何汇合？", attrs: { id: "lambda-live-title" } }),
        element("p", { text: "绿色事件包持续穿过速度层，琥珀色批次包沿批处理层移动，两路数据最终进入服务层。" }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: "双路径动态模拟" }),
    ]),
    element("div", { className: "dynamic-flow-scenes" }, [modeStream, modeReplay]),
    element("div", { className: "dynamic-flow-canvas" }, [
      diagram,
      element("div", { className: "dynamic-flow-legend" }, [
        element("span", {}, [element("i", { className: "dynamic-flow-legend-dot is-request" }), "实时事件 · 速度层"]),
        element("span", {}, [element("i", { className: "dynamic-flow-legend-dot is-response" }), "历史批次 · 批处理层"]),
        status,
      ]),
    ]),
    element("div", { className: "dynamic-flow-toolbar" }, [
      element("div", { className: "dynamic-flow-controls" }, [play, reset, speedSelect]), stage,
    ]),
    explanation,
    element("p", { className: "dynamic-flow-boundary", text: "动画用于解释 Lambda 的双路径职责，不代表固定的计算引擎、批次大小或刷新周期。实际系统还需要定义结果合并、去重、覆盖顺序和一致性规则。" }),
  ]);
  setMode(mode);
  if (reducedMotion) {
    play.textContent = "播放动画";
    play.setAttribute("aria-pressed", "false");
    status.textContent = "系统已减少动态效果；可手动播放";
  } else start();
  return root;
}

function legacyArchitectureDesignFlowVisualizer(element) {
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

function legacyQualityScenarioVisualizer(element) {
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

function legacyLayeredArchitectureVisualizer(element) {
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

function legacySoaReferenceVisualizer(element) {
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

function legacyWpdrRcVisualizer(element) {
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

function legacyLambdaKappaComparisonVisualizer(element) {
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

let courseMotionSequence = 0;

function courseMotionVisualizer(element, config) {
  let mode = config.defaultMode || Object.keys(config.modes || {})[0] || "default";
  let running = false;
  let elapsed = 0;
  let lastFrame = 0;
  let frameHandle = null;
  let speedFactor = 1;
  let selectedNode = 0;
  let root = null;
  const prefix = "course-motion-" + (++courseMotionSequence);
  const diagram = svgElement("svg", {
    class: "course-motion-svg",
    viewBox: config.viewBox || "0 0 900 300",
    role: "group",
    "aria-label": config.diagramLabel || config.title,
  });
  const defs = svgElement("defs");
  const markerColors = {
    request: "#25866a", response: "#c18a32", feedback: "#7382a5",
    batch: "#c18a32", speed: "#25866a", orchestration: "#7182b4", support: "#7c8795",
  };
  for (const [kind, color] of Object.entries(markerColors)) {
    const marker = svgElement("marker", {
      id: `${prefix}-${kind}`, viewBox: "0 0 10 10", refX: "8", refY: "5",
      markerWidth: "6", markerHeight: "6", orient: "auto",
    });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  }
  diagram.append(defs);

  (config.panels || []).forEach((panel) => {
    diagram.append(svgElement("rect", {
      x: panel.x, y: panel.y, width: panel.w, height: panel.h, rx: 12,
      class: "course-motion-panel",
    }));
    const title = svgElement("text", {
      x: panel.x + 14, y: panel.y + 22, class: "course-motion-panel-title",
    });
    title.textContent = panel.title;
    diagram.append(title);
    if (panel.subtitle) {
      const subtitle = svgElement("text", {
        x: panel.x + 14, y: panel.y + 39, class: "course-motion-panel-note",
      });
      subtitle.textContent = panel.subtitle;
      diagram.append(subtitle);
    }
  });
  (config.labels || []).forEach((item) => {
    const label = svgElement("text", {
      x: item.x, y: item.y, class: "course-motion-label" + (item.kind ? ` is-${item.kind}` : ""),
      "text-anchor": item.anchor || "middle",
    });
    label.textContent = item.text;
    diagram.append(label);
  });
  (config.connectors || []).forEach((item) => {
    diagram.append(svgElement("path", { d: item.d, class: "course-motion-connector" + (item.kind ? ` is-${item.kind}` : "") }));
  });

  const routeRecords = config.routes.map((route, index) => {
    const path = svgElement("path", {
      d: route.d,
      class: `course-motion-route is-${route.kind || "request"}`,
      "marker-end": `url(#${prefix}-${route.kind || "request"})`,
      "data-route": route.id || String(index),
    });
    diagram.append(path);
    return { ...route, path, length: 0 };
  });

  const nodeRecords = config.nodes.map((node, index) => {
    const group = svgElement("g", { class: `course-motion-node${node.kind ? ` is-${node.kind}` : ""}`, "data-node": index });
    const width = node.w || 126;
    const height = node.h || 66;
    group.append(
      svgElement("rect", {
        x: node.x - width / 2, y: node.y - height / 2, width, height, rx: 10,
        class: "course-motion-node-box",
      }),
      svgElement("circle", {
        cx: node.x - width / 2 + 13, cy: node.y - height / 2 + 14, r: 4,
        class: "course-motion-node-dot",
      }),
    );
    const title = svgElement("text", {
      x: node.x, y: node.y - 2, "text-anchor": "middle", class: "course-motion-node-title",
    });
    title.textContent = node.title;
    const note = svgElement("text", {
      x: node.x, y: node.y + 17, "text-anchor": "middle", class: "course-motion-node-note",
    });
    note.textContent = node.note || node.short || "";
    group.append(title, note);
    diagram.append(group);
    return { ...node, group };
  });

  const packetRecords = (config.packets || []).map((packet) => {
    const group = svgElement("g", { class: `course-motion-packet is-${packet.kind || "request"}` });
    group.append(
      svgElement("circle", { r: 12, class: "course-motion-packet-halo" }),
      svgElement("circle", { r: 5.5, class: "course-motion-packet-core" }),
    );
    diagram.append(group);
    return { ...packet, group };
  });

  const modeButtons = Object.entries(config.modes || {}).map(([key, value]) => {
    const button = element("button", {
      className: "dynamic-flow-scene", text: value.label,
      attrs: { type: "button", "aria-pressed": String(key === mode) },
    });
    button.addEventListener("click", () => setMode(key));
    return { key, button };
  });
  const play = element("button", {
    className: "dynamic-flow-control is-primary", text: "播放动画",
    attrs: { type: "button", "aria-pressed": "false" },
  });
  const reset = element("button", { className: "dynamic-flow-control", text: "重置", attrs: { type: "button" } });
  const speed = element("select", { className: "dynamic-flow-speed", attrs: { "aria-label": "示意图播放速度" } }, [
    element("option", { text: "慢速", attrs: { value: "0.65" } }),
    element("option", { text: "正常", attrs: { value: "1", selected: true } }),
    element("option", { text: "快速", attrs: { value: "1.5" } }),
  ]);
  const motionState = element("span", { className: "dynamic-flow-motion-state", text: "已暂停" });
  const stage = element("strong", { className: "dynamic-flow-stage", text: config.stage || "数据正在沿架构关系移动", attrs: { "aria-live": "polite" } });
  const explanation = element("p", { className: "dynamic-flow-explanation", text: config.description || "" });
  const nodeButtons = config.nodes.map((node, index) => {
    const button = element("button", {
      className: "course-motion-node-button", text: node.title,
      attrs: { type: "button", "aria-pressed": String(index === selectedNode) },
    });
    button.addEventListener("click", () => { selectedNode = index; updateNodeDetail(); });
    return button;
  });
  const detailStep = element("span", { className: "learning-concept-detail-step" });
  const detailTitle = element("strong", { className: "learning-concept-detail-title" });
  const detailText = element("p", { className: "learning-concept-detail-text" });
  const detailFocus = element("small", { className: "learning-concept-detail-focus" });
  function updateNodeDetail() {
    const node = config.nodes[selectedNode];
    nodeButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === selectedNode)));
    detailStep.textContent = `模块 ${selectedNode + 1} / ${config.nodes.length}`;
    detailTitle.textContent = node.title;
    detailText.textContent = node.detail || node.short || "";
    detailFocus.textContent = node.focus || "";
  }

  function routeEnabled(route) {
    const selected = config.modes?.[mode]?.routes;
    return !selected || selected.includes(route.id);
  }
  function packetEnabled(packet) {
    const selected = config.modes?.[mode]?.packets;
    return !packet.modes || packet.modes.includes(mode);
  }
  function setMode(nextMode) {
    if (!config.modes?.[nextMode]) return;
    mode = nextMode;
    elapsed = 0;
    lastFrame = 0;
    const selected = config.modes[mode];
    modeButtons.forEach(({ key, button }) => button.setAttribute("aria-pressed", String(key === mode)));
    explanation.textContent = selected.description;
    stage.textContent = selected.stage || selected.label;
    updateFrame(0);
  }
  function updateFrame(time) {
    nodeRecords.forEach(({ group }) => group.classList.remove("is-active"));
    routeRecords.forEach((route) => {
      route.path.classList.toggle("is-muted", !routeEnabled(route));
      route.path.classList.toggle("is-current", routeEnabled(route));
    });
    packetRecords.forEach((packet) => {
      const route = routeRecords.find((item) => item.id === packet.route);
      if (!route || !routeEnabled(route) || !packetEnabled(packet)) {
        packet.group.setAttribute("visibility", "hidden");
        return;
      }
      packet.group.setAttribute("visibility", "visible");
      const progress = ((time / (packet.period || 4200)) + (packet.offset || 0)) % 1;
      const directed = packet.reverse ? 1 - progress : progress;
      if (!route.length) route.length = route.path.getTotalLength();
      const point = route.path.getPointAtLength(route.length * directed);
      packet.group.setAttribute("transform", `translate(${point.x} ${point.y})`);
      if (route.nodes?.length) {
        const current = Math.min(route.nodes.length - 1, Math.floor(directed * route.nodes.length));
        const nodeIndex = route.nodes[current];
        nodeRecords[nodeIndex]?.group.classList.add("is-active");
      }
    });
    diagram.dataset.mode = mode;
    diagram.dataset.running = String(running);
    diagram.dataset.elapsed = String(Math.round(time));
  }
  function tick(now) {
    if (!running) return;
    if (!root?.isConnected) { running = false; frameHandle = null; return; }
    if (lastFrame) elapsed += Math.min(80, now - lastFrame) * speedFactor;
    lastFrame = now;
    updateFrame(elapsed);
    frameHandle = requestAnimationFrame(tick);
  }
  function pause() {
    running = false;
    if (frameHandle !== null) cancelAnimationFrame(frameHandle);
    frameHandle = null;
    lastFrame = 0;
    play.textContent = "播放动画";
    play.setAttribute("aria-pressed", "false");
    motionState.textContent = "已暂停";
    diagram.dataset.running = "false";
  }
  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    play.textContent = "暂停动画";
    play.setAttribute("aria-pressed", "true");
    motionState.textContent = "动态运行中";
    frameHandle = requestAnimationFrame(tick);
  }
  play.addEventListener("click", () => { if (running) pause(); else start(); });
  reset.addEventListener("click", () => { elapsed = 0; lastFrame = 0; updateFrame(0); });
  speed.addEventListener("change", () => { speedFactor = Number(speed.value) || 1; lastFrame = 0; updateFrame(elapsed); });

  root = element("section", { className: "learning-visualizer learning-visualizer-dynamic learning-visualizer-motion", attrs: {
    "aria-labelledby": prefix + "-title",
  } }, [
    element("div", { className: "learning-visualizer-heading" }, [
      element("div", {}, [
        element("span", { className: "learning-visualizer-kicker", text: config.kicker || "MOVING CONCEPT · LIVE" }),
        element("h3", { text: config.title, attrs: { id: prefix + "-title" } }),
        element("p", { text: config.subtitle || "图中的数据粒子持续沿真实连线移动；暂停、调速或切换场景观察架构关系。" }),
      ]),
      element("span", { className: "learning-visualizer-badge", text: config.badge || "动态架构模拟" }),
    ]),
    ...(modeButtons.length ? [element("div", { className: "dynamic-flow-scenes", attrs: { role: "group", "aria-label": "选择演示场景" } }, modeButtons.map(({ button }) => button))] : []),
    element("div", { className: "dynamic-flow-canvas" }, [
      diagram,
      element("div", { className: "dynamic-flow-legend" }, [
        ...(config.legend || [{ kind: "request", label: "数据 / 请求" }]).map((item) => element("span", {}, [
          element("i", { className: "dynamic-flow-legend-dot is-" + item.kind }), item.label,
        ])),
        motionState,
      ]),
    ]),
    element("div", { className: "dynamic-flow-toolbar" }, [
      element("div", { className: "dynamic-flow-controls" }, [play, reset, speed]), stage,
    ]),
    explanation,
    element("div", { className: "course-motion-node-list", attrs: { role: "group", "aria-label": config.nodeGroupLabel || "选择模块查看解释" } }, nodeButtons),
    element("div", { className: "learning-concept-detail", attrs: { "aria-live": "polite", "aria-atomic": "true" } }, [detailStep, detailTitle, detailText, detailFocus]),
    element("p", { className: "dynamic-flow-boundary", text: config.boundary || "本图用于帮助理解概念关系，不代表所有项目必须采用相同的物理部署拓扑；具体机制应结合需求与题干条件判断。" }),
  ]);
  updateNodeDetail();
  if (config.modes) setMode(mode);
  else updateFrame(0);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  if (reducedMotion) {
    motionState.textContent = "系统已减少动态效果；可手动播放";
  } else start();
  return root;
}

function architectureDesignFlowVisualizer(element) {
  return courseMotionVisualizer(element, {
    title: "架构设计是一条会反复迭代的决策链",
    subtitle: "绿色决策流从需求走向评估；蓝灰色反馈流从复审返回设计策略，推动下一轮调整。",
    badge: "决策流 + 反馈流",
    diagramLabel: "需求、架构驱动因素、设计策略、职责接口、迭代分解和评估复审之间的动态迭代关系",
    viewBox: "0 0 900 300",
    nodes: [
      { x: 88, y: 132, title: "需求与约束", note: "功能 / 质量 / 外部", detail: "同时收集功能需求、质量属性需求、外部约束，以及已有资产、技术和组织因素。性能、安全、成本和交付时间不能被功能清单替代。", focus: "常见失分点：只抄业务功能，不识别质量属性和外部约束。" },
      { x: 233, y: 132, title: "架构驱动因素", note: "优先级 / 冲突 / 假设", detail: "从输入中识别对系统结构和关键决策影响最大的因素，明确优先级、冲突和假设。它们决定设计要优先解决什么。", focus: "把题干中的高风险质量场景和硬约束提炼为驱动因素。" },
      { x: 378, y: 132, title: "设计策略", note: "风格 / 模式 / 战术", detail: "围绕驱动因素选择候选架构风格、设计概念、模式或策略，并解释其如何回应需求。策略是候选决策，不是脱离上下文的标准答案。", focus: "写清“因为哪个约束，所以采用哪项策略”，不要先定技术再找理由。" },
      { x: 523, y: 132, title: "职责与接口", note: "元素 / 连接件 / 部署", detail: "识别架构元素和连接方式，为元素分配职责，定义接口、交互和必要的部署边界，再检查跨组件约束。", focus: "把策略落到可检查的结构：谁负责、如何交互、边界在哪里。" },
      { x: 668, y: 132, title: "迭代分解", note: "原型 / 风险 / 细化", detail: "架构设计是迭代和风险驱动的过程。对尚未解决的部分继续分解、做原型或验证关键机制，再根据反馈修订设计。", focus: "不是一次画完；要针对不确定性和高风险点逐步细化。" },
      { x: 813, y: 132, title: "评估复审", note: "风险 / 权衡 / 验证", detail: "检查架构是否回应驱动因素，识别风险、敏感点和权衡点；通过复审、原型和测试证据反馈设计，并记录决策理由。", focus: "案例答题可按“需求—决策—机制—风险—验证”形成闭环。" },
    ],
    routes: [
      { id: "decision", kind: "request", d: "M 88 132 H 813", nodes: [0, 1, 2, 3, 4, 5] },
      { id: "feedback", kind: "feedback", d: "M 813 176 C 790 248 470 260 378 176", nodes: [5, 4, 3, 2] },
    ],
    packets: [
      { route: "decision", kind: "request", period: 7200, offset: 0 },
      { route: "decision", kind: "request", period: 7200, offset: 0.52 },
      { route: "feedback", kind: "feedback", period: 6100, offset: 0.25 },
    ],
    labels: [{ x: 605, y: 244, text: "复审反馈：调整策略 / 重新验证", kind: "feedback" }],
    legend: [{ kind: "request", label: "设计决策推进" }, { kind: "feedback", label: "复审反馈" }],
    stage: "决策向前推进，评估结果持续反馈",
    boundary: "本图概括课程主线与 SEI Attribute-Driven Design 的共同思路；不代表所有项目必须采用完全相同的阶段名称、顺序或工具。",
  });
}

function qualityScenarioVisualizer(element) {
  return courseMotionVisualizer(element, {
    title: "质量属性场景：让模糊要求变成可测量的响应",
    subtitle: "一个场景数据包依次经过六个要素；到达响应度量后，系统才能判断是否达标。",
    badge: "六要素动态拆解",
    diagramLabel: "刺激源、刺激、环境、制品、响应和响应度量六个质量属性场景要素",
    viewBox: "0 0 900 270",
    nodes: [
      { x: 88, y: 128, title: "刺激源", note: "谁发起？", detail: "说明刺激来自哪个参与者、外部系统、设备或内部事件。来源不同，负载模式和响应责任也可能不同。", focus: "追问：是谁触发了这个要求？" },
      { x: 233, y: 128, title: "刺激", note: "发生什么？", detail: "描述触发系统关注的事件，例如请求到达、节点故障、配置变更或未经授权的访问尝试。不要只写“性能变差”这样的结果词。", focus: "把事件写成可观察、可复现的动作。" },
      { x: 378, y: 128, title: "环境", note: "什么条件？", detail: "说明刺激发生时系统处于何种状态，例如正常运行、高峰负载、降级运行或维护窗口。相同刺激在不同环境下可能要求不同响应。", focus: "遗漏环境条件，会让测试无法复现，也让方案比较失去前提。" },
      { x: 523, y: 128, title: "制品", note: "影响哪里？", detail: "指出受到刺激的系统对象，例如服务、数据存储、网络链路、部署节点或业务流程。范围越清晰，越容易把属性要求对应到架构决策。", focus: "把属性要求落到实际受影响的架构元素。" },
      { x: 668, y: 128, title: "响应", note: "系统做什么？", detail: "描述系统在该条件下应采取的动作或可观察结果，例如完成请求、隔离故障、维持核心功能或拒绝越权操作。", focus: "响应要能被验证，不要只写“保持稳定”“确保安全”。" },
      { x: 813, y: 128, title: "响应度量", note: "如何判定？", detail: "为响应定义可测量的指标、阈值或检查方法。具体数值必须来自业务目标、合同、标准或项目约束，不能由图解随意编造。", focus: "没有度量口径，就难以比较方案或证明架构满足要求。" },
    ],
    routes: [{ id: "scenario", kind: "request", d: "M 88 128 H 813", nodes: [0, 1, 2, 3, 4, 5] }],
    packets: [
      { route: "scenario", kind: "request", period: 5600, offset: 0 },
      { route: "scenario", kind: "request", period: 5600, offset: 0.5 },
    ],
    labels: [{ x: 450, y: 218, text: "刺激描述 → 系统响应 → 可验证的度量" }],
    stage: "场景从刺激源流向可验证的响应度量",
    boundary: "六要素是通用场景拆解框架。页面没有替你设定性能阈值或可用性目标；实际数值必须来自题干、需求或可核验来源。",
  });
}

function layeredArchitectureVisualizer(element) {
  const y = [62, 152, 242, 332];
  const names = ["表现层", "中间层", "访问层", "数据层"];
  const notes = ["交互 · 输入输出", "业务规则 · 流程", "数据访问 · 适配", "持久化 · 数据管理"];
  const explanations = [
    "面向用户或调用方处理界面呈现、输入校验和交互组织，再将请求交给下层业务能力。",
    "承载主要业务规则、应用流程和服务编排，协调业务操作并向下层请求数据或持久化能力。",
    "隔离业务逻辑与底层存储细节，封装查询、持久化或外部数据访问方式，便于替换和维护。",
    "负责数据持久化、组织和相关数据服务。具体实现可以是关系数据库、NoSQL 或其他存储，但选择应取决于数据与访问需求。",
  ];
  return courseMotionVisualizer(element, {
    title: "分层架构：请求逐层向下，结果沿原路返回",
    subtitle: "左侧绿色请求包向下穿过四层，右侧琥珀色响应包反向返回；两条轨道对应同一次调用往返。",
    badge: "请求 / 响应双向动画",
    diagramLabel: "表现层、中间层、访问层、数据层之间请求向下和响应向上的分层架构",
    viewBox: "0 0 900 380",
    nodes: names.map((title, index) => ({
      x: 450, y: y[index], w: 250, h: 58, title, note: notes[index],
      detail: explanations[index],
      focus: ["不要把页面展示逻辑和核心业务规则全部堆在表现层。", "分层的关键是职责边界，不是必须采用某个具体框架。", "访问层不等于数据库本身，也不应把业务决策随意下沉。", "数据层是职责层，不是某个数据库产品的代名词。"][index],
    })),
    connectors: y.flatMap((value) => [
      { d: `M 235 ${value} H 325` }, { d: `M 575 ${value} H 665` },
    ]),
    routes: [
      { id: "request", kind: "request", d: `M 235 ${y[0]} V ${y[3]}`, nodes: [0, 1, 2, 3] },
      { id: "response", kind: "response", d: `M 665 ${y[3]} V ${y[0]}`, nodes: [3, 2, 1, 0] },
    ],
    packets: [
      { route: "request", kind: "request", period: 5200, offset: 0 },
      { route: "request", kind: "request", period: 5200, offset: 0.52 },
      { route: "response", kind: "response", period: 5200, offset: 0.22 },
    ],
    labels: [
      { x: 150, y: 32, text: "请求 ↓", kind: "request" },
      { x: 750, y: 32, text: "↑ 响应", kind: "response" },
    ],
    legend: [{ kind: "request", label: "请求：表现层 → 数据层" }, { kind: "response", label: "响应：数据层 → 表现层" }],
    modes: {
      read: { label: "查询读取", routes: ["request", "response"], description: "查询请求向下到达数据层，读取结果沿右侧轨道逐层返回；业务规则仍由中间层组织。", stage: "读取：请求下行，结果上行" },
      write: { label: "写入更新", routes: ["request", "response"], description: "写入请求同样经过职责边界到达数据层；持久化完成后，状态或结果沿响应轨道返回。", stage: "写入：持久化后返回结果" },
    },
    defaultMode: "read",
    boundary: "四层只是常见示意，不是固定配置。课程导图指出层数可增减或合并；层数过多会带来调用、性能、可靠性和维护成本。",
  });
}

function soaReferenceVisualizer(element) {
  return courseMotionVisualizer(element, {
    title: "SOA 参考架构：服务通过 ESB 协作，治理能力贯穿全程",
    subtitle: "切换直接服务调用和流程编排；下方开发、业务优化与 IT 管理是支撑能力，不是每笔请求都要经过的串行节点。",
    badge: "服务路由 + 横向支撑",
    diagramLabel: "SOA 的连接服务、业务逻辑服务、控制服务、开发服务、业务优化和 IT 管理协作关系",
    viewBox: "0 0 900 390",
    nodes: [
      { x: 75, y: 155, w: 118, title: "应用 / 伙伴", note: "服务消费者", detail: "服务消费者可以是内部应用、外部伙伴或其他服务。它通过约定接口调用可复用的业务能力。", focus: "关注服务契约和消费者边界。" },
      { x: 280, y: 155, w: 142, title: "连接服务 · ESB", note: "路由 / 转换 / 适配", detail: "通过消息、事件和服务连接完成注册发现、路由、转换、协议适配和安全等工作，使服务能够协作。", focus: "ESB 是中介连接能力，不等同于某一个具体产品。" },
      { x: 555, y: 80, w: 150, title: "业务逻辑服务", note: "封装业务能力", detail: "包括应用与信息访问、业务应用和伙伴服务，封装既有系统能力，并为新应用或外部伙伴提供可调用的业务服务。", focus: "判断服务边界时，回到业务能力和复用目标，而不只是拆分代码。" },
      { x: 555, y: 215, w: 150, title: "控制服务", note: "流程 / 信息 / 交互", detail: "通过信息服务、流程服务和交互服务组织数据整合、业务流程控制与用户访问。它负责协调，而不是取代所有业务逻辑。", focus: "把业务能力提供者和流程/交互协调者区分开。" },
      { x: 280, y: 325, w: 150, h: 58, kind: "support", title: "开发服务", note: "建模 / 设计 / 测试", detail: "为建模、设计、实现和测试提供方法、组件与工具支持，帮助团队按统一方式构建和维护服务。", focus: "开发服务关注工程支撑，不是运行时业务请求的必经节点。" },
      { x: 555, y: 325, w: 154, h: 58, kind: "support", title: "业务优化", note: "流程监控 / 改进", detail: "通过业务流程管理和活动监控分析运行表现、发现瓶颈，推动流程改进和业务响应优化。", focus: "服务上线不是终点，还要观察效果并根据反馈持续优化。" },
      { x: 780, y: 325, w: 144, h: 58, kind: "support", title: "IT 服务管理", note: "安全 / 目录 / 运维", detail: "提供安全、目录、系统管理、资源虚拟化、监控、配置和运行保障等支撑能力。", focus: "治理和运维能力要纳入架构，而不是等上线后再补。" },
      { x: 825, y: 155, w: 120, title: "服务消费者", note: "调用结果", detail: "目标服务或调用方消费处理结果；具体拓扑会因服务契约、流程和部署方式不同而变化。", focus: "图中只表达逻辑协作，不是固定的物理网络位置。" },
    ],
    routes: [
      { id: "direct", kind: "request", d: "M 75 155 H 280 Q 390 155 455 80 H 825", nodes: [0, 1, 2, 7] },
      { id: "orchestrated", kind: "orchestration", d: "M 75 170 H 280 Q 390 170 455 215 H 555 Q 610 215 610 80 H 825", nodes: [0, 1, 3, 2, 7] },
      { id: "support", kind: "support", d: "M 280 325 H 555 H 780", nodes: [4, 5, 6] },
    ],
    packets: [
      { route: "direct", kind: "request", period: 5900, offset: 0, modes: ["direct"] },
      { route: "direct", kind: "request", period: 5900, offset: 0.54, modes: ["direct"] },
      { route: "orchestrated", kind: "orchestration", period: 6500, offset: 0, modes: ["orchestrated"] },
      { route: "support", kind: "support", period: 3800, offset: 0.3 },
    ],
    modes: {
      direct: { label: "直接服务调用", routes: ["direct", "support"], description: "消费者经 ESB 路由到业务逻辑服务；ESB 负责连接与适配，业务服务提供可复用能力。", stage: "消息经连接服务到达业务服务" },
      orchestrated: { label: "流程编排", routes: ["orchestrated", "support"], description: "消费者请求由控制服务协调流程，再调用业务逻辑服务；流程控制与业务能力提供者是不同职责。", stage: "控制服务协调业务流程" },
    },
    defaultMode: "direct",
    legend: [{ kind: "request", label: "服务调用" }, { kind: "orchestration", label: "流程编排" }, { kind: "support", label: "横向支撑 / 治理" }],
    boundary: "这是按课程导图整理的职责关系图，不代表所有 SOA 实现都必须照此固定拓扑部署。ESB 能力过度集中也可能形成性能瓶颈或单点风险。",
  });
}

function wpdrRcVisualizer(element) {
  const nodes = [
    { x: 450, y: 58, title: "W · 预警", note: "监测 / 情报 / 风险", detail: "课程导图列出的工作包括资产监测、威胁情报、态势感知、风险评估和安全预警。预警信息帮助组织提前调整防护重点。", focus: "记忆关键词：监测、情报、态势、风险、预警。" },
    { x: 640, y: 120, title: "P · 保护", note: "身份 / 权限 / 加固", detail: "课程导图列出的措施包括身份管理、访问控制、加密、隔离、加固、备份和安全策略。保护措施应对应具体资产和威胁。", focus: "记忆关键词：身份、权限、加密、隔离、加固、备份。" },
    { x: 640, y: 242, title: "D · 检测", note: "扫描 / 日志 / 异常", detail: "通过漏洞扫描、入侵检测、日志分析、行为分析和异常发现，识别防护措施未能阻止或新出现的风险。", focus: "检测不是响应本身；发现后还要研判并进入处置。" },
    { x: 450, y: 304, title: "R · 响应", note: "研判 / 隔离 / 处置", detail: "课程导图列出的响应工作包括告警研判、隔离、阻断、取证、通报和应急处置。需要按事件影响和组织流程协调。", focus: "记忆关键词：研判、隔离、阻断、取证、通报、处置。" },
    { x: 260, y: 242, title: "R · 恢复", note: "修复 / 备份 / 连续性", detail: "包括故障修复、数据恢复、业务连续性、灾备切换和复盘改进。恢复之后还要检查业务是否真正回到可接受状态。", focus: "恢复不是简单重启服务，还要验证数据和业务连续性。" },
    { x: 260, y: 120, title: "C · 反击", note: "阻断攻击链 / 强化", detail: "课程导图将其描述为追踪攻击来源、阻断攻击链、开展对抗和强化防御；所有操作都必须在法律允许和明确授权范围内。", focus: "特别注意合法性和授权边界，不能把反击解释为任意攻击第三方。" },
  ];
  return courseMotionVisualizer(element, {
    title: "WPDRRC：安全工作是一条持续反馈的闭环",
    subtitle: "安全事件沿六个环节循环推进；恢复、反击与复盘结果持续反馈到预警和保护策略。",
    badge: "六环节闭环动画",
    diagramLabel: "WPDRRC 预警、保护、检测、响应、恢复、反击六环节围绕持续改进形成闭环",
    viewBox: "0 0 900 370",
    nodes,
    routes: [{
      id: "security-loop", kind: "request",
      d: "M 516 58 Q 560 58 574 120 L 574 242 Q 560 304 516 304 H 326 Q 240 304 240 242 V 120 Q 240 58 384 58 Z",
      nodes: [0, 1, 2, 3, 4, 5],
    }],
    packets: [
      { route: "security-loop", kind: "request", period: 9700, offset: 0 },
      { route: "security-loop", kind: "request", period: 9700, offset: 0.48 },
    ],
    labels: [{ x: 450, y: 186, text: "持续监测 · 复盘改进", kind: "feedback" }, { x: 450, y: 207, text: "人员 · 策略 · 技术" }],
    stage: "安全事件沿 W → P → D → R → R → C 持续循环",
    boundary: "人员、策略、技术是模型的三大支撑要素，不是第七个环节。图中闭环用于表达持续改进；具体环节定义和考试表述仍以指定教材为准。",
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
  const visual = courseMotionVisualizer(element, {
    title: "Lambda 与 Kappa：看数据粒子走哪条路",
    subtitle: "左侧 Lambda 把实时事件和历史批次分开处理，右侧 Kappa 让实时与历史重放复用同一条流处理路径。",
    badge: "双架构并行动画",
    diagramLabel: "Lambda 双路径与 Kappa 单一流处理路径的数据粒子移动对比",
    viewBox: "0 0 900 300",
    panels: [
      { x: 16, y: 14, w: 410, h: 270, title: "Lambda · 批流双路径", subtitle: "历史批处理 + 低延迟补充" },
      { x: 474, y: 14, w: 410, h: 270, title: "Kappa · 单一流路径", subtitle: "实时处理 + 历史事件重放" },
    ],
    nodes: [
      { x: 80, y: 150, w: 112, title: "事件 / 数据", note: "实时 + 历史" },
      { x: 210, y: 86, w: 130, title: "批处理层", note: "历史重算" },
      { x: 210, y: 214, w: 130, title: "速度层", note: "低延迟补充" },
      { x: 365, y: 150, w: 112, title: "服务视图", note: "结果协调" },
      { x: 535, y: 150, w: 112, title: "事件日志", note: "持久保留" },
      { x: 680, y: 150, w: 132, title: "统一流处理", note: "实时 / 重放" },
      { x: 835, y: 150, w: 112, title: "状态视图", note: "查询结果" },
    ],
    routes: [
      { id: "lambda-batch", kind: "batch", d: "M 80 150 Q 140 86 210 86 Q 290 86 365 150", nodes: [0, 1, 3] },
      { id: "lambda-speed", kind: "speed", d: "M 80 150 Q 140 214 210 214 Q 290 214 365 150", nodes: [0, 2, 3] },
      { id: "kappa-stream", kind: "request", d: "M 535 150 H 680 H 835", nodes: [4, 5, 6] },
    ],
    packets: [
      { route: "lambda-batch", kind: "batch", period: 6800, offset: 0 },
      { route: "lambda-batch", kind: "batch", period: 6800, offset: 0.5 },
      { route: "lambda-speed", kind: "speed", period: 3900, offset: 0 },
      { route: "lambda-speed", kind: "speed", period: 3900, offset: 0.5 },
      { route: "kappa-stream", kind: "request", period: 4700, offset: 0 },
      { route: "kappa-stream", kind: "feedback", period: 4700, offset: 0.5 },
    ],
    legend: [{ kind: "speed", label: "实时事件" }, { kind: "batch", label: "历史批次 / 重放" }],
    stage: "两种架构正在并行处理实时与历史数据",
    boundary: "Kappa 并非天然更优；它依赖日志保留、事件重放、状态管理和流处理能力。Lambda 需要承担双路径结果协调、去重与更新顺序等复杂度。",
  });
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
  function update() {
    const item = dimensions[active];
    buttons.forEach((button, index) => {
      button.classList.toggle("is-active", index === active);
      button.setAttribute("aria-pressed", String(index === active));
    });
    detailLabel.textContent = `比较维度 ${active + 1} / ${dimensions.length} · ${item.label}`;
    lambdaText.textContent = item.lambda;
    kappaText.textContent = item.kappa;
  }
  visual.append(
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
  );
  update();
  return visual;
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
    case "19.3.3": return lambdaStreamVisualizer(element);
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
      text: "专题图中的请求包、响应包、决策流、安全事件和批流数据粒子都会沿 SVG 连线持续移动；可暂停、调速、切换场景，并点击模块查看职责与考试要点。自选探索不会推进课程进度，也不会生成答题记录。",
    }),
    ...examples.map((unit) => learningVisualizerNode(unit, element)),
  ]);
}
