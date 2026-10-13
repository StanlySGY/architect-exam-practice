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
    }],
    answerVerification: 'not-established',
  }];
  const report = auditClaimEvidenceRegister(bank, { reviewedOn: '2026-10-13', records });
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 2);
  assert.equal(report.counts.exactTextTargetsMatched, 2);
  assert.equal(report.counts.recordsWithAllowedDisposition, 1);
  assert.equal(report.counts.recordsWithAllowedVerification, 1);
  assert.equal(report.counts.sourceEntries, 1);
  assert.equal(report.counts.recordsWithExternalSources, 1);
  assert.equal(report.counts.invalidRecords, 0);
});
