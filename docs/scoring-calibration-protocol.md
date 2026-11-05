# 案例/论文 AI 评分校准协议

## 目的与边界

校准要回答的是：**在固定模型、提示词、评分器和评分细则版本下，AI 评分与独立人工裁决分数的差距有多大，误差集中在哪些评分维度。** 它不能证明 AI 分数等同于真实考试成绩，也不能把一个批次的结果外推到未来版本。

## 样本采集

案例题与论文题分开统计。每批样本的 metadata 必须记录模型标识、模型版本和采集日期；每份答卷须保留题型、匿名样本 ID、评分细则版本、提示词版本、评分器版本。每份答卷必须由两位不同阅卷人独立盲评，记录各自总分和满分；分歧经讨论或第三方裁决后记录 adjudicated 分数。AI 对同一份答卷可运行一次或多次，记录每次原始结构化结果。

不得用 AI 自评分数充当人工标签。不要把同一份答卷拆成多个独立样本来凑数量。同一题型混入不同的 rubric、prompt 或 grader 版本时，程序会阻止合并分析；每个版本组合应单独采样。避免保存考生姓名、单位、联系方式等身份信息；答卷使用前应确认授权与内部数据处理要求。

## 最小探索性样本

每种题型至少 10 份完整样本（双人独立评分、裁决分数、AI 评分、版本信息齐备）才允许输出探索性汇总。10 份只是启动分析的最低门槛，不代表统计功效充分、模型通过认证或可以用于正式成绩判定。样本不足时程序应退出码 2，并明确标记 blocked。

## 指标解释

- 总分误差：将分数按各题满分归一化为百分比，计算 MAE（百分点）、有符号偏差、完全一致数、误差在 5/10 个百分点内的数量，以及最大误差和最差样本。
- 人工一致性：双人评分计算 ICC(A,1)（双向随机、绝对一致、单次测量）及平均绝对评分差。必须由同一对阅卷人评完该批全部样本；录入顺序不影响计算（按匿名 raterId 规范排序），若阅卷组合变化则不输出合并 ICC，只保留双评差值并报告阅卷组合数。报告给出 ICC 状态和 ANOVA 均方项，不提供置信区间；零方差导致分母为零时标记不可计算，不把缺失结果写成 0。ICC 可能为负值，不做截断。ICC 不应脱离样本量、评分范围和分歧分布单独解释。
- 分项误差：论文题使用生产评分器的 `dimensions` 对象（固定六个维度，字段为 `score/max`），人工裁决也需提供同名维度；六维度及各自满分必须与生产细则一致，分项得分/满分之和必须等于总分/总满分。案例题生产返回 `results[]`（`id/score/max`），子问 ID 必须唯一，子问分数和满分之和必须等于总分和总满分；AI 结果与人工裁决的子问 ID 集合及满分必须一致。`id` 只是当前案例的小问编号，不会被跨案例误当作统一评分维度。案例分项只有在人工与 AI 结果都另行提供可比的 `name/dimension/criterion` 时才会计算。
- 版本隔离：同一题型的样本若混入不同 rubric、prompt 或 grader 版本，程序会标记该题型 blocked 并列出版本分组，不会把不同评分口径下的结果合并计算。请每个版本组合单独采样和运行。
- 通过/不通过：只有样本明确提供 passThresholdPct 时才计算 AI 与人工裁决的判定分歧；不擅自推定论文及案例的统一合格线。`disagreementCount` 比较人工判定与同一答卷 AI 多次运行平均分的判定；`aiRunDisagreementCount` 则逐次比较 AI 单次运行与人工判定，两者不可混为一谈。
- 重复运行波动：同一答卷多次 AI 运行的分数极差用于观察非确定性，不可与人工评分误差混为一谈。总分先在同一答卷内对多次运行取平均，再以答卷为单位计算误差；分项误差也先在答卷内平均多次运行，再让每份答卷等权参与 MAE，避免运行次数多的答卷获得更大权重。报告同时列出每个分项的有效样本数。
- 样本身份：`id` 必须是非空匿名字符串，且整个 intake 唯一；重复 ID 的记录全部拒绝，不能通过重复录入增加样本量。`samples` 顶层必须为数组，模型及模型版本必须是非空字符串。

