# 批次 C 第 4 批 20 个学习单元来源与教学质量初审（2026-11-06）

## 结论与范围

本批复核 20 个 partial 单元：11.6.2、12.1.1、12.1.2、12.2.1、12.2.2、12.2.3、12.2.4、12.2.5、12.3.2、12.4、13.1、13.2.1、13.2.2、13.2.3、13.2.4、13.2.5、13.2.6、13.3.1、13.3.2、13.3.3。

**20 个单元全部保持 partial。** 本轮审阅了当前单元主张、教学字段、自检题和已登记 evidence，并与 NIST、ISO/IEC/IEEE、SEI、Microsoft、W3C、WHATWG、OMG、Martin Fowler 资料交叉核对。外部资料仅用于识别定义、适用范围和概念边界，不代替《系统架构设计师教程（第 2 版）》逐页复核；未更新课程 JSON、evidence 或状态。

## 工作队列与共性问题

- 20/20 单元均只有 1 条结构有效的命题级 evidence；reviewedOn 均为 2026-10-10，每单元只登记 1 个来源 host。单条证据不等于整单元材料性主张已核验。
- 20/20 的 why、how、confusions、examFocus、scenarios 五个核心教学字段均命中工作队列的已知模板信号。模板命中只是复核优先级，不证明事实错误。
- 第二道 selfChecks 主要复用通用脚手架：11.6.2 使用“核心原理—新增能力—架构影响—场景—风险”；12 章重复“业务目标—职责边界—架构风格—技术决策—风险权衡”；13 章重复“层次职责—依赖方向—通信—变化隔离—性能/维护成本”。这些分析套路不能替代针对四 V、架构描述、MVC/MVP/MVVM、XML、UIP、动态组件、DDD 与 BPMN 的专项练习。
- 现有 evidence 多为 bounded claim：NIST 大数据参考架构支持角色与组件，不足以单独定义大数据；TOGAF 总览不能代替教材对信息系统架构定义或固定分类的证据；框架文档的局部实现不是普遍架构约束。

## 逐项复核

