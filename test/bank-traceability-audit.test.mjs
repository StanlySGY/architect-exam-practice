import assert from "node:assert/strict";
import test from "node:test";
import { auditBank } from "../scripts/audit-bank-traceability.mjs";
test("只读题库审计区分结构完整、出处缺失和重复题干候选",()=>{
 const r=auditBank({source:{note:"答案均为非官方整理。"},choices:[
 {id:"a",sourceType:"mock",term:"卷一",paper:"卷一",stem:"同题",options:{A:"甲",B:"乙",C:"丙",D:"丁"},answer:"A",analysis:"解析",sourceFile:"a.md"},
 {id:"b",sourceType:"mock",term:"卷二",paper:"卷二",stem:"同题",options:{A:"甲",B:"丙",C:"乙",D:"丁"},answer:"A",analysis:"解析",sourceFile:"b.md"}],cases:[{sourceFile:"case.md"}],essays:[{sourceFile:"essay.md",answerSource:"glm-5.2-reviewed"}]});
 assert.equal(r.readOnly,true);assert.equal(r.choices.missingSourceFile,0);assert.equal(r.choices.missingPreciseSourceReference,2);assert.equal(r.choices.answerTrustMetadataPresent,0);assert.equal(r.choices.repeatedMockStemGroupsAcrossPapers,1);assert.equal(r.choices.exactSameStemAndOptionsGroupsAcrossPapers,0);assert.equal(r.cases.answerSourceMissing,1);assert.equal(r.essays.glmReviewedLabel,1);assert.ok(r.warnings.some(x=>x.includes("非官方整理")));
});
