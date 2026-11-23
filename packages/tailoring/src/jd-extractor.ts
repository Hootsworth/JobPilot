import type { LlmProvider } from '@jobpilot/llm';
import { JdRequirementsSchema, type JdRequirements } from '@jobpilot/shared';

export async function extractJdRequirements(params: {
  title: string;
  companyName: string;
  description: string;
  cachedRequirements?: unknown;
  llmProvider: LlmProvider;
  model?: string;
}): Promise<{ requirements: JdRequirements; fromCache: boolean }> {
  if (params.cachedRequirements) {
    const parsed = JdRequirementsSchema.safeParse(params.cachedRequirements);
    if (parsed.success && (parsed.data.mustHaveSkills.length > 0 || parsed.data.keywords.length > 0)) {
      return { requirements: parsed.data, fromCache: true };
    }
  }

  const res = await params.llmProvider.generateStructured({
    schema: JdRequirementsSchema,
    schemaName: 'jd_requirements',
    taskType: 'jd_extract',
    model: params.model,
    temperature: 0,
    maxTokens: 1600,
    systemPrompt: [
      'You are a job description analyst.',
      'Extract concrete technical requirements, skills, responsibilities, and ATS keywords strictly from the provided JD.',
      'Never assume requirements not written in the JD.'
    ].join('\n'),
    userPrompt: [
      `Role: ${params.title}`,
      `Company: ${params.companyName}`,
      '',
      'Job Description:',
      params.description.slice(0, 14_000)
    ].join('\n')
  });

  return {
    requirements: {
      ...res.data,
      roleTitle: res.data.roleTitle || params.title,
      companyName: res.data.companyName || params.companyName
    },
    fromCache: false
  };
}
