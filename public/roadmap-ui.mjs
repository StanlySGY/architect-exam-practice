import { ROADMAP_STORAGE_KEY, createStudyRoadmap, getActiveRoadmapWeek, advanceStudyRoadmap } from "./study-roadmap.mjs";

function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

function storedPlan() {
  try {
    const raw = localStorage.getItem(ROADMAP_STORAGE_KEY);
    return raw ? createStudyRoadmap(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function savePlan(plan) {
  try {
    localStorage.setItem(ROADMAP_STORAGE_KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

function showRoadmapError(panel, message) {
  panel.querySelector(".roadmap-error")?.remove();
  const error = node("p", "roadmap-error", message);
  error.setAttribute("role", "alert");
  panel.append(error);
}

export function mountBeginnerRoadmap({ onOpenWeek = async () => {} } = {}) {
  const panel = document.querySelector("#beginner-roadmap");
  if (!panel) return;
  const button = (label, className, handler) => {
    const result = node("button", className, label);
    result.type = "button";
    result.addEventListener("click", handler);
    return result;
  };
  const reviewShortcut = () => {
    const box = node("div", "roadmap-review-callout");
    box.append(node("p", "", "2026 年 10 月的考试已采用上午综合知识与案例分析连考、下午论文单独考试的批次安排；下一年度以新公告和准考证为准。"));
    const link = node("a", "roadmap-review-link", "查看 2026 考后复盘与学习重点");
    link.href = "/exam-review-2026.html";
    box.append(link);
    return box;
  };
  const render = () => {
    const plan = storedPlan();
    panel.replaceChildren();
    const header = node("div", "roadmap-heading");
    const copy = node("div");
    copy.append(
      node("p", "eyebrow", "ZERO-TO-ARCHITECT"),
      node("h2", "", plan ? "你的系统架构师备考路线" : "第一次备考？先把路线定下来"),
      node("p", "roadmap-intro", "不要求你先懂架构。先建立基础，再练设计取舍，最后把三科放进同一套考试节奏。"),
    );
    header.append(copy, node("span", "roadmap-status", "综合知识 · 案例分析 · 论文"));
    panel.append(header);

    if (!plan) {
      const form = node("form", "roadmap-setup");
      const experience = node("select");
      experience.name = "experience";
      experience.setAttribute("aria-label", "当前备考基础");
      experience.add(new Option("零基础 / 还没系统学过", "beginner", true, true));
      experience.add(new Option("有开发经验，但没系统备考", "experienced"));
      const hours = node("select");
      hours.name = "hours";
      hours.setAttribute("aria-label", "每周可投入时间");
      for (const amount of [4, 6, 8, 10, 12]) hours.add(new Option(`每周 ${amount} 小时`, String(amount), false, amount === 8));
      const experienceLabel = node("label");
      experienceLabel.append(node("span", "", "你目前的基础"), experience);
      const hoursLabel = node("label");
      hoursLabel.append(node("span", "", "每周能稳定投入"), hours);
      form.append(experienceLabel, hoursLabel);
      form.append(button("生成我的学习路线", "primary", () => form.requestSubmit()));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const next = createStudyRoadmap({ experience: experience.value, hoursPerWeek: Number(hours.value) });
        if (!savePlan(next)) {
          showRoadmapError(panel, "浏览器未能保存路线，请检查本地存储空间或隐私设置。");
          return;
        }
        render();
      });
      panel.append(
        form,
        node("p", "roadmap-footnote", "按约 144 小时（零基础）或 112 小时（有基础）的有效学习时间估算；这是可调整的起步方案，不是官方课时要求。"),
        reviewShortcut(),
      );
      return;
    }

    const active = getActiveRoadmapWeek(plan);
    const progress = active.percent;
    const metrics = node("div", "roadmap-metrics");
    metrics.append(
      node("strong", "", `${plan.completedThrough} / ${plan.totalWeeks} 周`),
      node("span", "", `${plan.hoursPerWeek} 小时 / 周 · 约 ${plan.totalHours} 小时总投入`),
      node("span", "", `开始于 ${plan.startDate}`),
    );
    const progressTrack = node("div", "roadmap-progress");
    progressTrack.setAttribute("role", "progressbar");
    progressTrack.setAttribute("aria-label", "学习路线完成进度");
    progressTrack.setAttribute("aria-valuemin", "0");
    progressTrack.setAttribute("aria-valuemax", "100");
    progressTrack.setAttribute("aria-valuenow", String(progress));
    progressTrack.setAttribute("aria-valuetext", `${plan.completedThrough} / ${plan.totalWeeks} 周`);
    const progressFill = node("span");
    progressFill.style.width = `${progress}%`;
    progressTrack.append(progressFill);
    const current = node("article", "roadmap-current-week");
    current.append(
      node("div", "roadmap-week-label", active.completed ? "路线已完成" : `当前任务 · 第 ${active.number} / ${plan.totalWeeks} 周`),
      node("h3", "", active.completed ? "完成第一轮系统备考" : active.week.title),
      node("p", "", active.completed ? "接下来按错题、薄弱知识点和整套模拟保持复习节奏。" : active.week.focus),
    );
    const phases = node("div", "roadmap-phase-list");
    for (const phase of (active.week?.phases ?? [])) phases.append(node("span", "roadmap-phase-chip", phase));
    current.append(phases);
    const tasks = node("ul", "roadmap-task-list");
    for (const task of (active.week?.tasks ?? [])) tasks.append(node("li", "", task));
    current.append(tasks, node("p", "roadmap-output", active.completed ? "建议：每周至少做一次限时训练，并持续回顾到期错题。" : `本周产出：${active.week.deliverable}`));
    panel.append(metrics, progressTrack, current);

    const actions = node("div", "roadmap-actions");
    if (!active.completed) {
      actions.append(button("打开本周学习内容", "primary", async (event) => {
        const control = event.currentTarget;
        control.disabled = true;
        try { await onOpenWeek(active.week); }
        finally { control.disabled = false; }
      }));
      actions.append(button("本周完成，进入下一周", "secondary", () => {
        const next = advanceStudyRoadmap(plan);
        if (!savePlan(next)) {
          showRoadmapError(panel, "浏览器无法保存本周进度，本周尚未推进。请检查存储空间或浏览器隐私设置后重试。");
          return;
        }
        render();
      }));
    }
    actions.append(button("调整 / 重做路线", "ghost", () => {
      try {
        localStorage.removeItem(ROADMAP_STORAGE_KEY);
        render();
      } catch {
        showRoadmapError(panel, "浏览器无法清除当前路线，原路线和进度均已保留。请检查浏览器存储权限后重试。");
      }
    }));
    panel.append(actions);

    const upcoming = node("div", "roadmap-next");
    upcoming.append(node("h3", "", "接下来会学到"));
    const nextWeeks = active.completed ? [] : plan.weeks.slice(active.number, active.number + 3);
    if (nextWeeks.length) {
      for (const week of nextWeeks) {
        const entry = node("div", "roadmap-next-item");
        entry.append(node("strong", "", `第 ${week.number} 周 · ${week.title}`), node("span", "", week.focus));
        upcoming.append(entry);
      }
    } else upcoming.append(node("p", "muted", "路线已完成，继续用错题和模拟考试维护掌握度。"));
    panel.append(
      upcoming,
      node("p", "roadmap-footnote", "路线保存在当前浏览器，不会自动写入 SQLite 备份。手动标记周完成只推进路线，不会伪造阅读、答题或掌握记录。考试日期、批次和合格标准以当次官方公告为准。"),
      reviewShortcut(),
    );
  };
  render();
}
