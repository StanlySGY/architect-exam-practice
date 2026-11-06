import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_SAMPLES_PER_TYPE = 10;
const TYPES = new Set(['case', 'essay']);
const ESSAY_DIMENSION_MAX = Object.freeze({
  '切合题意': 20,
  '观点正确': 20,
  '逻辑清晰': 15,
  '论据充分': 20,
  '语言流畅': 10,
  '格式规范': 15,
});

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function scorePercent(value, label) {
  const score = value?.score ?? value?.total_score;
  const maxScore = value?.maxScore ?? value?.max_score;
  if (!finite(score) || !finite(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) {
    throw new TypeError(label + ' must contain a valid score and positive maxScore');
  }
  return score / maxScore * 100;
}

function validateCaseBreakdown(value, label) {
  if (!Array.isArray(value?.results) || value.results.length === 0) {
    throw new TypeError(label + '.results must be a non-empty array');
  }
  const ids = new Set();
  const maxima = new Map();
  let scoreTotal = 0;
  let maxTotal = 0;
  for (const [index, row] of value.results.entries()) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    const score = row?.score;
    const max = row?.max;
    if (!id) throw new TypeError(label + '.results[' + index + '].id must be a non-empty string');
    if (ids.has(id)) throw new TypeError(label + '.results contains duplicate id: ' + id);
    if (!finite(score) || !finite(max) || max <= 0 || score < 0 || score > max) {
      throw new TypeError(label + '.results[' + index + '] must contain a valid score and positive max');
    }
    ids.add(id);
    maxima.set(id, max);
    scoreTotal += score;
    maxTotal += max;
  }
  const totalScore = value.total_score ?? value.score;
  const totalMax = value.max_score ?? value.maxScore;
  if (Math.abs(scoreTotal - totalScore) > 1e-9 || Math.abs(maxTotal - totalMax) > 1e-9) {
    throw new TypeError(label + ' total_score/max_score must equal the sums in results[]');
  }
  return { ids, maxima };
}

function validateEssayBreakdown(value, label) {
  const dimensions = value?.dimensions;
  const names = Object.keys(ESSAY_DIMENSION_MAX);
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)
    || Object.keys(dimensions).length !== names.length
    || names.some(name => !Object.hasOwn(dimensions, name))) {
    throw new TypeError(label + ' must contain exactly the six production essay dimensions');
  }
  let scoreTotal = 0;
  let maxTotal = 0;
  for (const name of names) {
    const dimension = dimensions[name];
    const score = dimension?.score;
    const max = dimension?.max;
    if (!finite(score) || !finite(max) || max !== ESSAY_DIMENSION_MAX[name] || score < 0 || score > max) {
      throw new TypeError(label + '.dimensions[' + name + '] has an invalid score or production max');
    }
    scoreTotal += score;
    maxTotal += max;
  }
  const totalScore = value.total_score ?? value.score;
  const totalMax = value.max_score ?? value.maxScore;
  if (Math.abs(scoreTotal - totalScore) > 1e-9 || Math.abs(maxTotal - totalMax) > 1e-9) {
    throw new TypeError(label + ' total_score/max_score must equal the sums in dimensions');
  }
}

function validateBreakdown(type, value, label) {
  return type === 'case'
    ? validateCaseBreakdown(value, label)
    : validateEssayBreakdown(value, label);
}

