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
export function learningVisualizerNode(unit, element) {
  if (!unit || typeof element !== "function") return null;
  switch (String(unit.id)) {
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
    element("summary", { text: "自选互动实验 · " + examples.length + " 个知识点" }),
    element("p", {
      className: "learning-visualizer-library-intro",
      text: "独立探索这些概念，不会推进课程进度，也不会生成答题记录。所有演示参数均标注其示例边界。",
    }),
    ...examples.map((unit) => learningVisualizerNode(unit, element)),
  ]);
}
