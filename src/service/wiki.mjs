// wiki 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { makeId } from "../utils.mjs";
import { embedDocument, cosine } from "../hash-embed.mjs";
import {
  bigramSimilarity,
  normalizeComparableText,
  resolveSourceNode,
  throwIfAborted,
} from "./helpers.mjs";
import { EssayDomain } from "./essay.mjs";

// 近重复判定阈值（余弦）。字符哈希嵌入下 0.9+ 基本可视为同义改写。
const NEAR_DUPLICATE_THRESHOLD = 0.9;

export class WikiDomain extends EssayDomain {
  async addWikiEntries({
    chapter,
    section = null,
    entries,
    sourceNode = null,
    signal,
    dedupe = true,
  }) {
    throwIfAborted(signal);
    const chapterId = Number(chapter);
    const createdAt = this.now();
    const normalized = entries.map((item, index) => {
      if (!item.title?.trim() || !item.summary?.trim()) {
        throw Object.assign(
          new Error(`Agent 返回的第 ${index + 1} 个知识点格式无效`),
          { status: 502 },
        );
      }
      return {
        id: makeId(`wiki-c${chapterId}`),
        chapter: chapterId,
        section,
        title: item.title.trim(),
        summary: item.summary.trim(),
        keyPoints: Array.isArray(item.key_points)
          ? item.key_points.map((p) => String(p).trim()).filter(Boolean)
          : [],
        commonMistakes: Array.isArray(item.common_mistakes)
          ? item.common_mistakes.map((p) => String(p).trim()).filter(Boolean)
          : [],
        related: Array.isArray(item.related)
          ? item.related.map((p) => String(p).trim()).filter(Boolean)
          : [],
        sourceNode: resolveSourceNode(sourceNode, item.source_node),
        status: "draft",
        createdAt,
        updatedAt: createdAt,
      };
    });
    return this.store.update((state) => {
      throwIfAborted(signal);
      // 同名条目（按归一化标题）视为重复：批内与既有条目都不重复才收入，
      // 与 wikiLint 的 duplicate_title 判定保持一致。
      // dedupe: false 供测试/数据修复场景绕过，正常生成路径始终开启。
      const seen = new Set();
      const accepted = [];
      for (const item of normalized) {
        if (dedupe) {
          const key = normalizeComparableText(item.title);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          if (
            state.wikiEntries.some(
              (existing) => normalizeComparableText(existing.title) === key,
            )
          ) {
            continue;
          }
        }
        accepted.push(item);
      }
      state.wikiEntries.push(...accepted);
      return accepted;
    });
  }

  wikiList() {
    const state = this.store.snapshot();
    const entries = state.wikiEntries;
    // 建立标题 -> 条目 的映射，用于双向链接匹配。
    const byTitle = new Map();
    for (const entry of entries) {
      byTitle.set(normalizeComparableText(entry.title), entry);
    }
    return entries.map((entry) => {
      // links：与 related 一一对应，related 能解析到现有条目的返回其 id，否则为 null。
      const links = (entry.related ?? []).map(
        (name) => this.resolveWikiEntry(name, { entries })?.id ?? null,
      );
      // backlinks：引用当前条目的其他条目。
      const backlinks = entries
        .filter((other) => other.id !== entry.id)
        .filter((other) =>
          (other.related ?? []).some(
            (name) =>
              normalizeComparableText(name) ===
              normalizeComparableText(entry.title),
          ),
        )
        .map((other) => ({ id: other.id, title: other.title }));
      return { ...entry, links, backlinks };
    });
  }

  // 条目文本向量（标题+摘要+要点+误区），供相关推荐与近重复检测使用。
  wikiEntryVectors(entries) {
    const vectors = new Map();
    for (const entry of entries) {
      vectors.set(
        entry.id,
        embedDocument([
          entry.title,
          entry.title,
          entry.summary,
          entry.keyPoints ?? [],
          entry.commonMistakes ?? [],
        ]),
      );
    }
    return vectors;
  }

