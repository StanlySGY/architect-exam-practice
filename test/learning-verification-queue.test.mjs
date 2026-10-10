import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildVerificationQueue } from '../scripts/audit-learning-verification-queue.mjs';
const content=JSON.parse(fs.readFileSync(new URL('../data/learning-content.json',import.meta.url),'utf8'));
test('verification queue keeps claim-level evidence separate from whole-unit status',()=>{
 const report=buildVerificationQueue({units:{'4.3.1':{status:'partial',what:'core claim',source:{path:'https://csrc.nist.gov/glossary/term/defense_in_depth'},evidence:[{url:'https://csrc.nist.gov/glossary/term/defense_in_depth',supportedClaim:'definition',scope:'core definition only',reviewedOn:'2026-10-09',reviewStatus:'source-supports-core-claim'}]},'4.3.2':{status:'partial',what:'invalid evidence date',evidence:[{url:'https://example.com/claim',supportedClaim:'claim',scope:'bounded',reviewedOn:'2026-02-30',reviewStatus:'source-supports-core-claim'}]},x:{status:'verified',what:'unsupported',evidence:[{url:'https://example.com'}]}}});
 assert.equal(report.unitsWithClaimLevelEvidence,1); assert.deepEqual(report.verifiedWithoutEvidence,['x']); assert.equal(report.unitsMissingEvidence,2);
});

test('verification queue rejects malformed or impossible evidence review dates',()=>{
 const makeEvidence=reviewedOn=>({url:'https://example.com/claim',supportedClaim:'claim',scope:'bounded claim only',reviewedOn,reviewStatus:'source-supports-core-claim'});
 const report=buildVerificationQueue({units:{valid:{status:'partial',evidence:[makeEvidence('2024-02-29')]},malformed:{status:'partial',evidence:[makeEvidence('2024-2-09')]},impossible:{status:'partial',evidence:[makeEvidence('2025-02-29')]}}});
 assert.equal(report.unitsWithClaimLevelEvidence,1);
 assert.deepEqual(report.queue.map(unit=>unit.id),['impossible','malformed']);
});
test('current learning course has 324 authored units and preserves evidence boundaries',()=>{
 const report=buildVerificationQueue(content); assert.equal(report.unitCount,324); assert.equal(report.statusDistribution.verified,3); assert.equal(report.statusDistribution.partial,321); assert.equal(report.unitsWithClaimLevelEvidence,324); assert.equal(report.unitsMissingEvidence,0); assert.deepEqual(report.verifiedWithoutEvidence,[]);
});

