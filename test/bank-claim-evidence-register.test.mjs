import assert from 'node:assert/strict';
import test from 'node:test';
import { auditClaimEvidenceRegister } from '../scripts/audit-bank-claim-evidence-register.mjs';

test('证据登记审计精确定位原文，且不将来源记录升级为答案核验', () => {
  const report = auditClaimEvidenceRegister(
    { choices: [{ id: 'q1', analysis: '例如 AWS Lambda 普通函数的 timeout 上限为 15 分钟。' }] },
    {
      reviewedOn: '2026-10-13',
      records: [{
        recordId: 'r1',
        disposition: 'supported-with-scope',
        targets: [{ itemId: 'q1', field: 'analysis', claimNeedle: 'AWS Lambda 普通函数的 timeout 上限为 15 分钟' }],
        sourceEvidence: [{
          url: 'https://docs.example.com/limits',
          title: 'Limits',
          publisher: 'Example',
          sourceKind: 'vendor-documentation',
          checkedOn: '2026-10-13',
          supports: '限定条件下的限制。',
          limitations: '不证明所有产品。',
        }],
        answerVerification: 'not-established',
      }],
    },
  );
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 1);
  assert.equal(report.counts.exactTextTargetsMatched, 1);
  assert.equal(report.counts.invalidRecords, 0);
  assert.equal(report.records[0].answerVerification, 'not-established');
  assert.match(report.note, /不发起网络请求/);
});

test('证据目标发生漂移、来源元数据不完整或 disposition 越界时报告失败', () => {
  const report = auditClaimEvidenceRegister(
    { choices: [{ id: 'q1', analysis: '新版本解析文本。' }] },
    {
      records: [{
        recordId: 'r2',
        disposition: 'verified',
        targets: [{ itemId: 'q1', field: 'analysis', claimNeedle: '旧版本解析文本' }],
        sourceEvidence: [{ url: 'http://not-https.example.com/source' }],
      }],
    },
  );
  assert.equal(report.counts.targetClaimsUnmatched, 1);
  assert.equal(report.counts.recordsWithAllowedDisposition, 0);
  assert.equal(report.counts.invalidRecords, 1);
  assert.equal(report.records[0].sourceMetadataOk, false);
});

test('案例子题 ID 可追溯，且登记不能把答案状态写为 verified 或 approved', () => {
  const bank = { cases: [{ id: 'case-1', subQuestions: [{ question_label: '问题1', reference_answer: '这是一段可定位的参考解析。' }] }] };
  const records = ['verified', 'approved'].map((answerVerification) => ({
    recordId: answerVerification,
    disposition: 'supported-with-scope',
    targets: [{ itemId: 'case-1:问题1', field: 'reference_answer', claimNeedle: '可定位的参考解析' }],
    sourceEvidence: [],
    answerVerification,
  }));
  const report = auditClaimEvidenceRegister(bank, { records });
  assert.equal(report.counts.exactTextTargetsMatched, 2);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 2);
  assert.equal(report.counts.recordsWithAllowedVerification, 0);
  assert.equal(report.counts.invalidRecords, 2);
  assert.ok(report.records.every((record) => record.answerVerificationAllowed === false));
});

