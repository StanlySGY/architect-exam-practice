const LEGACY_COMPATIBILITY_IDS = Object.freeze([
  '4.4.2',
  '6.2.3',
  '17.2.3',
  '19.3.5',
  '19.4.4',
]);

/**
 * Shared scope for learning-content audits. Chapter overview records and
 * legacy/parent compatibility mappings are reported explicitly, not silently
 * dropped from the denominator.
 */
export function buildLearningUnitScope(content) {
  const allUnits = Object.entries(content?.units ?? {});
  const chapterOverviewUnits = allUnits.filter(([, unit]) => unit?.source?.path === 'data/chapters.json');
  const legacyCompatibilityUnits = allUnits.filter(([id]) => LEGACY_COMPATIBILITY_IDS.includes(id));
  const excludedIds = new Set([
    ...chapterOverviewUnits.map(([id]) => id),
    ...legacyCompatibilityUnits.map(([id]) => id),
  ]);
  const units = allUnits.filter(([id]) => !excludedIds.has(id));

  const excludedUnits = {
    chapterOverview: {
      count: chapterOverviewUnits.length,
      ids: chapterOverviewUnits.map(([id]) => id),
      reason: 'navigation-only chapter overview records are not leaf learning units',
    },
    legacyCompatibilityMappings: {
      count: legacyCompatibilityUnits.length,
      ids: legacyCompatibilityUnits.map(([id]) => id),
      reason: 'legacy/parent compatibility mappings require separate source-to-topic reconciliation and are not counted as independent leaf units',
    },
  };

  return {
    allUnits,
    units,
    chapterOverviewUnits,
    legacyCompatibilityUnits,
    excludedIds,
    sourceUnitCount: allUnits.length,
    unitCount: units.length,
    excludedUnitCount: excludedIds.size,
    excludedUnits,
  };
}
