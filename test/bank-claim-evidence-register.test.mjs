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

test('模拟论文成果数字在无项目证据时只能作为示例，不提升为已核实成果', () => {
  const bank = { choices: [], cases: [], essays: [
    { id: 'resilience', writingPoints: '年可用性从99.95%提升至99.99%，平均故障恢复时间从15分钟降至3分钟。' },
    { id: 'consistency', writingPoints: '交易数据零差错（3年0资损），日均处理1000万+笔交易。' },
    { id: 'dr', writingPoints: 'RTO < 30秒、RPO = 0、年可用性99.99%。' },
  ] };
  const records = [
    { recordId: 'resilience', disposition: 'unsubstantiated-performance-claim', targets: [{ itemId: 'resilience', field: 'writingPoints', claimNeedle: '年可用性从99.95%提升至99.99%' }, { itemId: 'resilience', field: 'writingPoints', claimNeedle: '平均故障恢复时间从15分钟降至3分钟' }], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'consistency', disposition: 'unsubstantiated-performance-claim', targets: [{ itemId: 'consistency', field: 'writingPoints', claimNeedle: '交易数据零差错（3年0资损）' }, { itemId: 'consistency', field: 'writingPoints', claimNeedle: '日均处理1000万+笔交易' }], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'dr', disposition: 'unsubstantiated-performance-claim', targets: [{ itemId: 'dr', field: 'writingPoints', claimNeedle: 'RTO < 30秒、RPO = 0、年可用性99.99%' }], sourceEvidence: [], answerVerification: 'not-established' },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 3);
  assert.equal(report.counts.targetClaims, 5);
  assert.equal(report.counts.exactTextTargetsMatched, 5);
  assert.equal(report.counts.recordsWithAllowedDisposition, 3);
  assert.equal(report.counts.recordsWithAllowedVerification, 3);
  assert.equal(report.counts.invalidRecords, 0);
});

test('真题主题写作提纲里的容量与成效指标必须标为示例或补充可复核证据', () => {
  const bank = { choices: [], cases: [], essays: [
    { id: 'cloudnative', writingPoints: '效果：发布频率提升10倍、可用性99.99%' },
    { id: 'transactions', writingPoints: '订单数据一致性达到99.99%，系统吞吐量提升40%' },
    { id: 'loadbalance', writingPoints: '效果：支撑百万级QPS、99.99%可用性' },
  ] };
  const records = [
    { recordId: 'cloudnative', disposition: 'unsubstantiated-performance-claim', targets: [{ itemId: 'cloudnative', field: 'writingPoints', claimNeedle: '发布频率提升10倍' }, { itemId: 'cloudnative', field: 'writingPoints', claimNeedle: '可用性99.99%' }], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'transactions', disposition: 'unsubstantiated-performance-claim', targets: [{ itemId: 'transactions', field: 'writingPoints', claimNeedle: '订单数据一致性达到99.99%' }, { itemId: 'transactions', field: 'writingPoints', claimNeedle: '系统吞吐量提升40%' }], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'loadbalance', disposition: 'unsubstantiated-performance-claim', targets: [{ itemId: 'loadbalance', field: 'writingPoints', claimNeedle: '支撑百万级QPS' }, { itemId: 'loadbalance', field: 'writingPoints', claimNeedle: '99.99%可用性' }], sourceEvidence: [], answerVerification: 'not-established' },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 3);
  assert.equal(report.counts.targetClaims, 6);
  assert.equal(report.counts.exactTextTargetsMatched, 6);
  assert.equal(report.counts.recordsWithAllowedDisposition, 3);
  assert.equal(report.counts.recordsWithAllowedVerification, 3);
  assert.equal(report.counts.invalidRecords, 0);
});

