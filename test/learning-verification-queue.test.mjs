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
 const report=buildVerificationQueue(content); assert.equal(report.unitCount,324); assert.equal(report.statusDistribution.verified,3); assert.equal(report.statusDistribution.partial,321); assert.equal(report.unitsWithClaimLevelEvidence,93); assert.equal(report.unitsMissingEvidence,231); assert.deepEqual(report.verifiedWithoutEvidence,[]);
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
