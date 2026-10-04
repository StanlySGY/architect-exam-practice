// 知识图谱：受限力导向布局 + 平移缩放交互，从 app.js 拆分出的独立模块。
// 渲染入口由 app.js 调用；openEntry 属于应用层（跳转阅读视图），通过 initWikiGraphDeps 注入。
import { $, element, emptyMessage } from "./ui.js";

let graphDeps = {};

export function initWikiGraphDeps(deps) {
  graphDeps = { ...graphDeps, ...deps };
}

// 知识图谱使用受限力导向布局：有弹性，但完成计算后停止，避免持续晃动。
const GRAPH_WORLD_HEIGHT = 560;
const GRAPH_CHAPTER_COLORS = [
  "#1f6b4f",
  "#55786a",
  "#7b7464",
  "#667b8c",
  "#896f76",
  "#7d7b91",
];
// 颜色分组（Obsidian color groups 约定）：按状态 / 按关联度着色。
const WIKI_STATUS_NAMES = { draft: "待校对", reviewed: "已校对", flagged: "有疑问" };
const WIKI_STATUS_COLORS = { draft: "#d8902f", reviewed: "#1f6b4f", flagged: "#b84d3d" };
const WIKI_DEGREE_COLORS = ["#9aa79e", "#55786a", "#1f6b4f", "#143d2c"];
let wikiGraphState = null;

function graphHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function graphClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function destroyWikiGraph() {
  if (wikiGraphState?.raf) cancelAnimationFrame(wikiGraphState.raf);
  wikiGraphState = null;
}

function graphWorldForCanvas(canvas) {
  const height = GRAPH_WORLD_HEIGHT;
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  return { width: Math.max(1, height * aspect), height };
}

function graphPointFromEvent(svg, event, world) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * world.width,
    y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * world.height,
  };
}

function graphWorldPoint(graph, event) {
  const point = graphPointFromEvent(graph.svg, event, graph.world);
  return {
    x: (point.x - graph.tx) / graph.scale,
    y: (point.y - graph.ty) / graph.scale,
  };
}

function updateWikiGraphTransform(graph) {
  graph.content.setAttribute(
    "transform",
    `translate(${graph.tx} ${graph.ty}) scale(${graph.scale})`,
  );
  updateWikiGraphLabels(graph);
  if (graph.popoverNodeId) {
    positionWikiGraphPopover(graph, graph.nodesById.get(graph.popoverNodeId));
  }
}

function wikiGraphLabelRequired(graph, node) {
  return Boolean(
    node.id === graph.selectedId ||
      node.id === graph.hoveredId ||
      graph.searchMatches.has(node.id) ||
      node.element.classList.contains("is-neighbor") ||
      node.element.matches(":focus-visible"),
  );
}

// sigma.js 的 labelRenderedSizeThreshold 约定：节点渲染尺寸（像素）达到阈值才显示标签，
// 悬停/选中/邻居/搜索命中始终显示。
const LABEL_RENDERED_THRESHOLD = 4;

function wikiGraphLabelBox(node) {
  const half = node.labelWidth / 2 + 4;
  const top = node.labelPos.y - 4;
  return {
    left: node.labelPos.x - half,
    right: node.labelPos.x + half,
    top,
    bottom: top + 15,
  };
}