| 单元 | 当前证据范围与复核结论 / 修订方向 |
|---|---|
| 11.6.2 | 现有 NIST Volume 6 evidence 仅支持参考架构角色/组件。定义应补 NIST SP 1500-1r2：大数据主要体现 volume、variety、velocity、variability，是否需要可扩展架构取决于工作负载、性能、成本和时间要求，不存在通用数值门槛。“价值”是分析目标/收益，不宜替代特征定义。 |
| 12.1.1 | 当前把信息系统架构描述为统筹、规划、设计和组织活动，并称有概念层/物理层。ISO/IEC/IEEE 42010:2022 规定架构描述（AD）的结构和表达、视点/关注点等，不规定架构设计过程或方法；概念层/物理层应标注为课程采用的视角，不是该标准规定的唯一二分法。 |
| 12.1.2 | 企业架构被写成从系统结构描述逐步发展为连接战略、业务、信息、技术和治理的体系。避免所有组织都遵循单线历史阶段；TOGAF 是一种框架/方法，不代表各企业必须采用同一域划分、组织结构或实施顺序。需补教材历史依据。 |
| 12.2.1 | 架构风格定义系统家族的词汇表、构件/连接件类型和组合约束，SEI/Garlan–Shaw 经典资料对核心定义支持较强。保留三要素，补充结构不变量/计算模型、适用前提和质量属性权衡；1994 文献不代表穷尽现代风格。 |
| 12.2.2 | 当前 Microsoft 架构风格指南不能支撑完整的物理/逻辑分类。补 N-tier 的 layer/tier 区分：layer 是逻辑职责和依赖边界，tier 是物理部署位置；多个逻辑层可部署在同一 tier，一个逻辑层也可拆到多个 tier。 |
| 12.2.3 | 现有 TOGAF evidence 只支持业务、数据、应用、技术域，不能证明“战略、业务、组织、管理、技术、人的因素”是固定且穷尽的强制分类。宜将其标注为课程综合视角，按利益相关方关注点和系统环境选择；ISO 42010 的 concerns/viewpoints 更能说明情境差异。 |
| 12.2.4 | Azure 架构风格指南支持多种组织模式及其权衡，不证明从单机到分布式/服务化/企业集成的线性历史路径。改为多种形态并存；单体、分层、分布式、事件驱动、微服务按业务、规模、自治、团队和运维条件选型，复杂度高不等于质量高。 |
| 12.2.5 | TOGAF evidence 支持多域关联，但不规定固定层数。建议解释业务/组织、数据、应用/服务、技术/部署、治理/安全等视角及其映射；不要把企业架构域与软件内部表示层、业务层、数据层混淆。 |
| 12.3.2 | TOGAF ADM evidence 只支持业务目标、需求管理与架构治理的联系，不是完整企业信息化方案。需分开架构开发方法与数字化转型生命周期：流程重构、数据治理、人才、采购、迁移、运营、变更管理都可能涉及；ADM 应裁剪和迭代，不是机械瀑布流程。 |
| 12.4 | ISO/IEC/IEEE 42030:2019 支持按利益相关方关注点开展架构评估、识别风险/机会和支持决策，但当前 what 是教学目标而非具名案例。需补真实案例、背景、参与方、业务目标、遗留约束、标准接口、备选方案、权衡、实施迁移和可证实结果。标准集成并非企业整合成功的充分条件。2019 版已发布，2026 年第 2 版工作项在研。 |
| 13.1 | Microsoft 来源支持分层风格，不证明所有系统必须用表现/中间/访问/数据固定四层。明确 layer 是逻辑边界，tier 是物理部署；补严格/宽松分层、跨层访问规则及成本，增加层数不自动提高质量。 |
| 13.2.1 | Microsoft ASP.NET Core MVC 对职责分离有直接说明：Controller 协调请求并选择 View，Model 表示状态/业务逻辑，View 呈现数据。需强调框架实现不是所有 MVC 变体；复杂业务逻辑宜下沉到模型/领域服务，ViewModel 是 UI 数据投影，不等同领域 Model。 |
| 13.2.2 | Fowler 的资料支持 MVP 职责分离，但原泛化 MVP 文章已拆分为 Passive View 与 Supervising Controller。前者更严格地把 View 行为放在 Presenter，后者允许 View 做简单绑定/展示；“Presenter 负责全部交互”和“View 绝不访问 Model”不能当作所有 MVP 的硬规则。 |
| 13.2.3 | Microsoft MAUI 资料支持 View 绑定 ViewModel、ViewModel 协调 Model；应补属性通知/命令和测试隔离。某些实现中 ViewModel 可直接暴露 Model 对象供 View 绑定，不能把 View 与 Model 绝对隔离画成唯一拓扑。 |
| 13.2.4 | W3C XML evidence 只支持通用结构化标记/元素嵌套。XML 本身不是 GUI 专用语言；控件、布局和事件语义由 XAML 等具体 UI 词汇表/框架赋予。HTML 也不只是“关注显示”，WHATWG 将其定位为具有语义的 Web 文档/应用标记语言。应区分 XML、HTML、框架专用 UI 标记。 |
| 13.2.5 | Fowler Application Controller 支持集中协调屏幕导航和应用流程，但不直接定义课程所称 UIP。Microsoft UIP Application Block 历史资料中的 Navigator/Navigation Graph 可配置页面与合法转换，呈有向状态图；应标明是特定历史框架语境，不与 Application Controller、一般状态机或所有工作流引擎混为一谈。 |
| 13.2.6 | Blazor DynamicComponent 只证明可按运行时组件 Type 与 Parameters 动态渲染组件，不是完整元数据页面引擎。完整 schema-driven 页面还需 schema、控件映射、校验、权限、布局、版本兼容和错误处理。 |
| 13.3.1 | Microsoft DDD 资料支持按领域概念组织业务规则。需区分 bounded context、实体/聚合、domain service 与 application service：聚合界定一致性边界，应用服务编排用例，领域服务承载不自然属于单一实体/值对象的规则；组件、部署服务和事务边界不可直接画等号，DDD 也非所有系统必选。 |
| 13.3.2 | OMG BPMN 2.0.2 支持事件、活动、网关、顺序流和参与者。工作流不只是线性有序列表，BPMN 可表达条件分支、合并、并行网关和跨参与者消息流；需区分流程建模符号与运行时流程引擎。 |
| 13.3.3 | Microsoft DDD 资料明确实体以身份、连续性和生命周期识别。补实体与值对象对照：实体以身份识别，值对象以属性值表达；实体可封装行为/不变量。领域实体不等同数据库表或 ORM 行，边界依赖 bounded context。 |

## 来源与可支持范围

1. **NIST 大数据定义与参考架构**
   - NIST SP 1500-1r2, *NIST Big Data Interoperability Framework: Volume 1, Definitions*：https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1500-1r2.pdf
   - NIST Big Data Glossary：https://csrc.nist.gov/glossary/term/big_data
   - NIST Volume 6, *Reference Architecture*：https://www.nist.gov/publications/nist-big-data-interoperability-framework-volume-6-big-data-reference-architecture
   - Volume 1 支持四 V、工作负载依赖和可扩展架构边界；Volume 6 支持角色、功能组件及管理/安全/隐私结构。参考架构不规定通用数据量阈值。

2. **架构描述和架构评估**
   - ISO/IEC/IEEE 42010:2022：https://www.iso.org/standard/74393.html
   - ISO/IEC/IEEE 42030:2019：https://www.iso.org/standard/73436.html
   - 42010 规定架构描述的表达结构、视点/关注点等，不规定架构设计方法或过程。42030:2019 支持架构评估关注点、质量、风险/机会与决策；ISO 页面显示 2019 版仍为已发布版本，2026 年已有第 2 版工作项：https://www.iso.org/standard/93814.html。