test("NIST-backed security concepts carry bounded claim-level evidence and remain partial",()=>{
 for (const id of ["4.6.2","4.7.1","4.7.2","4.8.2"]) {
  const unit=content.units[id];
  assert.equal(unit.status,"partial",id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});

test('SEI architecture evaluation and reliability units carry bounded source evidence and remain partial',()=>{
 for (const id of ['8.1.1','8.1.2','8.2.1','8.3','9.1.1','9.1.2','7.2.1','7.2.4','7.2.7','16.3.2']) {
  const unit=content.units[id];
  assert.equal(unit.status,'partial',id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});


test('architecture documentation, ADR, SDN and access-control concepts have bounded evidence',()=>{
 for (const id of ['7.1.1','7.2.2','7.2.6','10.7.1','17.2.5','18.2.2','18.2.3','18.5.3']) {
  const unit=content.units[id];
  assert.equal(unit.status,'partial',id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});


test('authentication, confidentiality, integrity and recovery concepts have bounded NIST evidence',()=>{
 for (const id of ['18.5.2','18.5.4','18.5.5','17.3.1']) {
  const unit=content.units[id];
  assert.equal(unit.status,'partial',id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});

test("OWASP application security and big-data architecture units have bounded evidence and remain partial",()=>{
 for (const id of ["18.7.1","18.7.2","18.7.3","19.1","19.2.1","19.2.2","19.3.1","19.3.2","19.3.3","19.3.6","19.4.1","19.5"]) {
  const unit=content.units[id];
  assert.equal(unit.status,"partial",id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});


test("NIST risk, security evaluation, data integrity, e-commerce and OT security units have bounded evidence",()=>{
 for (const id of ["18.3.2","18.3.3","18.5.1","18.6.1","18.6.2","18.8.1","18.8.2"]) {
  const unit=content.units[id];
  assert.equal(unit.status,"partial",id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});


test("threat modeling, zero trust, incident response and stream-processing units have scoped evidence",()=>{
 for (const id of ["18.1.1","18.1.2","18.2.1","18.4.1","18.4.2","19.3.4","19.4.2","19.4.3","19.6.1","19.6.2"]) {
  const unit=content.units[id];
  assert.equal(unit.status,"partial",id);
  assert.ok(unit.evidence?.some(e=>e.url===unit.source.path && e.supportedClaim && e.scope && e.reviewedOn && e.reviewStatus),id);
 }
});

test("NIST source evidence supports only the public-key and certificate-binding core claims",()=>{
 const publicKey=content.units["4.4.3"];
 const certificate=content.units["4.5.2"];
 assert.equal(publicKey.status,"partial");
 assert.equal(certificate.status,"partial");
 assert.ok(publicKey.evidence?.some(e=>e.url==="https://csrc.nist.gov/glossary/term/public_key_cryptography" && e.reviewStatus==="source-supports-core-claim" && e.scope.includes("does not verify the entire learning unit")));
 assert.ok(certificate.evidence?.some(e=>e.url==="https://csrc.nist.gov/glossary/term/public_key_certificate" && e.reviewStatus==="source-supports-core-claim" && e.scope.includes("does not establish that every certificate is valid")));
});


test("symmetric cryptography, vulnerability assessment and architecture-style claims have scoped primary-source evidence",()=>{
 const cases=[
  ["4.4.2","https://csrc.nist.gov/glossary/term/symmetric_key_algorithm","shared-key mechanism only"],
  ["7.3.1","https://www.sei.cmu.edu/documents/1119/1994_005_001_16331.pdf","component, connector and style/constraint concepts only"],
  ["4.7.6","https://csrc.nist.gov/glossary/term/vulnerability_assessment","purpose of vulnerability assessment only"]
 ];
 for(const [id,url,scope] of cases){
  const unit=content.units[id];
  assert.equal(unit.status,"partial",id);
  assert.ok(unit.evidence?.some(e=>e.url===url && e.reviewStatus==="source-supports-core-claim" && e.scope.includes(scope)),id);
 }
});

test("cryptography and port-discovery concepts have bounded NIST evidence",()=>{
 const cases=[["4.4.1","https://csrc.nist.gov/glossary/term/cryptography"],["4.4.1","https://csrc.nist.gov/glossary/term/cryptanalysis"],["4.7.4","https://csrc.nist.gov/pubs/sp/800/115/final"]];
 for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,"partial",id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewedOn&&e.reviewStatus),id+" "+url);}
});

test("dataflow, data-centered and event-based architecture styles have scoped SEI evidence",()=>{
 const cases=[["7.3.2","pipe-and-filter"],["7.3.4","data-centered systems"],["7.3.6","event systems"]];
 for(const [id,claim] of cases){const u=content.units[id];assert.equal(u.status,"partial",id);assert.ok(u.evidence?.some(e=>e.url==="https://insights.sei.cmu.edu/documents/232/1994_019_001_30085.pdf"&&e.supportedClaim&&e.supportedClaim.includes(claim)&&e.scope&&e.reviewStatus),id);}
});

test("call-return and virtual-machine architecture patterns have scoped SEI evidence",()=>{
 const cases=[["7.3.3","explicit-invocation call-return patterns"],["7.3.5","interpreters among virtual-machine patterns"]];
 for(const [id,claim] of cases){const u=content.units[id];assert.equal(u.status,"partial",id);assert.ok(u.evidence?.some(e=>e.url==="https://www.sei.cmu.edu/documents/1602/2020_011_001_650228.pdf"&&e.supportedClaim&&e.supportedClaim.includes(claim)&&e.scope&&e.reviewStatus),id);}
});

test('SDN terminology has bounded IRTF evidence and remains partial',()=>{
 const unit=content.units['17.3.3'];
 assert.equal(unit.status,'partial');
 assert.ok(unit.evidence?.some(e=>e.url==='https://www.rfc-editor.org/rfc/rfc7426.html'&&e.supportedClaim.includes('控制平面与转发平面')&&e.scope.includes('信息类参考术语文档')));
});

test('IPv4/IPv6 campus coexistence has bounded IETF evidence and remains partial',()=>{
 const unit=content.units['17.5.2'];
 assert.equal(unit.status,'partial');
 assert.ok(unit.evidence?.some(e=>e.url==='https://www.rfc-editor.org/rfc/rfc4213.html'&&e.supportedClaim.includes('双栈')&&e.scope.includes('不证明具体园区')));
});


test('storage and 5G learning units have bounded source evidence and remain partial',()=>{
 const storage=content.units['17.2.4'];
 assert.equal(storage.status,'partial');
 assert.ok(storage.evidence?.some(e=>e.url==='https://www.snia.org/education/what-is-object-storage'&&e.supportedClaim.includes('对象存储')&&e.scope.includes('不单独证明块存储')));
 const fiveG=content.units['17.5.3'];
 assert.equal(fiveG.status,'partial');
 assert.ok(fiveG.evidence?.some(e=>e.url==='https://www.itu.int/rec/R-REC-M.2150/en'&&e.supportedClaim.includes('IMT-2020')&&e.scope.includes('不证明任何具体行业应用必然适用')));
});


test('campus LAN, continuity planning, and transaction semantics have bounded evidence',()=>{
 const cases=[['17.2.1','https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/cisco-campus-lan-wlan-design-guide.html','不能据此断言所有 LAN 必须使用三层结构'],['17.5.1','https://csrc.nist.gov/Topics/Security-and-Privacy/security-programs-and-operations/contingency-planning','不保证冗余本身能够避免全部中断'],['18.2.4','https://www.postgresql.org/docs/18/tutorial-transactions.html','不单独证明商业数据完整性已充分保障']];
 for(const [id,url,scope] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope.includes(scope)&&e.reviewStatus==='source-supports-bounded-claim'),id);}
});


test('WAN definition and Chinese Wall access control have bounded evidence',()=>{
 const wan=content.units['17.2.2'];assert.equal(wan.status,'partial');assert.ok(wan.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/wide_area_network'&&e.supportedClaim.includes('NIST')&&e.scope.includes('不证明某个具体 WAN')));
 const wall=content.units['18.2.5'];assert.equal(wall.status,'partial');assert.ok(wall.evidence?.some(e=>e.url==='https://www.cs.purdue.edu/homes/ninghui/readings/AccessControl/brewer_nash_89.pdf'&&e.supportedClaim.includes('此前访问过的数据')&&e.scope.includes('不意味着所有动态访问控制系统')));
});


test('data-center energy efficiency evidence remains bounded',()=>{const u=content.units['17.4.4'];assert.equal(u.status,'partial');assert.ok(u.evidence?.some(e=>e.url==='https://www.energy.gov/cmei/femp/articles/best-practices-guide-energy-efficient-data-center-design'&&e.supportedClaim.includes('虚拟化')&&e.scope.includes('不能据此保证每种工作负载')));});


test('quality tradeoffs and security-control catalog have bounded evidence',()=>{
 const quality=content.units['17.4.2'];assert.equal(quality.status,'partial');assert.ok(quality.evidence?.some(e=>e.url==='https://www.iso.org/standard/78176.html'&&e.supportedClaim.includes('质量模型')&&e.scope.includes('不直接证明成本')));
 const security=content.units['18.1.3'];assert.equal(security.status,'partial');assert.ok(security.evidence?.some(e=>e.url==='https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final'&&e.supportedClaim.includes('安全和隐私控制目录')&&e.scope.includes('不验证 ISO/IEC 27000')));
});


test('cybersecurity lifecycle and non-repudiation have bounded evidence',()=>{
 const cyber=content.units['17.4.3'];assert.equal(cyber.status,'partial');assert.ok(cyber.evidence?.some(e=>e.url==='https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20'&&e.supportedClaim.includes('六项功能')&&e.scope.includes('不规定唯一实施方法')));
 const nr=content.units['18.5.6'];assert.equal(nr.status,'partial');assert.ok(nr.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/non_repudiation'&&e.supportedClaim.includes('第三方')&&e.scope.includes('不能据此保证单靠日志')));
});


test('quality requirements and bounded/unbounded stream processing have scoped evidence',()=>{
 const req=content.units['17.4.1'];assert.equal(req.status,'partial');assert.ok(req.evidence?.some(e=>e.url==='https://www.iso.org/standard/78176.html'&&e.supportedClaim.includes('验收准则')&&e.scope.includes('不能据此断言某个项目')));
 const stream=content.units['19.4.5'];assert.equal(stream.status,'partial');assert.ok(stream.evidence?.some(e=>e.url==='https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/execution_mode/'&&e.supportedClaim.includes('有界输入')&&e.scope.includes('不支持本单元中数据湖')));
});


test('5G system architecture evidence stays within specification scope',()=>{const u=content.units['17.2.3'];assert.equal(u.status,'partial');assert.ok(u.evidence?.some(e=>e.url==='https://www.etsi.org/deliver/etsi_ts/123500_123599/123501/18.05.00_60/ts_123501v180500p.pdf'&&e.supportedClaim.includes('5G System')&&e.scope.includes('不代表该版本是当前最新版本')));});


test('Lambda and Kappa architecture claims have bounded source evidence',()=>{
 const lambda=content.units['19.3.5'];assert.equal(lambda.status,'partial');assert.ok(lambda.evidence?.some(e=>e.url==='https://d1.awsstatic.com/whitepapers/lambda-architecure-on-for-batch-aws.pdf'&&e.supportedClaim.includes('batch、speed 和 serving')&&e.scope.includes('不证明它对所有实时分析场景都最优')));
 const kappa=content.units['19.4.4'];assert.equal(kappa.status,'partial');assert.ok(kappa.evidence?.some(e=>e.url==='https://www.ericsson.com/en/blog/2015/11/data-processing-architectures--lambda-and-kappa'&&e.supportedClaim.includes('Kappa')&&e.scope.includes('不证明 Kappa 在所有系统都能替代 Lambda')));
});


test('computer system foundations and systems engineering have scoped evidence',()=>{
 const system=content.units['2.1'];assert.equal(system.status,'partial');assert.ok(system.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/hardware'&&e.supportedClaim.includes('物理组件')));assert.ok(system.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/software'&&e.supportedClaim.includes('程序及相关数据')));
 const se=content.units['2.8'];assert.equal(se.status,'partial');assert.ok(se.evidence?.some(e=>e.url==='https://www.nasa.gov/reference/2-0-fundamentals-of-systems-engineering/'&&e.supportedClaim.includes('多学科方法')&&e.scope.includes('不意味着所有行业')));
 const req=content.units['5.2'];assert.equal(req.status,'partial');assert.ok(req.evidence?.some(e=>e.url==='https://www.nasa.gov/reference/3-0-systems-engineering-processes-vol-2/'&&e.supportedClaim.includes('验证证据')&&e.scope.includes('不替代软件需求工程标准')));
});


test('GB 17859 level names and standard status have distinct sources',()=>{const u=content.units['4.8.1'];assert.equal(u.status,'partial');assert.ok(u.evidence?.some(e=>e.url==='https://zjic.zj.gov.cn/ywdh/szfg/202104/P020220711448085717700.pdf'&&e.supportedClaim.includes('五个等级')&&e.scope.includes('不据此把五级直接等同于现行网络安全等级保护')));assert.ok(u.evidence?.some(e=>e.url==='https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=814B9ED6130F17C4B53EF6AA98BCD5A7'&&e.supportedClaim.includes('标记为现行')&&e.scope.includes('只支持标准身份')));});


test('LAN WAN and system performance metrics have scoped evidence',()=>{
 const net=content.units['2.5'];assert.equal(net.status,'partial');assert.ok(net.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/local_area_network'&&e.supportedClaim.includes('相对有限区域')));assert.ok(net.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/wide_area_network'&&e.supportedClaim.includes('覆盖范围大于 LAN')));
 const perf=content.units['2.9'];assert.equal(perf.status,'partial');assert.ok(perf.evidence?.some(e=>e.url==='https://www.iso.org/standard/78176.html'&&e.supportedClaim.includes('时间行为、资源利用和容量')&&e.scope.includes('不提供具体系统的性能公式')));
});


test('information security objectives and control families have scoped evidence',()=>{
 const goals=content.units['4.1.1'];assert.equal(goals.status,'partial');for(const term of ['confidentiality','integrity','availability','authenticity','non_repudiation'])assert.ok(goals.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/'+term&&e.supportedClaim&&e.scope&&e.reviewedOn==='2026-10-10'&&e.reviewStatus==='source-supports-bounded-claim'),term);
 const controls=content.units['4.1.2'];assert.equal(controls.status,'partial');assert.ok(controls.evidence?.some(e=>e.url==='https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final'&&e.supportedClaim.includes('恶意代码防护')&&e.scope.includes('不证明某个系统已部署全部控制')));
});


test('embedded-system purpose and test expected-result evidence remain scoped',()=>{
 const embedded=content.units['2.4'];assert.equal(embedded.status,'partial');assert.ok(embedded.evidence?.some(e=>e.url==='https://csrc.nist.gov/files/pubs/conference/1990/10/01/proceedings-13th-national-computer-security-confer/final/docs/1990-13th-ncsc-proceedings-vol-1.pdf'&&e.supportedClaim.includes('大型系统中的组成部分')&&e.scope.includes('来源年代较早')));
 const testing=content.units['5.4'];assert.equal(testing.status,'partial');assert.ok(testing.evidence?.some(e=>e.url==='https://glossary.istqb.org/en_US/term/expected-result?exact_matches_first=true&syllabus_id=23'&&e.supportedClaim.includes('实际结果')&&e.scope.includes('不证明任一测试套件覆盖充分')));
});


test('hardware component interfaces and system life-cycle evidence are bounded',()=>{
 const component=content.units['2.2'];assert.equal(component.status,'partial');assert.ok(component.evidence?.some(e=>e.url==='https://csrc.nist.gov/glossary/term/system_component'&&e.supportedClaim.includes('明确输入、输出和特定功能')&&e.scope.includes('不单独验证处理器')));
 const lifecycle=content.units['3.1'];assert.equal(lifecycle.status,'partial');assert.ok(lifecycle.evidence?.some(e=>e.url==='https://www.nasa.gov/reference/3-0-nasa-program-project-life-cycle/'&&e.supportedClaim.includes('生命周期')&&e.scope.includes('不证明本章所列全部信息系统分类')));
});


test('architecture quality scenarios reliability maintenance CPS and AI definitions have bounded evidence',()=>{const expected=[['8.1.3','https://www.sei.cmu.edu/library/reasoning-about-software-quality-attributes/','质量属性场景'],['8.2.2','https://www.sei.cmu.edu/library/principles-for-evaluating-the-quality-attributes-of-a-software-architecture/','检查表和度量'],['9.1.3','https://csrc.nist.gov/glossary/term/reliability','指定时间内'],['10.1.1','https://www.iso.org/standard/80710.html','软件维护'],['11.1.1','https://www.nist.gov/publications/framework-cyber-physical-systems-volume-1-overview','数字、模拟、物理和人类组件'],['11.2.1','https://www.oecd.org/en/publications/explanatory-memorandum-on-the-updated-oecd-definition-of-an-ai-system_623da898-en.html','显式或隐式目标']];for(const [id,url,claim] of expected){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim.includes(claim)&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('AI development history and edge-cloud positioning have scoped sources',()=>{const a=content.units['11.2.2'];assert.equal(a.status,'partial');assert.ok(a.evidence?.some(e=>e.url==='https://www.oecd.org/en/publications/artificial-intelligence-in-society_eedfee77-en.html'&&e.supportedClaim.includes('符号式方法')&&e.scope.includes('不是完整的人工智能史')));const edge=content.units['11.4.1'];assert.equal(edge.status,'partial');assert.ok(edge.evidence?.some(e=>e.url==='https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934390'&&e.supportedClaim.includes('靠近传感器数据采集')&&e.scope.includes('不局限于网关')));});


test('architecture descriptions and planned software reuse have bounded evidence',()=>{const expected=[['7.1.2','https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/07/43/74393.html','结构与表达要求'],['7.4.1','https://www.sei.cmu.edu/library/software-product-lines-collection/','共同核心资产'],['10.1.2','https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/07/43/74393.html','架构本身与用于表达该架构']];for(const [id,url,claim] of expected){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim.includes(claim)&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'),id);}});


test('relational tables normalization database design and backup have scoped sources',()=>{const cases=[['6.2.1','https://www.postgresql.org/docs/17/ddl-basics.html','行和列'],['6.2.3','https://www.ibm.com/docs/en/tpfdf/1.1.3?topic=database-normalization','属性与主键之间的依赖'],['6.3.1','https://www.ibm.com/docs/en/tpfdf/1.1.3?topic=database-organizing','实体和属性'],['6.3.7','https://www.postgresql.org/docs/current/backup.html','备份与恢复']];for(const [id,url,claim] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim.includes(claim)&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'),id);}});


test('SWEBOK, database analysis, architecture concerns, UML interactions, layering, cloud-native and SOA claims have scoped primary-source evidence',()=>{const cases=[['5.1','https://www.computer.org/education/bodies-of-knowledge/software-engineering'],['6.3.2','https://www.ibm.com/docs/en/tpfdf/1.1.3?topic=database-organizing'],['7.1.3','https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/07/43/74393.html'],['9.1.4','https://csrc.nist.gov/glossary/term/reliability'],['10.2.1','https://www.omg.org/spec/UML/2.5.1'],['10.2.2','https://www.omg.org/spec/UML/2.5.1'],['10.2.3','https://www.omg.org/spec/UML/2.5.1'],['10.2.4','https://www.omg.org/spec/UML/2.5.1'],['13.1','https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/'],['14.1','https://glossary.cncf.io/cloud-native-tech/'],['15.1','https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('security governance, software engineering and database design evidence is scoped to primary sources',()=>{const cases=[['4.1.3','https://csrc.nist.gov/glossary/term/attack_surface'],['4.2','https://www.nist.gov/cyberframework'],['4.3.2','https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final'],['4.3.3','https://csrc.nist.gov/pubs/sp/800/37/r2/final'],['4.5.1','https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final'],['4.5.3','https://www.rfc-editor.org/rfc/rfc8446.html'],['4.7.3','https://csrc.nist.gov/glossary/term/spoofing'],['4.7.5','https://csrc.nist.gov/glossary/term/denial_of_service'],['5.3','https://www.computer.org/education/bodies-of-knowledge/software-engineering'],['5.5','https://csrc.nist.gov/pubs/sp/800/218/final'],['5.6','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['5.7','https://www.nasa.gov/reference/2-0-fundamentals-of-systems-engineering/'],['6.1.1','https://www.ibm.com/docs/en/tpfdf/1.1.3?topic=database-organizing'],['6.1.2','https://www.ibm.com/docs/en/tpfdf/1.1.3?topic=database-organizing'],['6.1.3','https://www.postgresql.org/docs/current/tutorial-concepts.html'],['6.3.3','https://www.ibm.com/docs/en/tpfdf/1.1.3?topic=database-organizing'],['6.3.5','https://www.postgresql.org/docs/current/indexes.html']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('software architecture design and reliability mechanisms have scoped evidence',()=>{const cases=[['7.2.3','https://www.sei.cmu.edu/library/documenting-software-architectures-views-and-beyond/'],['7.2.5','https://www.sei.cmu.edu/library/documenting-software-architectures-views-and-beyond/'],['7.2.8','https://www.sei.cmu.edu/library/software-architecture-in-practice-4th-edition/'],['7.2.9','https://www.iso.org/standard/80710.html'],['7.4.2','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['7.4.3','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['7.4.4','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['7.5.1','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['7.5.2','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['7.5.4','https://www.sei.cmu.edu/library/software-product-lines-collection/'],['9.4.1','https://csrc.nist.gov/glossary/term/fault_tolerance'],['9.4.4','https://csrc.nist.gov/glossary/term/fault_tolerance']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('version history, edge-cloud continuum and container concepts have scoped evidence',()=>{const cases=[['10.5.1','https://git-scm.com/docs/git-log'],['10.5.2','https://git-scm.com/docs/git-diff'],['10.7.2','https://www.iso.org/standard/80710.html'],['10.7.3','https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control'],['11.1.2','https://www.incose.org/docs/default-source/working-groups/systems-of-systems/sos-primer.pdf'],['11.1.3','https://www.nist.gov/publications/framework-cyber-physical-systems-volume-1-overview'],['11.4.2','https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934390'],['11.4.3','https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934390'],['11.4.4','https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934390'],['11.4.5','https://csrc.nist.gov/pubs/sp/800/213/final'],['11.4.6','https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934390'],['14.3.1','https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/'],['14.3.2','https://learn.microsoft.com/en-us/dotnet/architecture/microservices/'],['14.2.2','https://glossary.cncf.io/cloud-native-tech/']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('SOA, serverless, service-mesh and embedded-system evidence is scoped',()=>{const cases=[['14.3.3','https://learn.microsoft.com/en-us/azure/architecture/serverless-quest/serverless-overview'],['14.3.4','https://istio.io/latest/docs/ops/deployment/architecture/'],['14.4','https://glossary.cncf.io/cloud-native-tech/'],['15.2','https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html'],['15.4','https://www.w3.org/TR/ws-arch/'],['15.5','https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html'],['15.6','https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html'],['15.7','https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html'],['15.8','https://istio.io/latest/docs/concepts/what-is-istio/'],['15.9','https://www.w3.org/TR/ws-arch/'],['15.10','https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html'],['16.1.1','https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7150_002D_&page_name=AppendixA'],['16.1.2','https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7150_002D_&page_name=AppendixA'],['16.1.3','https://docs.aws.amazon.com/freertos/latest/userguide/dev-guide-freertos-kernel.html']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('enterprise architecture, architecture styles and UI patterns have scoped evidence',()=>{const cases=[['12.1.1','https://www.opengroup.org/togaf'],['12.1.2','https://www.opengroup.org/togaf'],['12.1.3','https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/07/43/74393.html'],['12.2.1','https://www.sei.cmu.edu/documents/1119/1994_005_001_16331.pdf'],['12.2.2','https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/'],['12.2.3','https://www.opengroup.org/togaf'],['12.2.4','https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/'],['12.2.5','https://www.opengroup.org/togaf'],['12.3.1','https://www.opengroup.org/togaf'],['12.3.2','https://www.opengroup.org/togaf'],['13.2.1','https://learn.microsoft.com/en-us/aspnet/core/mvc/overview'],['13.2.3','https://learn.microsoft.com/en-us/dotnet/architecture/maui/mvvm'],['13.2.4','https://www.w3.org/TR/xml/']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('business logic, data access and IoT architecture evidence is scoped',()=>{const cases=[['13.3.1','https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice'],['13.3.2','https://www.omg.org/spec/BPMN/2.0.2'],['13.3.3','https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/ddd-oriented-microservice'],['13.3.4','https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection'],['13.4.1','https://learn.microsoft.com/en-us/ef/core/'],['13.4.2','https://learn.microsoft.com/en-us/dotnet/framework/data/adonet/obtaining-a-dbproviderfactory'],['13.4.3','https://hibernate.org/orm/'],['13.4.4','https://www.w3.org/TR/xmlschema11-1/'],['13.4.5','https://www.postgresql.org/docs/current/tutorial-transactions.html'],['13.4.6','https://www.pgbouncer.org/features.html'],['13.6','https://www.itu.int/rec/T-REC-Y.4000-201611-I/en'],['16.2.2','https://docs.aws.amazon.com/freertos/latest/userguide/dev-guide-freertos-kernel.html']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('operating systems, ERP, digital government, Internet protocols and security controls have scoped evidence',()=>{const cases=[['2.3','https://csrc.nist.gov/glossary/term/os'],['3.2','https://csrc.nist.gov/glossary/term/information_system'],['3.5','https://www.ibm.com/think/topics/artificial-intelligence-types'],['3.7','https://www.sap.com/resources/what-is-erp'],['3.8','https://www.oecd.org/en/topics/digital-government.html'],['17.1','https://www.rfc-editor.org/rfc/rfc1122.html'],['18.3.1','https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('AI technology families, digital twins, cloud and big-data architecture have scoped evidence',()=>{const cases=[['11.2.3','https://www.ibm.com/think/topics/artificial-intelligence-types'],['11.5.1','https://www.nist.gov/publications/framework-digital-twin-manufacturing'],['11.5.2','https://www.nist.gov/publications/framework-digital-twin-manufacturing'],['11.5.3','https://www.nist.gov/publications/manufacturing-digital-twin-standards'],['11.5.4','https://www.nist.gov/digital-twins'],['11.6.1','https://csrc.nist.gov/glossary/term/cloud_computing'],['11.6.2','https://www.nist.gov/publications/nist-big-data-interoperability-framework-volume-6-big-data-reference-architecture']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test('robotics, MVP, dynamic UI and cloud-native claims have scoped evidence',()=>{const cases=[['11.3.1','https://www.nist.gov/robotics'],['11.3.4','https://www.ibm.com/think/topics/artificial-intelligence-types'],['13.2.2','https://martinfowler.com/eaaDev/ModelViewPresenter.html'],['13.2.6','https://learn.microsoft.com/en-us/aspnet/core/blazor/components/dynamiccomponent'],['14.2.1','https://glossary.cncf.io/cloud-native-tech/'],['14.2.3','https://learn.microsoft.com/en-us/azure/architecture/patterns/'],['14.2.4','https://glossary.cncf.io/cloud-native-tech/']];for(const [id,url] of cases){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope&&e.reviewStatus==='source-supports-bounded-claim'&&e.reviewedOn==='2026-10-10'),id);}});


test("all previously uncovered learning units now have bounded evidence",()=>{const ids=["2.6","2.7","3.3","3.4","3.6","6.1.4","6.2.2","6.3.4","6.3.6","6.4","6.5.1","6.5.2","7.5.3","9.1.5","9.2.2","9.3","9.4.2","9.4.3","9.5.1","9.5.2","9.5.3","9.5.4","9.6.1","9.6.2","9.6.3","9.6.4","10.3.1","10.3.2","10.3.3","10.4.1","10.4.2","10.4.3","10.4.4","10.4.5","10.4.6","10.4.7","10.4.8","10.4.9","10.4.10","10.4.11","10.4.12","10.4.13","10.4.14","10.4.15","10.4.16","10.4.17","10.4.18","10.6","10.7.4","11.3.2","11.3.3","12.4","13.2.5","13.5","13.7","15.3","16.2.1","16.2.3","16.2.4","16.2.5","16.3.1","16.3.3","16.4.1","16.4.2","16.4.3","19.6.3","19.6.4","20.1.1","20.1.2","20.2.1","20.2.2","20.3.1","20.3.2","20.3.3","20.4"];assert.equal(ids.length,75);for(const id of ids){const u=content.units[id];assert.ok(u,id);assert.equal(u.status,"partial",id);assert.ok(u.evidence?.some(e=>typeof e.url==="string"&&e.url.startsWith("https://")&&e.supportedClaim&&e.scope&&typeof e.reviewedOn==="string"&&e.reviewedOn.length===10&&e.reviewStatus&&!String(e.reviewStatus).includes("needs-review")&&!String(e.reviewStatus).includes("background-only")&&!String(e.reviewStatus).includes("candidate")),id);}});


test('TDEA withdrawal evidence points to the current NIST CSRC announcement URL',()=>{const u=content.units['4.4.2.3'];const url='https://csrc.nist.gov/news/2023/nist-to-withdraw-sp-800-67-rev-2';assert.equal(u.status,'partial');assert.equal(u.source.path,url);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim.includes('撤回状态与时间')));});


test('confirmed broken learning-source URLs are replaced with current scoped sources',()=>{const cases={'9.4.2':'https://csrc.nist.gov/glossary/term/fault_tolerance','9.1.5':'https://csrc.nist.gov/glossary/term/reliability','9.2.2':'https://csrc.nist.gov/glossary/term/reliability','9.5.1':'https://csrc.nist.gov/glossary/term/reliability','9.6.2':'https://csrc.nist.gov/glossary/term/reliability','9.4.4':'https://csrc.nist.gov/glossary/term/fault_tolerance','13.2.5':'https://martinfowler.com/eaaCatalog/applicationController.html','16.1.3':'https://docs.aws.amazon.com/freertos/latest/userguide/dev-guide-freertos-kernel.html','16.2.1':'https://docs.aws.amazon.com/freertos/latest/userguide/dev-guide-freertos-kernel.html','16.2.2':'https://docs.aws.amazon.com/freertos/latest/userguide/dev-guide-freertos-kernel.html','19.6.4':'https://aws.amazon.com/retail/advanced-data-insights/','14.1':'https://glossary.cncf.io/cloud-native-tech/','14.2.1':'https://glossary.cncf.io/cloud-native-tech/','14.2.2':'https://glossary.cncf.io/cloud-native-tech/','14.2.4':'https://glossary.cncf.io/cloud-native-tech/','14.4':'https://glossary.cncf.io/cloud-native-tech/','18.8.1':'https://api-security.owasp.org/','11.3.1':'https://www.nist.gov/robotics','11.3.2':'https://www.nist.gov/robotics','16.1.1':'https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7150_002D_&page_name=AppendixA','16.1.2':'https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7150_002D_&page_name=AppendixA'};for(const [id,url] of Object.entries(cases)){const u=content.units[id];assert.equal(u.status,'partial',id);assert.ok(u.evidence?.some(e=>e.url===url&&e.supportedClaim&&e.scope),id)}});

test('all learning evidence records have human-readable source titles',()=>{
 let count=0;for(const [id,unit] of Object.entries(content.units)){for(const evidence of unit.evidence||[]){count++;assert.ok(typeof evidence.sourceTitle==='string'&&evidence.sourceTitle.trim().length>0,`${id}: ${evidence.url}`)}}
 assert.ok(count>0);
});