## 运行

先复制模板到私有目录（不要把个人答卷或人工评分直接提交 Git）：

```bash
cp docs/scoring-calibration-intake-template.json ~/.local/share/architect-exam-practice/scoring-calibration-intake.json
```

填写结构示例（字段形状与本项目评分器一致；案例子问以 `id/score/max` 表示，论文六维度以对象键表示）：

```json
{
  "metadata": {
    "model": "model-id",
    "modelVersion": "provider-model-revision",
    "promptVersion": "case-essay-prompt-2026-11",
    "graderVersion": "grader-commit-or-release",
    "rubricVersion": "rubric-v1",
    "collectedAt": "2026-11-05"
  },
  "samples": [{
    "id": "case-anon-001",
    "type": "case",
    "version": { "rubric": "rubric-v1", "prompt": "case-prompt-v1", "grader": "grader-v1" },
    "humanRatings": [
      { "raterId": "rater-a", "score": 52, "maxScore": 75 },
      { "raterId": "rater-b", "score": 50, "maxScore": 75 }
    ],
    "adjudicated": {
      "total_score": 51,
      "max_score": 75,
      "results": [{ "id": "1", "score": 17, "max": 25 }, { "id": "2", "score": 34, "max": 50 }]
    },
    "aiRuns": [{
      "total_score": 51,
      "max_score": 75,
      "results": [{ "id": "1", "score": 17, "max": 25 }, { "id": "2", "score": 34, "max": 50 }]
    }]
  }, {
    "id": "essay-anon-001",
    "type": "essay",
    "version": { "rubric": "rubric-v1", "prompt": "essay-prompt-v1", "grader": "grader-v1" },
    "humanRatings": [
      { "raterId": "rater-a", "score": 68, "maxScore": 100 },
      { "raterId": "rater-b", "score": 70, "maxScore": 100 }
    ],
    "adjudicated": {
      "total_score": 69,
      "max_score": 100,
      "dimensions": {
        "切合题意": { "score": 14, "max": 20, "comment": "" },
        "观点正确": { "score": 14, "max": 20, "comment": "" },
        "逻辑清晰": { "score": 10, "max": 15, "comment": "" },
        "论据充分": { "score": 14, "max": 20, "comment": "" },
        "语言流畅": { "score": 7, "max": 10, "comment": "" },
        "格式规范": { "score": 10, "max": 15, "comment": "" }
      }
    },
    "aiRuns": [{ "total_score": 69, "max_score": 100, "dimensions": {
      "切合题意": { "score": 14, "max": 20, "comment": "" },
      "观点正确": { "score": 14, "max": 20, "comment": "" },
      "逻辑清晰": { "score": 10, "max": 15, "comment": "" },
      "论据充分": { "score": 14, "max": 20, "comment": "" },
      "语言流畅": { "score": 7, "max": 10, "comment": "" },
      "格式规范": { "score": 10, "max": 15, "comment": "" }
    } }]
  }]
}
```

运行：

```bash
node scripts/evaluate-scoring-calibration.mjs \
  ~/.local/share/architect-exam-practice/scoring-calibration-intake.json \
  ~/.local/share/architect-exam-practice/scoring-calibration-report.json
```

输出文件采用“仅新建”模式，若路径已存在会拒绝覆盖。样本不足返回退出码 2；修正/补充样本后使用新的输出路径再次运行。

## 决策规则

先看人工双评一致性，再看 AI 与 adjudicated 的差距。如果人工阅卷本身分歧很大，应先澄清 rubric 和样例锚点，而不是直接调模型提示词。若 AI 偏差集中在特定维度，应补充对应评分细则和边界案例，再用全新留出样本复测。任何权重、阈值或 prompt 修改后，都必须记录新版本并重新采集留出样本；不能在同一批数据上反复调参再把结果当作独立验证。
