# 审查结果

## 范围

- `src/figures.mjs`：Mermaid flowchart 节点、链式边、标签边、反向/双向箭头和未完整语义警告。
- `src/markdown.mjs`：内嵌 SVG 的元素/属性 allowlist、脚本和外部资源清理。
- `src/import-bank.mjs`、`src/exam-assets.mjs`、`src/service/sessions.mjs`、`public/app.js`、`public/styles.css`：答案来源提示、资料来源提示和窄屏阅读布局。

## 结果

### Critical

无。未发现会泄露答案、执行 SVG 脚本、静默丢失已识别 Mermaid 关系或破坏旧数据读取的阻断问题。

### Warning

1. 题库答案不能被项目内部结构检查证明为事实正确。`bank.json` 明确声明历年答案是第三方整理；案例/论文中的部分参考答案来自 `glm-5.2-reviewed`。产品现在持续显示来源提示，但仍需要使用官方原卷、权威解析或人工复核逐题确认。
2. 85 个 Mermaid 图包含 `subgraph`。当前渲染器保留节点和可识别连线，但不复现 Mermaid 的分组边界和完整布局，因此页面会显示结构化语义警告并提供源码核对入口。
3. 双模型外部审查未能提供报告：Antigravity 因地区资格限制拒绝；Gemini 因 API key 无效拒绝；Claude wrapper 异常退出。已改用本地静态审查、全量测试和浏览器实测，不将外部模型视为已通过。

## 验证证据

- `npm run lint` 通过。
- `npm test`：124/124 通过。
- 257 个 Mermaid 图扫描：0 个未标记的解析警告，渲染 2037 条可识别关系；85 个含 `subgraph` 的图均带结构语义警告。
- 题库结构扫描：1947 道选择题、132 道案例题、104 道论文题 ID 唯一，选择题均有 A-D 选项和合法答案字段。
- 已知历年选择题缺口：2010 下半年第 8 题、2011 下半年第 8 题、2012 下半年第 69 题；套卷选择器会提示缺题号。
- `http://127.0.0.1:3210/api/health` 返回 `{"ok":true,"service":"architect-chapter-practice"}`。
- Playwright 实测桌面资料页、题目来源提示、内嵌 SVG；390px 移动端资料页改为单栏且无页面级横向溢出。

## 结论

项目的资料和题库格式、渲染与来源标识已得到改进，但不能宣称正文和答案全部事实无误。后续应优先依据官方原卷/教程逐题建立人工复核记录，再把已确认的修订写回题库。
