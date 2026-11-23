export function computeDcg(relevances: number[], k: number): number {
  const limit = Math.min(k, relevances.length);
  let dcg = 0;
  for (let i = 0; i < limit; i++) {
    const rel = relevances[i] ?? 0;
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }
  return dcg;
}

export function computeNdcgAtK(
  orderedIds: string[],
  relevanceById: Map<string, number>,
  k: number = 10
): number {
  const predictedRels = orderedIds.slice(0, k).map((id) => relevanceById.get(id) ?? 0);
  const idealRels = Array.from(relevanceById.values()).sort((a, b) => b - a);
  const dcg = computeDcg(predictedRels, k);
  const idcg = computeDcg(idealRels, k);
  if (idcg === 0) return 1;
  return Math.round((dcg / idcg) * 10000) / 10000;
}

export function computeHardFilterMetrics(
  cases: Array<{ expectedPass: boolean; actualPass: boolean }>
): {
  total: number;
  correct: number;
  accuracy: number;
  falsePositives: number;
  falseNegatives: number;
} {
  let correct = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const c of cases) {
    if (c.expectedPass === c.actualPass) correct++;
    else if (!c.expectedPass && c.actualPass) falsePositives++;
    else falseNegatives++;
  }
  const total = cases.length;
  return {
    total,
    correct,
    accuracy: total > 0 ? Math.round((correct / total) * 10000) / 10000 : 1,
    falsePositives,
    falseNegatives
  };
}
