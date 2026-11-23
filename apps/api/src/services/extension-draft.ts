import { z } from 'zod';
import type { LlmProvider } from '@jobpilot/llm';
import type {
  DraftAnswerItem,
  DraftAnswerQuestion,
  DraftAnswersRequest,
  DraftAnswersResponse,
  MasterProfile,
  ProfileStory,
  SavedAnswer
} from '@jobpilot/shared';

const LlmDraftAnswersSchema = z.object({
  drafts: z
    .array(
      z.object({
        fieldId: z.string(),
        answer: z.string(),
        rationale: z.string().default('')
      })
    )
    .default([])
});

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/**
 * Deterministic token-overlap matcher against user's Saved Answers before any LLM call.
 */
export function matchSavedAnswerForQuestion(
  question: DraftAnswerQuestion,
  savedAnswers: SavedAnswer[]
): SavedAnswer | null {
  const qLower = question.label.toLowerCase();
  const qTokens = new Set(tokenize(question.label));
  if (qTokens.size === 0 || savedAnswers.length === 0) return null;

  let best: { item: SavedAnswer; score: number } | null = null;
  for (const item of savedAnswers) {
    const keyLower = item.questionKey.toLowerCase().replace(/_/g, ' ');
    if (qLower.includes(keyLower) || qLower.includes(item.questionPattern.toLowerCase())) {
      return item;
    }

    const patternTokens = tokenize(`${item.questionKey} ${item.questionPattern} ${item.tags.join(' ')}`);
    if (patternTokens.length === 0) continue;

    let overlap = 0;
    for (const t of patternTokens) {
      if (qTokens.has(t)) overlap++;
    }
    const score = overlap / Math.max(1, Math.min(qTokens.size, patternTokens.length));
    if (score >= 0.55 && (!best || score > best.score)) {
      best = { item, score };
    }
  }

  return best?.item ?? null;
}

export async function draftExtensionQuestionAnswers(params: {
  request: DraftAnswersRequest;
  profile: MasterProfile;
  stories: ProfileStory[];
  savedAnswers: SavedAnswer[];
  llmProvider: LlmProvider | null;
}): Promise<DraftAnswersResponse> {
  const draftsByFieldId = new Map<string, DraftAnswerItem>();
  const unresolved: DraftAnswerQuestion[] = [];

  for (const q of params.request.questions) {
    const saved = matchSavedAnswerForQuestion(q, params.savedAnswers);
    if (saved) {
      const clipped =
        q.maxLength && saved.answer.length > q.maxLength
          ? saved.answer.slice(0, q.maxLength)
          : saved.answer;
      draftsByFieldId.set(q.fieldId, {
        fieldId: q.fieldId,
        answer: clipped,
        confidence: 0.94,
        source: 'saved_answer',
        rationale: `Matched saved answer "${saved.questionPattern}"`
      });
    } else {
      unresolved.push(q);
    }
  }

  let usedLlm = false;
  let note: string | undefined;

  if (unresolved.length > 0 && params.llmProvider) {
    usedLlm = true;
    const res = await params.llmProvider.generateStructured({
      schema: LlmDraftAnswersSchema,
      schemaName: 'extension_draft_answers',
      taskType: 'form_draft',
      temperature: 0.2,
      maxTokens: 2000,
      systemPrompt: [
        'You draft concise, honest first-person job application answers strictly from the candidate Master Profile, India Profile fields, Story Bank, and Saved Answers.',
        'NEVER invent employers, job titles, dates, colleges, metrics, or skills not in the candidate record.',
        'If options are provided on a question, pick one of the exact options when fitting; otherwise leave answer empty if the candidate lacks the prerequisite.',
        'Respect maxLength limits when provided and keep tone crisp and direct.'
      ].join('\n'),
      userPrompt: JSON.stringify({
        targetJob: {
          title: params.request.jobTitle,
          companyName: params.request.companyName,
          descriptionSnippet: (params.request.jobDescription ?? '').slice(0, 4000)
        },
        profile: {
          fullName: params.profile.fullName,
          jsonResume: params.profile.jsonResume,
          indiaProfile: params.profile.indiaProfile
        },
        stories: params.stories.slice(0, 12),
        savedAnswers: params.savedAnswers.slice(0, 20),
        questions: unresolved
      })
    });

    const returnedMap = new Map(res.data.drafts.map((d) => [d.fieldId, d]));
    for (const q of unresolved) {
      const hit = returnedMap.get(q.fieldId);
      if (hit && hit.answer.trim()) {
        const clipped =
          q.maxLength && hit.answer.length > q.maxLength
            ? hit.answer.slice(0, q.maxLength)
            : hit.answer;
        draftsByFieldId.set(q.fieldId, {
          fieldId: q.fieldId,
          answer: clipped,
          confidence: 0.74,
          source: 'llm_draft',
          rationale: hit.rationale || 'Drafted from Master Profile & Story Bank'
        });
      } else {
        draftsByFieldId.set(q.fieldId, {
          fieldId: q.fieldId,
          answer: '',
          confidence: 0,
          source: 'unmapped',
          rationale: 'No grounded answer available in profile'
        });
      }
    }
  } else if (unresolved.length > 0) {
    note =
      'No active LLM provider key configured — returning Saved Answer matches only. Configure an API key in JobPilot Settings for AI drafts.';
    for (const q of unresolved) {
      draftsByFieldId.set(q.fieldId, {
        fieldId: q.fieldId,
        answer: '',
        confidence: 0,
        source: 'unmapped',
        rationale: 'Configure LLM key or add a Saved Answer to auto-draft this prompt'
      });
    }
  }

  return {
    drafts: params.request.questions.map(
      (q) =>
        draftsByFieldId.get(q.fieldId) ?? {
          fieldId: q.fieldId,
          answer: '',
          confidence: 0,
          source: 'unmapped',
          rationale: 'Unmapped question'
        }
    ),
    usedLlm,
    ...(note ? { note } : {})
  };
}