3. **架构风格与 layer/tier**
   - Garlan & Shaw, SEI 软件架构风格经典资料：https://www.sei.cmu.edu/documents/1119/1994_005_001_16331.pdf
   - Microsoft Azure Architecture Styles：https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/
   - Microsoft N-tier Architecture：https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/n-tier
   - SEI 支持构件、连接件和组织约束的风格定义；Microsoft 用于 layer/tier 区分和选型权衡，不证明风格有固定线性演进史。

4. **企业架构框架**
   - The Open Group TOGAF overview：https://www.opengroup.org/togaf
   - 本轮该总览页面访问受限，未能直接审阅详细正文。因此只保留既有 evidence 的有限范围判断，不用它证明“战略/业务/信息/技术/治理”固定清单。后续须对照指定教材和可访问的正式 TOGAF 文本补核。

5. **MVC、MVP、MVVM 与 Application Controller**
   - Microsoft ASP.NET Core MVC：https://learn.microsoft.com/en-us/aspnet/core/mvc/overview?view=aspnetcore-10.0
   - Martin Fowler MVP/Passive View/Supervising Controller：https://martinfowler.com/eaaDev/ModelViewPresenter.html 、https://martinfowler.com/eaaDev/PassiveScreen.html 、https://martinfowler.com/eaaDev/SupervisingPresenter.html
   - Microsoft .NET MAUI MVVM：https://learn.microsoft.com/en-us/dotnet/architecture/maui/mvvm
   - Fowler Application Controller：https://martinfowler.com/eaaCatalog/applicationController.html
   - 用于区分具体变体与职责边界；MVP 不应只有一种 View/Presenter 依赖规则。

6. **XML 与 HTML**
   - W3C XML 1.0 Fifth Edition：https://www.w3.org/TR/xml/
   - WHATWG HTML Living Standard：https://html.spec.whatwg.org/
   - XML 是通用结构化标记语法；HTML 具有 Web 文档和应用语义。GUI 控件、布局和事件需由具体 UI 标记语言/框架定义。

7. **UIP 与动态组件**
   - Microsoft UIP Application Block 历史文章：https://learn.microsoft.com/en-us/archive/msdn-magazine/2005/august/ui-testing-isolate-ui-code-before-it-invades-your-business-layer
   - Blazor DynamicComponent（.NET 10）：https://learn.microsoft.com/en-us/aspnet/core/blazor/components/dynamiccomponent?view=aspnetcore-10.0
   - 前者支持特定历史 UIP 框架语境；后者只支持按组件类型和参数动态渲染，不足以证明完整元数据页面引擎。

8. **DDD 与 BPMN**
   - Microsoft DDD-oriented microservice/domain model：https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice 、https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/microservice-domain-model
   - OMG BPMN 2.0.2：https://www.omg.org/spec/BPMN/2.0.2/PDF
   - DDD 用于实体身份/生命周期、值对象、聚合与业务规则边界；BPMN 用于流程建模符号。二者不意味着所有项目必须采用特定运行时框架。

## 下一步教学修订建议（草案，未写回 JSON）

1. **11.6.2**：拆成“四 V + 工作负载/可扩展性判断 + 分析价值”，用不同规模/速度的数据场景说明不能设固定容量门槛。
2. **12 章**：建立“架构 / 架构描述 / 企业架构 / 架构风格 / 架构域 / layer-tier / 架构评估”概念关系表；区分规范定义、框架实践、课程综合分类与历史叙事；12.4 增加可溯源的具名案例。
3. **13 章**：MVC/MVP/MVVM 做职责与依赖对照；XML/HTML/XAML 分开；UIP、Application Controller 与 BPMN 分开；动态组件与 schema 页面生成分开；DDD 聚合/事务边界讲清。
4. 将第二道自检题替换成知识点专项题：四 V 与阈值判断、架构描述视点、layer/tier 拓扑、MVP 变体、MVVM 绑定通知、XML/HTML/XAML、UIP 导航图、动态组件与 schema、聚合一致性、BPMN 条件/并行流程。
5. 在获得明确课程正文编辑授权、指定教材页码与人工复核记录前，只保留修订建议，不因外部来源增加而升级状态。

## 未关闭事项与保护边界

- 全部 20 个单元仍为 partial；缺人工签字、指定教材版次/印刷页码和逐主张覆盖记录。
- 每单元仅 1 条有效命题级 evidence，不能覆盖单元内所有主张；日期均为 2026-10-10，需要重新核对来源版本/有效性。
- The Open Group TOGAF 详细页面本轮无法直接读取；企业架构细节需指定教材和正式文本补核。
- 12.4 尚缺可逐项核验的具名案例来源；学习目标不能替代真实案例材料。
- 用户现有 data/learning-content.json 修改保持原样，本轮未修改、暂存或提交。
- 未修改相邻题库、SQLite、学习/答题记录、正式答案或审批状态；未执行模型生成/评分、模拟考试、部署或 PR 合并。
