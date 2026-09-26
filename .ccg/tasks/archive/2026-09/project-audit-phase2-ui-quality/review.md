# Review: P2 前端反馈与 API 可靠性改进

## 外部双模型审查

按任务要求并行尝试了 antigravity 和 Claude 两路只读审查。

- `codeagent-wrapper --progress --backend antigravity ...`：headless 模式因所需 command 权限被自动拒绝，退出码 1，未产生 `agent_message`。
- `codeagent-wrapper --progress --backend claude ...`：退出码 1，未产生审查内容。
- 直接使用 `agy --dangerously-skip-permissions --print` 重试：进程持续无输出，等待后手动中断，未产生审查内容。
- 直接使用 `claude --dangerously-skip-permissions --permission-mode bypassPermissions --print` 重试：退出码 1，返回 `Failed to authenticate. API Error: 401 Invalid API key`。

外部模型未能提供可用的代码审查结论，以上命令和错误证据保留在本任务记录中；以下为本地审查结论。

## 本地审查

### Critical

无。

### Warning

无。

### Info

- 共享 `api()` 在 `public/app.js:143-239` 为默认请求设置 30 秒超时，调用方可传入 `AbortSignal` 或覆盖超时；超时返回 `REQUEST_TIMEOUT`/408，主动取消优先保留原始取消错误。
- `beginLoad()` 在 `public/app.js:296-309` 使用按页面 key 递增的版本，列表请求完成前再次触发加载时，旧响应不会清空或覆盖新结果。
- 主要列表和详情加载均设置 `aria-busy`、可感知的 loading 状态和页面级重试入口；HTML 初始状态见 `public/index.html`，样式见 `public/styles.css`。
- 模拟考试答案保存使用每题队列和 revision，交卷前等待当前保存请求；生成、评分、保存和提交按钮在请求期间有明确的禁用/进行中状态。
- `test/frontend-contract.test.mjs` 是静态契约测试，覆盖默认超时、取消监听、主要容器无障碍属性、重试入口、长请求超时和 loading/error 样式；它不能替代真实浏览器 E2E。
- `resolveElement()` 和资料详情加载中的局部变量 `body` 当前未使用，但不影响运行行为，未扩大本阶段范围处理。

## 验证

- `npm run lint`：通过。
- `npm test`：94/94 通过。
- `git diff --check`：通过。
- `node --check public/app.js`：通过。

## 浏览器验证

- 使用 Playwright 在 1440×900 和 390×844 视口检查主要页面，未发现横向溢出或正常加载时的页面错误。
- 拦截真题目录请求后，页面显示“加载失败”、页面级“重新加载”入口，目录容器恢复 `aria-busy="false"`，开始按钮保持禁用；恢复请求后目录重新渲染，显示 `26 套可开 · 最新 2025年下半年`，开始按钮重新启用。
- 对同一模拟考试题目模拟 revision 1 延迟 160ms、revision 2 延迟 15ms 的乱序返回。服务端最终保留 revision 2 的答案；revision 1 返回 `stale: true`，未覆盖新答案。
- 浏览器回归创建的临时会话已通过删除接口放弃清理。

## 结论

本地审查结果为 `APPROVE`。外部双模型审查因运行环境不可用未完成，但本阶段的离线测试、浏览器验证和并发乱序回归均已通过；完整 Playwright E2E 仍应在具备稳定浏览器测试环境后纳入自动化质量门禁。
