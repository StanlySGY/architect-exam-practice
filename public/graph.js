// 知识图谱：受限力导向布局 + 平移缩放交互，从 app.js 拆分出的独立模块。
// 渲染入口由 app.js 调用；openWikiDetail 属于应用层，通过 initWikiGraphDeps 注入。
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

function populateWikiGraphChapters(entries) {
  const select = $("#wiki-graph-chapter");
  if (!select) return "all";
  const current = select.value || "all";
  const chapters = [...new Set(entries.map((entry) => Number(entry.chapter) || 0))].sort(
    (a, b) => a - b,
  );
  select.replaceChildren(
    element("option", { text: "全部章节", attrs: { value: "all" } }),
    ...chapters.map((chapter) =>
      element("option", {
        text: `第 ${chapter} 章`,
        attrs: { value: chapter },
      }),
    ),
  );
  select.value = chapters.includes(Number(current)) ? current : "all";
  return select.value;
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

function wikiGraphLabelBox(node) {
  const label = node.element.querySelector(".wiki-graph-node-label");
  const rect = label?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      left: rect.left - 4,
      right: rect.right + 4,
      top: rect.top - 3,
      bottom: rect.bottom + 3,
    };
  }
  const width = Math.max(24, label?.getComputedTextLength?.() || [...node.title].length * 11);
  const top = node.y + node.radius + 7;
  return {
    left: node.x - width / 2 - 4,
    right: node.x + width / 2 + 4,
    top,
    bottom: top + 17,
  };
}

function updateWikiGraphLabels(graph) {
  const candidates = graph.nodes
    .filter((node) => node.prominent || wikiGraphLabelRequired(graph, node))
    .sort((a, b) => {
      const aRequired = wikiGraphLabelRequired(graph, a);
      const bRequired = wikiGraphLabelRequired(graph, b);
      if (aRequired !== bRequired) return Number(bRequired) - Number(aRequired);
      return b.degree - a.degree || a.title.localeCompare(b.title, "zh-CN");
    });
  const occupied = [];
  for (const node of graph.nodes) {
    node.element.classList.remove("is-label-hidden");
  }
  for (const node of candidates) {
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
      node.element.classList.add("is-label-hidden");
      continue;
    }
    occupied.push(box);
  }
}

function updateWikiGraphFocus(graph) {
  const focusId = graph.hoveredId || graph.selectedId;
  const focus = focusId
    ? new Set([focusId, ...(graph.adjacency.get(focusId) ?? [])])
    : null;
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
        graphDeps.openWikiDetail?.(drag.id);
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
      2.4,
    );
    graph.scale = nextScale;
    graph.tx = point.x - before.x * nextScale;
    graph.ty = point.y - before.y * nextScale;
    updateWikiGraphTransform(graph);
  }, { passive: false });
}

export function renderWikiGraph(entries) {
  const canvas = $("#wiki-graph-canvas");
  destroyWikiGraph();
  const world = graphWorldForCanvas(canvas);
  const selectedChapter = populateWikiGraphChapters(entries);
  const visibleEntries = selectedChapter === "all"
    ? entries
    : entries.filter((entry) => String(Number(entry.chapter) || 0) === selectedChapter);
  if (!visibleEntries.length) {
    $("#wiki-graph-summary").textContent = "暂无条目";
    canvas.replaceChildren(emptyMessage("没有匹配条目", "切换章节或清除筛选后再试。"));
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
  const nodeById = new Map(
    visibleEntries.map((entry) => [entry.id, {
      id: entry.id,
      title: entry.title,
      chapter: Number(entry.chapter) || 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      radius: 7,
      degree: 0,
      color: GRAPH_CHAPTER_COLORS[chapterIds.indexOf(Number(entry.chapter) || 0) % GRAPH_CHAPTER_COLORS.length],
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
  const prominentIds = new Set(
    [...nodeById.values()]
      .filter((node) => node.degree > 0)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, Math.min(12, nodeById.size))
      .map((node) => node.id),
  );
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
    node.prominent = prominentIds.has(node.id) || node.degree >= 5;
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
  svg.append(background, content);
  const graph = {
    svg,
    content,
    world,
    nodes: [...nodeById.values()],
    nodesById: nodeById,
    edges,
    adjacency,
    chapterCenters,
    selectedId: null,
    hoveredId: null,
    scale: 1,
    tx: 0,
    ty: 0,
    raf: 0,
    suppressClick: false,
    searchTerm: $("#wiki-graph-search")?.value || "",
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
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("class", "wiki-graph-node-label");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dy", node.radius + 19);
    label.textContent = node.title;
    group.append(title, hit, halo, circle, label);
    node.element = group;
    nodeLayer.append(group);
    group.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
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
    });
    group.addEventListener("pointerleave", () => {
      if (graph.drag?.id === node.id) return;
      graph.hoveredId = null;
      updateWikiGraphFocus(graph);
    });
    group.addEventListener("click", () => {
      if (graph.suppressClick) return;
      graph.selectedId = node.id;
      updateWikiGraphFocus(graph);
      graphDeps.openWikiDetail?.(node.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        graph.selectedId = node.id;
        updateWikiGraphFocus(graph);
        graphDeps.openWikiDetail?.(node.id);
      }
    });
  }
  wikiGraphState = graph;
  $("#wiki-graph-summary").textContent = graph.summaryText;
  canvas.replaceChildren(svg);
  updateWikiGraphPositions(graph);
  updateWikiGraphFocus(graph);
  updateWikiGraphSearch(graph, graph.searchTerm);
  fitWikiGraph(graph);
  installWikiGraphPointerEvents(graph);
  startWikiGraphSimulation(graph);
}


export function currentWikiGraph() {
  return wikiGraphState;
}
