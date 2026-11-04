import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { questionReviewNoteFor } from "../src/question-review-notes.mjs";

test("MTBF ambiguity note explains context-specific NASA definitions without approving imported mock answer", () => {
  const note = questionReviewNoteFor("mock-2026年5月-模拟卷5-002");
  assert.ok(note);
  assert.match(note.title, /MTBF.*MTTF.*MTTR/);
  assert.match(note.summary, /不能把这条等式当成通用恒等式/);
  assert.ok(note.points.some((item) => item.includes("NASA-HDBK-8709.22")));
  assert.ok(note.points.some((item) => item.includes("常数失效率")));
  assert.ok(note.takeaway.includes("999/(999+1)=99.9%"));
  assert.equal(note.sourceType, "mock");
  assert.equal(note.answerVerification, "not-established");
  assert.equal(note.humanSignOff, false);
  assert.match(note.boundary, /模拟题/);
  assert.match(note.boundary, /not-established/);
  assert.equal(note.references.length, 3);
  assert.ok(note.references.every((item) => item.url.startsWith("https://")));
});

test("question review notes return defensive copies and are absent for unrelated questions", () => {
  const note = questionReviewNoteFor("mock-2026年5月-模拟卷5-002");
  note.points.push("local mutation");
  note.references[0].label = "changed";
  const secondRead = questionReviewNoteFor("mock-2026年5月-模拟卷5-002");
  assert.equal(secondRead.points.includes("local mutation"), false);
  assert.notEqual(secondRead.references[0].label, "changed");
  assert.equal(questionReviewNoteFor("real-2020年下半年-003"), null);
});

test("MTBF source register preserves three versioned NASA references and remains unsigned", () => {
  const register = JSON.parse(readFileSync(new URL("../docs/audits/bank-claim-evidence-register-2026-10-13.json", import.meta.url), "utf8"));
  const record = register.records.find((item) => item.recordId === "availability-mtbf-definition-conflict");
  assert.ok(record);
  assert.equal(record.lastReviewedOn, "2026-11-04");
  assert.equal(record.answerVerification, "not-established");
  assert.equal(record.sourceEvidence.length, 3);
  const handbook = record.sourceEvidence.find((item) => item.url.includes("20180004878"));
  assert.ok(handbook);
  assert.equal(handbook.checkedOn, "2026-11-04");
  assert.match(handbook.supports, /MTTF\/\(MTTF\+MTTR\)/);
  assert.match(handbook.supports, /MTBF\/\(MTBF\+MDT\)/);
  assert.match(handbook.limitations, /convenience reference/);
});
