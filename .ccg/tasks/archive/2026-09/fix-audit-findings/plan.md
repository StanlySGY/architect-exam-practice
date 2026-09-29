# 实施计划

1. 已完成分析：确认既有工作区含 FSRS、题目 revision、题库编辑、问题题状态机及 Wiki 改动；`.ccg/spec/` 不存在。外部分析模型调用均不可用，Antigravity 返回地区限制 403，Claude wrapper 无可用输出。
2. 并行实施模型调用：在 `src/generator.mjs` 修复每次请求的超时/重试生命周期、JSON Schema 降级重试、论文评分数值校验、Claude CLI usage 解析和论文提交文本传递。
3. 并行实施导入隔离：在 `src/import-bank.mjs` 与 `src/service/data.mjs` 使用稳定导入命名空间，处理旧导入 ID 兼容、相关状态引用迁移及重复 ID 拒绝。
4. 并行实施配置与文案：在 `src/model-config.mjs` 收紧 `.env` 权限，在 `public/index.html` 和 `README.md` 更新 FSRS 与模型用量说明。
5. 主线实施作答与判卷：在 `src/service/essay.mjs`、`src/service/case-exam.mjs`、`public/app.js` 原子保存评分对应的答卷；在 `src/service/sessions.mjs` 固定题目快照、隔离 API 响应，并从快照判分。
6. 更新 `test/practice.test.mjs`，运行测试和语法检查，审阅所有变更；尝试双模型复核，并将不可用情况记录在报告中。
7. 更新任务状态、仅归档本任务记录并提交；保留其他已有工作区改动。

文件拆分为渐进的长期维护事项，本次聚焦于上述数据可靠性和运行行为，不进行跨文件架构重排。