function updateWikiGraphLabels(graph) {
  const view = graph.view;
  const candidates = [];
  for (const node of graph.nodes) {
    // 标签在缩放变换之外的屏幕空间层：位置跟随节点，字号恒定不随缩放膨胀。
    const x = node.x * graph.scale + graph.tx;
    const y = node.y * graph.scale + graph.ty + node.radius * graph.scale + 13;
    node.labelPos = { x, y };
    const required = wikiGraphLabelRequired(graph, node);
    node.labelVisible =
      x > -60 &&
      x < view.width + 60 &&
      y > -20 &&
      y < view.height + 20 &&
      (required || node.radius * graph.scale >= LABEL_RENDERED_THRESHOLD);
    if (node.labelVisible) candidates.push(node);
  }
  candidates.sort((a, b) => {
    const aRequired = wikiGraphLabelRequired(graph, a);
    const bRequired = wikiGraphLabelRequired(graph, b);
    if (aRequired !== bRequired) return Number(bRequired) - Number(aRequired);
    return b.degree - a.degree || a.title.localeCompare(b.title, "zh-CN");
  });
  const occupied = [];
  for (const node of candidates) {
    if (!node.labelWidth) {
      node.labelWidth =
        node.labelElement?.getComputedTextLength?.() ||
        [...node.title].length * 11;
    }
    const required = wikiGraphLabelRequired(graph, node);
    const box = wikiGraphLabelBox(node);
    const overlaps = occupied.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );
    if (overlaps && !required) {
      node.labelVisible = false;
      continue;
    }
    occupied.push(box);
  }
  for (const node of graph.nodes) {
    const label = node.labelElement;
    if (!label) continue;
    if (!node.labelVisible) {
      label.classList.add("is-hidden");
      continue;
    }
    label.classList.remove("is-hidden");
    label.setAttribute("x", node.labelPos.x);
    label.setAttribute("y", node.labelPos.y);
  }
}

// 悬停预览卡（Obsidian 式）：标题 + 章节 + 关联数 + 摘要摘录 + 关键要点前两条。
function showWikiGraphTooltip(graph, node) {
  const tooltip = graph.tooltip;
  if (!tooltip) return;
  tooltip.replaceChildren(
    ...[
      element("strong", { text: node.title }),
      element("span", {
        className: "wiki-graph-tooltip-meta",
        text: `第 ${node.chapter} 章 · ${node.degree} 条关联`,
      }),
      node.summary ? element("p", { text: node.summary }) : null,
      (node.keyPoints ?? []).length
        ? element(
            "ul",
            { className: "wiki-graph-tooltip-points" },
            node.keyPoints.slice(0, 2).map((point) => element("li", { text: point })),
          )
        : null,
    ].filter(Boolean),
  );
  const k = graph.view.width / graph.world.width;
  const x = (node.x * graph.scale + graph.tx) * k;
  const y = (node.y * graph.scale + graph.ty) * k;
  const flip = x + 330 > graph.view.width;
  tooltip.style.left = `${graphClamp(
    flip ? x - 322 : x + 18,
    8,
    Math.max(8, graph.view.width - 314),
  )}px`;
  tooltip.style.top = `${graphClamp(y - 24, 8, Math.max(8, graph.view.height - 170))}px`;
  tooltip.hidden = false;
}

function hideWikiGraphTooltip(graph) {
  if (graph.tooltip) graph.tooltip.hidden = true;
}

// 点击节点的详情气泡：原地展示，可展开到整个画布大小，导航改为气泡里的主动选择。
function positionWikiGraphPopover(graph, node) {
  const popover = graph.popover;
  if (!popover || popover.hidden) return;
  if (popover.classList.contains("is-expanded")) {
    // 展开模式铺满画布，正文区自行滚动。
    popover.style.left = "2%";
    popover.style.top = "2%";
    popover.style.width = "96%";
    popover.style.maxHeight = "96%";
    return;
  }
  popover.style.width = "";
  popover.style.maxHeight = "";
  const k = graph.view.width / graph.world.width;
  const x = (node.x * graph.scale + graph.tx) * k;
  const y = (node.y * graph.scale + graph.ty) * k;
  const flip = x + 340 > graph.view.width;
  popover.style.left = `${graphClamp(
    flip ? x - 326 : x + 20,
    8,
    Math.max(8, graph.view.width - 326),
  )}px`;
  popover.style.top = `${graphClamp(y - 30, 8, Math.max(8, graph.view.height - 230))}px`;
}

