# 需求记录

- 审计 /home/sgy/workspace/ruankao-senior-architecture-designer，吸收其 INDEX.md 分层、frontmatter 元数据、来源可追溯和按需阅读经验。
- 资料阅读器继续兼容现有 Markdown API，同时识别 Markdown、HTML、SVG、Mermaid 和纯文本格式。
- Markdown 中的 Mermaid fenced code 至少支持当前资料实际使用的 flowchart、sequenceDiagram、stateDiagram-v2，无法解析时保留可读源码和明确提示。
- HTML/SVG 必须在本地安全边界内展示，禁止资料内容获得宿主页面脚本权限。
- 增加阅读辅助：资料元信息、目录导航、前后篇切换、字号/版心控制和专注阅读，避免长章节阅读时失去位置。
- 不修改现有资料正文，不改变旧版 markdown 字段和资料路径安全校验。
