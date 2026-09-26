# P0/P1 加固审查记录

审查日期：2026-09-26
审查范围：本轮针对全项目审查报告实施的安全、考试一致性、备份可靠性和质量门禁改动。

## 综合结论

- Critical：0
- Warning：4
- Info：3
- 本轮范围内没有发现需要阻断交付的 Critical 问题。
- P0/P1 的关键行为已有服务层单元测试覆盖；远程监听、鉴权和启动副作用另做了进程级冒烟检查。

## Critical

无。

已确认的关键边界：

- 非回环监听在初始化 SQLite 前检查访问令牌；缺少令牌时进程以状态码 1 退出，且不会创建数据库文件。
- 除 `/api/health` 外的 API 在启用令牌时统一要求 Bearer 或 `x-architect-token`，Agent API 还要求启动环境显式设置 `ARCHITECT_ENABLE_AGENTS=true`。
- 模型列表请求限制为 HTTP/HTTPS，拒绝账号密码、回环、私网、链路本地、组播和内部域名；DNS 解析后重新校验地址，生产请求固定到解析地址，禁止重定向，并限制超时和响应大小。
- HTTP 模型配置不能修改 `ARCHITECT_CLAUDE_COMMAND`，CLI 路径不再通过公开配置返回。
- 模拟考试判卷在串行存储更新内执行状态检查和写入；超时后只接受服务端已经保存的答案，客户端新答案不能通过判卷请求注入。
- 同题答案 revision 对旧请求统一返回 `stale`，不会因重复答案回退版本号；论文模拟的保存和评分均由服务端检查截止时间。
- 备份导入在替换状态前完成版本、大小、集合、ID、枚举、时间和主要跨集合引用校验，并在导入前生成恢复点。

## Warning

### W1. 自动化 HTTP/E2E 覆盖仍未建立

当前新增的是离线服务层和安全辅助函数测试；鉴权、CSRF、Agent 默认关闭、导入导出权限和移动端流程仍主要依赖手工/冒烟验证。后续应补 Playwright/API 契约回归，尤其覆盖 401、403、超时交卷和重复提交。

### W2. 恢复点没有保留策略

每次导入都会在 `data/backups/` 创建完整恢复点，目录已加入 `.gitignore`，但目前没有按数量、时间或磁盘空间清理的策略。长期频繁导入可能积累较大文件；部署运维应增加保留策略或清理命令。

### W3. Agent 审计粒度仍有限

导入、导出和清空已写入 `auditLog`，但显式开启 Agent 后尚未记录每次执行的调用者、Agent、耗时和结果状态。当前默认关闭且 API 仍受统一令牌保护，风险已降低，但局域网/团队使用前应补充审计。

### W4. 领域服务和状态存储仍是后续工程债务

`src/service/` 的继承式组装和 SQLite 中的整体 JSON 状态仍保留；本轮没有进行实体表迁移、SQL 分页、Wiki backlinks 增量索引或服务组合式重构。这些属于审查报告的 P2/扩展性工作，不应视为本轮 P0/P1 已解决。

## Info

- 前端模拟考试答案保存已按 session/question 串行排队，并在交卷前等待待处理保存请求；服务端 revision 仍是最终一致性边界。
- `src/service/` 和 `src/security.mjs` 等本轮新增模块当前在工作树中显示为未跟踪文件。归档提交只包含 `.ccg/tasks/`，不会替用户提交整个脏工作树；发布前必须将这些运行时模块纳入正式代码提交。
- 本轮没有 `.ccg/spec/` 目录，没有新增规范回馈项。

## 验证记录

通过：

- `npm run lint`
- `npm test`：90/90 通过
- `git diff --check`
- 进程级检查：`HOST=0.0.0.0` 且未设置 `ARCHITECT_ACCESS_TOKEN` 时以状态码 1 退出，日志为“监听非本机地址时必须设置 ARCHITECT_ACCESS_TOKEN”，临时数据库文件不存在。
- 回归检查：项目 `.env` 中的 `ARCHITECT_ACCESS_TOKEN` 会在远程监听安全校验前加载。

双模型审查尝试：

- antigravity：失败。headless 模式因需要 `command` 权限且无法交互授权，输出 `jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for`。
- Claude：失败。wrapper 返回 `claude exited with status 1`，没有产生审查报告。

因此本文件中的结论来自本地 diff、源码逐项复核、自动化测试和进程级冒烟检查；没有把外部模型失败误报为有效审查结果。