function showWikiGraphPopover(graph, node) {
  const popover = graph.popover;
  if (!popover) return;
  graph.popoverNodeId = node.id;
  const expanded = Boolean(graph.popoverExpanded);
  popover.classList.toggle("is-expanded", expanded);
  const body = element("div", { className: "wiki-graph-popover-body" });
  // 注意:replaceChildren 会把 null 参数字符串化成 "null" 文本节点,
  // 条件渲染必须先收集成数组并过滤 Boolean。
  body.replaceChildren(
    ...[
      element("span", {
      className: "wiki-graph-tooltip-meta",
      text: `第 ${node.chapter} 章 · ${node.section || "整章"} · ${node.degree} 条关联`,
    }),
    node.summary
      ? element("p", { className: "wiki-graph-popover-summary", text: node.summary })
      : null,
    (node.keyPoints ?? []).length
      ? element("div", { className: "wiki-graph-popover-points" }, [
          element("h5", { text: "关键要点" }),
          element(
            "ul",
            {},
            node.keyPoints
              .slice(0, expanded ? undefined : 3)
              .map((point) => element("li", { text: point })),
          ),
        ])
      : null,
    expanded && (node.commonMistakes ?? []).length
      ? element("div", { className: "wiki-graph-popover-points mistakes" }, [
          element("h5", { text: "常见误区" }),
          element("ul", {}, node.commonMistakes.map((point) => element("li", { text: point }))),
        ])
      : null,
    expanded && (node.related ?? []).length
      ? element("div", { className: "wiki-graph-popover-related" }, [
          element("h5", { text: "关联知识点" }),
          element(
            "div",
            { className: "wiki-related" },
            node.related.map((title, index) => {
              const targetId = node.links?.[index];
              const tag = element("span", {
                className: `wiki-related-tag${targetId ? " linked" : ""}`,
                text: title,
              });
              if (targetId) {
                tag.addEventListener("click", () => {
                  hideWikiGraphPopover(graph);
                  graphDeps.openEntry?.(targetId);
                });
              }
              return tag;
            }),
          ),
        ])
      : null,
    ].filter(Boolean),
  );
  popover.replaceChildren(
    element("div", { className: "wiki-graph-popover-head" }, [
      element("strong", { text: node.title }),
      element("span", {
        className: `wiki-status ${node.status}`,
        text: WIKI_STATUS_NAMES[node.status] || node.status,
      }),
      element("button", {
        className: "icon-button wiki-graph-popover-toggle",
        text: expanded ? "⤡" : "⤢",
        attrs: {
          type: "button",
          "aria-label": expanded ? "收起详情" : "展开到页面大小",
          title: expanded ? "收起详情" : "展开到页面大小",
        },
      }),
      element("button", {
        className: "icon-button wiki-graph-popover-close",
        text: "×",
        attrs: { type: "button", "aria-label": "关闭详情" },
      }),
    ]),
    body,
    element("div", { className: "wiki-graph-popover-actions" }, [
      element("button", {
        className: "secondary",
        text: "在阅读视图打开",
        attrs: { type: "button" },
      }),
    ]),
  );
  popover
    .querySelector(".wiki-graph-popover-toggle")
    .addEventListener("click", () => {
      graph.popoverExpanded = !graph.popoverExpanded;
      showWikiGraphPopover(graph, node);
    });
  popover
    .querySelector(".wiki-graph-popover-close")
    .addEventListener("click", () => hideWikiGraphPopover(graph));
  popover
    .querySelector(".wiki-graph-popover-actions button")
    .addEventListener("click", () => {
      hideWikiGraphPopover(graph);
      graphDeps.openEntry?.(node.id);
    });
  popover.hidden = false;
  positionWikiGraphPopover(graph, node);
}

function hideWikiGraphPopover(graph) {
  graph.popoverNodeId = null;
  if (graph.popover) graph.popover.hidden = true;
}

// 邻域集合:深度 1 = 直接相邻,深度 2 = 两跳内(Obsidian local graph 约定)。
function wikiGraphNeighborhood(graph, rootId, depth) {
  const found = new Set([rootId]);
  let frontier = new Set([rootId]);
  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set();
    for (const id of frontier) {
      for (const neighbor of graph.adjacency.get(id) ?? []) {
        if (!found.has(neighbor)) {
          found.add(neighbor);
          next.add(neighbor);
        }
      }
    }
    frontier = next;
  }
  return found;
}

