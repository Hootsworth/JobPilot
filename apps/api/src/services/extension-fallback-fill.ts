import { z } from 'zod';
import type { LlmProvider } from '@jobpilot/llm';
import type {
  FallbackFillFieldInput,
  FallbackFillRequest,
  FallbackFillResponse,
  FallbackFillSuggestion,
  MasterProfile,
  MissingRequiredQuestion,
  ProfileStory,
  SavedAnswer
} from '@jobpilot/shared';
import { CanonicalFieldKeySchema } from '@jobpilot/shared';
import { matchSavedAnswerForQuestion } from './extension-draft.js';

const LlmFallbackOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        fieldId: z.string(),
        canonicalKey: CanonicalFieldKeySchema.catch('unknown').default('unknown'),
        proposedValue: z.string(),
        confidence: z.number().min(0).max(1).default(0.7),
        rationale: z.string().default(''),
        groundedIn: z.string().default(''),
        needsUserInput: z.boolean().optional(),
        questionForUser: z.string().max(400).optional()
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

function toMissingRequiredQuestion(
  field: FallbackFillFieldInput,
  hint?: {
    canonicalKey?: FallbackFillSuggestion['canonicalKey'];
    question?: string;
    reason?: string;
  }
): MissingRequiredQuestion {
  const cleanQuestion = (hint?.question || field.label).trim().slice(0, 400);
  return {
    fieldId: field.fieldId,
    label: field.label,
    controlType: field.controlType,
    ...(field.options ? { options: field.options } : {}),
    ...(field.maxLength ? { maxLength: field.maxLength } : {}),
    ...(hint?.canonicalKey && hint.canonicalKey !== 'unknown'
      ? { canonicalKey: hint.canonicalKey }
      : {}),
    question: cleanQuestion || field.label,
    ...(hint?.reason ? { reason: hint.reason.trim().slice(0, 300) } : {})
  };
}

export async function runExtensionLlmFallbackFill(params: {
  request: FallbackFillRequest;
  profile: MasterProfile;
  stories: ProfileStory[];
  savedAnswers: SavedAnswer[];
  llmProvider: LlmProvider | null;
}): Promise<FallbackFillResponse> {
  const suggestions: FallbackFillSuggestion[] = [];
  const resolvedFieldIds = new Set<string>();

  for (const field of params.request.fields) {
    const matched = matchSavedAnswerForQuestion(
      {
        fieldId: field.fieldId,
        label: field.label,
        ...(field.maxLength ? { maxLength: field.maxLength } : {})
      },
      params.savedAnswers
    );
    if (!matched) continue;

    let value = matched.answer.trim();
    if (!value) continue;

    if (field.options && field.options.length > 0) {
      const snapped = snapToAllowedOption(value, field.options);
      if (!snapped) continue;
      value = snapped;
    }

    if (field.maxLength && value.length > field.maxLength) {
      value = value.slice(0, field.maxLength);
    }

    suggestions.push({
      fieldId: field.fieldId,
      canonicalKey: 'unknown',
      proposedValue: value,
      confidence: 0.85,
      rationale: 'Matched from your Saved Answer Bank',
      groundedIn: `Saved Answer: ${matched.questionPattern}`,
      needsUserInput: false
    });
    resolvedFieldIds.add(field.fieldId);
  }

  const remainingFields = params.request.fields.filter((f) => !resolvedFieldIds.has(f.fieldId));
  if (remainingFields.length === 0) {
    return {
      suggestions,
      usedLlm: false,
      missingRequired: []
    };
  }

  if (!params.llmProvider) {
    const missingRequired = remainingFields
      .filter((f) => f.required === true)
      .map((f) =>
        toMissingRequiredQuestion(f, {
          reason: 'Required field could not be matched from your profile or saved answers.'
        })
      );

    return {
      suggestions,
      usedLlm: false,
      missingRequired,
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
      'You are a strict, grounded form-field identifier and value filler for JobPilot.',
      'For each unresolved form field from any job portal or custom company application form:',
      '1. Identify what candidate or application information the field asks for (set canonicalKey accurately).',
      '2. Fill it ONLY using verified facts from the candidate Master Profile, India Profile, Story Bank, and Saved Answers.',
      'STRICT NON-HALLUCINATION & REQUIRED-ONLY QUESTION RULES:',
      '- NEVER invent skills, employers, titles, degrees, dates, colleges, phone numbers, visa status, or numeric metrics.',
      '- If a field supplies an "options" array, proposedValue MUST be chosen verbatim from those options — or set proposedValue to "" if none match honestly.',
      '- If the field is NOT required (required is false or omitted) and cannot be grounded honestly, set proposedValue to "" and needsUserInput to false. NEVER ask the user for optional fields.',
      '- If the field IS required (required: true) and cannot be grounded honestly in the candidate data, set proposedValue to "", set needsUserInput to true, and write a concise, clear questionForUser asking the user ONLY for that missing information.',
      '- Respect maxLength when specified and cite exact profile provenance in "groundedIn".'
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
      fields: remainingFields
    })
  });

  const fieldById = new Map<string, FallbackFillFieldInput>(
    remainingFields.map((f) => [f.fieldId, f])
  );
  const llmQuestionHints = new Map<
    string,
    {
      canonicalKey?: FallbackFillSuggestion['canonicalKey'];
      question?: string;
      reason?: string;
    }
  >();

  for (const raw of res.data.suggestions) {
    const field = fieldById.get(raw.fieldId);
    if (!field) continue;

    let value = raw.proposedValue.trim();
    if (!value) {
      if (field.required && raw.needsUserInput !== false) {
        llmQuestionHints.set(field.fieldId, {
          canonicalKey: raw.canonicalKey,
          question: raw.questionForUser,
          reason: raw.rationale
        });
      }
      continue;
    }

    if (field.options && field.options.length > 0) {
      const snapped = snapToAllowedOption(value, field.options);
      if (!snapped) {
        // Drop hallucinated option that does not exist in DOM choices
        if (field.required) {
          llmQuestionHints.set(field.fieldId, {
            canonicalKey: raw.canonicalKey,
            question: raw.questionForUser,
            reason: 'Required field requires choosing one of the available options.'
          });
        }
        continue;
      }
      value = snapped;
    }

    if (field.maxLength && value.length > field.maxLength) {
      value = value.slice(0, field.maxLength);
    }

    resolvedFieldIds.add(field.fieldId);
    suggestions.push({
      fieldId: field.fieldId,
      canonicalKey: raw.canonicalKey,
      proposedValue: value,
      confidence: Math.min(0.85, Math.max(0.1, raw.confidence)),
      rationale: raw.rationale || 'Mapped via LLM fallback',
      groundedIn: raw.groundedIn || 'Master Profile',
      needsUserInput: false
    });
  }

  const missingRequired: MissingRequiredQuestion[] = [];
  for (const field of remainingFields) {
    if (field.required !== true || resolvedFieldIds.has(field.fieldId)) continue;
    missingRequired.push(toMissingRequiredQuestion(field, llmQuestionHints.get(field.fieldId)));
  }

  return {
    suggestions,
    usedLlm: true,
    missingRequired
  };
}