test('SDP 绝对可见性、考试频率押题和安全百分比均被登记为有边界的未核实命题', () => {
  const bank = {
    choices: [
      { id: 'sdp', analysis: '未认证用户对未认证用户完全不可见这类说法需要限定。' },
      { id: 'exam', analysis: 'MTTF/MTTR/MTBF几乎每年必考1题。' },
      { id: 'security', stem: '系统应能够防止99%的黑客攻击。' },
    ],
    cases: [],
    essays: [],
  };
  const records = [
    {
      recordId: 'sdp',
      disposition: 'overgeneralized',
      targets: [{ itemId: 'sdp', field: 'analysis', claimNeedle: '对未认证用户完全不可见' }],
      sourceEvidence: [{ url: 'https://csrc.nist.gov/pubs/sp/800/207/final', title: 'Zero Trust Architecture', publisher: 'NIST', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13', supports: '先认证授权再建立会话。', limitations: '不证明所有 SDP 产品都隐藏所有端口。' }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'exam',
      disposition: 'unsupported-exam-frequency-prediction',
      targets: [{ itemId: 'exam', field: 'analysis', claimNeedle: 'MTTF/MTTR/MTBF几乎每年必考1题' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'security',
      disposition: 'unsubstantiated-performance-claim',
      targets: [{ itemId: 'security', field: 'stem', claimNeedle: '防止99%的黑客攻击' }],
      sourceEvidence: [{ url: 'https://csrc.nist.gov/pubs/sp/800/55/v1/final', title: 'Measurement Guide for Information Security', publisher: 'NIST', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13', supports: '指南讨论信息安全度量的开发与评价。', limitations: '不提供通用的 99% 攻击拦截保证。' }],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 3);
  assert.equal(report.counts.targetClaims, 3);
  assert.equal(report.counts.exactTextTargetsMatched, 3);
  assert.equal(report.counts.recordsWithAllowedDisposition, 3);
  assert.equal(report.counts.recordsWithAllowedVerification, 3);
  assert.equal(report.counts.invalidRecords, 0);
});

test('Kafka 调优需保留版本和性能权衡；三个性能计算只核验题面算术', () => {
  const bank = {
    choices: [
      { id: 'uptime', analysis: '每年=365.25×24×60≈525960分钟。最大不可用时间=525960×0.0001≈52.6分钟。' },
      { id: 'tps', analysis: '吞吐率 = 事务数 / 时间 = 36000 / 3600秒 = 10 TPS（Transactions Per Second）。' },
      { id: 'mm1', analysis: 'M/M/1队列中，平均响应时间（逗留时间）W=1/(μ-λ)=1/(5-4)=1分钟。其中平均等待时间Wq=λ/[μ(μ-λ)]=4/[5×1]=0.8分钟，平均服务时间=1/μ=0.2分钟。' },
    ],
    cases: [{ id: 'kafka-case', subQuestions: [{ question_label: '问题3', reference_answer: '增大batch.size（如64KB→256KB），增大linger.ms（如0→20ms），让消息在缓冲区积累后批量发送。' }] }],
    essays: [],
  };
  const records = [
    {
      recordId: 'kafka', disposition: 'supported-with-scope',
      targets: [
        { itemId: 'kafka-case:问题3', field: 'reference_answer', claimNeedle: '增大batch.size（如64KB→256KB）' },
        { itemId: 'kafka-case:问题3', field: 'reference_answer', claimNeedle: '增大linger.ms（如0→20ms）' },
      ],
      sourceEvidence: [{ url: 'https://kafka.apache.org/40/configuration/producer-configs/', title: 'Producer Configs', publisher: 'Apache Kafka project', sourceKind: 'official-project-documentation', checkedOn: '2026-10-13', supports: 'batch.size 与 linger.ms 控制批处理和等待。', limitations: '不证明示例参数是通用最佳配置。' }],
      answerVerification: 'not-established',
    },
    { recordId: 'uptime', disposition: 'calculation-reproduced', targets: [{ itemId: 'uptime', field: 'analysis', claimNeedle: '525960×0.0001≈52.6分钟' }], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'tps', disposition: 'calculation-reproduced', targets: [{ itemId: 'tps', field: 'analysis', claimNeedle: '36000 / 3600秒 = 10 TPS' }], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'mm1', disposition: 'calculation-reproduced', targets: [{ itemId: 'mm1', field: 'analysis', claimNeedle: 'W=1/(μ-λ)=1/(5-4)=1分钟' }, { itemId: 'mm1', field: 'analysis', claimNeedle: 'Wq=λ/[μ(μ-λ)]=4/[5×1]=0.8分钟' }], sourceEvidence: [], answerVerification: 'calculation-only' },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 4);
  assert.equal(report.counts.targetClaims, 6);
  assert.equal(report.counts.exactTextTargetsMatched, 6);
  assert.equal(report.counts.recordsWithAllowedDisposition, 4);
  assert.equal(report.counts.recordsWithAllowedVerification, 4);
  assert.equal(report.counts.invalidRecords, 0);
  assert.equal(report.counts.sourceEntries, 1);
});