export function updateWikiGraphFocus(graph) {
  const focusId = graph.hoveredId || graph.selectedId;
  const depth = graph.focusDepth ?? 1;
  // depth 0 = 关闭邻域高亮;1 = 直接相邻(默认);2 = 两跳邻域。
  let focus = null;
  if (focusId && depth >= 2) focus = wikiGraphNeighborhood(graph, focusId, depth);
  else if (focusId && depth === 1)
    focus = new Set([focusId, ...(graph.adjacency.get(focusId) ?? [])]);
  for (const node of graph.nodes) {
    const isFocus = focus?.has(node.id) ?? false;
    node.element.classList.toggle("is-selected", node.id === graph.selectedId);
    node.element.classList.toggle(
      "is-neighbor",
      Boolean(focus && isFocus && node.id !== focusId),
    );
    node.element.classList.toggle("is-muted", Boolean(focus && !isFocus));
  }
  for (const edge of graph.edges) {
    const hot = Boolean(
      focus && (edge.source.id === focusId || edge.target.id === focusId),
    );
    edge.element.classList.toggle("is-hot", hot);
    edge.element.classList.toggle("is-muted", Boolean(focus && !hot));
  }
  updateWikiGraphLabels(graph);
}

export function updateWikiGraphSearch(graph, value) {
  const term = value.trim().toLowerCase();
  graph.searchTerm = term;
  const matches = term
    ? graph.nodes.filter((node) => node.title.toLowerCase().includes(term))
    : [];
  graph.searchMatches = new Set(matches.map((node) => node.id));
  if ($("#wiki-graph-summary") && graph.summaryText) {
    $("#wiki-graph-summary").textContent = term
      ? `${graph.summaryText} · 找到 ${matches.length} 个`
      : graph.summaryText;
  }
  for (const node of graph.nodes) {
    const isMatch = !term || graph.searchMatches.has(node.id);
    node.element.classList.toggle("is-search-match", Boolean(term && isMatch));
    node.element.classList.toggle("is-search-muted", Boolean(term && !isMatch));
  }
  updateWikiGraphLabels(graph);
}

export function fitWikiGraph(graph) {
  if (!graph.nodes.length) return;
  const padding = 42;
  const minX = Math.min(...graph.nodes.map((node) => node.x - node.radius));
  const maxX = Math.max(...graph.nodes.map((node) => node.x + node.radius));
  const minY = Math.min(...graph.nodes.map((node) => node.y - node.radius));
  const maxY = Math.max(...graph.nodes.map((node) => node.y + node.radius));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  graph.scale = graphClamp(
    Math.min(
      (graph.world.width - padding * 2) / width,
      (graph.world.height - padding * 2) / height,
      1.25,
    ),
    0.42,
    1.25,
  );
  graph.tx = (graph.world.width - width * graph.scale) / 2 - minX * graph.scale;
  graph.ty = (graph.world.height - height * graph.scale) / 2 - minY * graph.scale;
  updateWikiGraphTransform(graph);
}

// 目录定位：把指定条目的节点居中并高亮，用于目录与图谱联动。
export function focusWikiGraphNode(id) {
  const graph = wikiGraphState;
  if (!graph) return;
  const node = graph.nodesById.get(id);
  if (!node) return;
  graph.selectedId = id;
  graph.tx = graph.world.width / 2 - node.x * graph.scale;
  graph.ty = graph.world.height / 2 - node.y * graph.scale;
  updateWikiGraphTransform(graph);
  updateWikiGraphFocus(graph);
}

function updateWikiGraphPositions(graph) {
  for (const node of graph.nodes) {
    node.element.setAttribute("transform", `translate(${node.x} ${node.y})`);
  }
  for (const edge of graph.edges) {
    edge.element.setAttribute("x1", edge.source.x);
    edge.element.setAttribute("y1", edge.source.y);
    edge.element.setAttribute("x2", edge.target.x);
    edge.element.setAttribute("y2", edge.target.y);
  }
  updateWikiGraphLabels(graph);
  if (graph.popoverNodeId) {
    positionWikiGraphPopover(graph, graph.nodesById.get(graph.popoverNodeId));
  }
}

