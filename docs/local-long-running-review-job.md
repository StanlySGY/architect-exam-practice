# WSL 本地长任务：学习内容与题库来源复核

本项目提供一个可断点续跑的本地只读研究任务。它负责来源可达性、当前题库来源候选映射、学习单元人工复核包、生成题结构候选、答案风险候选映射和评分校准数据入口。它不替代人工事实核验。

## 启动前检查

```bash
cd /home/sgy/workspace/architect-exam-practice
systemctl --user is-active architect-exam-practice.service
curl -fsS http://127.0.0.1:3210/api/health
npm run research:local:dry-run
```

长任务依赖 WSL 中 Node.js 22+、当前应用本机服务，以及两个相邻只读目录：

- `../architect-exam-bank/data/bank.json`
- `../ruankao-senior-architecture-designer/sources/`

任务会计算题库文件元数据和 Markdown 来源文件清单指纹。原始题库 JSON 和来源目录只读，输出绝不写回这些目录。

## 推荐：交给用户级 systemd 独立运行

```bash
cd /home/sgy/workspace/architect-exam-practice
UNIT="architect-exam-review-$(date +%Y%m%d-%H%M%S)"
systemd-run --user --unit="$UNIT" \
  --property=WorkingDirectory=/home/sgy/workspace/architect-exam-practice \
  --setenv=NODE_USE_ENV_PROXY=1 \
  "$(command -v npm)" run research:local -- \
  --job-id=verification-research --concurrency=6 --batch-size=12
```

`systemd-run` 返回后任务独立运行，无需保持当前对话打开。不要在同一个 `job-id` 上并行启动多份进程；脚本带互斥锁。

查看 unit：

```bash
systemctl --user status "$UNIT"
journalctl --user -u "$UNIT" -f
```

查看任务检查点与报告：

```bash
JOB="$HOME/.local/share/architect-exam-practice/review-jobs/verification-research"
cat "$JOB/state.json"
tail -n 50 "$JOB/job.log"
cat "$JOB/report.json"
```

如果任务被手动停止、WSL 退出或进程中断，脚本会在每批 URL 检查后落盘。重新执行同一 `job-id` 会从未完成 URL 继续；如果输入指纹变化会拒绝混用旧结果。需要对当前新数据重新创建一份任务时才使用 `--fresh`。

停止正在运行的 unit：

```bash
systemctl --user stop "$UNIT"
```

脚本接收 SIGTERM，并在当前批次结束后写入暂停状态。下一次用同一个 `job-id` 启动即可续跑。

## 输出文件

输出位于 `~/.local/share/architect-exam-practice/review-jobs/<job-id>/`，目录权限为 0700，文件权限为 0600。主要内容：

- `plan.json`：输入快照、总量和安全边界。
- `state.json`：输入指纹、每个 URL 的检查结果、进度与完成状态。
- `job.log`：每批检查日志。
- `source-mapping-current.json` / `.md`：以当前相邻只读题库和 58 份来源 Markdown 生成的题目来源候选映射。
- `url-check-results.json`：课程证据 URL 的 HTTP 状态、最终跳转、内容类型与关联学习单元。
- `learning-review-batches.json`：322 个部分核验学习单元分为 17 批，每批 20 个或更少。
- `generated-question-audit.json`：807 道 AI 生成题（含 162 条旧格式 `ruankao-agent/mindmap` 记录）的结构/重复候选。
- `answer-risk-review-packet.json`：157 条答案风险候选与本机题库记录关联情况。
- `scoring-calibration-intake-template.json`：人工阅卷样本采集模板。
- `scoring-calibration-status.json`：评分校准是否被人工样本阻塞。
- `report.json`：最终总览。

## 检查边界

1. 来源链接通过系统 `curl` 子进程检查，设连接/总超时；先发 HEAD，但**所有非 2xx HEAD 响应（包括 404、重定向、访问受限和无 HTTP 状态）都必须再用 `GET Range: bytes=0-0` 复核**，并限制响应体大小。最终 GET 的 401/403/407 归类为访问受限，只有最终 GET 的 404/410 才归类为不存在。部分站点不正确处理 HEAD；HEAD 404 不能单独作为链接失效依据。HTTP 200 只说明服务器响应，不证明正文支持该命题或来源身份真实。
2. 来源映射只生成同年度/题型/文本/题号匹配候选；题号、文本或选项匹配均不证明来自官方原卷。每条候选仍需核对版本和权利来源。
3. 结构异常、重复题干和风险词只进入人工复核候选，不自动判断答案对错，不批准、不删除、不改写题库记录。
4. 当前 322 个 partial 学习单元不会因自动链接检查或 AI 输出而升级为 verified；11 个本地 PDF 来源身份未独立认证的单元继续保持 partial。
5. 当前没有人工双评案例/论文锚点集，因此评分校准保持 blocked。本任务不会调用模型，不会消耗模型额度。
6. 本任务只对应用 API 发 GET 请求；不写 SQLite、学习进度、错题、题目或知识单元状态；不写相邻仓库。

脚本参数可选：`--concurrency=1..12`、`--batch-size=1..50`、`--timeout-ms=1000..30000`、`--max-urls=1..10000`、`--job-id=<name>`、`--fresh`、`--dry-run`、`--retry-network-errors`。

`--retry-network-errors` 用于已完成任务的二次复查：只重试网络错误、HTTP 5xx、限流等临时失败；不重试可达、访问受限（401/403）或明确不存在（404/410）的地址。它保留任务指纹和已完成映射报告，只更新失败 URL 的检查结果。URL 探测由有硬超时的 curl 子进程执行，避免代理 TCP 连接无限期卡住 Node 事件循环。
