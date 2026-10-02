# 修复记录

## 根因

3297 被设置为读取 `/tmp/architect-product-audit.sqlite`。该文件是此前隔离验证用的空数据库，只有 4 KB；原始学习数据仍保存在 `data/state.sqlite`。

## 处理

停止读取临时库的服务进程，并在不设置 `ARCHITECT_DATA_FILE` 的情况下以 `HOST=127.0.0.1 PORT=3297` 重启，使服务回到默认的 `data/state.sqlite`。

## 验证

- `GET /api/health`：200；
- `GET /api/data/status`：2,414 道题、233 条 Wiki、132 个案例、104 篇论文；
- `GET /api/content-health`：返回对应内容质量摘要；
- 首页：HTTP 200；
- `git diff --check`：通过。

未修改或删除任何学习数据库内容。
