# 审查记录

## 本轮变更

- 案例和论文 API 支持 limit/offset，前端按页渲染并处理筛选、生成后的回到第一页和异步请求竞态。
- 长文本、长链接、ASCII 架构图、参考答案和统计卡片增加收缩与断行规则，移动端页面宽度跟随视口。
- 既有 Wiki 阅读器/图谱子栏、独立目录滚动、节点详情弹层、多供应商模型下拉、Agent 工作台和生成取消链路保持可用。

## 验证

- npm test：76/76 通过。
- node --check public/app.js：通过。
- node --check server.mjs：通过。
- node --check src/service/case-exam.mjs：通过。
- node --check src/service/essay.mjs：通过。
- git diff --check：通过。
- Playwright 桌面端：Wiki 阅读器/知识图谱切换、图谱节点详情弹层、模型列表下拉和数据管理页通过；页面 scrollWidth 与 viewport 一致。
- Playwright 移动端 390px：Wiki、资料和数据管理页无页面级横向溢出；资料目录在自身区域滚动；控制台无错误。

## 分级结论

### Critical

无。

### Warning

1. 案例单条记录仍可能包含较长场景、参考答案和架构图；当前分页已经限制首屏记录数，后续可按用户反馈把答案改为按题目折叠。
2. 无分页参数的案例/论文接口仍返回完整列表，以兼容旧调用；新增内部调用应优先带分页参数。
3. Antigravity 外部审查因 headless 权限返回 HTTP 403，Claude wrapper 因后端参数错误退出；未把外部审查描述为通过。

### Info

- 当前工作区包含此前用户和自动生成的未提交文件；本任务未回滚、清理或提交这些无关改动。
- 模型 API Key 在 UI 和 API 响应中保持掩码，模型获取结果写入供应商对应的选择框。
