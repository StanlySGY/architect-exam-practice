import assert from "node:assert/strict";
import { element } from "../public/ui.js";
import test from "node:test";

test("共享 DOM helper 正确处理 HTML 布尔属性，不把 false 渲染成存在的属性", () => {
  const previousDocument = globalThis.document;
  try {
    globalThis.document = {
      createElement(tag) {
        return {
          tagName: tag,
          attributes: new Map(),
          disabled: false,
          hidden: false,
          checked: false,
          setAttribute(name, value) { this.attributes.set(name, value); },
          removeAttribute(name) { this.attributes.delete(name); },
          append(...children) { this.children = children; },
        };
      },
    };

    const button = element("button", {
      attrs: {
        type: "button",
        disabled: false,
        hidden: true,
        "aria-pressed": false,
        "data-state": true,
      },
    });

    assert.equal(button.disabled, false);
    assert.equal(button.attributes.has("disabled"), false);
    assert.equal(button.hidden, true);
    assert.equal(button.attributes.has("hidden"), true);
    assert.equal(button.attributes.get("aria-pressed"), "false");
    assert.equal(button.attributes.get("data-state"), "true");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
