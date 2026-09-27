# 审查结果

## 外部模型

- Antigravity：未产出报告。headless 模式拒绝其需要的 command 权限，随后 wrapper 因注入的 `--gemini-model` 参数兼容问题退出。
- Claude：未产出报告。wrapper 提示 `--gemini-model parameter is only effective with --backend gemini` 后退出 1。

## 本地验证

- `node --check` 通过：`public/app.js`、`server.mjs`、`src/exam-assets.mjs`、`src/markdown.mjs`、`src/figures.mjs`。
- `npm test` 通过：79 个测试全部通过。
- `git diff --check` 通过。
- Chrome DevTools 实测资料页：章节 13 渲染 20 个 Mermaid SVG、生成 28 项目录和 20 个源码折叠区；桌面端左侧目录独立滚动；390px 视口无横向溢出。
- HTML/SVG 使用空 `sandbox` iframe 和 `srcdoc`，未将资料原文注入宿主页面。

## Findings

- Critical：无。
- Warning：当前 Mermaid 是项目内置解析子集，尚未承诺覆盖 Mermaid 全部语法；本次已补齐真实资料中的 `(["..."])` 节点和带引号/虚线标签连线。
- Info：浏览器验证使用系统 Chrome DevTools，因为项目环境没有可导入的 Playwright npm 包。

## 后续复核

- 针对第 13 章真实失败图补齐解析后，扫描资料库中的 257 个 Mermaid fenced block，`flowchart` 249 个、`sequenceDiagram` 5 个、`stateDiagram-v2` 3 个全部生成结构化 SVG。
- `npm test` 最终结果为 79/79 通过，`node --check` 和 `git diff --check` 通过。
- 第二次 Antigravity/Claude 审查仍未产出：Antigravity 被 headless command 权限拒绝，Claude 仍因 wrapper 注入的 `--gemini-model` 参数退出。
