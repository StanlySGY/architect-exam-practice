import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_SAMPLES_PER_TYPE = 10;
const TYPES = new Set(['case', 'essay']);

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
    // Case grader result IDs are question identifiers, not a shared rubric
    // dimension. Only explicit names/dimensions are comparable across samples.
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
  if (n < 2) return null;
  const grand = mean(rows.flat());
  const rowMeans = rows.map(mean);
  const colMeans = [0, 1].map(col => mean(rows.map(row => row[col])));
  const msRows = k * rowMeans.reduce((sum, v) => sum + (v - grand) ** 2, 0) / (n - 1);
  const msCols = n * colMeans.reduce((sum, v) => sum + (v - grand) ** 2, 0) / (k - 1);
  let residual = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) residual += (rows[i][j] - rowMeans[i] - colMeans[j] + grand) ** 2;
  }
  const msError = residual / ((n - 1) * (k - 1));
  const denominator = msRows + (k - 1) * msError + k * (msCols - msError) / n;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return (msRows - msError) / denominator;
}

function validateSample(sample, index) {
  const errors = [];
  if (!sample || !TYPES.has(sample.type)) errors.push('type must be case or essay');
  if (!Array.isArray(sample?.humanRatings) || sample.humanRatings.length !== 2) {
    errors.push('exactly two independent humanRatings are required');
  } else {
    const raters = sample.humanRatings.map(rating => String(rating?.raterId ?? '').trim());
    if (raters.some(value => !value) || new Set(raters).size !== 2) errors.push('human raterId values must be non-empty and distinct');
  }
  if (!sample?.adjudicated) errors.push('adjudicated score is required');
  if (!Array.isArray(sample?.aiRuns) || sample.aiRuns.length < 1) errors.push('at least one aiRun is required');
  if (!sample?.version || !sample.version.rubric || !sample.version.prompt || !sample.version.grader) {
    errors.push('version.rubric, version.prompt and version.grader are required');
  }
  try {
    for (const [i, rating] of (sample?.humanRatings ?? []).entries()) scorePercent(rating, 'humanRatings[' + i + ']');
    if (sample?.adjudicated) scorePercent(sample.adjudicated, 'adjudicated');
    for (const [i, run] of (sample?.aiRuns ?? []).entries()) scorePercent(run?.result ?? run, 'aiRuns[' + i + ']');
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
  if (!String(input?.metadata?.model ?? '').trim()) metadataErrors.push('metadata.model is required');
  if (!String(input?.metadata?.modelVersion ?? '').trim()) metadataErrors.push('metadata.modelVersion is required');
  const collectedAt = String(input?.metadata?.collectedAt ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(collectedAt)
    || Number.isNaN(Date.parse(`${collectedAt}T00:00:00Z`))
    || new Date(`${collectedAt}T00:00:00Z`).toISOString().slice(0, 10) !== collectedAt) {
    metadataErrors.push('metadata.collectedAt must be a valid YYYY-MM-DD date');
  }
  const rejected = [];
  const validByType = { case: [], essay: [] };

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const errors = validateSample(sample, index);
    if (errors.length) {
      rejected.push({ id: sample?.id ?? 'index-' + index, errors });
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
        passFail: null,
        repeatedAiRunVariability: null,
      };
      continue;
    }
    const humanPairs = [];
    const aiErrors = [];
    const perComponent = new Map();
    const runRanges = [];
    const thresholdChecks = [];
    const worst = [];

    for (const sample of rows) {
      const human = scorePercent(sample.adjudicated, 'adjudicated');
      const ratings = sample.humanRatings.map(rating => scorePercent(rating, 'human rating'));
      humanPairs.push(ratings);
      const aiScores = sample.aiRuns.map(run => scorePercent(run?.result ?? run, 'AI run'));
      const ai = mean(aiScores);
      const error = ai - human;
      aiErrors.push(error);
      worst.push({ id: sample.id ?? '(unnamed)', humanPct: human, aiMeanPct: ai, signedErrorPp: error, absoluteErrorPp: Math.abs(error), runCount: aiScores.length });
      if (aiScores.length > 1) runRanges.push(Math.max(...aiScores) - Math.min(...aiScores));

      for (const run of sample.aiRuns) {
        for (const component of componentScores(run)) {
          const humanComponent = new Map(componentScores(sample.adjudicated).map(item => [item.name, item.percent])).get(component.name);
          if (humanComponent === undefined) continue;
          if (!perComponent.has(component.name)) perComponent.set(component.name, []);
          perComponent.get(component.name).push(component.percent - humanComponent);
        }
      }
      if (finite(sample.passThresholdPct)) {
        thresholdChecks.push({
          humanPass: human >= sample.passThresholdPct,
          aiPass: ai >= sample.passThresholdPct,
        });
      }
    }

    const absolute = aiErrors.map(Math.abs);
    worst.sort((a, b) => b.absoluteErrorPp - a.absoluteErrorPp);
    const within = limit => absolute.filter(value => value <= limit + 1e-9).length;
    const ratersDiff = humanPairs.map(pair => Math.abs(pair[0] - pair[1]));
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
        iccA1: humanIccA1(humanPairs),
        meanAbsoluteRaterDifferencePp: mean(ratersDiff),
      },
      componentMeanAbsoluteErrorPp: Object.fromEntries(
        [...perComponent.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, errors]) => [name, mean(errors.map(Math.abs))])
      ),
      passFail: {
        thresholdedSampleCount: thresholdChecks.length,
        disagreementCount: thresholdChecks.filter(item => item.humanPass !== item.aiPass).length,
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
  const status = insufficient.length || metadataErrors.length
    ? 'blocked-or-insufficient-anchor-samples'
    : 'exploratory-analysis-ready';
  return {
    reportVersion: 1,
    status,
    metadataErrors,
    limitations: [
      'Ten samples per answer type is an exploratory minimum, not certification or proof of exam-score predictiveness.',
      'Two independent human ratings and an adjudicated score are required for every sample; AI self-scores are not ground truth.',
      'Pass/fail disagreement is calculated only when a sample supplies an explicit passThresholdPct.',
      'Results apply only to the recorded model, prompt, grader and rubric versions; they do not establish future-version performance.',
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
