# 审查记录

## 结论

- Wiki 已拆分为知识点阅读器和独立知识图谱子栏。
- 知识点目录与正文使用独立滚动区域；关联知识点切换右侧阅读器，不再推动整页滚动。
- 图谱保留拖拽、缩放、搜索、章节筛选、适配画布、重新布局和详情交互。
- 生成题目、案例、论文、Wiki 均支持停止生成，取消后恢复按钮状态并区分取消与失败。
- 服务端取消信号贯穿 HTTP、SSE、CLI 和持久化入口，避免取消竞态下落库。

## 验证

- `npm test`：75/75 通过。
- `node --check public/app.js`：通过。
- `node --check src/generator.mjs`：通过。
- `node --check server.mjs`：通过。
- `git diff --check`：通过。
- Playwright 移动端 `390px`：Wiki 两个子栏可切换、图谱可见、无横向页面溢出、控制台无错误。
- Playwright 桌面端 `1440px`：页面 `scrollWidth` 与 viewport 一致，图谱画布约 `1067px`，使用主内容剩余空间。

## 取消竞态修复

- 服务层新增统一 `throwIfAborted(signal)` 检查。
- 题目、案例、论文、Wiki 的写入方法在进入 `store.update` mutator 时再次检查取消信号。
- 新增“模型返回后、持久化入口取消也不写入题库”回归测试。

## 外部审查

- 按项目协作要求尝试调用 Antigravity 与 Claude 双模型分析/审查。
- 当前 CLI 权限环境拒绝了外部模型调用，因此没有可引用的外部审查报告；本记录只汇总本地测试、浏览器回归和人工代码审查结果。
