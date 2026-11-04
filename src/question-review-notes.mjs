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