function startWikiGraphSimulation(graph, alpha = 1) {
  if (graph.raf) cancelAnimationFrame(graph.raf);
  graph.alpha = alpha;
  graph.ticks = 0;
  const tick = () => {
    const currentAlpha = graph.alpha;
    for (let index = 0; index < graph.nodes.length; index += 1) {
      const node = graph.nodes[index];
      for (let otherIndex = index + 1; otherIndex < graph.nodes.length; otherIndex += 1) {
        const other = graph.nodes[otherIndex];
        let dx = node.x - other.x;
        let dy = node.y - other.y;
        let distance = Math.hypot(dx, dy);
        if (!distance) {
          const angle = (graphHash(`${node.id}:${other.id}`) / 4294967296) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = Math.min(0.65, 650 / (distance * distance)) * currentAlpha;
        node.vx += (dx / distance) * push;
        node.vy += (dy / distance) * push;
        other.vx -= (dx / distance) * push;
        other.vy -= (dy / distance) * push;
      }
    }
    for (const edge of graph.edges) {
      const source = edge.source;
      const target = edge.target;
      let dx = target.x - source.x;
      let dy = target.y - source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const desired = source.chapter === target.chapter ? 76 : 112;
      const spring = ((distance - desired) / distance) * 0.018 * currentAlpha;
      dx *= spring;
      dy *= spring;
      source.vx += dx;
      source.vy += dy;
      target.vx -= dx;
      target.vy -= dy;
    }
    for (const node of graph.nodes) {
      const center = graph.chapterCenters.get(node.chapter) ?? {
        x: graph.world.width / 2,
        y: graph.world.height / 2,
      };
      node.vx += (center.x - node.x) * 0.008 * currentAlpha;
      node.vy += (center.y - node.y) * 0.008 * currentAlpha;
      node.vx *= 0.78;
      node.vy *= 0.78;
      if (node.fx === null) {
        node.x += node.vx;
        node.y += node.vy;
      } else {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      }
      const margin = node.radius + 18;
      if (node.x < margin) {
        node.x = margin;
        node.vx = Math.abs(node.vx) * 0.2;
      }
      if (node.x > graph.world.width - margin) {
        node.x = graph.world.width - margin;
        node.vx = -Math.abs(node.vx) * 0.2;
      }
      if (node.y < margin) {
        node.y = margin;
        node.vy = Math.abs(node.vy) * 0.2;
      }
      if (node.y > graph.world.height - margin) {
        node.y = graph.world.height - margin;
        node.vy = -Math.abs(node.vy) * 0.2;
      }
    }
    updateWikiGraphPositions(graph);
    graph.alpha *= 0.94;
    graph.ticks += 1;
    if (graph.alpha > 0.018 && graph.ticks < 220) {
      graph.raf = requestAnimationFrame(tick);
    } else {
      graph.raf = 0;
      fitWikiGraph(graph);
    }
  };
  graph.raf = requestAnimationFrame(tick);
}

function installWikiGraphPointerEvents(graph) {
  const { svg } = graph;
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".wiki-graph-node")) return;
    hideWikiGraphPopover(graph);
    const point = graphPointFromEvent(svg, event, graph.world);
    graph.pan = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      tx: graph.tx,
      ty: graph.ty,
      moved: false,
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
  });
  svg.addEventListener("pointermove", (event) => {
    if (graph.drag?.pointerId === event.pointerId) {
      const node = graph.nodesById.get(graph.drag.id);
      if (!node) return;
      const point = graphWorldPoint(graph, event);
      const distance = Math.hypot(point.x - graph.drag.startX, point.y - graph.drag.startY);
      if (distance > 3) graph.drag.moved = true;
      node.fx = graphClamp(point.x, node.radius + 8, graph.world.width - node.radius - 8);
      node.fy = graphClamp(point.y, node.radius + 8, graph.world.height - node.radius - 8);
      node.x = node.fx;
      node.y = node.fy;
      updateWikiGraphPositions(graph);
      return;
    }
    if (graph.pan?.pointerId === event.pointerId) {
      const point = graphPointFromEvent(svg, event, graph.world);
      const dx = point.x - graph.pan.startX;
      const dy = point.y - graph.pan.startY;
      if (Math.hypot(dx, dy) > 3) graph.pan.moved = true;
      graph.tx = graph.pan.tx + dx;
      graph.ty = graph.pan.ty + dy;
      updateWikiGraphTransform(graph);
    }
  });
  const endPointer = (event) => {
    if (graph.drag?.pointerId === event.pointerId) {
      const drag = graph.drag;
      const node = graph.nodesById.get(graph.drag.id);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
        node.element.classList.remove("is-dragging");
      }
      if (drag.moved) {
        graph.suppressClick = true;
        setTimeout(() => {
          graph.suppressClick = false;
        }, 0);
        startWikiGraphSimulation(graph, 0.34);
      } else {
        graph.suppressClick = true;
        graph.selectedId = drag.id;
        updateWikiGraphFocus(graph);
        showWikiGraphPopover(graph, node);
        setTimeout(() => {
          graph.suppressClick = false;
        }, 0);
      }
      graph.drag = null;
    }
    if (graph.pan?.pointerId === event.pointerId) {
      if (!graph.pan.moved) {
        graph.selectedId = null;
        updateWikiGraphFocus(graph);
      }
      graph.pan = null;
      svg.classList.remove("is-panning");
    }
  };
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = graphPointFromEvent(svg, event, graph.world);
    const before = graphWorldPoint(graph, event);
    const nextScale = graphClamp(
      graph.scale * (event.deltaY > 0 ? 0.9 : 1.1),
      0.42,
      3.5,
    );
    graph.scale = nextScale;
    graph.tx = point.x - before.x * nextScale;
    graph.ty = point.y - before.y * nextScale;
    updateWikiGraphTransform(graph);
  }, { passive: false });
}

