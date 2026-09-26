# Review

## 变更

- 在 SVG 图谱中按屏幕坐标检测标签边界，优先保留选中、悬停、搜索命中、邻接和高连接节点的标签。
- 移动端发生标签重叠时隐藏次要标签；节点本身、详情弹窗和键盘语义不受影响。
- 在平移、缩放、重新布局和节点位置更新后重新计算标签可见性。

## 本地验证

- `npm test`：75/75 通过。
- `node --check public/app.js`、`server.mjs`、`src/generator.mjs`：通过。
- `git diff --check`：通过。
- Chromium 390px：标签无重叠、页面无横向溢出；拖拽、平移、滚轮缩放和节点详情弹窗通过。
- Chromium 1440px：画布约 1065px × 558px，233 个节点、128 条关联；标签无重叠，页面无横向溢出。
- 控制台错误：0。

## 外部审查

- Antigravity wrapper 未能在当前 headless 权限环境中获取命令权限。
- Claude wrapper 因当前后端参数错误退出，未返回审查报告。

## Verdict

本次变更无 Critical 问题；本地测试和浏览器回归通过，可归档。
