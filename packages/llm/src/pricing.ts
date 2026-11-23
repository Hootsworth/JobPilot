export interface PricingEstimate {
  estimatedCostUsd: number;
  knownPricing: boolean;
}

interface RatePerMillion {
  inputPer1M: number;
  outputPer1M: number;
}

// Best-effort prefix-matched USD rates per 1M tokens for usage dashboard visibility.
// Never gates model availability — unknown/preview models simply report knownPricing: false.
const PREFIX_RATES: Array<{ prefix: string; rates: RatePerMillion }> = [
  { prefix: 'gpt-4o-mini', rates: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { prefix: 'gpt-4o', rates: { inputPer1M: 2.5, outputPer1M: 10.0 } },
  { prefix: 'gpt-4.1-nano', rates: { inputPer1M: 0.1, outputPer1M: 0.4 } },
  { prefix: 'gpt-4.1-mini', rates: { inputPer1M: 0.4, outputPer1M: 1.6 } },
  { prefix: 'gpt-4.1', rates: { inputPer1M: 2.0, outputPer1M: 8.0 } },
  { prefix: 'o4-mini', rates: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  { prefix: 'o3-mini', rates: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  { prefix: 'gemini-2.5-flash-lite', rates: { inputPer1M: 0.1, outputPer1M: 0.4 } },
  { prefix: 'gemini-2.5-flash', rates: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  { prefix: 'gemini-2.5-pro', rates: { inputPer1M: 1.25, outputPer1M: 10.0 } },
  { prefix: 'gemini-2.0-flash', rates: { inputPer1M: 0.1, outputPer1M: 0.4 } },
  { prefix: 'llama-4', rates: { inputPer1M: 0.2, outputPer1M: 0.6 } },
  { prefix: 'llama-3.3', rates: { inputPer1M: 0.2, outputPer1M: 0.6 } }
];

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): PricingEstimate {
  const normalized = model.trim().toLowerCase().replace(/^models\//, '');
  const match = PREFIX_RATES.find((entry) => normalized.includes(entry.prefix));
  if (!match) {
    return { estimatedCostUsd: 0, knownPricing: false };
  }
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * match.rates.inputPer1M;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * match.rates.outputPer1M;
  return {
    estimatedCostUsd: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
    knownPricing: true
  };
}
