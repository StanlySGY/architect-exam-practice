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
 const report=buildVerificationQueue(content); assert.equal(report.unitCount,309); assert.equal(report.statusDistribution.verified,3); assert.equal(report.statusDistribution.partial,306); assert.equal(report.unitsWithClaimLevelEvidence,28); assert.equal(report.unitsMissingEvidence,281); assert.deepEqual(report.verifiedWithoutEvidence,[]);
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
