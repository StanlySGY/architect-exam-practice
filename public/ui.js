// 前端共享 DOM 工具：app.js 与 graph.js 等模块共同使用。
export const $ = (selector) => document.querySelector(selector);


export function element(tag, { className, text, attrs = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  node.append(...children.filter(Boolean));
  return node;
}

export function emptyMessage(title, message) {
  return element("div", { className: "empty" }, [
    element("strong", { text: title }),
    element("span", { text: message }),
  ]);
}
