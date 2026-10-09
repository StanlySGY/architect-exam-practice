import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const dist = (items, fn) => { const out = {}; for (const x of items) { const k = String(fn(x) ?? "(missing)"); out[k] = (out[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(out).sort((a,b)=>b[1]-a[1])); };
function groups(items, keyFn) { const map = new Map(); for (const x of items) { const k = keyFn(x); if (!k) continue; if (!map.has(k)) map.set(k, []); map.get(k).push(x); } return [...map.values()].filter((g)=>g.length>1); }
function subjective(items) { return {total:items.length,sourceFileMissing:items.filter(x=>!String(x.sourceFile??"").trim()).length,answerSourceDistribution:dist(items,x=>x.answerSource),answerSourceMissing:items.filter(x=>!String(x.answerSource??"").trim()).length,glmReviewedLabel:items.filter(x=>x.answerSource==="glm-5.2-reviewed").length};}
export function auditBank(bank,{sourcePath=null}={}) {
 const choices=Array.isArray(bank?.choices)?bank.choices:[],cases=Array.isArray(bank?.cases)?bank.cases:[],essays=Array.isArray(bank?.essays)?bank.essays:[],mock=choices.filter(x=>x.sourceType==="mock");
 const opts=x=>["A","B","C","D"].map(k=>norm(x.options?.[k])).join("|");
 const repeated=groups(mock,x=>norm(x.stem)).filter(g=>new Set(g.map(x=>String(x.term)+"|"+String(x.paper))).size>1);
 const exact=groups(choices,x=>norm(x.stem)+"##"+opts(x)).filter(g=>new Set(g.map(x=>String(x.sourceType)+"|"+String(x.term)+"|"+String(x.paper))).size>1);
 const samePaper=groups(choices,x=>norm(x.stem)+"##"+opts(x)).filter(g=>new Set(g.map(x=>String(x.sourceType)+"|"+String(x.term)+"|"+String(x.paper))).size===1);
 const c={total:choices.length,sourceTypeDistribution:dist(choices,x=>x.sourceType),missingSourceFile:choices.filter(x=>!String(x.sourceFile??"").trim()).length,missingPreciseSourceReference:choices.filter(x=>!["sourceUrl","sourcePage","sourceReference","sourceCitation","sourceLocation"].some(k=>String(x[k]??"").trim())).length,answerTrustMetadataPresent:choices.filter(x=>x.answerTrust!==undefined||x.answerTrustLabel!==undefined).length,missingAnalysis:choices.filter(x=>!String(x.analysis??"").trim()).length,missingOptions:choices.filter(x=>!x.options||["A","B","C","D"].some(k=>!String(x.options[k]??"").trim())).length,invalidAnswer:choices.filter(x=>!["A","B","C","D"].includes(String(x.answer??"").trim())).length,answerDistribution:dist(choices,x=>x.answer),repeatedMockStemGroupsAcrossPapers:repeated.length,repeatedMockStemExamples:repeated.slice(0,10).map(g=>g.map(x=>({id:x.id,term:x.term,paper:x.paper,questionNo:x.questionNo,answer:x.answer,stem:String(x.stem??"").slice(0,100)}))),exactSameStemAndOptionsGroupsAcrossPapers:exact.length,sharedStemAndOptionsGroupsWithinPaper:samePaper.length};
 const r={reportVersion:1,sourcePath,readOnly:true,manifestGeneratedAt:bank?.manifest?.generated_at??null,declaredSource:bank?.source??null,counts:{choices:choices.length,cases:cases.length,essays:essays.length},choices:c,cases:subjective(cases),essays:subjective(essays),warnings:[]};
 if(/non.?official|非官方/i.test(String(bank?.source?.note??"")))r.warnings.push("题库元数据明确声明答案为非官方整理；结构完整不等于答案经过官方核验。");
 if(c.missingPreciseSourceReference)r.warnings.push("选择题缺少题目级 URL、页码或条款定位；sourceFile 仅提供文件路径，不能替代精确出处。");
 if(c.answerTrustMetadataPresent<choices.length)r.warnings.push("选择题没有完整的 answerTrust 元数据，不能按题目区分官方答案、第三方整理或未核验状态。");
 if(c.repeatedMockStemGroupsAcrossPapers)r.warnings.push("模拟卷之间存在重复题干候选；脚本不自动删除，需比较选项、答案和知识考点。");
 if(cases.some(x=>!String(x.answerSource??"").trim())||essays.some(x=>!String(x.answerSource??"").trim()))r.warnings.push("部分案例/论文没有 answerSource 标记；这表示来源元数据缺失，不直接推断答案缺失或错误。");
 return r;
}
async function main(){const sourcePath=process.argv[2]?resolve(process.cwd(),process.argv[2]):resolve(import.meta.dirname,"../../architect-exam-bank/data/bank.json");const bank=JSON.parse(await readFile(sourcePath,"utf8"));process.stdout.write(JSON.stringify(auditBank(bank,{sourcePath}),null,2)+"\n");}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write("题库可追溯性审计失败："+e.message+"\n");process.exitCode=1;});