test('设计原则的绝对措辞保留考试语义，但不代表真实系统零耦合；押题趋势需统计证据', () => {
  const bank = {
    choices: [{ id: 'coupling', analysis: '设计原则是追求低耦合，应尽量使用数据耦合（最低），完全避免内容耦合（最高）。' }],
    cases: [{ id: 'trend-case', subQuestions: [{ question_label: '问题2', reference_answer: '考试趋势：质量属性分析是每年必考题，需求条目数量从2024年的10条增加到12条。' }] }],
    essays: [],
  };
  const records = [
    {
      recordId: 'coupling', disposition: 'supported-with-scope',
      targets: [{ itemId: 'coupling', field: 'analysis', claimNeedle: '完全避免内容耦合' }],
      sourceEvidence: [
        { url: 'https://martinfowler.com/ieeeSoftware/coupling.pdf', title: 'Reducing Coupling', publisher: 'Martin Fowler, IEEE Software', sourceKind: 'expert-article', checkedOn: '2026-10-13', supports: '某些耦合不可避免，应控制有害耦合。', limitations: '不作为原题官方答案证明。' },
        { url: 'https://software-engineering-guide.github.io/chapters/02-02-software-design-principles/', title: 'Software design principles', publisher: 'Software Engineering Guide', sourceKind: 'educational-guide', checkedOn: '2026-10-13', supports: '设计原则是启发式，不是定律；提倡低耦合。', limitations: '不验证原题所有选项。' },
      ],
      answerVerification: 'not-established',
    },
    {
      recordId: 'trend', disposition: 'unsupported-exam-frequency-prediction',
      targets: [
        { itemId: 'trend-case:问题2', field: 'reference_answer', claimNeedle: '质量属性分析是每年必考题' },
        { itemId: 'trend-case:问题2', field: 'reference_answer', claimNeedle: '需求条目数量从2024年的10条增加到12条' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 2);
  assert.equal(report.counts.targetClaims, 3);
  assert.equal(report.counts.exactTextTargetsMatched, 3);
  assert.equal(report.counts.recordsWithAllowedDisposition, 2);
  assert.equal(report.counts.recordsWithAllowedVerification, 2);
  assert.equal(report.counts.sourceEntries, 2);
  assert.equal(report.counts.recordsWithExternalSources, 1);
  assert.equal(report.counts.invalidRecords, 0);
});

test('LoRA popularity and exam-necessity statements are classified as unsupported trend predictions', () => {
  const bank = { choices: [{ id: 'lora', analysis: 'LoRA冻结预训练模型权重，在每个目标层旁边注入低秩矩阵（A和B），只训练A和B的参数（通常不到原模型参数的1%）。\n\n押题理由: LoRA是2025-2026年最流行的高效微调技术，是大模型实际应用的必备知识。' }], cases: [], essays: [] };
  const records = [{
    recordId: 'lora-trend', disposition: 'unsupported-exam-frequency-prediction',
    targets: [
      { itemId: 'lora', field: 'analysis', claimNeedle: 'LoRA是2025-2026年最流行的高效微调技术' },
      { itemId: 'lora', field: 'analysis', claimNeedle: '是大模型实际应用的必备知识' },
    ],
    sourceEvidence: [],
    answerVerification: 'not-established',
  }];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 2);
  assert.equal(report.counts.exactTextTargetsMatched, 2);
  assert.equal(report.counts.recordsWithAllowedDisposition, 1);
  assert.equal(report.counts.recordsWithAllowedVerification, 1);
  assert.equal(report.counts.invalidRecords, 0);
});

test('CQRS 的工作负载与延迟数字不得泛化，Kafka exactly-once 必须限定事务边界', () => {
  const bank = {
    choices: [],
    cases: [
      { id: 'cqrs-case', subQuestions: [
        { question_label: '问题1', reference_answer: '电商系统80%以上的订单查询场景是用户查询自己的订单。' },
        { question_label: '问题2', reference_answer: '同步延迟通常在1秒以内（最终一致性）。批量统计走ClickHouse，完全与在线业务隔离，不影响MySQL性能。' },
      ] },
      { id: 'kafka-case', subQuestions: [{ question_label: '问题2', reference_answer: 'Kafka 0.11+引入幂等生产者（enable.idempotence=true）+ 事务API（transactional.id），结合消费端的事务性offset提交，实现端到端精确一次语义。' }] },
    ],
    essays: [],
  };
  const records = [
    {
      recordId: 'cqrs-share', disposition: 'unsubstantiated-performance-claim',
      targets: [{ itemId: 'cqrs-case:问题1', field: 'reference_answer', claimNeedle: '80%以上的订单查询场景是' }],
      sourceEvidence: [], answerVerification: 'not-established',
    },
    {
      recordId: 'cqrs-lag', disposition: 'overgeneralized',
      targets: [
        { itemId: 'cqrs-case:问题2', field: 'reference_answer', claimNeedle: '同步延迟通常在1秒以内（最终一致性）' },
        { itemId: 'cqrs-case:问题2', field: 'reference_answer', claimNeedle: '完全与在线业务隔离，不影响MySQL性能' },
      ],
      sourceEvidence: [{ url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs', title: 'CQRS pattern', publisher: 'Microsoft Learn / Azure Architecture Center', sourceKind: 'official-architecture-guidance', checkedOn: '2026-10-13', supports: '读写存储分离需同步，读模型可能陈旧。', limitations: '不保证延迟小于一秒，也不保证同步链路零资源开销。' }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'kafka-eos', disposition: 'overgeneralized',
      targets: [{ itemId: 'kafka-case:问题2', field: 'reference_answer', claimNeedle: '实现端到端精确一次语义' }],
      sourceEvidence: [{ url: 'https://kafka.apache.org/design/', title: 'Design', publisher: 'Apache Kafka project', sourceKind: 'official-project-documentation', checkedOn: '2026-10-13', supports: 'Kafka 主题内事务读处理写可实现精确一次。', limitations: '外部目标系统需要自身协同或幂等性。' }],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 3);
  assert.equal(report.counts.targetClaims, 4);
  assert.equal(report.counts.exactTextTargetsMatched, 4);
  assert.equal(report.counts.recordsWithAllowedDisposition, 3);
  assert.equal(report.counts.recordsWithAllowedVerification, 3);
  assert.equal(report.counts.sourceEntries, 2);
  assert.equal(report.counts.recordsWithExternalSources, 2);
  assert.equal(report.counts.invalidRecords, 0);
});

test('位示图计算需要显式声明二进制单位，CPU 周期数运算只证明算术正确', () => {
  const bank = {
    choices: [
      { id: 'bitmap', analysis: '物理块数=300×1024/4=76800个，位示图大小=76800/32=2400个字。' },
      { id: 'cpu', analysis: '执行时间 = 时钟周期数 / 主频 = 6×10⁹ / 2.4×10⁹ = 2.5秒。' },
    ],
    cases: [],
    essays: [],
  };
  const records = [
    {
      recordId: 'bitmap', disposition: 'assumption-sensitive-calculation',
      targets: [
        { itemId: 'bitmap', field: 'analysis', claimNeedle: '物理块数=300×1024/4=76800个' },
        { itemId: 'bitmap', field: 'analysis', claimNeedle: '位示图大小=76800/32=2400个字' },
      ],
      sourceEvidence: [
        { url: 'https://www.bipm.org/en/measurement-units/si-prefixes', title: 'SI prefixes', publisher: 'BIPM', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13', supports: 'G/M SI prefixes use decimal factors.', limitations: 'Does not determine the intended convention in the exam question.' },
        { url: 'https://physics.nist.gov/cuu/Units/binary.html', title: 'The binary prefixes', publisher: 'NIST', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13', supports: 'Ki/Mi/Gi denote binary powers.', limitations: 'Does not replace the exam author’s intended convention.' },
      ],
      answerVerification: 'calculation-only',
    },
    {
      recordId: 'cpu', disposition: 'calculation-reproduced',
      targets: [{ itemId: 'cpu', field: 'analysis', claimNeedle: '6×10⁹ / 2.4×10⁹ = 2.5秒' }],
      sourceEvidence: [], answerVerification: 'calculation-only',
    },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 2);
  assert.equal(report.counts.targetClaims, 3);
  assert.equal(report.counts.exactTextTargetsMatched, 3);
  assert.equal(report.counts.recordsWithAllowedDisposition, 2);
  assert.equal(report.counts.recordsWithAllowedVerification, 2);
  assert.equal(report.counts.sourceEntries, 2);
  assert.equal(report.counts.recordsWithExternalSources, 1);
  assert.equal(report.counts.invalidRecords, 0);
});

test('TLS latency estimates and AES speed/quantum claims require scope, benchmarks, and standards evidence', () => {
  const bank = {
    choices: [],
    cases: [
      { id: 'tls-case', subQuestions: [{ question_label: '问题2', reference_answer: '对传输中的数据采用TLS加密（不影响业务延迟）。解密操作会增加10-50ms的延迟，将加密延迟控制在1-5ms。' }] },
      { id: 'aes-case', subQuestions: [{ question_label: '问题2', reference_answer: 'AES-256密钥256位，14轮加密（AES-128为10轮），计算量约比AES-128慢40%；2^256密钥空间暴力破解不可行；抗量子计算有效安全强度128位。' }] },
    ],
    essays: [],
  };
  const records = [
    {
      recordId: 'tls', disposition: 'unsubstantiated-performance-claim',
      targets: [
        { itemId: 'tls-case:问题2', field: 'reference_answer', claimNeedle: 'TLS加密（不影响业务延迟）' },
        { itemId: 'tls-case:问题2', field: 'reference_answer', claimNeedle: '增加10-50ms的延迟' },
        { itemId: 'tls-case:问题2', field: 'reference_answer', claimNeedle: '将加密延迟控制在1-5ms' },
      ],
      sourceEvidence: [{ url: 'https://www.rfc-editor.org/rfc/rfc8446', title: 'RFC 8446: The Transport Layer Security (TLS) Protocol Version 1.3', publisher: 'RFC Editor / IETF', sourceKind: 'official-standard-guidance', checkedOn: '2026-10-13', supports: 'TLS 1.3 distinguishes full handshake and PSK resumption, including 0-RTT early data.', limitations: 'No universal millisecond performance penalty is specified; latency depends on deployment and measurement conditions.' }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'aes', disposition: 'overgeneralized',
      targets: [
        { itemId: 'aes-case:问题2', field: 'reference_answer', claimNeedle: '14轮加密（AES-128为10轮）' },
        { itemId: 'aes-case:问题2', field: 'reference_answer', claimNeedle: '计算量约比AES-128慢40%' },
        { itemId: 'aes-case:问题2', field: 'reference_answer', claimNeedle: '2^256密钥空间暴力破解不可行' },
        { itemId: 'aes-case:问题2', field: 'reference_answer', claimNeedle: '抗量子计算有效安全强度128位' },
      ],
      sourceEvidence: [
        { url: 'https://csrc.nist.gov/pubs/fips/197/final', title: 'FIPS 197: Advanced Encryption Standard', publisher: 'NIST', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13', supports: 'AES-128 has 10 rounds and AES-256 has 14 rounds.', limitations: 'The specification does not prove a universal 40% speed difference.' },
        { url: 'https://csrc.nist.gov/Projects/post-quantum-cryptography/faqs', title: 'Post-Quantum Cryptography FAQ', publisher: 'NIST', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13', supports: 'Discusses Grover-style square-root search in a model with explicit assumptions.', limitations: 'Does not certify an unconditional exact 128-bit effective security rating for the full cipher under every quantum resource model.' },
      ],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 2);
  assert.equal(report.counts.targetClaims, 7);
  assert.equal(report.counts.exactTextTargetsMatched, 7);
  assert.equal(report.counts.recordsWithAllowedDisposition, 2);
  assert.equal(report.counts.recordsWithAllowedVerification, 2);
  assert.equal(report.counts.sourceEntries, 3);
  assert.equal(report.counts.recordsWithExternalSources, 2);
  assert.equal(report.counts.invalidRecords, 0);
});

test('Kafka 消费者默认超时参数应限定版本，协作式再均衡需兼容迁移', () => {
  const bank = {
    choices: [],
    cases: [{ id: 'kafka-rebalance', subQuestions: [{ question_label: '问题1', reference_answer: '消费者心跳超时，超过session.timeout.ms（默认10s）；两次poll()调用间隔超过max.poll.interval.ms（默认5min）。使用Kafka 2.4+的CooperativeStickyAssignor（协作式粘性分配器），支持增量Rebalance。' }] }],
    essays: [],
  };
  const records = [{
    recordId: 'kafka-timeouts', disposition: 'supported-with-scope',
    targets: [
      { itemId: 'kafka-rebalance:问题1', field: 'reference_answer', claimNeedle: 'session.timeout.ms（默认10s）' },
      { itemId: 'kafka-rebalance:问题1', field: 'reference_answer', claimNeedle: 'max.poll.interval.ms（默认5min）' },
      { itemId: 'kafka-rebalance:问题1', field: 'reference_answer', claimNeedle: 'Kafka 2.4+的CooperativeStickyAssignor' },
    ],
    sourceEvidence: [
      { url: 'https://kafka.apache.org/24/generated/consumer_config.html', title: 'Consumer Configurations (Apache Kafka 2.4)', publisher: 'Apache Kafka project', sourceKind: 'official-project-documentation', checkedOn: '2026-10-13', supports: '2.4 default session timeout is 10s, max poll interval is 5min.', limitations: 'Version-specific defaults only.' },
      { url: 'https://kafka.apache.org/40/generated/consumer_config.html', title: 'Consumer Configurations (Apache Kafka 4.0)', publisher: 'Apache Kafka project', sourceKind: 'official-project-documentation', checkedOn: '2026-10-13', supports: '4.0 classic protocol default session timeout is 45s, max poll interval is 5min.', limitations: 'Depends on protocol and overrides.' },
      { url: 'https://kafka.apache.org/24/getting-started/upgrade/', title: 'Upgrading to Kafka 2.4', publisher: 'Apache Kafka project', sourceKind: 'official-project-documentation', checkedOn: '2026-10-13', supports: 'Cooperative assignor uses staged rolling compatibility migration.', limitations: 'Not an instant single-consumer toggle.' },
    ],
    answerVerification: 'not-established',
  }];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 3);
  assert.equal(report.counts.exactTextTargetsMatched, 3);
  assert.equal(report.counts.recordsWithAllowedDisposition, 1);
  assert.equal(report.counts.recordsWithAllowedVerification, 1);
  assert.equal(report.counts.sourceEntries, 3);
  assert.equal(report.counts.recordsWithExternalSources, 1);
  assert.equal(report.counts.invalidRecords, 0);
});

test('可用性公式的公开证据保留模型假设，不掩盖 MTBF/MTTF 术语冲突', () => {
  const bank = {
    choices: [{ id: 'availability', analysis: '稳态可用性 = MTBF/(MTBF+MTTR) = 999/(999+1) = 99.9%。注意MTBF = MTTF + MTTR，此处MTBF已包含修复时间。实际上更精确的是A = MTTF/(MTTF+MTTR)。' }],
  };
  const records = [{
    recordId: 'availability', disposition: 'internal-definition-conflict',
    targets: [
      { itemId: 'availability', field: 'analysis', claimNeedle: '稳态可用性 = MTBF/(MTBF+MTTR)' },
      { itemId: 'availability', field: 'analysis', claimNeedle: 'MTBF = MTTF + MTTR' },
    ],
    sourceEvidence: [{
      url: 'https://www.nasa.gov/wp-content/uploads/2023/11/170508-formulas-inherent-availability-and-reliability-with-constant-failure-and-repair-rates.pdf',
      title: 'Formulas: Inherent Availability and Reliability with Constant Failure and Repair Rates',
      publisher: 'NASA', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13',
      supports: 'NASA defines steady-state inherent availability as MTBF/(MTBF+MTTR) under its constant-rate model.',
      limitations: 'Formula and terminology depend on the source model; does not validate an unqualified identity MTBF=MTTF+MTTR.',
    }, {
      url: 'https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf',
      title: 'Reliability-Centered Maintenance Guide', publisher: 'NASA', sourceKind: 'government-standard-guidance', checkedOn: '2026-10-13',
      supports: 'Section 14.3 gives Ai = MTBF/(MTBF+MTTR), and glossary defines MTBF alternatively as mean time to failure.',
      limitations: 'Does not support MTBF=MTTF+MTTR as an unqualified identity.',
    }],
    answerVerification: 'not-established',
  }];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 2);
  assert.equal(report.counts.exactTextTargetsMatched, 2);
  assert.equal(report.counts.recordsWithAllowedDisposition, 1);
  assert.equal(report.counts.recordsWithAllowedVerification, 1);
  assert.equal(report.counts.sourceEntries, 2);
  assert.equal(report.counts.recordsWithExternalSources, 1);
  assert.equal(report.counts.invalidRecords, 0);
});

test('Envoy 延迟估计需环境基准，模拟论文绩效数字需标为示例', () => {
  const bank = {
    choices: [],
    cases: [{ id: 'envoy-case', subQuestions: [{
      question_label: '问题2',
      reference_answer: 'Envoy Sidecar单跳额外延迟通常在0.5-2ms；对绝大多数业务（响应时间>50ms）影响可忽略。',
    }] }],
    essays: [
      { id: 'events', writingPoints: '系统日处理事件量提升10倍，响应延迟降低80%。' },
      { id: 'quality', writingPoints: '数据质量合格率从72%提升至95%，通过DCMM三级认证。' },
      { id: 'agent', writingPoints: '开发效率提升40%，代码缺陷率降低30%。' },
    ],
  };
  const records = [
    {
      recordId: 'envoy',
      disposition: 'unsubstantiated-performance-claim',
      targets: [
        { itemId: 'envoy-case:问题2', field: 'reference_answer', claimNeedle: 'Envoy Sidecar单跳额外延迟通常在0.5-2ms' },
        { itemId: 'envoy-case:问题2', field: 'reference_answer', claimNeedle: '对绝大多数业务（响应时间>50ms）影响可忽略' },
      ],
      sourceEvidence: [{
        url: 'https://www.envoyproxy.io/docs/envoy/latest/faq/performance/how_to_benchmark_envoy',
        title: 'What are best practices for benchmarking Envoy?',
        publisher: 'Envoy project official documentation',
        sourceKind: 'official-project-documentation',
        checkedOn: '2026-10-14',
        supports: '不存在可概括代理延迟开销的单一通用数值，测试必须结合配置与工作负载。',
        limitations: '不为任何部署提供统一毫秒级延迟保证。',
      }],
      answerVerification: 'not-established',
    },
    { recordId: 'events', disposition: 'unsubstantiated-performance-claim', targets: [
      { itemId: 'events', field: 'writingPoints', claimNeedle: '系统日处理事件量提升10倍' },
      { itemId: 'events', field: 'writingPoints', claimNeedle: '响应延迟降低80%' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'quality', disposition: 'unsubstantiated-performance-claim', targets: [
      { itemId: 'quality', field: 'writingPoints', claimNeedle: '数据质量合格率从72%提升至95%' },
      { itemId: 'quality', field: 'writingPoints', claimNeedle: '通过DCMM三级认证' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'agent', disposition: 'unsubstantiated-performance-claim', targets: [
      { itemId: 'agent', field: 'writingPoints', claimNeedle: '开发效率提升40%' },
      { itemId: 'agent', field: 'writingPoints', claimNeedle: '代码缺陷率降低30%' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
  ];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-14', records });
  assert.equal(report.counts.records, 4);
  assert.equal(report.counts.targetClaims, 8);
  assert.equal(report.counts.exactTextTargetsMatched, 8);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.sourceEntries, 1);
  assert.equal(report.counts.recordsWithAllowedDisposition, 4);
  assert.equal(report.counts.recordsWithAllowedVerification, 4);
  assert.equal(report.counts.invalidRecords, 0);
});

test('模拟论文中的多个量化成果保留示例属性，不冒充真实项目数据', () => {
  const essays = [
    { id: 'microservices', writingPoints: '系统吞吐量提升5倍，发布周期从月级缩短到天级，系统可用性99.95%→99.99%，平均响应时间降低60%，发布频率提升20倍。' },
    { id: 'atam', writingPoints: '系统通过等保三级认证，响应时间<1.5s，成功对接30+部门。' },
    { id: 'cloudnative', writingPoints: '系统弹性扩展能力提升10倍，运维效率提升5倍。' },
    { id: 'rag', writingPoints: '问答准确率达88%，法律依据引用准确率95%，日均服务1000+律师咨询。' },
    { id: 'modifiability', writingPoints: '需求变更响应周期从2周缩短到3天，缺陷率降低40%。' },
    { id: 'serverless', writingPoints: '成本降低60%，发布频率提升5倍。' },
  ];
  const groups = [
    ['microservices', ['系统吞吐量提升5倍', '发布周期从月级缩短到天级', '系统可用性99.95%→99.99%', '平均响应时间降低60%', '发布频率提升20倍']],
    ['atam', ['系统通过等保三级认证', '响应时间<1.5s', '成功对接30+部门']],
    ['cloudnative', ['系统弹性扩展能力提升10倍', '运维效率提升5倍']],
    ['rag', ['问答准确率达88%', '法律依据引用准确率95%', '日均服务1000+律师咨询']],
    ['modifiability', ['需求变更响应周期从2周缩短到3天', '缺陷率降低40%']],
    ['serverless', ['成本降低60%', '发布频率提升5倍']],
  ];
  const records = groups.map(([id, needles]) => ({
    recordId: id,
    disposition: 'unsubstantiated-performance-claim',
    targets: needles.map(claimNeedle => ({ itemId: id, field: 'writingPoints', claimNeedle })),
    sourceEvidence: [],
    answerVerification: 'not-established',
  }));
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 6);
  assert.equal(report.counts.targetClaims, 17);
  assert.equal(report.counts.exactTextTargetsMatched, 17);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 6);
  assert.equal(report.counts.recordsWithAllowedVerification, 6);
  assert.equal(report.counts.invalidRecords, 0);
});

test('模拟论文中其他业务成果、合规及自动化指标需要项目证据', () => {
  const groups = [
    ['domain', ['系统吞吐量提升5倍', '部署频率从月级到日级', '故障影响范围缩小80%']],
    ['zeroTrust', ['安全事件减少70%', 'VPN相关投诉下降90%', '等保2.0合规达标']],
    ['automation', ['文档处理效率提升10倍', '数据报表生成从小时级缩短到分钟级', 'IT运维工单自动处理率达到60%']],
    ['maintenance', ['设备故障预测准确率92%', '非计划停机减少60%', '生产工艺优化周期从2周缩短到2天', '新员工培训时间缩短50%', '年度维护成本降低35%']],
    ['federated', ['欺诈识别率提升15%', '数据合规零风险']],
    ['migration', ['发布频率从月级提升到周级', '系统可用性提升到99.95%']],
    ['defects', ['平均缺陷修复时间从5天降到1天', '变更引入缺陷率降低60%']],
    ['governance', ['数据需求交付周期从3个月降至2周', '数据质量达标率从60%提升到95%']],
  ];
  const essays = groups.map(([id, needles]) => ({ id, writingPoints: needles.join('；') }));
  const records = groups.map(([id, needles]) => ({
    recordId: id,
    disposition: 'unsubstantiated-performance-claim',
    targets: needles.map(claimNeedle => ({ itemId: id, field: 'writingPoints', claimNeedle })),
    sourceEvidence: [],
    answerVerification: 'not-established',
  }));
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 8);
  assert.equal(report.counts.targetClaims, 22);
  assert.equal(report.counts.exactTextTargetsMatched, 22);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 8);
  assert.equal(report.counts.recordsWithAllowedVerification, 8);
  assert.equal(report.counts.invalidRecords, 0);
});

test('AI、零信任、实时架构与训练集群模拟成果数字需证据支撑', () => {
  const groups = [
    ['rag', ['问答准确率达92%', '平均响应时间<3秒', '月度推理成本降低60%']],
    ['security', ['通过等保三级认证', '零安全事故运行18个月', '安全事件响应时间从小时级缩短到分钟级', '零数据泄露']],
    ['traffic', ['信号控制延迟<500ms', '可用性99.995%', '系统稳定运行2年']],
    ['vision', ['缺陷检出率98.5%', '误检率<1%', '单次推理<50ms']],
    ['training', ['GPU MFU达到55%+', '日均训练Token数达到100B+', 'MTBF>48小时']],
  ];
  const essays = groups.map(([id, needles]) => ({ id, writingPoints: needles.join('；') }));
  const records = groups.map(([id, needles]) => ({
    recordId: id,
    disposition: 'unsubstantiated-performance-claim',
    targets: needles.map(claimNeedle => ({ itemId: id, field: 'writingPoints', claimNeedle })),
    sourceEvidence: [],
    answerVerification: 'not-established',
  }));
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 5);
  assert.equal(report.counts.targetClaims, 16);
  assert.equal(report.counts.exactTextTargetsMatched, 16);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 5);
  assert.equal(report.counts.recordsWithAllowedVerification, 5);
  assert.equal(report.counts.invalidRecords, 0);
});

test('模拟论文的确定性考试趋势预测缺少历年统计时标记为未证实', () => {
  const essays = [
    { id: 'llm', writingPoints: '大模型应用架构是2026年最可能出现的新方向题目。' },
    { id: 'event', writingPoints: '事件驱动架构在2025年已考过，2026年可能以不同角度再出（如结合微服务、IoT）。' },
    { id: 'data', writingPoints: '数据治理是2026年预测热点方向。' },
    { id: 'agent', writingPoints: '多Agent系统是2026年最前沿的考试方向之一，结合大模型热点。' },
    { id: 'cloud', writingPoints: '云原生是近年高频考点，2025下已考Serverless，2026年大概率考更广泛的云原生架构。' },
    { id: 'rag', writingPoints: 'RAG是2026年AI方向最可能出的论文题之一。' },
  ];
  const ids = ['llm', 'event', 'data', 'agent', 'cloud', 'rag'];
  const needles = [
    '大模型应用架构是2026年最可能出现的新方向题目',
    '事件驱动架构在2025年已考过，2026年可能以不同角度再出（如结合微服务、IoT）',
    '数据治理是2026年预测热点方向',
    '多Agent系统是2026年最前沿的考试方向之一，结合大模型热点',
    '云原生是近年高频考点，2025下已考Serverless，2026年大概率考更广泛的云原生架构',
    'RAG是2026年AI方向最可能出的论文题之一',
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records: [{
      recordId: 'exam-trends',
      disposition: 'unsupported-exam-frequency-prediction',
      targets: ids.map((id, i) => ({ itemId: id, field: 'writingPoints', claimNeedle: needles[i] })),
      sourceEvidence: [],
      answerVerification: 'not-established',
    }] },
  );
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 6);
  assert.equal(report.counts.exactTextTargetsMatched, 6);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 1);
  assert.equal(report.counts.recordsWithAllowedVerification, 1);
  assert.equal(report.counts.invalidRecords, 0);
});

test('模拟可靠性、推理和迁移成果需运行记录或可复现基准', () => {
  const groups = [
    ['reliability', [
      '系统可用性达到99.99%（年停机时间<52.6分钟），零重大故障',
      '年可用性99.99%，核心业务RTO<30秒、RPO=0',
      'MTBF（>8760小时）、MTTR（<30分钟）',
      '运行3年无重大故障，可用性99.995%，灾备切换时间<15秒',
    ]],
    ['event', ['日处理事件5亿+', '端到端延迟P99<500ms', '系统扩展到20+微服务零耦合']],
    ['rag', ['律师满意度92%']],
    ['inference', ['推理吞吐量提升4倍', 'P99延迟降低60%', 'GPU利用率从30%提升到85%']],
    ['migration', ['性能下降15-30%的调优', '核心业务性能达到原系统的95%+', '通过等保三级认证']],
  ];
  const essays = groups.map(([id, needles]) => ({ id, writingPoints: needles.join('；') }));
  const records = groups.map(([id, needles]) => ({
    recordId: id,
    disposition: 'unsubstantiated-performance-claim',
    targets: needles.map(claimNeedle => ({ itemId: id, field: 'writingPoints', claimNeedle })),
    sourceEvidence: [],
    answerVerification: 'not-established',
  }));
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 5);
  assert.equal(report.counts.targetClaims, 14);
  assert.equal(report.counts.exactTextTargetsMatched, 14);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 5);
  assert.equal(report.counts.recordsWithAllowedVerification, 5);
  assert.equal(report.counts.invalidRecords, 0);
});

test('真题论文写作提纲里的定量项目成效须与官方题面事实区分', () => {
  const groups = [
    ['escape', ['线上缺陷逃逸率降至2%以下']],
    ['bigdata', ['支撑10亿级数据量', '查询性能提升5倍']],
    ['aop', ['代码量减少30%']],
    ['integration', ['系统集成周期缩短60%']],
    ['release', ['发布频率从月到日']],
    ['component', ['开发效率提升50%', '代码复用率70%']],
    ['mttr', ['MTTR缩短40%']],
    ['storage', ['存储成本降低60%', '查询性能提升3倍']],
    ['freshness', ['数据时效性从T+1提升到分钟级']],
    ['network', ['响应延迟降至10ms', '带宽节省70%']],
    ['dev', ['开发效率提升40%']],
    ['cloudops', ['部署频率从月到日', 'MTTR从小时到分钟', '成本降低30%']],
    ['serverless', ['成本降低60%', '发布频率提升5倍']],
  ];
  const essays = groups.map(([id, needles]) => ({ id, writingPoints: needles.join('；') }));
  const records = groups.map(([id, needles]) => ({
    recordId: id,
    disposition: 'unsubstantiated-performance-claim',
    targets: needles.map(claimNeedle => ({ itemId: id, field: 'writingPoints', claimNeedle })),
    sourceEvidence: [],
    answerVerification: 'not-established',
  }));
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 13);
  assert.equal(report.counts.targetClaims, 20);
  assert.equal(report.counts.exactTextTargetsMatched, 20);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 13);
  assert.equal(report.counts.recordsWithAllowedVerification, 13);
  assert.equal(report.counts.invalidRecords, 0);
});

test('历年真题主题下的参考论文提纲成果指标不得冒充官方题面或真实项目业绩', () => {
  const groups = [
    ['defect', ['线上缺陷逃逸率降至2%以下']],
    ['scale', ['支撑10亿级数据量', '查询性能提升5倍']],
    ['aop', ['代码量减少30%']],
    ['integration', ['系统集成周期缩短60%']],
    ['reuse', ['开发效率提升50%', '代码复用率70%']],
    ['warehouse', ['存储成本降低60%', '查询性能提升3倍']],
    ['edge', ['响应延迟降至10ms', '带宽节省70%']],
    ['model', ['开发效率提升40%']],
    ['cloudops', ['部署频率从月到日', 'MTTR从小时到分钟', '成本降低30%']],
    ['serverless', ['可用性99.99%', '扩展能力提升10倍', '运维成本降低40%']],
    ['performance', ['TPS提升3倍', 'P99响应时间降至200ms以内']],
    ['flashsale', ['支撑百万级QPS', '零超卖', '系统可用性99.99%']],
  ];
  const essays = groups.map(([id, needles]) => ({ id, writingPoints: needles.join('；') }));
  const records = groups.map(([id, needles]) => ({
    recordId: id,
    disposition: 'unsubstantiated-performance-claim',
    targets: needles.map(claimNeedle => ({ itemId: id, field: 'writingPoints', claimNeedle })),
    sourceEvidence: [],
    answerVerification: 'not-established',
  }));
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 12);
  assert.equal(report.counts.targetClaims, 23);
  assert.equal(report.counts.exactTextTargetsMatched, 23);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 12);
  assert.equal(report.counts.recordsWithAllowedVerification, 12);
  assert.equal(report.counts.invalidRecords, 0);
});

