import assert from "node:assert/strict";
import test from "node:test";
import { ROADMAP_STORAGE_KEY, createStudyRoadmap } from "../public/study-roadmap.mjs";
import { mountBeginnerRoadmap } from "../public/roadmap-ui.mjs";

class FakeOption {
  constructor(label, value, defaultSelected = false, selected = false) {
    this.label = label;
    this.value = value;    this.label = label;
    this.className = "";
    this.value = value;
    this.defaultSelected = defaultSelected;
    this.selected = selected;
  }

  descendants() {
    return [];
  }

  allText() {
    return this.label;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.parentNode = null;
    this.disabled = false;
    this.type = "";
    this.name = "";
  }

  append(...items) {
    for (const item of items) {
      item.parentNode = this;
      this.children.push(item);
    }
  }

  add(item) {
    item.parentNode = this;
    this.children.push(item);
    if (item.selected || !this.value) this.value = item.value;
  }

  replaceChildren(...items) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...items);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) ?? [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  dispatch(name, event = {}) {
    for (const callback of this.listeners.get(name) ?? []) {
      callback({ currentTarget: this, preventDefault() {}, ...event });
    }
  }

  requestSubmit() {
    this.dispatch("submit");
  }

  click() {
    this.dispatch("click");
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
    this.parentNode = null;
  }

  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    if (!className) return null;
    return this.descendants().find((item) => item.className.split(/\s+/).includes(className)) ?? null;
  }

  descendants() {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  findAll(predicate) {
    return this.descendants().filter(predicate);
  }

  allText() {
    return [this.textContent, ...this.children.map((child) => child.allText())].join(" ");
  }
}

function createHarness({ initialPlan = null, failSet = false, failRemove = false } = {}) {
  const panel = new FakeElement("section");
  const stored = new Map();
  if (initialPlan) stored.set(ROADMAP_STORAGE_KEY, JSON.stringify(initialPlan));
  const storage = {
    getItem(key) {
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      if (failSet) throw new Error("QuotaExceededError");
      stored.set(key, String(value));
    },
    removeItem(key) {
      if (failRemove) throw new Error("SecurityError");
      stored.delete(key);
    }
  };
  const previous = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    Option: globalThis.Option
  };
  globalThis.document = {
    querySelector(selector) {
      return selector === "#beginner-roadmap" ? panel : null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
  globalThis.localStorage = storage;
  globalThis.Option = FakeOption;
  mountBeginnerRoadmap();
  return {
    panel,
    stored,
    clickButton(label) {
      const button = panel.findAll((item) => item.tagName === "button" && item.textContent === label)[0];
      assert.ok(button, "button not found: " + label);
      button.click();
    },
    restore() {
      if (previous.document === undefined) delete globalThis.document;
      else globalThis.document = previous.document;
      if (previous.localStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous.localStorage;
      if (previous.Option === undefined) delete globalThis.Option;
      else globalThis.Option = previous.Option;
    }
  };
}

test("首次配置会保存路线，并在首页呈现第一周任务和考后复盘入口", () => {
  const harness = createHarness();
  try {
    harness.clickButton("生成我的学习路线");
    const saved = JSON.parse(harness.stored.get(ROADMAP_STORAGE_KEY));
    assert.equal(saved.experience, "beginner");
    assert.equal(saved.hoursPerWeek, 8);
    assert.equal(saved.completedThrough, 0);
    assert.ok(harness.panel.allText().includes("0 / 18 周"));
    assert.match(harness.panel.allText(), /先理解系统架构是什么/);    const progress = harness.panel.findAll((item) => item.className === "roadmap-progress")[0];
    assert.equal(progress.getAttribute("role"), "progressbar");
    assert.equal(progress.getAttribute("aria-valuenow"), "0");
    assert.equal(progress.getAttribute("aria-valuetext"), "0 / 18 周");
    assert.equal(harness.panel.findAll((item) => item.tagName === "a" && item.href === "/exam-review-2026.html").length, 1);
  } finally {
    harness.restore();
  }
});

test("首次建档保存失败时保留配置表单并显示告警", () => {
  const harness = createHarness({ failSet: true });
  try {
    harness.clickButton("生成我的学习路线");
    const error = harness.panel.querySelector(".roadmap-error");
    assert.ok(error);
    assert.equal(error.getAttribute("role"), "alert");
    assert.match(error.textContent, /未能保存路线/);
    assert.equal(harness.stored.has(ROADMAP_STORAGE_KEY), false);
    assert.equal(harness.panel.findAll((item) => item.tagName === "form").length, 1);
  } finally {
    harness.restore();
  }
});

test("进度保存失败时不会推进周数，且展示可访问的错误提示", () => {
  const plan = createStudyRoadmap({ experience: "beginner", hoursPerWeek: 8, startDate: "2026-10-30" });
  const harness = createHarness({ initialPlan: plan, failSet: true });
  try {
    const before = harness.stored.get(ROADMAP_STORAGE_KEY);
    harness.clickButton("本周完成，进入下一周");
    const error = harness.panel.querySelector(".roadmap-error");
    assert.ok(error);
    assert.equal(error.getAttribute("role"), "alert");
    assert.match(error.textContent, /本周尚未推进/);
    assert.ok(harness.panel.allText().includes("0 / 18 周"));
    assert.equal(harness.stored.get(ROADMAP_STORAGE_KEY), before);
  } finally {
    harness.restore();
  }
});

test("重置失败时保留路线和进度，并告知用户", () => {
  const plan = createStudyRoadmap({ experience: "experienced", hoursPerWeek: 6, completedThrough: 3, startDate: "2026-10-30" });
  const harness = createHarness({ initialPlan: plan, failRemove: true });
  try {
    const before = harness.stored.get(ROADMAP_STORAGE_KEY);
    harness.clickButton("调整 / 重做路线");
    const error = harness.panel.querySelector(".roadmap-error");
    assert.ok(error);
    assert.match(error.textContent, /原路线和进度均已保留/);
    assert.ok(harness.panel.allText().includes("3 / 19 周"));
    assert.equal(harness.stored.get(ROADMAP_STORAGE_KEY), before);
  } finally {
    harness.restore();
  }
});

test("成功推进与重置都会持久化状态并重新渲染", () => {
  const plan = createStudyRoadmap({ experience: "beginner", hoursPerWeek: 8, startDate: "2026-10-30" });
  const harness = createHarness({ initialPlan: plan });
  try {
    harness.clickButton("本周完成，进入下一周");
    const advanced = JSON.parse(harness.stored.get(ROADMAP_STORAGE_KEY));
    assert.equal(advanced.completedThrough, 1);
    assert.ok(harness.panel.allText().includes("1 / 18 周"));
    harness.clickButton("调整 / 重做路线");
    assert.equal(harness.stored.has(ROADMAP_STORAGE_KEY), false);
    assert.match(harness.panel.allText(), /第一次备考？先把路线定下来/);
  } finally {
    harness.restore();
  }
});