export function renderWikiGraph(entries, { focusId = null, colorBy = "chapter", focusDepth = 1 } = {}) {
  const canvas = $("#wiki-graph-canvas");
  destroyWikiGraph();
  const world = graphWorldForCanvas(canvas);
  // 条目已由应用层按搜索/章节/状态筛过后传入，图谱与目录始终展示同一批数据。
  const visibleEntries = entries;
  if (!visibleEntries.length) {
    $("#wiki-graph-summary").textContent = "暂无条目";
    canvas.replaceChildren(emptyMessage("没有匹配条目", "调整搜索或筛选条件后再试。"));
    return;
  }
  const chapterIds = [...new Set(visibleEntries.map((entry) => Number(entry.chapter) || 0))].sort(
    (a, b) => a - b,
  );
  const chapterCenters = new Map();
  const centerX = world.width / 2;
  const centerY = world.height / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  chapterIds.forEach((chapter, index) => {
    const progress = (index + 0.5) / Math.max(chapterIds.length, 1);
    const angle = index * goldenAngle - Math.PI / 2;
    const radiusX = 24 + Math.sqrt(progress) * world.width * 0.36;
    const radiusY = 18 + Math.sqrt(progress) * world.height * 0.3;
    chapterCenters.set(chapter, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  });
  // 颜色分组：按章节（默认）/ 按状态 / 按关联度，与图例联动。
  const colorFor = (entry) => {
    if (colorBy === "status") {
      return WIKI_STATUS_COLORS[entry.status] || WIKI_STATUS_COLORS.draft;
    }
    const chapterIndex = chapterIds.indexOf(Number(entry.chapter) || 0);
    return GRAPH_CHAPTER_COLORS[(chapterIndex < 0 ? 0 : chapterIndex) % GRAPH_CHAPTER_COLORS.length];
  };
  const nodeById = new Map(
    visibleEntries.map((entry) => [entry.id, {
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      section: entry.section,
      status: entry.status,
      keyPoints: entry.keyPoints ?? [],
      commonMistakes: entry.commonMistakes ?? [],
      related: entry.related ?? [],
      links: entry.links ?? [],
      chapter: Number(entry.chapter) || 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      radius: 7,
      degree: 0,
      labelElement: null,
      labelWidth: 0,
      labelPos: { x: 0, y: 0 },
      labelVisible: false,
      color: colorFor(entry),
    }]),
  );
  const edgeMap = new Map();
  for (const entry of visibleEntries) {
    for (const targetId of entry.links ?? []) {
      if (!nodeById.has(targetId) || targetId === entry.id) continue;
      const key = [entry.id, targetId].sort().join("::");
      if (!edgeMap.has(key)) edgeMap.set(key, { source: entry.id, target: targetId });
    }
  }
  const edges = [...edgeMap.values()].map((edge) => ({
    ...edge,
    source: nodeById.get(edge.source),
    target: nodeById.get(edge.target),
  }));
  const adjacency = new Map(visibleEntries.map((entry) => [entry.id, new Set()]));
  for (const edge of edges) {
    edge.source.degree += 1;
    edge.target.degree += 1;
    adjacency.get(edge.source.id)?.add(edge.target.id);
    adjacency.get(edge.target.id)?.add(edge.source.id);
  }
  if (colorBy === "degree") {
    for (const node of nodeById.values()) {
      node.color =
        node.degree >= 6 ? WIKI_DEGREE_COLORS[3]
        : node.degree >= 3 ? WIKI_DEGREE_COLORS[2]
        : node.degree >= 1 ? WIKI_DEGREE_COLORS[1]
        : WIKI_DEGREE_COLORS[0];
    }
  }
  for (const [index, node] of [...nodeById.values()].entries()) {
    const center = chapterCenters.get(node.chapter) ?? {
      x: world.width / 2,
      y: world.height / 2,
    };
    const seed = graphHash(`${node.id}:${index}`) / 4294967296;
    const angle = seed * Math.PI * 2;
    const distance = 24 + (graphHash(`${node.id}:radius`) % 80);
    node.x = center.x + Math.cos(angle) * distance;
    node.y = center.y + Math.sin(angle) * distance;
    node.radius = graphClamp(6 + Math.sqrt(node.degree) * 1.7, 6, 14);
  }
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${world.width} ${world.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("class", "wiki-graph-svg");
  svg.setAttribute("aria-label", "知识点关系图");
  const background = document.createElementNS(svgNS, "rect");
  background.setAttribute("class", "wiki-graph-background");
  background.setAttribute("width", world.width);
  background.setAttribute("height", world.height);
  const content = document.createElementNS(svgNS, "g");
  content.setAttribute("class", "wiki-graph-content");
  const edgeLayer = document.createElementNS(svgNS, "g");
  edgeLayer.setAttribute("class", "wiki-graph-edges");
  const nodeLayer = document.createElementNS(svgNS, "g");
  nodeLayer.setAttribute("class", "wiki-graph-nodes");
  content.append(edgeLayer, nodeLayer);
  // 标签层位于缩放变换之外：字号固定（屏幕空间），位置逐帧跟随节点。
  const labelLayer = document.createElementNS(svgNS, "g");
  labelLayer.setAttribute("class", "wiki-graph-labels");
  svg.append(background, content, labelLayer);
  // 悬停预览卡与点击详情气泡挂在画布上，按屏幕空间定位。
  const tooltip = element("div", { className: "wiki-graph-tooltip" });
  tooltip.hidden = true;
  const popover = element("div", { className: "wiki-graph-popover" });
  popover.hidden = true;
  const graph = {
    svg,
    content,
    world,
    // 视口（画布像素）：标签与提示卡按屏幕空间定位。
    view: {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    },
    nodes: [...nodeById.values()],
    nodesById: nodeById,
    edges,
    adjacency,
    chapterCenters,
    selectedId: null,
    hoveredId: null,
    focusDepth,
    scale: 1,
    tx: 0,
    ty: 0,
    raf: 0,
    suppressClick: false,
    tooltip,
    popover,
    popoverNodeId: null,
    // 与目录共用应用层的搜索框，重渲染时同步当前关键词。
    searchTerm: $("#wiki-search")?.value.trim().toLowerCase() || "",
    searchMatches: new Set(),
    summaryText: `${nodeById.size} 个知识点 · ${edges.length} 条关联`,
  };
  for (const edge of edges) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("class", "wiki-graph-edge");
    edge.element = line;
    edgeLayer.append(line);
  }
  for (const node of graph.nodes) {
    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("class", `wiki-graph-node${node.prominent ? " is-prominent" : ""}`);
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `查看知识点：${node.title}`);
    group.dataset.id = node.id;
    const title = document.createElementNS(svgNS, "title");
    title.textContent = node.title;
    const hit = document.createElementNS(svgNS, "circle");
    hit.setAttribute("class", "wiki-graph-node-hit");
    hit.setAttribute("r", node.radius + 10);
    const halo = document.createElementNS(svgNS, "circle");
    halo.setAttribute("class", "wiki-graph-node-halo");
    halo.setAttribute("r", node.radius + 5);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("class", "wiki-graph-node-dot");
    circle.setAttribute("r", node.radius);
    circle.setAttribute("fill", node.color);
    group.append(title, hit, halo, circle);
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("class", "wiki-graph-label");
    label.textContent = node.title;
    labelLayer.append(label);
    node.labelElement = label;
    node.element = group;
    nodeLayer.append(group);
    group.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      hideWikiGraphTooltip(graph);
      hideWikiGraphPopover(graph);
      const point = graphWorldPoint(graph, event);
      graph.drag = {
        id: node.id,
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        moved: false,
      };
      node.element.classList.add("is-dragging");
      try {
        group.setPointerCapture(event.pointerId);
      } catch {
        svg.setPointerCapture(event.pointerId);
      }
    });
    group.addEventListener("pointerenter", () => {
      graph.hoveredId = node.id;
      updateWikiGraphFocus(graph);
      // 详情气泡已在该节点上时不再叠加悬停预览。
      if (graph.popoverNodeId !== node.id) showWikiGraphTooltip(graph, node);
    });
    group.addEventListener("pointerleave", () => {
      if (graph.drag?.id === node.id) return;
      graph.hoveredId = null;
      updateWikiGraphFocus(graph);
      hideWikiGraphTooltip(graph);
    });
    group.addEventListener("click", () => {
      if (graph.suppressClick) return;
      graph.selectedId = node.id;
      updateWikiGraphFocus(graph);
      showWikiGraphPopover(graph, node);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        graph.selectedId = node.id;
        updateWikiGraphFocus(graph);
        showWikiGraphPopover(graph, node);
      }
    });
  }
  wikiGraphState = graph;
  $("#wiki-graph-summary").textContent = graph.summaryText;
  canvas.replaceChildren(svg, tooltip, popover);
  // Esc 关闭详情气泡（画布元素跨重渲染常驻，只绑定一次）。
  if (!canvas.dataset.popoverEscBound) {
    canvas.dataset.popoverEscBound = "1";
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && wikiGraphState) hideWikiGraphPopover(wikiGraphState);
    });
  }
  renderWikiGraphLegend(colorBy);
  updateWikiGraphPositions(graph);
  updateWikiGraphFocus(graph);
  updateWikiGraphSearch(graph, graph.searchTerm);
  fitWikiGraph(graph);
  // 回到图谱时高亮当前阅读的条目，保持两个视图的上下文连续。
  if (focusId && nodeById.has(focusId)) {
    graph.selectedId = focusId;
    updateWikiGraphFocus(graph);
  }
  installWikiGraphPointerEvents(graph);
  startWikiGraphSimulation(graph);
}


