import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildVerificationQueue } from '../scripts/audit-learning-verification-queue.mjs';
const content=JSON.parse(fs.readFileSync(new URL('../data/learning-content.json',import.meta.url),'utf8'));
test('verification queue keeps claim-level evidence separate from whole-unit status',()=>{
 const report=buildVerificationQueue({units:{'4.3.1':{status:'partial',what:'core claim',source:{path:'https://csrc.nist.gov/glossary/term/defense_in_depth'},evidence:[{url:'https://csrc.nist.gov/glossary/term/defense_in_depth',supportedClaim:'definition',scope:'core definition only',reviewedOn:'2026-10-09',reviewStatus:'source-supports-core-claim'}]},x:{status:'verified',what:'unsupported',evidence:[{url:'https://example.com'}]}}});
 assert.equal(report.unitsWithClaimLevelEvidence,1); assert.deepEqual(report.verifiedWithoutEvidence,['x']); assert.equal(report.unitsMissingEvidence,1);
});
test('current learning course has 309 units and preserves its review states',()=>{
 const report=buildVerificationQueue(content); assert.equal(report.unitCount,309); assert.equal(report.statusDistribution.verified,3); assert.equal(report.statusDistribution.partial,306); assert.equal(report.unitsWithClaimLevelEvidence,61); assert.equal(report.unitsMissingEvidence,248); assert.deepEqual(report.verifiedWithoutEvidence,[]);
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
