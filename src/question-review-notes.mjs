// Local, question-specific study annotations. These notes never alter the
// imported bank, answer key, source classification, or approval state.
const NOTES = Object.freeze({
  "mock-2026年5月-模拟卷5-002": Object.freeze({
    sourceType: "mock",
    answerVerification: "not-established",
    humanSignOff: false,
    title: "MTBF / MTTF / MTTR：先统一可用性口径",
    label: "解析存在术语口径冲突",
    summary:
      "解析先使用 MTBF/(MTBF+MTTR) 算出 99.9%，随后又写“MTBF = MTTF + MTTR”并切换成 MTTF/(MTTF+MTTR)。NASA 资料表明这些缩写的具体定义取决于所引用的测量口径，不能把这条等式当成通用恒等式。",
    points: [
      "按 NASA 2008 Reliability-Centered Maintenance Guide §14.3，固有可用性 Ai = MTBF/(MTBF+MTTR)，该指南在本节将 MTBF 括注为 Mean Time Between Failure（also, Mean Time to Failure）。",
      "NASA 2018 NASA-HDBK-8709.22（引用 NASA-STD-8729.1）将固有可用性写为 MTTF/(MTTF+MTTR)，而运行可用性写为 MTBF/(MTBF+MDT)；手册同时在缩写表中分别列出 MTBF、MTTF 和 MTTR。",
      "NASA 2023 恒定失效率/修复率公式页给出 MTBF/(MTBF+MTTR)，但前提包括常数失效率、常数修复率和指数分布模型。",
      "解析末尾“MTTF/MTTR/MTBF 几乎每年必考 1 题”没有完整官方历年原卷序列和统计口径支撑，应视为作者押题判断，而不是已证实的考试规律。",
    ],
    takeaway:
      "本题按题干给定 MTBF=999 h、MTTR=1 h，并采用解析开头的固有可用性公式，算术 999/(999+1)=99.9% 成立。更严谨的解析应明确本题 MTBF 表示平均运行/故障间隔，并删去无条件的“MTBF = MTTF + MTTR”；若采用另一套标准口径，应重新定义变量，而不是在同一推导中静默换符号。",
    references: [
      {
        label: "NASA RCM Guide（2008）§14.3，印刷页 14-4",
        url: "https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf",
      },
      {
        label: "NASA-HDBK-8709.22（2018），缩写表及 §4 定义，PDF 第 16、28 页",
        url: "https://ntrs.nasa.gov/api/citations/20180004878/downloads/20180004878.pdf?attachment=true",
      },
      {
        label: "NASA 固有可用性公式（恒定失效率/修复率模型）",
        url: "https://www.nasa.gov/wp-content/uploads/2023/11/170508-formulas-inherent-availability-and-reliability-with-constant-failure-and-repair-rates.pdf",
      },
    ],
    boundary:
      "这是本地学习提示，不是官方真题出处证明，也不是整题答案的人工批准。题目仍标记为模拟题；答案核验状态仍为 not-established。不要把 NASA 各文档的定义推广成所有行业/标准通用的唯一术语口径。",
  }),
  "real-2020年下半年-003": Object.freeze({
    sourceType: "real",
    answerVerification: "calculation-only",
    humanSignOff: false,
    title: "位示图容量：GB/MB 的十进制与二进制口径",
    label: "答案依赖未明示的单位假设",
    summary:
      "题库解析按 1 GB=1024 MB、1 MB=1024 KB 计算得到 2400 个字，和选项 A 一致；但题干只写 GB、MB，没有声明二进制约定。SI 前缀 G/M 是十进制，IEC 二进制前缀应写 Gi/Mi。",
    points: [
      "按题库解析采用的二进制约定：块数 = 300×1024/4 = 76800；每块 1 bit，32 bit/字，因此 76800/32 = 2400 个字。",
      "按 SI 十进制 GB/MB：300 GB ÷ 4 MB = 75000 个块，需要 75000 bit；32 bit/字并向上取整，位示图需 2344 个字。该结果不在给出的选项中。",
      "BIPM 的 SI 前缀表定义 G=10^9、M=10^6；NIST 对 IEC 二进制前缀区分 Ki=2^10、Mi=2^20、Gi=2^30，并明确区分 1 MB=10^6 B 与 1 MiB=2^20 B。",
    ],
    takeaway:
      "现有选项强烈暗示出题者意图使用二进制容量换算，所以 A=2400 可在该约定下复算成立；但不能把 GB/MB 本身教成 1024 进制。严谨题干应写 GiB/MiB，或明确声明本题使用 1 GB=1024 MB 的历史约定。",
    references: [
      {
        label: "BIPM — SI prefixes（G=10^9、M=10^6）",
        url: "https://www.bipm.org/en/measurement-units/si-prefixes",
      },
      {
        label: "NIST — Definitions of the SI units: The binary prefixes（Ki/Mi/Gi 与 MB/GB 对照）",
        url: "https://physics.nist.gov/cuu/Units/binary.html",
      },
    ],
    boundary:
      "题库将该条标记为历年真题，但本提示不验证原卷版本或题面转录授权；第三方解析的选项答案仍不等同于官方答案认证。这里仅复算两套单位约定下的结果，答案核验状态为 calculation-only，且没有人工签核。",
  }),
});

export function questionReviewNoteFor(questionId) {
  const note = NOTES[String(questionId ?? "")];
  return note
    ? {
        ...note,
        points: [...note.points],
        references: note.references.map((item) => ({ ...item })),
      }
    : null;
}
