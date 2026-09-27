// 业务服务门面：领域方法拆分在 src/service/ 下，通过继承链组装为完整的 PracticeService。
// 练习/判卷 → src/service/sessions.mjs，错题与统计 → review.mjs，题库管理 → bank.mjs，
// 数据与备份 → data.mjs，案例 → case-exam.mjs，论文 → essay.mjs，知识库 → wiki.mjs。
import { WikiDomain } from "./service/wiki.mjs";

export class PracticeService extends WikiDomain {}
