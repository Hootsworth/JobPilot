import { z } from 'zod';
import type { LlmProvider } from '@jobpilot/llm';
import type {
  FallbackFillFieldInput,
  FallbackFillRequest,
  FallbackFillResponse,
  FallbackFillSuggestion,
  MasterProfile,
  ProfileStory,
  SavedAnswer
} from '@jobpilot/shared';
import { CanonicalFieldKeySchema } from '@jobpilot/shared';

const LlmFallbackOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        fieldId: z.string(),
        canonicalKey: CanonicalFieldKeySchema.catch('unknown').default('unknown'),
        proposedValue: z.string(),
        confidence: z.number().min(0).max(1).default(0.7),
        rationale: z.string().default(''),
        groundedIn: z.string().default('')
      })
    )
    .default([])
});

function normalizeOptionText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function snapToAllowedOption(value: string, options: string[]): string | null {
  const valNorm = normalizeOptionText(value);
  if (!valNorm) return null;

  for (const opt of options) {
    if (normalizeOptionText(opt) === valNorm) return opt;
  }
  for (const opt of options) {
    const optNorm = normalizeOptionText(opt);
    if (optNorm && (optNorm.includes(valNorm) || valNorm.includes(optNorm))) {
      return opt;
    }
  }
  return null;
}

export async function runExtensionLlmFallbackFill(params: {
  request: FallbackFillRequest;
  profile: MasterProfile;
  stories: ProfileStory[];
  savedAnswers: SavedAnswer[];
  llmProvider: LlmProvider | null;
}): Promise<FallbackFillResponse> {
  if (!params.llmProvider) {
    return {
      suggestions: [],
      usedLlm: false,
      note: 'No active LLM provider key configured. Add an API key in Settings to enable LLM fallback field mapping.'
    };
  }

  const res = await params.llmProvider.generateStructured({
    schema: LlmFallbackOutputSchema,
    schemaName: 'extension_fallback_fill',
    taskType: 'form_draft',
    temperature: 0,
    maxTokens: 2500,
    systemPrompt: [
      'You are a strict, grounded form-field mapper and value filler for JobPilot.',
      'For each unresolved form field, map it ONLY using verified facts from the candidate Master Profile, India Profile, Story Bank, and Saved Answers.',
      'STRICT NON-HALLUCINATION RULES:',
      '1. NEVER invent skills, employers, titles, degrees, dates, colleges, phone numbers, or numeric metrics.',
      '2. If a field supplies an "options" array, proposedValue MUST be chosen verbatim from those options — or set proposedValue to "" if none match honestly.',
      '3. If the candidate profile lacks the required information for a field, set proposedValue to "".',
      '4. Respect maxLength when specified and explain exact profile provenance in "groundedIn".'
    ].join('\n'),
    userPrompt: JSON.stringify({
      atsAdapter: params.request.atsAdapter,
      targetJob: {
        title: params.request.jobTitle,
        companyName: params.request.companyName,
        descriptionSnippet: (params.request.jobDescription ?? '').slice(0, 4000)
      },
      candidate: {
        fullName: params.profile.fullName,
        email: params.profile.email,
        phone: params.profile.phone,
        jsonResume: params.profile.jsonResume,
        indiaProfile: params.profile.indiaProfile
      },
      stories: params.stories.slice(0, 12),
      savedAnswers: params.savedAnswers.slice(0, 20),
      fields: params.request.fields
    })
  });

  const fieldById = new Map<string, FallbackFillFieldInput>(
    params.request.fields.map((f) => [f.fieldId, f])
  );
  const suggestions: FallbackFillSuggestion[] = [];

  for (const raw of res.data.suggestions) {
    const field = fieldById.get(raw.fieldId);
    if (!field) continue;

    let value = raw.proposedValue.trim();
    if (!value) continue;

    if (field.options && field.options.length > 0) {
      const snapped = snapToAllowedOption(value, field.options);
      if (!snapped) {
        // Drop hallucinated option that does not exist in DOM choices
        continue;
      }
      value = snapped;
    }

    if (field.maxLength && value.length > field.maxLength) {
      value = value.slice(0, field.maxLength);
    }

    suggestions.push({
      fieldId: field.fieldId,
      canonicalKey: raw.canonicalKey,
      proposedValue: value,
      confidence: Math.min(0.85, Math.max(0.1, raw.confidence)),
      rationale: raw.rationale || 'Mapped via LLM fallback',
      groundedIn: raw.groundedIn || 'Master Profile'
    });
  }

  return {
    suggestions,
    usedLlm: true
  };
}
