// 轻量"语义"向量：字符 bigram 哈希嵌入（特征哈希 + 符号技巧）。
// 无模型、零依赖、确定可复现；对中文短文本的近似重复与相关条目检索
// 明显优于纯 bigram 集合重合（保留词序信息、支持余弦打分）。
// 注意：这是词面相似度的增强，不是真正的语义嵌入；同义改写仍需人工校对。

const DIM = 256;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function hash32(token, seed) {
  let hash = seed || 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function* charBigrams(text) {
  for (let index = 0; index < text.length - 1; index += 1) {
    yield text.slice(index, index + 2);
  }
}

// 返回归一化后的稀疏加权向量（Map: 维度 → 权重）。权重 = 1 + log 词频。
export function embed(text) {
  const normalized = normalizeText(text);
  const counts = new Map();
  for (const gram of charBigrams(normalized)) {
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  // 单字也计入，缓解短标题 bigram 过少的问题。
  for (const char of normalized) {
    counts.set(`#${char}`, (counts.get(`#${char}`) ?? 0) + 0.5);
  }
  const vector = new Map();
  for (const [token, count] of counts) {
    const hash = hash32(token);
    const dimension = hash % DIM;
    const sign = (hash >>> 31) & 1 ? -1 : 1;
    const weight = sign * (1 + Math.log(count));
    vector.set(dimension, (vector.get(dimension) ?? 0) + weight);
  }
  let norm = 0;
  for (const weight of vector.values()) norm += weight * weight;
  norm = Math.sqrt(norm);
  if (!norm) return vector;
  for (const [dimension, weight] of vector) {
    vector.set(dimension, weight / norm);
  }
  return vector;
}

export function cosine(left, right) {
  if (!left?.size || !right?.size) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  for (const [dimension, weight] of small) {
    const other = large.get(dimension);
    if (other) dot += weight * other;
  }
  return dot;
}

// 文档 → 向量的便捷封装：拼接字段后嵌入，调用方可以缓存结果。
export function embedDocument(fields) {
  return embed(
    (Array.isArray(fields) ? fields : [])
      .flatMap((field) => (Array.isArray(field) ? field : [field]))
      .filter(Boolean)
      .join("\n"),
  );
}