// 图例随颜色分组模式联动（Obsidian color groups 的图例约定）。
function renderWikiGraphLegend(colorBy) {
  const legend = $("#wiki-graph-legend");
  if (!legend) return;
  const legendItem = (icon, text) => {
    const span = element("span", {});
    span.append(icon, document.createTextNode(text));
    return span;
  };
  const dot = (color) => {
    const i = element("i", { className: "wiki-graph-legend-dot" });
    i.style.background = color;
    return i;
  };
  const items = [
    legendItem(element("i", { className: "wiki-graph-legend-dot core" }), "连接越多，节点越大"),
  ];
  if (colorBy === "status") {
    for (const status of ["draft", "reviewed", "flagged"]) {
      items.push(legendItem(dot(WIKI_STATUS_COLORS[status]), WIKI_STATUS_NAMES[status]));
    }
  } else if (colorBy === "degree") {
    const ranges = [
      ["无关联", 0],
      ["1-2 条", 1],
      ["3-5 条", 2],
      ["6 条以上", 3],
    ];
    for (const [label, index] of ranges) {
      items.push(legendItem(dot(WIKI_DEGREE_COLORS[index]), label));
    }
  } else {
    items.push(legendItem(element("i", { className: "wiki-graph-legend-line" }), "颜色区分章节"));
  }
  items.push(element("span", { text: "点击节点查看详情气泡" }));
  legend.replaceChildren(...items);
}

export function currentWikiGraph() {
  return wikiGraphState;
}