  // 相关条目推荐：嵌入余弦相似度排序，排除自身与已关联条目。
  relatedWikiSuggestions({ entryId, limit = 5 } = {}) {
    const entries = this.store.snapshot().wikiEntries ?? [];
    const vectors = this.wikiEntryVectors(entries);
    const target = vectors.get(entryId);
    if (!target) return [];
    const self = entries.find((entry) => entry.id === entryId);
    const linked = new Set(
      (self?.related ?? []).map(
        (name) => this.resolveWikiEntry(name, { entries })?.id,
      ),
    );
    return entries
      .filter((entry) => entry.id !== entryId && !linked.has(entry.id))
      .map((entry) => ({ entry, score: cosine(target, vectors.get(entry.id)) }))
      .filter((item) => item.score > 0.05)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(10, Number(limit) || 5)))
      .map(({ entry, score }) => ({
        id: entry.id,
        title: entry.title,
        chapter: entry.chapter,
        score: Math.round(score * 1000) / 1000,
      }));
  }

  // 问答检索：问题 → 候选条目排序（词面重合 + 嵌入余弦混合）。
  // 返回前 limit 条；全部得分过低时返回空数组，由调用方弃答。
  rankWikiEntriesForQuestion(question, { entries = null, limit = 12 } = {}) {
    const pool = entries ?? this.store.snapshot().wikiEntries ?? [];
    if (!pool.length) return [];
    const vectors = this.wikiEntryVectors(pool);
    const queryVector = embedDocument([question, question]);
    const terms = normalizeComparableText(question);
    const scored = pool.map((entry) => {
      const titleNorm = normalizeComparableText(entry.title);
      const bodyNorm = normalizeComparableText(
        [entry.summary, ...(entry.keyPoints ?? [])].join(""),
      );
      // 词面分：标题命中权重 3，正文命中权重 1（包含关系）。
      const lexical =
        (titleNorm && terms && (titleNorm.includes(terms) || terms.includes(titleNorm)) ? 3 : 0) +
        (bodyNorm && terms && bodyNorm.includes(terms) ? 1 : 0);
      const semantic = cosine(queryVector, vectors.get(entry.id));
      return { entry, score: lexical + semantic * 2 };
    });
    return scored
      .filter((item) => item.score > 0.04)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(20, Number(limit) || 12)))
      .map(({ entry, score }) => ({ ...entry, retrievalScore: Math.round(score * 1000) / 1000 }));
  }

  // 名称 → 条目解析：精确匹配优先，其次互相包含（≥4 字），最后 bigram 相似度兜底。
  resolveWikiEntry(name, { entries = null, threshold = 0.6 } = {}) {
    const nameNorm = normalizeComparableText(name);
    if (!nameNorm) return null;
    const pool = entries ?? this.store.snapshot().wikiEntries ?? [];
    for (const entry of pool) {
      if (normalizeComparableText(entry.title) === nameNorm) return entry;
    }
    for (const entry of pool) {
      const titleNorm = normalizeComparableText(entry.title);
      if (
        nameNorm.length >= 4 &&
        titleNorm.length >= 4 &&
        (titleNorm.includes(nameNorm) || nameNorm.includes(titleNorm))
      ) {
        return entry;
      }
    }
    let best = null;
    if (nameNorm.length >= 4) {
      for (const entry of pool) {
        const score = bigramSimilarity(
          nameNorm,
          normalizeComparableText(entry.title),
        );
        if (score >= threshold && (!best || score > best.score)) {
          best = { entry, score };
        }
      }
    }
    return best?.entry ?? null;
  }

  // 按知识点标题为判分结果匹配 Wiki 条目：先精确匹配，再用模糊匹配补位。
  matchWikiEntries(titles = [], limit = 3) {
    const entries = this.store.snapshot().wikiEntries ?? [];
    const norms = (Array.isArray(titles) ? titles : [])
      .map((title) => normalizeComparableText(title))
      .filter(Boolean);
    const matched = [];
    const seen = new Set();
    const pick = (predicate) => {
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        const titleNorm = normalizeComparableText(entry.title);
        if (!titleNorm) continue;
        if (predicate(titleNorm)) {
          seen.add(entry.id);
          matched.push({ id: entry.id, title: entry.title });
        }
      }
    };
    pick((titleNorm) => norms.some((kp) => kp === titleNorm));
    pick(
      (titleNorm) =>
        titleNorm.length >= 4 &&
        norms.some(
          (kp) =>
            kp.length >= 4 && (titleNorm.includes(kp) || kp.includes(titleNorm)),
        ),
    );
    pick(
      (titleNorm) =>
        titleNorm.length >= 4 &&
        norms.some(
          (kp) =>
            kp.length >= 4 && bigramSimilarity(kp, titleNorm) >= 0.6,
        ),
    );
    return matched.slice(0, limit);
  }

  // 为知识点/来源节点匹配相关 Wiki 条目（错题本与判分共用）。
  // wikiEntries 允许调用方传入已有的快照切片，避免逐条错题重复全量深拷贝。
  relatedWikiEntries(
    { knowledgePoint = "", sourceNode = "", limit = 3 } = {},
    wikiEntries = null,
  ) {
    const entries = wikiEntries ?? this.store.snapshot().wikiEntries ?? [];
    const kpNorm = normalizeComparableText(knowledgePoint);
    const sourceNorm = normalizeComparableText(sourceNode);
    return entries
      .filter((entry) => {
        const titleNorm = normalizeComparableText(entry.title);
        const entrySourceNorm = normalizeComparableText(entry.sourceNode);
        if (kpNorm && titleNorm === kpNorm) return true;
        if (sourceNorm && entrySourceNorm === sourceNorm) return true;
        // 模糊匹配：知识点标题与 Wiki 条目标题互相包含（长度足够时）。
        if (kpNorm && titleNorm) {
          if (kpNorm.length >= 4 && titleNorm.includes(kpNorm)) return true;
          if (titleNorm.length >= 4 && kpNorm.includes(titleNorm)) return true;
        }
        return false;
      })
      .slice(0, limit)
      .map((entry) => ({ id: entry.id, title: entry.title }));
  }

  // Wiki 自检（Lint）：同名条目、断链引用、孤立条目、缺溯源、语义近重复，并给出修复建议。
  wikiLint() {
    const entries = this.store.snapshot().wikiEntries ?? [];
    const byTitle = new Map();
    const firstByTitle = new Map();
    for (const entry of entries) {
      const titleNorm = normalizeComparableText(entry.title);
      byTitle.set(titleNorm, (byTitle.get(titleNorm) ?? 0) + 1);
      if (!firstByTitle.has(titleNorm)) firstByTitle.set(titleNorm, entry.id);
    }
    const vectors = this.wikiEntryVectors(entries);
    const issues = [];
    for (const entry of entries) {
      const titleNorm = normalizeComparableText(entry.title);
      const related = entry.related ?? [];
      const resolved = related.filter((name) =>
        byTitle.has(normalizeComparableText(name)),
      );
      const entryIssues = [];
      const suggestions = [];
      if ((byTitle.get(titleNorm) ?? 0) > 1) {
        entryIssues.push("duplicate_title");
      }
      if (related.length > resolved.length) {
        entryIssues.push("broken_related");
        for (const name of related) {
          if (byTitle.has(normalizeComparableText(name))) continue;
          const candidate = this.resolveWikiEntry(name, {
            entries,
            threshold: 0.4,
          });
          if (candidate && candidate.id !== entry.id) {
            suggestions.push({
              name,
              candidate: candidate.title,
              id: candidate.id,
            });
          }
        }
      }
      if (!entry.sourceNode) entryIssues.push("missing_source");
      // 语义近重复：标题不同但内容高度重合的条目（同义改写、重复生成）。
      if (!entryIssues.includes("duplicate_title")) {
        let nearDuplicate = null;
        for (const other of entries) {
          if (other.id === entry.id) continue;
          const score = cosine(vectors.get(entry.id), vectors.get(other.id));
          if (
            score >= NEAR_DUPLICATE_THRESHOLD &&
            (!nearDuplicate || score > nearDuplicate.score)
          ) {
            nearDuplicate = { entry: other, score };
          }
        }
        if (nearDuplicate) {
          entryIssues.push("near_duplicate");
          suggestions.push({
            name: nearDuplicate.entry.title,
            candidate: nearDuplicate.entry.title,
            id: nearDuplicate.entry.id,
            score: Math.round(nearDuplicate.score * 1000) / 1000,
          });
        }
      }
      const hasOutbound = resolved.some(
        (name) => firstByTitle.get(normalizeComparableText(name)) !== entry.id,
      );
      const hasInbound = entries.some(
        (other) =>
          other.id !== entry.id &&
          (other.related ?? []).some(
            (name) => normalizeComparableText(name) === titleNorm,
          ),
      );
      if (!hasInbound && !hasOutbound) entryIssues.push("orphan");
      if (entryIssues.length) {
        const mergeInto =
          byTitle.get(titleNorm) > 1 && firstByTitle.get(titleNorm) !== entry.id
            ? firstByTitle.get(titleNorm)
            : null;
        issues.push({
          id: entry.id,
          title: entry.title,
          issues: entryIssues,
          suggestions,
          mergeInto,
        });
      }
    }
    return { total: entries.length, problems: issues.length, issues };
  }

  // 修复断链引用：把解析不到的 related 名称替换为建议的现有条目标题。
  async fixWikiRelated({ entryId, name, candidate }) {
    return this.store.update((state) => {
      const entry = state.wikiEntries.find((item) => item.id === entryId);
      if (!entry)
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      const index = (entry.related ?? []).findIndex(
        (item) =>
          normalizeComparableText(item) === normalizeComparableText(name),
      );
      if (index === -1) {
        throw Object.assign(new Error("未找到要修复的引用"), { status: 400 });
      }
      entry.related[index] = String(candidate ?? "").trim();
      entry.updatedAt = this.now();
      return { entryId, fixed: true };
    });
  }

  // 同名条目合并：把来源条目的内容并入目标条目后删除来源。
  async mergeWikiEntry({ entryId, intoId }) {
    if (entryId === intoId) {
      throw Object.assign(new Error("不能合并到自身"), { status: 400 });
    }
    return this.store.update((state) => {
      const source = state.wikiEntries.find((item) => item.id === entryId);
      const target = state.wikiEntries.find((item) => item.id === intoId);
      if (!source || !target) {
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      }
      // 去重按归一化文本比较：只差标点/空格的近似重复要点只保留首个变体。
      const dedupe = (list) => {
        const seen = new Set();
        const result = [];
        for (const item of Array.isArray(list) ? list : []) {
          const text = String(item).trim();
          if (!text) continue;
          const key = normalizeComparableText(text);
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(text);
        }
        return result;
      };
      target.keyPoints = dedupe([
        ...(target.keyPoints ?? []),
        ...(source.keyPoints ?? []),
      ]);
      target.commonMistakes = dedupe([
        ...(target.commonMistakes ?? []),
        ...(source.commonMistakes ?? []),
      ]);
      target.related = dedupe([
        ...(target.related ?? []),
        ...(source.related ?? []),
      ]).filter(
        (name) =>
          normalizeComparableText(name) !== normalizeComparableText(target.title),
      );
      if (!target.sourceNode && source.sourceNode) {
        target.sourceNode = source.sourceNode;
      }
      state.wikiEntries = state.wikiEntries.filter(
        (item) => item.id !== entryId,
      );
      target.updatedAt = this.now();
      return { merged: entryId, into: intoId };
    });
  }

  // 编辑知识点条目：只更新调用方提供的字段。
  async updateWikiEntry({ entryId, updates }) {
    return this.store.update((state) => {
      const entry = state.wikiEntries.find((item) => item.id === entryId);
      if (!entry)
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      if (typeof updates.title === "string") entry.title = updates.title.trim();
      if (typeof updates.summary === "string")
        entry.summary = updates.summary.trim();
      if (Array.isArray(updates.keyPoints))
        entry.keyPoints = updates.keyPoints.map((p) => String(p).trim()).filter(Boolean);
      if (Array.isArray(updates.commonMistakes))
        entry.commonMistakes = updates.commonMistakes.map((p) => String(p).trim()).filter(Boolean);
      if (Array.isArray(updates.related))
        entry.related = updates.related.map((p) => String(p).trim()).filter(Boolean);
      if (typeof updates.aiCheckedAt === "string")
        entry.aiCheckedAt = updates.aiCheckedAt.trim() || null;
      if (typeof updates.aiCheckNote === "string")
        entry.aiCheckNote = updates.aiCheckNote.trim() || null;
      entry.updatedAt = this.now();
      return { entryId, saved: true };
    });
  }

  async setWikiStatus({ entryId, status }) {
    if (!["draft", "reviewed", "flagged"].includes(status)) {
      throw Object.assign(new Error("状态无效"), { status: 400 });
    }
    return this.store.update((state) => {
      const entry = state.wikiEntries.find((item) => item.id === entryId);
      if (!entry)
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      entry.status = status;
      entry.updatedAt = this.now();
      return { entryId, status };
    });
  }
}