test('同一题目字段与声明不得跨登记记录重复计数', () => {
  const bank = { choices: [
    { id: 'q1', analysis: '同一条声明需要只登记一次。' },
  ], cases: [], essays: [] };
  const sharedTarget = { itemId: 'q1', field: 'analysis', claimNeedle: '同一条声明' };
  const register = { records: [
    {
      recordId: 'first',
      disposition: 'overgeneralized',
      targets: [sharedTarget],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'second',
      disposition: 'overgeneralized',
      targets: [sharedTarget],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ] };
  const report = auditClaimEvidenceRegister(bank, register);
  assert.equal(report.counts.duplicateTargetTuples, 1);
  assert.equal(report.counts.duplicateTargetRegistrations, 2);
  assert.equal(report.counts.invalidRecords, 2);
  assert.ok(report.records.every(record => record.targetsOk === false));
  assert.ok(report.records.every(record => record.targetChecks[0].duplicateRegistration === true));
});

test('选择题计算审计区分纯算术复核与单位/模型敏感前提', () => {
  const choices = [
    { id: 'cache', analysis: 'Cache共有2^19/2^6=2^13个块。标记位=28-13-6=9位。' },
    { id: 'rr', analysis: '5×20=100ms。每个进程在100ms内获得1个时间片即20ms的CPU时间。' },
    { id: 'avail', analysis: '990 / (990 + 10) = 990/1000 = 99%' },
    { id: 'index', analysis: '4KB/4B=1024个地址；最大文件=1024×1024×4KB=1024²×4KB=4GB' },
    { id: 'break-even', analysis: '可变成本比例=4000/6250=64%；解得X=5000台' },
    { id: 'four-nines', analysis: '99.99%可用性意味着0.01%的不可用时间；每年=365.25×24×60≈525960分钟。525960×0.0001≈52.6分钟' },
  ];
  const records = [
    { recordId: 'cache', disposition: 'assumption-sensitive-calculation', targets: [
      { itemId: 'cache', field: 'analysis', claimNeedle: 'Cache共有2^19/2^6=2^13个块' },
      { itemId: 'cache', field: 'analysis', claimNeedle: '标记位=28-13-6=9位' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'rr', disposition: 'calculation-reproduced', targets: [
      { itemId: 'rr', field: 'analysis', claimNeedle: '5×20=100ms' },
      { itemId: 'rr', field: 'analysis', claimNeedle: '每个进程在100ms内获得1个时间片即20ms的CPU时间' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'avail', disposition: 'calculation-reproduced', targets: [
      { itemId: 'avail', field: 'analysis', claimNeedle: '990 / (990 + 10) = 990/1000 = 99%' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'index', disposition: 'assumption-sensitive-calculation', targets: [
      { itemId: 'index', field: 'analysis', claimNeedle: '4KB/4B=1024个地址' },
      { itemId: 'index', field: 'analysis', claimNeedle: '最大文件=1024×1024×4KB=1024²×4KB=4GB' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'break-even', disposition: 'calculation-reproduced', targets: [
      { itemId: 'break-even', field: 'analysis', claimNeedle: '可变成本比例=4000/6250=64%' },
      { itemId: 'break-even', field: 'analysis', claimNeedle: '解得X=5000台' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'four-nines', disposition: 'calculation-reproduced', targets: [
      { itemId: 'four-nines', field: 'analysis', claimNeedle: '99.99%可用性意味着0.01%的不可用时间' },
      { itemId: 'four-nines', field: 'analysis', claimNeedle: '每年=365.25×24×60≈525960分钟' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
  ];
  const report = auditClaimEvidenceRegister(
    { choices, cases: [], essays: [] },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 6);
  assert.equal(report.counts.targetClaims, 11);
  assert.equal(report.counts.exactTextTargetsMatched, 11);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 6);
  assert.equal(report.counts.recordsWithAllowedVerification, 6);
  assert.equal(report.counts.invalidRecords, 0);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
});

test('重复的Redis AOF与安全百分比声明均被映射，性能拐点推断标记为前提敏感', () => {
  const choices = Array.from({ length: 6 }, (_, index) => ({
    id: 'security-' + String(index + 12),
    stem: '该系统应能够防止99%的黑客攻击。',
  }));
  choices.push({
    id: 'curve',
    analysis: '负载达到90%时响应时间从200ms急增到800ms（4倍），说明处于拐点附近的重载区。',
  });
  const cases = [{
    id: 'redis-case',
    subQuestions: [{
      question_label: '问题2',
      reference_answer: 'AOF everysec策略下最多丢失1秒数据。',
    }],
  }];
  const essays = [{
    id: 'traffic-essay',
    writingPoints: '信号控制延迟<500ms；可用性99.995%；系统稳定运行2年；实时延迟<200ms；安全加密增加30ms延迟。',
  }];
  const records = [
    {
      recordId: 'redis',
      disposition: 'durability-bound-overstatement',
      targets: [
        { itemId: 'redis-case:问题2', field: 'reference_answer', claimNeedle: '最多丢失1秒数据' },
        { itemId: 'redis-case:问题2', field: 'reference_answer', claimNeedle: '最多丢失1秒数据' },
      ],
      sourceEvidence: [{
        url: 'https://redis.io/docs/latest/management/persistence/',
        title: 'Redis persistence',
        publisher: 'Redis official documentation',
        sourceKind: 'vendor-official-documentation',
        checkedOn: '2026-10-13',
        supports: 'everysec 会按秒执行 fsync，灾难故障时可能丢失约一秒写入。',
        limitations: '这不是所有故障/存储栈上的严格上限。',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'security',
      disposition: 'unsubstantiated-performance-claim',
      targets: choices.slice(0, 6).map(choice => ({
        itemId: choice.id,
        field: 'stem',
        claimNeedle: '防止99%的黑客攻击',
      })),
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'curve',
      disposition: 'assumption-sensitive-calculation',
      targets: [
        { itemId: 'curve', field: 'analysis', claimNeedle: '负载达到90%时响应时间从200ms急增到800ms（4倍）' },
        { itemId: 'curve', field: 'analysis', claimNeedle: '说明处于拐点附近的重载区' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'traffic',
      disposition: 'unsubstantiated-performance-claim',
      targets: [
        { itemId: 'traffic-essay', field: 'writingPoints', claimNeedle: '信号控制延迟<500ms' },
        { itemId: 'traffic-essay', field: 'writingPoints', claimNeedle: '可用性99.995%' },
        { itemId: 'traffic-essay', field: 'writingPoints', claimNeedle: '系统稳定运行2年' },
        { itemId: 'traffic-essay', field: 'writingPoints', claimNeedle: '实时延迟<200ms' },
        { itemId: 'traffic-essay', field: 'writingPoints', claimNeedle: '安全加密增加30ms延迟' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices, cases, essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 4);
  assert.equal(report.counts.targetClaims, 15);
  assert.equal(report.counts.exactTextTargetsMatched, 15);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.duplicateTargetRegistrations, 2);
  assert.equal(report.counts.duplicateTargetTuples, 1);
  assert.equal(report.counts.invalidRecords, 1);
  assert.equal(report.records[0].targetsOk, false);
  assert.ok(report.records.every(record => record.answerVerification === 'not-established'));
});

test('案例题的TLS绝对化措辞、零信任押题与FaaS冷启动范围均有登记', () => {
  const cases = [
    {
      id: 'tls-case',
      subQuestions: [{
        question_label: '问题1',
        reference_answer: '对传输中的数据采用TLS加密（不影响业务延迟），这是一项绝对化性能承诺。',
      }],
    },
    {
      id: 'zero-trust-case',
      subQuestions: ['问题1', '问题2', '问题3'].map(question_label => ({
        question_label,
        reference_answer: '考试趋势：零信任安全是近年来安全架构的热点方向。',
      })),
    },
    {
      id: 'faas-case',
      subQuestions: [{
        question_label: '问题1',
        reference_answer: '冷启动延迟通常为1-10秒（取决于运行时语言和包大小）。',
      }],
    },
  ];
  const records = [
    {
      recordId: 'tls',
      disposition: 'overgeneralized',
      targets: [{ itemId: 'tls-case:问题1', field: 'reference_answer', claimNeedle: 'TLS加密（不影响业务延迟）' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'zero-trust-trend',
      disposition: 'unsupported-exam-frequency-prediction',
      targets: ['问题1', '问题2', '问题3'].map(question => ({
        itemId: 'zero-trust-case:' + question,
        field: 'reference_answer',
        claimNeedle: '零信任安全是近年来安全架构的热点方向',
      })),
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'faas-cold-start',
      disposition: 'overgeneralized',
      targets: [{ itemId: 'faas-case:问题1', field: 'reference_answer', claimNeedle: '冷启动延迟通常为1-10秒' }],
      sourceEvidence: [{
        url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html',
        title: 'Understanding the Lambda execution environment lifecycle',
        publisher: 'AWS official documentation',
        sourceKind: 'vendor-official-documentation',
        checkedOn: '2026-10-14',
        supports: 'Lambda冷启动可从低于100毫秒到超过1秒，取决于运行时和初始化工作。',
        limitations: '不是所有FaaS平台通用范围。',
      }],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases, essays: [] },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 3);
  assert.equal(report.counts.targetClaims, 5);
  assert.equal(report.counts.exactTextTargetsMatched, 5);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 3);
  assert.equal(report.counts.recordsWithAllowedVerification, 3);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('真实题解析中的重复安全百分比、单位前提与作业时间线均精确映射', () => {
  const choices = Array.from({ length: 6 }, (_, index) => ({
    id: 'real-2019-' + String(index + 12),
    stem: '系统应能够防止99%的黑客攻击。',
    analysis: '解析指出系统应能够防止99%的黑客攻击。',
  }));
  choices.push(
    { id: 'bitmap', analysis: '磁盘容量300GB，物理块4MB。物理块数=300×1024/4=76800个，位示图大小=76800/32=2400个字。' },
    { id: 'cache', analysis: '主存256MB=2^28字节。Cache共有2^19/2^6=2^13个块。标记位=28-13-6=9位。' },
    { id: 'availability', analysis: '稳态可用性 = MTBF/(MTBF+MTTR)；MTBF = MTTF + MTTR；999/(999+1) = 99.9%' },
    { id: 'amdahl', analysis: '当N趋于无穷时S=1/(1-f)=1/(1-0.8)=1/0.2=5。因此即使使用无限多处理器，加速比也不超过5倍。' },
    { id: 'schedule', analysis: '按题面执行顺序计算后，最短完成时间为220ms。' },
  );
  const records = [
    {
      recordId: 'security',
      disposition: 'unsubstantiated-performance-claim',
      targets: choices.slice(0, 6).flatMap(choice => [
        { itemId: choice.id, field: 'stem', claimNeedle: '防止99%的黑客攻击' },
        { itemId: choice.id, field: 'analysis', claimNeedle: '防止99%的黑客攻击' },
      ]),
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'bitmap',
      disposition: 'assumption-sensitive-calculation',
      targets: [
        { itemId: 'bitmap', field: 'analysis', claimNeedle: '磁盘容量300GB，物理块4MB' },
        { itemId: 'bitmap', field: 'analysis', claimNeedle: '物理块数=300×1024/4=76800个' },
        { itemId: 'bitmap', field: 'analysis', claimNeedle: '位示图大小=76800/32=2400个字' },
      ],
      sourceEvidence: [],
      answerVerification: 'calculation-only',
    },
    {
      recordId: 'cache',
      disposition: 'assumption-sensitive-calculation',
      targets: [
        { itemId: 'cache', field: 'analysis', claimNeedle: '主存256MB=2^28字节' },
        { itemId: 'cache', field: 'analysis', claimNeedle: 'Cache共有2^19/2^6=2^13个块' },
        { itemId: 'cache', field: 'analysis', claimNeedle: '标记位=28-13-6=9位' },
      ],
      sourceEvidence: [],
      answerVerification: 'calculation-only',
    },
    {
      recordId: 'availability',
      disposition: 'internal-definition-conflict',
      targets: [
        { itemId: 'availability', field: 'analysis', claimNeedle: '稳态可用性 = MTBF/(MTBF+MTTR)' },
        { itemId: 'availability', field: 'analysis', claimNeedle: 'MTBF = MTTF + MTTR' },
        { itemId: 'availability', field: 'analysis', claimNeedle: '999/(999+1) = 99.9%' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'amdahl',
      disposition: 'calculation-reproduced',
      targets: [
        { itemId: 'amdahl', field: 'analysis', claimNeedle: '1/0.2=5' },
        { itemId: 'amdahl', field: 'analysis', claimNeedle: '即使使用无限多处理器，加速比也不超过5倍' },
      ],
      sourceEvidence: [],
      answerVerification: 'calculation-only',
    },
    {
      recordId: 'schedule',
      disposition: 'calculation-reproduced',
      targets: [{ itemId: 'schedule', field: 'analysis', claimNeedle: '最短完成时间为220ms' }],
      sourceEvidence: [],
      answerVerification: 'calculation-only',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices, cases: [], essays: [] },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 6);
  assert.equal(report.counts.targetClaims, 24);
  assert.equal(report.counts.exactTextTargetsMatched, 24);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 6);
  assert.equal(report.counts.recordsWithAllowedVerification, 6);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('案例中的熔断、Agent超时、反作弊相似度和零信任时限均按示例参数记录', () => {
  const cases = [
    { id: 'circuit', subQuestions: [{ question_label: '问题3', reference_answer: '失败率超过阈值（如50%）；经过超时时间（如30秒）后，自动进入半开状态。' }] },
    { id: 'agent', subQuestions: [{ question_label: '问题2', reference_answer: '每个Agent每30秒向Orchestrator发送心跳消息；连续3次未收到心跳（90秒）判定Agent故障；编码任务5分钟；任务执行超时（5分钟）。' }] },
    { id: 'cheating', subQuestions: [{ question_label: '问题3', reference_answer: '相似度超过阈值（如85%）标记为可疑。' }] },
    { id: 'zero-trust', subQuestions: [{ question_label: '问题2', reference_answer: '缩短会话有效期（如30分钟），定期（如每5分钟）上报设备安全状态。' }] },
  ];
  const records = [
    {
      recordId: 'circuit',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'circuit:问题3', field: 'reference_answer', claimNeedle: '失败率超过阈值（如50%）' },
        { itemId: 'circuit:问题3', field: 'reference_answer', claimNeedle: '经过超时时间（如30秒）后，自动进入半开状态' },
      ],
      sourceEvidence: [{
        url: 'https://resilience4j.readme.io/docs/circuitbreaker',
        title: 'CircuitBreaker',
        publisher: 'Resilience4j official documentation',
        sourceKind: 'official-project-documentation',
        checkedOn: '2026-10-14',
        supports: '50% is the default failure-rate threshold for Resilience4j.',
        limitations: 'Defaults differ by implementation; the documentation does not make 30 seconds a universal open-state wait duration.',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'agent',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'agent:问题2', field: 'reference_answer', claimNeedle: '每个Agent每30秒向Orchestrator发送心跳消息' },
        { itemId: 'agent:问题2', field: 'reference_answer', claimNeedle: '连续3次未收到心跳（90秒）判定Agent故障' },
        { itemId: 'agent:问题2', field: 'reference_answer', claimNeedle: '编码任务5分钟' },
        { itemId: 'agent:问题2', field: 'reference_answer', claimNeedle: '任务执行超时（5分钟）' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'cheating',
      disposition: 'illustrative-parameter-needs-context',
      targets: [{ itemId: 'cheating:问题3', field: 'reference_answer', claimNeedle: '相似度超过阈值（如85%）标记为可疑' }],
      sourceEvidence: [{
        url: 'https://helpcenter.turnitin.com/hc/en-us/articles/27811925295501-Plagiarism-and-what-are-acceptable-similarity-scores',
        title: 'Plagiarism and what are acceptable similarity scores?',
        publisher: 'Turnitin official help center',
        sourceKind: 'vendor-official-guidance',
        checkedOn: '2026-10-14',
        supports: 'Similarity score reflects matching text and is not itself a determination of plagiarism.',
        limitations: 'Turnitin’s score does not validate the project’s SimHash/TF-IDF algorithm or a universal 85% threshold.',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'zero-trust',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'zero-trust:问题2', field: 'reference_answer', claimNeedle: '缩短会话有效期（如30分钟）' },
        { itemId: 'zero-trust:问题2', field: 'reference_answer', claimNeedle: '定期（如每5分钟）上报设备安全状态' },
      ],
      sourceEvidence: [
        {
          url: 'https://pages.nist.gov/800-63-4/sp800-63b/session/',
          title: 'Session Management',
          publisher: 'NIST',
          sourceKind: 'government-standard-guidance',
          checkedOn: '2026-10-14',
          supports: 'Session timeout limits depend on assurance level, environment, endpoint/device and application.',
          limitations: 'No universal 30-minute timeout is prescribed for all zero-trust systems.',
        },
        {
          url: 'https://csrc.nist.gov/pubs/sp/800/207/final',
          title: 'Zero Trust Architecture (SP 800-207)',
          publisher: 'NIST',
          sourceKind: 'government-standard-guidance',
          checkedOn: '2026-10-14',
          supports: 'Zero-trust decisions consider identity and context when controlling resource access.',
          limitations: 'It does not define a universal five-minute device-posture reporting interval.',
        },
      ],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases, essays: [] },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 4);
  assert.equal(report.counts.targetClaims, 9);
  assert.equal(report.counts.exactTextTargetsMatched, 9);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.sourceEntries, 4);
  assert.equal(report.counts.recordsWithExternalSources, 3);
  assert.equal(report.counts.recordsWithAllowedDisposition, 4);
  assert.equal(report.counts.recordsWithAllowedVerification, 4);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
  assert.ok(report.records.every(record => record.answerVerification === 'not-established'));
});

test('边缘数据量缩减、跨洲网络延迟、分片线性估算和离线缓冲均保留适用前提', () => {
  const cases = [
    { id: 'edge-a', subQuestions: [{ question_label: '问题1', reference_answer: '边缘预处理可将数据量降低100倍以上。' }] },
    { id: 'edge-b', subQuestions: [{ question_label: '问题2', reference_answer: '边缘预处理可将数据量降低100倍以上。' }] },
    { id: 'latency', subQuestions: [{ question_label: '问题2', reference_answer: '三个数据中心的跨洲网络延迟高达100-300ms。' }] },
    { id: 'billing', subQuestions: [{ question_label: '问题2', reference_answer: '每个执行器处理约10万商户的账单，理论耗时降至12分钟左右。' }] },
    { id: 'vehicle', subQuestions: [{ question_label: '问题3', reference_answer: '车辆离线消息缓冲区容量为100MB。' }] },
  ];
  const records = [
    {
      recordId: 'edge-reduction',
      disposition: 'unsubstantiated-performance-claim',
      targets: [
        { itemId: 'edge-a:问题1', field: 'reference_answer', claimNeedle: '将数据量降低100倍以上' },
        { itemId: 'edge-b:问题2', field: 'reference_answer', claimNeedle: '将数据量降低100倍以上' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'cross-region',
      disposition: 'illustrative-parameter-needs-context',
      targets: [{ itemId: 'latency:问题2', field: 'reference_answer', claimNeedle: '跨洲网络延迟高达100-300ms' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'billing',
      disposition: 'assumption-sensitive-calculation',
      targets: [
        { itemId: 'billing:问题2', field: 'reference_answer', claimNeedle: '每个执行器处理约10万商户的账单' },
        { itemId: 'billing:问题2', field: 'reference_answer', claimNeedle: '理论耗时降至12分钟左右' },
      ],
      sourceEvidence: [],
      answerVerification: 'calculation-only',
    },
    {
      recordId: 'vehicle-buffer',
      disposition: 'illustrative-parameter-needs-context',
      targets: [{ itemId: 'vehicle:问题3', field: 'reference_answer', claimNeedle: '容量为100MB' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases, essays: [] },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 4);
  assert.equal(report.counts.targetClaims, 6);
  assert.equal(report.counts.exactTextTargetsMatched, 6);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 4);
  assert.equal(report.counts.recordsWithAllowedVerification, 4);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('软件维护类型分布比例标记为历史教学估计，并保留来源边界', () => {
  const essays = [{
    id: 'maintenance-essay',
    writingPoints: '改正性维护（约20%）；适应性维护（约25%）；完善性维护（约50%）；预防性维护（约5%）。',
  }];
  const records = [{
    recordId: 'maintenance-distribution',
    disposition: 'supported-with-scope',
    targets: [
      { itemId: 'maintenance-essay', field: 'writingPoints', claimNeedle: '改正性维护（约20%）' },
      { itemId: 'maintenance-essay', field: 'writingPoints', claimNeedle: '适应性维护（约25%）' },
      { itemId: 'maintenance-essay', field: 'writingPoints', claimNeedle: '完善性维护（约50%）' },
      { itemId: 'maintenance-essay', field: 'writingPoints', claimNeedle: '预防性维护（约5%）' },
    ],
    sourceEvidence: [
      {
        url: 'https://www.albany.edu/faculty/offutt/classes/maintEssays/maintEvolutionOverview.html',
        title: 'Overview of Software Maintenance and Evolution',
        publisher: 'University at Albany course reference by Jeff Offutt',
        sourceKind: 'academic-course-reference',
        checkedOn: '2026-10-14',
        supports: '课程参考将传统教材比例说明为历史估计，并提示研究年代较早。',
        limitations: '不证明这些比例适用于所有现代项目。',
      },
      {
        url: 'https://www.dequidt.me/teaching/software-maintenance/lectures/010_intro/',
        title: 'Introduction to Software Maintenance',
        publisher: 'Software maintenance course notes',
        sourceKind: 'educational-course-notes',
        checkedOn: '2026-10-14',
        supports: '课程笔记将该分布作为近似教学规则。',
        limitations: '不构成现代组织的独立统计调查。',
      },
    ],
    answerVerification: 'not-established',
  }];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases: [], essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 4);
  assert.equal(report.counts.exactTextTargetsMatched, 4);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.sourceEntries, 2);
  assert.equal(report.counts.recordsWithAllowedDisposition, 1);
  assert.equal(report.counts.recordsWithAllowedVerification, 1);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('同一案例参考答案挂载到多个小问时，各子题中的风险文本都可单独定位', () => {
  const answer = '该服务的部署工具在2025年3月31日退役；不能将5分钟内修复bug视为有依据的交付保证。';
  const bank = {
    choices: [],
    cases: [{
      id: 'case',
      subQuestions: [
        { question_label: '问题1', reference_answer: answer },
        { question_label: '问题2', reference_answer: answer },
        { question_label: '问题3', reference_answer: '其他内容' },
      ],
    }],
    essays: [],
  };
  const report = auditClaimEvidenceRegister(bank, { records: [{
    recordId: 'retired-dependency',
    disposition: 'retired-technology-needs-context',
    targets: [
      { itemId: 'case:问题1', field: 'reference_answer', claimNeedle: '5分钟内修复bug' },
      { itemId: 'case:问题2', field: 'reference_answer', claimNeedle: '5分钟内修复bug' },
    ],
    sourceEvidence: [],
    answerVerification: 'not-established',
  }] });
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 2);
  assert.equal(report.counts.exactTextTargetsMatched, 2);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.duplicateTargetTuples, 0);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('大模型权重容量、量化表现、特征时延与沙箱限额区分计算和实测', () => {
  const cases = [
    { id: 'llm', subQuestions: [{ question_label: '问题1', reference_answer: '原始：70B模型 × 4字节/参数 = 280GB显存需求（单卡A100仅80GB）；INT8：70B模型 × 1字节/参数 = 70GB显存；INT4：70B模型 × 0.5字节/参数 = 35GB显存；INT8速度2-3x、精度损失0.5-1%；INT4速度4-5x、精度损失2-3%。' }] },
    { id: 'feature', subQuestions: [{ question_label: '问题2', reference_answer: '响应时间：p50 < 10ms, p99 < 50ms' }] },
    { id: 'realtime', subQuestions: [{ question_label: '问题1', reference_answer: 'result = mlModel.predict(df) // 100ms内返回' }] },
    { id: 'judge', subQuestions: [{ question_label: '问题2', reference_answer: '每次代码执行限制CPU时间（如5秒）和Wall时间（如10秒）；限制进程内存使用（如256MB）。' }] },
    { id: 'canary', subQuestions: [{ question_label: '问题3', reference_answer: '第一阶段：5%流量使用新规则' }] },
  ];
  const records = [
    { recordId: 'weights', disposition: 'assumption-sensitive-calculation', targets: [
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: '原始：70B模型 × 4字节/参数 = 280GB显存需求' },
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: 'INT8：70B模型 × 1字节/参数 = 70GB显存' },
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: 'INT4：70B模型 × 0.5字节/参数 = 35GB显存' },
    ], sourceEvidence: [], answerVerification: 'calculation-only' },
    { recordId: 'quantization', disposition: 'unsubstantiated-performance-claim', targets: [
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: '2-3x' },
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: '0.5-1%' },
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: '4-5x' },
      { itemId: 'llm:问题1', field: 'reference_answer', claimNeedle: '2-3%' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'feature-store', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'feature:问题2', field: 'reference_answer', claimNeedle: 'p50 < 10ms' },
      { itemId: 'feature:问题2', field: 'reference_answer', claimNeedle: 'p99 < 50ms' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'realtime', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'realtime:问题1', field: 'reference_answer', claimNeedle: '100ms内返回' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'judge', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'judge:问题2', field: 'reference_answer', claimNeedle: 'CPU时间（如5秒）' },
      { itemId: 'judge:问题2', field: 'reference_answer', claimNeedle: 'Wall时间（如10秒）' },
      { itemId: 'judge:问题2', field: 'reference_answer', claimNeedle: '限制进程内存使用（如256MB）' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'canary', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'canary:问题3', field: 'reference_answer', claimNeedle: '第一阶段：5%流量使用新规则' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
  ];
  const report = auditClaimEvidenceRegister({ choices: [], cases, essays: [] }, { reviewedOn: '2026-10-14', records });
  assert.equal(report.counts.records, 6);
  assert.equal(report.counts.targetClaims, 14);
  assert.equal(report.counts.exactTextTargetsMatched, 14);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 6);
  assert.equal(report.counts.recordsWithAllowedVerification, 6);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('可靠性目标、风控阈值、服务SLO与第三方真题复原率均保留证据边界', () => {
  const cases = [
    { id: 'redis', subQuestions: [{ question_label: '问题1', reference_answer: 'everysec策略下最多只丢失1秒数据。' }] },
    { id: 'fraud', subQuestions: ['问题1', '问题2', '问题3'].map(question_label => ({ question_label, reference_answer: '超过用户历史平均3倍时↑风险。' })) },
    { id: 'llm', subQuestions: ['问题1', '问题2', '问题3'].map(question_label => ({ question_label, reference_answer: 'Gold    P99<100ms，>1000req/s，99.99%可用性。' })) },
    { id: 'source', subQuestions: [{ question_label: '问题3', reference_answer: 'CSDN页面标题：2024上半年真题-复原程度90%。' }] },
  ];
  const essays = [{ id: 'mtbf', writingPoints: '确定可靠性目标（如MTBF ≥ 1000小时）；目标设定：MTBF ≥ 500小时。' }];
  const records = [
    {
      recordId: 'redis',
      disposition: 'durability-bound-overstatement',
      targets: [{ itemId: 'redis:问题1', field: 'reference_answer', claimNeedle: '最多只丢失1秒数据' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'mtbf',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'mtbf', field: 'writingPoints', claimNeedle: '确定可靠性目标（如MTBF ≥ 1000小时）' },
        { itemId: 'mtbf', field: 'writingPoints', claimNeedle: '目标设定：MTBF ≥ 500小时' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'fraud',
      disposition: 'illustrative-parameter-needs-context',
      targets: ['问题1', '问题2', '问题3'].map(q => ({ itemId: 'fraud:' + q, field: 'reference_answer', claimNeedle: '超过用户历史平均3倍时↑风险' })),
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'llm-slo',
      disposition: 'illustrative-parameter-needs-context',
      targets: ['问题1', '问题2', '问题3'].flatMap(q => [
        { itemId: 'llm:' + q, field: 'reference_answer', claimNeedle: 'Gold    P99<100ms' },
        { itemId: 'llm:' + q, field: 'reference_answer', claimNeedle: '>1000req/s' },
        { itemId: 'llm:' + q, field: 'reference_answer', claimNeedle: '99.99%' },
      ]),
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'source-completeness',
      disposition: 'unverified-source-completeness-estimate',
      targets: [{ itemId: 'source:问题3', field: 'reference_answer', claimNeedle: '2024上半年真题-复原程度90%' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases, essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 5);
  assert.equal(report.counts.targetClaims, 16);
  assert.equal(report.counts.exactTextTargetsMatched, 16);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 5);
  assert.equal(report.counts.recordsWithAllowedVerification, 5);
  assert.equal(report.counts.invalidRecords, 0);
});

test('车联网、采样、流处理和运维阈值均保留情境边界', () => {
  const cases = [
    { id: 'v2x', subQuestions: [
      { question_label: '问题1', reference_answer: '本地MQTT Broker转发区域内V2V消息（延迟<20ms）。' },
      { question_label: '问题2', reference_answer: '紧急制动预警要求端到端<20ms。' },
      { question_label: '问题3', reference_answer: '| P0（紧急） | 紧急制动预警、碰撞告警 | — | <20ms |' },
    ] },
    { id: 'tracing', subQuestions: [
      { question_label: '问题1', reference_answer: '头部采样可采用概率采样（如采样率10%）。' },
      { question_label: '问题2', reference_answer: '头部采样可采用概率采样（如采样率10%）。' },
    ] },
    { id: 'flink', subQuestions: [
      { question_label: '问题1', reference_answer: 'Flink滑动窗口：5分钟窗口，1分钟滑动步长。' },
      { question_label: '问题2', reference_answer: 'Flink滑动窗口：5分钟窗口，1分钟滑动步长。' },
    ] },
    { id: 'prediction', subQuestions: [{ question_label: '问题3', reference_answer: '预测某设备7天内故障概率>80%。' }] },
    { id: 'tenant', subQuestions: [
      { question_label: '问题1', reference_answer: '大租户（用户数>1000，约占5%）。' },
      { question_label: '问题2', reference_answer: '大租户（用户数>1000，约占5%）。' },
    ] },
    { id: 'slow-query', subQuestions: [{ question_label: '问题3', reference_answer: '对超过2秒的查询自动告警。' }] },
    { id: 'preload', subQuestions: [{ question_label: '问题1', reference_answer: '考试开始前10分钟预加载试卷，在考试前30分钟自动扩容。' }] },
    { id: 'rice', subQuestions: [{ question_label: '问题1', reference_answer: 'Confidence: 90%（功能相对独立）。' }] },
  ];
  const essays = [
    { id: 'maintenance', writingPoints: '确定可靠性目标（如MTBF ≥ 1000小时）。' },
    { id: 'faas', writingPoints: '单次函数执行时间有上限（如15分钟）。' },
  ];
  const choices = [{ id: 'lambda', analysis: '例如AWS Lambda 15分钟。' }];
  const records = [
    { recordId: 'v2x', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'v2x:问题1', field: 'reference_answer', claimNeedle: '本地MQTT Broker转发区域内V2V消息（延迟<20ms）' },
      { itemId: 'v2x:问题2', field: 'reference_answer', claimNeedle: '紧急制动预警要求端到端<20ms' },
      { itemId: 'v2x:问题3', field: 'reference_answer', claimNeedle: '| P0（紧急） | 紧急制动预警、碰撞告警 | — | <20ms |' },
    ], sourceEvidence: [{
      url: 'https://www.etsi.org/deliver/etsi_ts/122100_122199/122186/16.02.00_60/ts_122186v160200p.pdf',
      title: 'Service requirements for enhanced V2X scenarios',
      publisher: 'ETSI / 3GPP',
      sourceKind: 'technical-standard',
      checkedOn: '2026-10-14',
      supports: '不同V2X场景具有不同最大端到端时延要求，包括部分场景10ms、20ms以及更大的值。',
      limitations: '不能据此证明所有MEC/MQTT路径通用达到20ms。',
    }], answerVerification: 'not-established' },
    { recordId: 'tracing', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'tracing:问题1', field: 'reference_answer', claimNeedle: '采样率10%' },
      { itemId: 'tracing:问题2', field: 'reference_answer', claimNeedle: '采样率10%' },
    ], sourceEvidence: [{
      url: 'https://opentelemetry.io/docs/languages/js/sampling/',
      title: 'Sampling',
      publisher: 'OpenTelemetry official documentation',
      sourceKind: 'official-project-documentation',
      checkedOn: '2026-10-14',
      supports: 'TraceIdRatioBasedSampler支持配置采样比例，例如10%。',
      limitations: '比例可配置，SDK默认行为并不统一；10%并非所有服务的最佳比例。',
    }], answerVerification: 'not-established' },
    { recordId: 'flink', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'flink:问题1', field: 'reference_answer', claimNeedle: 'Flink滑动窗口：5分钟窗口，1分钟滑动步长' },
      { itemId: 'flink:问题2', field: 'reference_answer', claimNeedle: 'Flink滑动窗口：5分钟窗口，1分钟滑动步长' },
    ], sourceEvidence: [{
      url: 'https://nightlies.apache.org/flink/flink-docs-stable/api/java/org/apache/flink/streaming/api/windowing/assigners/SlidingEventTimeWindows.html',
      title: 'SlidingEventTimeWindows',
      publisher: 'Apache Flink official documentation',
      sourceKind: 'official-project-documentation',
      checkedOn: '2026-10-14',
      supports: '滑动窗口显式配置窗口大小与滑动间隔。',
      limitations: '文档不规定5分钟/1分钟是所有流处理场景的最佳值。',
    }], answerVerification: 'not-established' },
    { recordId: 'prediction', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'prediction:问题3', field: 'reference_answer', claimNeedle: '预测某设备7天内故障概率>80%' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'tenant', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'tenant:问题1', field: 'reference_answer', claimNeedle: '大租户（用户数>1000，约占5%）' },
      { itemId: 'tenant:问题2', field: 'reference_answer', claimNeedle: '大租户（用户数>1000，约占5%）' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'slow-query', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'slow-query:问题3', field: 'reference_answer', claimNeedle: '对超过2秒的查询自动告警' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'preload', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'preload:问题1', field: 'reference_answer', claimNeedle: '考试开始前10分钟' },
      { itemId: 'preload:问题1', field: 'reference_answer', claimNeedle: '在考试前30分钟自动扩容' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'rice', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'rice:问题1', field: 'reference_answer', claimNeedle: 'Confidence: 90%（功能相对独立）' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'maintenance', disposition: 'illustrative-parameter-needs-context', targets: [
      { itemId: 'maintenance', field: 'writingPoints', claimNeedle: 'MTBF ≥ 1000小时' },
    ], sourceEvidence: [], answerVerification: 'not-established' },
    { recordId: 'faas', disposition: 'supported-with-scope', targets: [
      { itemId: 'lambda', field: 'analysis', claimNeedle: 'AWS Lambda 15分钟' },
      { itemId: 'faas', field: 'writingPoints', claimNeedle: '单次函数执行时间有上限（如15分钟）' },
    ], sourceEvidence: [{
      url: 'https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html',
      title: 'Lambda quotas',
      publisher: 'AWS official documentation',
      sourceKind: 'vendor-documentation',
      checkedOn: '2026-10-14',
      supports: 'AWS Lambda普通函数超时上限是15分钟。',
      limitations: '该限制不能推广为所有FaaS平台或所有Lambda执行模式的通用限制。',
    }], answerVerification: 'not-established' },
  ];
  const report = auditClaimEvidenceRegister({ choices, cases, essays }, { reviewedOn: '2026-10-14', records });
  assert.equal(report.counts.records, 10);
  assert.equal(report.counts.targetClaims, 17);
  assert.equal(report.counts.exactTextTargetsMatched, 17);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.sourceEntries, 4);
  assert.equal(report.counts.recordsWithExternalSources, 4);
  assert.equal(report.counts.recordsWithAllowedDisposition, 10);
  assert.equal(report.counts.recordsWithAllowedVerification, 10);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});

test('MQTT QoS 2、Redis幂等TTL与Flink异常阈值均保留协议或场景边界', () => {
  const cases = [
    { id: 'mqtt', subQuestions: [
      { question_label: '问题1', reference_answer: 'MQTT QoS 2本身通过四步握手实现Exactly Once语义；MQTT QoS 2保证必达。' },
      { question_label: '问题2', reference_answer: 'MQTT QoS 2本身通过四步握手实现Exactly Once语义；MQTT QoS 2保证必达。' },
      { question_label: '问题3', reference_answer: 'MQTT QoS 2本身通过四步握手实现Exactly Once语义；MQTT QoS 2保证必达。' },
    ] },
    { id: 'redis', subQuestions: [
      { question_label: '问题1', reference_answer: '设置合理的过期时间（如24小时）。' },
      { question_label: '问题2', reference_answer: '设置合理的过期时间（如24小时）。' },
    ] },
    { id: 'flink', subQuestions: [
      { question_label: '问题1', reference_answer: '偏离3σ以上视为异常；1分钟内振动值增长200%。' },
      { question_label: '问题2', reference_answer: '偏离3σ以上视为异常；1分钟内振动值增长200%。' },
    ] },
  ];
  const records = [
    {
      recordId: 'mqtt',
      disposition: 'overgeneralized',
      targets: [
        { itemId: 'mqtt:问题1', field: 'reference_answer', claimNeedle: 'MQTT QoS 2本身通过四步握手' },
        { itemId: 'mqtt:问题2', field: 'reference_answer', claimNeedle: 'MQTT QoS 2本身通过四步握手' },
        { itemId: 'mqtt:问题3', field: 'reference_answer', claimNeedle: 'MQTT QoS 2本身通过四步握手' },
        { itemId: 'mqtt:问题1', field: 'reference_answer', claimNeedle: 'MQTT QoS 2保证必达' },
        { itemId: 'mqtt:问题2', field: 'reference_answer', claimNeedle: 'MQTT QoS 2保证必达' },
        { itemId: 'mqtt:问题3', field: 'reference_answer', claimNeedle: 'MQTT QoS 2保证必达' },
      ],
      sourceEvidence: [{
        url: 'https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html',
        title: 'MQTT Version 5.0',
        publisher: 'OASIS MQTT Technical Committee',
        sourceKind: 'technical-standard',
        checkedOn: '2026-10-14',
        supports: 'QoS 2 provides exactly-once delivery at the MQTT protocol layer between one sender and one receiver.',
        limitations: 'This does not automatically ensure exactly-once application side effects or physical command execution.',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'redis-ttl',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'redis:问题1', field: 'reference_answer', claimNeedle: '设置合理的过期时间（如24小时）' },
        { itemId: 'redis:问题2', field: 'reference_answer', claimNeedle: '设置合理的过期时间（如24小时）' },
      ],
      sourceEvidence: [{
        url: 'https://redis.io/docs/latest/commands/set/',
        title: 'SET',
        publisher: 'Redis official documentation',
        sourceKind: 'official-project-documentation',
        checkedOn: '2026-10-14',
        supports: 'Redis SET supports NX and explicit EX/PX expiration values.',
        limitations: 'It does not prescribe 24 hours as a universal deduplication retention interval.',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'flink-3sigma',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'flink:问题1', field: 'reference_answer', claimNeedle: '偏离3σ以上视为异常' },
        { itemId: 'flink:问题2', field: 'reference_answer', claimNeedle: '偏离3σ以上视为异常' },
      ],
      sourceEvidence: [{
        url: 'https://itl.nist.gov/div898/handbook/pmc/section3/pmc32.htm',
        title: 'What are Variables Control Charts?',
        publisher: 'NIST/SEMATECH e-Handbook of Statistical Methods',
        sourceKind: 'government-standard-guidance',
        checkedOn: '2026-10-14',
        supports: 'Three-sigma control limits are used in process control and the expected outside-limit rate assumes a suitable distribution, commonly normal.',
        limitations: 'The source does not establish a fixed 3-sigma rule for arbitrary IoT time series; skew, dependence and baseline shifts can affect false alarms.',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'vibration-trigger',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'flink:问题1', field: 'reference_answer', claimNeedle: '1分钟内振动值增长200%' },
        { itemId: 'flink:问题2', field: 'reference_answer', claimNeedle: '1分钟内振动值增长200%' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases, essays: [] },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 4);
  assert.equal(report.counts.targetClaims, 12);
  assert.equal(report.counts.exactTextTargetsMatched, 12);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.sourceEntries, 3);
  assert.equal(report.counts.recordsWithExternalSources, 3);
  assert.equal(report.counts.recordsWithAllowedDisposition, 4);
  assert.equal(report.counts.recordsWithAllowedVerification, 4);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
  assert.ok(report.records.every(record => record.answerVerification === 'not-established'));
});

test('灰度比例、GPU利用率、论文SLO和项目成果均区分示例与实测', () => {
  const cases = [
    { id: 'istio', subQuestions: [{ question_label: '问题3', reference_answer: '按用户比例10%的流量导入v2。' }] },
    { id: 'gpu', subQuestions: [{ question_label: '问题3', reference_answer: '独占GPU的缺点是资源浪费（GPU利用率20%）。' }] },
    { id: 'rice', subQuestions: [
      { question_label: '问题1', reference_answer: 'Confidence: 90%（功能相对独立）。' },
      { question_label: '问题2', reference_answer: 'Confidence: 90%（功能相对独立）。' },
    ] },
  ];
  const essays = [
    { id: 'chaos', writingPoints: '建立稳态假设：请求成功率>99.9%、P99延迟<500ms。' },
    { id: 'quality', writingPoints: '响应度量可以写成延迟<2s、可用性99.99%。' },
    { id: 'test-coverage', writingPoints: '单元测试（覆盖率>80%）。' },
    { id: 'consistency', writingPoints: '项目背景：日交易量1000万+笔；用户规模5000万+；核心成果：实现交易数据零差错，系统可用性99.99%。' },
  ];
  const records = [
    {
      recordId: 'istio',
      disposition: 'illustrative-parameter-needs-context',
      targets: [{ itemId: 'istio:问题3', field: 'reference_answer', claimNeedle: '按用户比例10%的流量导入v2' }],
      sourceEvidence: [{
        url: 'https://istio.io/latest/docs/tasks/traffic-management/traffic-shifting/',
        title: 'Traffic Shifting',
        publisher: 'Istio official documentation',
        sourceKind: 'official-project-documentation',
        checkedOn: '2026-10-14',
        supports: 'Istio supports percentage-weighted traffic shifts for staged rollouts.',
        limitations: 'No universal canary ratio is prescribed.',
      }],
      answerVerification: 'not-established',
    },
    {
      recordId: 'gpu',
      disposition: 'illustrative-parameter-needs-context',
      targets: [{ itemId: 'gpu:问题3', field: 'reference_answer', claimNeedle: '资源浪费（GPU利用率20%）' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'chaos',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'chaos', field: 'writingPoints', claimNeedle: '请求成功率>99.9%' },
        { itemId: 'chaos', field: 'writingPoints', claimNeedle: 'P99延迟<500ms' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'quality',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'quality', field: 'writingPoints', claimNeedle: '延迟<2s' },
        { itemId: 'quality', field: 'writingPoints', claimNeedle: '可用性99.99%' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'coverage',
      disposition: 'illustrative-parameter-needs-context',
      targets: [{ itemId: 'test-coverage', field: 'writingPoints', claimNeedle: '单元测试（覆盖率>80%）' }],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'consistency-outcomes',
      disposition: 'unsubstantiated-performance-claim',
      targets: [
        { itemId: 'consistency', field: 'writingPoints', claimNeedle: '实现交易数据零差错' },
        { itemId: 'consistency', field: 'writingPoints', claimNeedle: '系统可用性99.99%' },
        { itemId: 'consistency', field: 'writingPoints', claimNeedle: '日交易量1000万+笔' },
        { itemId: 'consistency', field: 'writingPoints', claimNeedle: '用户规模5000万+' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
    {
      recordId: 'rice',
      disposition: 'illustrative-parameter-needs-context',
      targets: [
        { itemId: 'rice:问题1', field: 'reference_answer', claimNeedle: 'Confidence: 90%（功能相对独立）' },
        { itemId: 'rice:问题2', field: 'reference_answer', claimNeedle: 'Confidence: 90%（功能相对独立）' },
      ],
      sourceEvidence: [],
      answerVerification: 'not-established',
    },
  ];
  const report = auditClaimEvidenceRegister(
    { choices: [], cases, essays },
    { reviewedOn: '2026-10-14', records },
  );
  assert.equal(report.counts.records, 7);
  assert.equal(report.counts.targetClaims, 13);
  assert.equal(report.counts.exactTextTargetsMatched, 13);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.sourceEntries, 1);
  assert.equal(report.counts.recordsWithExternalSources, 1);
  assert.equal(report.counts.recordsWithAllowedDisposition, 7);
  assert.equal(report.counts.recordsWithAllowedVerification, 7);
  assert.equal(report.counts.duplicateTargetRegistrations, 0);
  assert.equal(report.counts.invalidRecords, 0);
});