function componentScores(run) {
  const result = run?.result ?? run;
  const rows = Array.isArray(result?.components)
    ? result.components
    : Array.isArray(result?.results)
      ? result.results
      : Array.isArray(result?.dimensions)
        ? result.dimensions
        : result?.dimensions && typeof result.dimensions === 'object'
          ? Object.entries(result.dimensions).map(([name, value]) => ({ name, ...value }))
          : [];
  const output = [];
  for (const row of rows) {
    // Case result IDs identify subquestions, not shared rubric dimensions.
    const name = String(row?.name ?? row?.dimension ?? row?.criterion ?? '').trim();
    const score = row?.score ?? row?.total_score;
    const maxScore = row?.maxScore ?? row?.max_score ?? row?.max;
    if (name && finite(score) && finite(maxScore) && maxScore > 0 && score >= 0 && score <= maxScore) {
      output.push({ name, percent: score / maxScore * 100 });
    }
  }
  return output;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function humanIccA1(rows) {
  const n = rows.length;
  const k = 2;
  if (n < 2) return { value: null, status: 'insufficient-samples', meanSquares: null };
  const grand = mean(rows.flat());
  const rowMeans = rows.map(mean);
  const colMeans = [0, 1].map(col => mean(rows.map(row => row[col])));
  const msSubjects = k * rowMeans.reduce((sum, value) => sum + (value - grand) ** 2, 0) / (n - 1);
  const msRaters = n * colMeans.reduce((sum, value) => sum + (value - grand) ** 2, 0) / (k - 1);
  let residual = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) residual += (rows[i][j] - rowMeans[i] - colMeans[j] + grand) ** 2;
  }
  const msError = residual / ((n - 1) * (k - 1));
  const raterTerm = k * (msRaters - msError) / n;
  const denominator = msSubjects + (k - 1) * msError + raterTerm;
  const meanSquares = { subjects: msSubjects, raters: msRaters, residual: msError };
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(msSubjects), Math.abs(msError), Math.abs(raterTerm)) * 32;
  if (!Number.isFinite(denominator)) return { value: null, status: 'non-finite-denominator', meanSquares };
  if (Math.abs(denominator) <= tolerance) {
    return { value: null, status: 'undefined-zero-denominator', meanSquares };
  }
  const value = (msSubjects - msError) / denominator;
  if (!Number.isFinite(value)) return { value: null, status: 'non-finite-result', meanSquares };
  return { value, status: 'computed', meanSquares };
}

