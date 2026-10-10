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
 const report=buildVerificationQueue(content); assert.equal(report.unitCount,324); assert.equal(report.statusDistribution.verified,3); assert.equal(report.statusDistribution.partial,321); assert.equal(report.unitsWithClaimLevelEvidence,109); assert.equal(report.unitsMissingEvidence,215); assert.deepEqual(report.verifiedWithoutEvidence,[]);
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