function validateSample(sample, index, duplicateId = false) {
  const errors = [];
  if (!sample || !TYPES.has(sample.type)) errors.push('type must be case or essay');
  if (typeof sample?.id !== 'string' || !sample.id.trim()) errors.push('id must be a non-empty anonymous sample string');
  if (duplicateId) errors.push('sample id must be unique across the intake file');
  if (!Array.isArray(sample?.humanRatings) || sample.humanRatings.length !== 2) {
    errors.push('exactly two independent humanRatings are required');
  } else {
    const raters = sample.humanRatings.map(rating => typeof rating?.raterId === 'string' ? rating.raterId.trim() : '');
    if (raters.some(value => !value) || new Set(raters).size !== 2) errors.push('human raterId values must be non-empty and distinct');
  }
  if (!sample?.adjudicated) errors.push('adjudicated score is required');
  if (!Array.isArray(sample?.aiRuns) || sample.aiRuns.length < 1) errors.push('at least one aiRun is required');
  if (!sample?.version || ['rubric', 'prompt', 'grader'].some(key => typeof sample.version[key] !== 'string' || !sample.version[key].trim())) {
    errors.push('version.rubric, version.prompt and version.grader are required');
  }
  try {
    if (Array.isArray(sample?.humanRatings)) {
      for (const [i, rating] of sample.humanRatings.entries()) scorePercent(rating, 'humanRatings[' + i + ']');
    }
    let adjudicatedBreakdown = null;
    if (sample?.adjudicated) {
      scorePercent(sample.adjudicated, 'adjudicated');
      if (TYPES.has(sample.type)) adjudicatedBreakdown = validateBreakdown(sample.type, sample.adjudicated, 'adjudicated');
    }
    if (Array.isArray(sample?.aiRuns)) {
      for (const [i, run] of sample.aiRuns.entries()) {
        const result = run?.result ?? run;
        scorePercent(result, 'aiRuns[' + i + ']');
        if (TYPES.has(sample.type)) {
          const runBreakdown = validateBreakdown(sample.type, result, 'aiRuns[' + i + ']');
          if (sample.type === 'case' && adjudicatedBreakdown) {
            const expectedIds = [...adjudicatedBreakdown.ids].sort();
            const actualIds = [...runBreakdown.ids].sort();
            if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)
              || expectedIds.some(id => Math.abs(adjudicatedBreakdown.maxima.get(id) - runBreakdown.maxima.get(id)) > 1e-9)) {
              throw new TypeError('aiRuns[' + i + '].results ids/maxima must match adjudicated.results');
            }
          }
        }
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  const threshold = sample?.passThresholdPct;
  if (threshold !== undefined && (!finite(threshold) || threshold < 0 || threshold > 100)) {
    errors.push('passThresholdPct must be between 0 and 100');
  }
  return errors.map(message => 'samples[' + index + ']: ' + message);
}

export function evaluateCalibration(input) {
  const samples = Array.isArray(input?.samples) ? input.samples : [];
  const metadataErrors = [];
  const inputErrors = Array.isArray(input?.samples) ? [] : ['samples must be an array'];
  if (typeof input?.metadata?.model !== 'string' || !input.metadata.model.trim()) metadataErrors.push('metadata.model is required');
  if (typeof input?.metadata?.modelVersion !== 'string' || !input.metadata.modelVersion.trim()) metadataErrors.push('metadata.modelVersion is required');
  const collectedAt = String(input?.metadata?.collectedAt ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(collectedAt)
    || Number.isNaN(Date.parse(collectedAt + 'T00:00:00Z'))
    || new Date(collectedAt + 'T00:00:00Z').toISOString().slice(0, 10) !== collectedAt) {
    metadataErrors.push('metadata.collectedAt must be a valid YYYY-MM-DD date');
  }

  const rejected = [];
  const validByType = { case: [], essay: [] };
  const idCounts = new Map();
  for (const sample of samples) {
    if (typeof sample?.id === 'string' && sample.id.trim()) {
      const id = sample.id.trim();
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
  }
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const id = typeof sample?.id === 'string' ? sample.id.trim() : '';
    const errors = validateSample(sample, index, Boolean(id && idCounts.get(id) > 1));
    if (errors.length) {
      rejected.push({ id: id || 'index-' + index, errors });
      continue;
    }
    validByType[sample.type].push(sample);
  }

  const byType = {};
  for (const type of ['case', 'essay']) {
    const rows = validByType[type];
    const versions = new Map();
    for (const sample of rows) {
      const key = JSON.stringify({ rubric: sample.version.rubric, prompt: sample.version.prompt, grader: sample.version.grader });
      versions.set(key, (versions.get(key) ?? 0) + 1);
    }
    if (versions.size > 1) {
      byType[type] = {
        sampleCount: rows.length,
        minimumExploratorySampleCount: MIN_SAMPLES_PER_TYPE,
        sufficientForExploratoryAnalysis: false,
        analysisBlockedReason: 'mixed rubric/prompt/grader versions must be evaluated in separate runs; scores are not pooled across versions',
        versionCohorts: [...versions.entries()].map(([version, sampleCount]) => ({ ...JSON.parse(version), sampleCount })),
        pointAgreement: null,
        humanAgreement: null,
        componentMeanAbsoluteErrorPp: null,
        componentSampleCounts: null,
        passFail: null,
        repeatedAiRunVariability: null,
      };
      continue;
    }

    const humanPairs = [];
    const raterPanels = new Set();
    const aiErrors = [];
    const perComponent = new Map();
    const runRanges = [];
    const thresholdChecks = [];
    const worst = [];

    for (const sample of rows) {
      const human = scorePercent(sample.adjudicated, 'adjudicated');
      const orderedRatings = [...sample.humanRatings].sort((a, b) => a.raterId < b.raterId ? -1 : a.raterId > b.raterId ? 1 : 0);
      raterPanels.add(JSON.stringify(orderedRatings.map(rating => rating.raterId)));
      const ratings = orderedRatings.map(rating => scorePercent(rating, 'human rating'));
      humanPairs.push(ratings);
      const aiScores = sample.aiRuns.map(run => scorePercent(run?.result ?? run, 'AI run'));
      const ai = mean(aiScores);
      const error = ai - human;
      aiErrors.push(error);
      worst.push({ id: sample.id, humanPct: human, aiMeanPct: ai, signedErrorPp: error, absoluteErrorPp: Math.abs(error), runCount: aiScores.length });
      if (aiScores.length > 1) runRanges.push(Math.max(...aiScores) - Math.min(...aiScores));

      const humanComponents = new Map(componentScores(sample.adjudicated).map(item => [item.name, item.percent]));
      const componentRunValues = new Map();
      for (const run of sample.aiRuns) {
        const thisRun = new Map();
        for (const component of componentScores(run)) {
          if (!humanComponents.has(component.name)) continue;
          if (!thisRun.has(component.name)) thisRun.set(component.name, []);
          thisRun.get(component.name).push(component.percent);
        }
        for (const [name, values] of thisRun) {
          if (!componentRunValues.has(name)) componentRunValues.set(name, []);
          componentRunValues.get(name).push(mean(values));
        }
      }
      for (const [name, values] of componentRunValues) {
        if (!perComponent.has(name)) perComponent.set(name, []);
        perComponent.get(name).push(mean(values) - humanComponents.get(name));
      }
      if (finite(sample.passThresholdPct)) {
        thresholdChecks.push({
          humanPass: human >= sample.passThresholdPct,
          aiMeanPass: ai >= sample.passThresholdPct,
          aiRunPasses: aiScores.map(score => score >= sample.passThresholdPct),
        });
      }
    }

    const absolute = aiErrors.map(Math.abs);
    worst.sort((a, b) => b.absoluteErrorPp - a.absoluteErrorPp);
    const within = limit => absolute.filter(value => value <= limit + 1e-9).length;
    const ratersDiff = humanPairs.map(pair => Math.abs(pair[0] - pair[1]));
    const icc = raterPanels.size > 1
      ? { value: null, status: 'inconsistent-rater-panel', meanSquares: null }
      : humanIccA1(humanPairs);
    const componentCounts = Object.fromEntries(
      [...perComponent.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, values.length])
    );
    byType[type] = {
      sampleCount: rows.length,
      minimumExploratorySampleCount: MIN_SAMPLES_PER_TYPE,
      sufficientForExploratoryAnalysis: rows.length >= MIN_SAMPLES_PER_TYPE,
      pointAgreement: {
        meanAbsoluteErrorPp: mean(absolute),
        signedBiasPp: mean(aiErrors),
        exactAgreementCount: absolute.filter(value => value <= 1e-9).length,
        within5PercentagePoints: within(5),
        within10PercentagePoints: within(10),
        maxAbsoluteErrorPp: absolute.length ? Math.max(...absolute) : null,
        worstSamples: worst.slice(0, 5),
      },
      humanAgreement: {
        method: 'ICC(A,1): two-way random-effects, absolute agreement, single measurement',
        iccA1: icc.value,
        iccA1Status: icc.status,
        iccA1MeanSquares: icc.meanSquares,
        raterPanelCohortCount: raterPanels.size,
        sampleCount: humanPairs.length,
        meanAbsoluteRaterDifferencePp: mean(ratersDiff),
      },
      componentMeanAbsoluteErrorPp: Object.fromEntries(
        [...perComponent.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, errors]) => [name, mean(errors.map(Math.abs))])
      ),
      componentSampleCounts: componentCounts,
      passFail: {
        thresholdedSampleCount: thresholdChecks.length,
        disagreementCount: thresholdChecks.filter(item => item.humanPass !== item.aiMeanPass).length,
        aiRunCount: thresholdChecks.reduce((sum, item) => sum + item.aiRunPasses.length, 0),
        aiRunDisagreementCount: thresholdChecks.reduce((sum, item) => sum + item.aiRunPasses.filter(value => value !== item.humanPass).length, 0),
        decisionBasis: 'disagreementCount compares the human decision with the mean AI score across runs; aiRunDisagreementCount compares every AI run separately',
      },
      repeatedAiRunVariability: {
        samplesWithRepeatedRuns: runRanges.length,
        meanRangePp: mean(runRanges),
        maxRangePp: runRanges.length ? Math.max(...runRanges) : null,
      },
    };
  }

  const insufficient = Object.entries(byType)
    .filter(([, result]) => !result.sufficientForExploratoryAnalysis)
    .map(([type, result]) => ({ type, validSampleCount: result.sampleCount, required: MIN_SAMPLES_PER_TYPE }));
  const status = insufficient.length || metadataErrors.length || inputErrors.length
    ? 'blocked-or-insufficient-anchor-samples'
    : 'exploratory-analysis-ready';
  return {
    reportVersion: 2,
    status,
    metadataErrors,
    inputErrors,
    limitations: [
      'Ten samples per answer type is an exploratory minimum, not certification or proof of exam-score predictiveness.',
      'Two independent human ratings and an adjudicated score are required for every sample; AI self-scores are not ground truth.',
      'Pass/fail disagreement is calculated only when a sample supplies an explicit passThresholdPct.',
      'Results apply only to the recorded model, prompt, grader and rubric versions; they do not establish future-version performance.',
      'ICC(A,1) is calculated only when the same two raters scored every sample; otherwise the ICC is withheld.',
      'Repeated AI runs are averaged within each sample before component MAE is averaged, so samples—not runs—receive equal weight.',
      'ICC is a point estimate without a confidence interval; small samples and restricted score ranges limit interpretation.',
    ],
    sampleCounts: {
      total: samples.length,
      validCase: validByType.case.length,
      validEssay: validByType.essay.length,
      rejected: rejected.length,
    },
    insufficient,
    byType,
    rejected,
  };
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath) {
    console.error('Usage: node scripts/evaluate-scoring-calibration.mjs <intake.json> [report.json]');
    process.exitCode = 64;
    return;
  }
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const report = evaluateCalibration(input);
  const serialized = JSON.stringify(report, null, 2) + '\n';
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
  }
  else process.stdout.write(serialized);
  if (report.status !== 'exploratory-analysis-ready') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
