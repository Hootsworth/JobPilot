import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type MasterProfile,
  type ProfileStory
} from '@jobpilot/shared';
import { runDeterministicVerification } from '@jobpilot/tailoring';

interface FaithfulnessFixture {
  masterProfile: {
    id: string;
    fullName: string;
    email: string;
    activeProfileVersion: number;
    jsonResume: Record<string, unknown>;
    indiaProfile: Record<string, unknown>;
  };
  stories: Array<Record<string, unknown>>;
  faithfulCases: Array<{
    name: string;
    patch: {
      summary: string;
      workHighlights: string[];
      skills: string[];
    };
  }>;
  adversarialCases: Array<{
    name: string;
    mutation: {
      addSkill?: string;
      overrideEmployer?: string;
      overrideWorkStartDate?: string;
      overrideCgpa?: string;
      overrideWorkHighlight?: string;
    };
  }>;
}

describe('@jobpilot/evals resume faithfulness regression harness', () => {
  it('catches 100% of adversarial hallucinations with 0% false positives on faithful rephrases', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../fixtures/resumes/faithfulness-cases.json'), 'utf8')
    ) as FaithfulnessFixture;

    const baseResume = {
      ...createEmptyJsonResume(),
      ...(raw.masterProfile.jsonResume as object)
    } as MasterProfile['jsonResume'];

    const masterProfile: MasterProfile = {
      id: raw.masterProfile.id,
      fullName: raw.masterProfile.fullName,
      email: raw.masterProfile.email,
      phone: null,
      activeProfileVersion: raw.masterProfile.activeProfileVersion,
      jsonResume: baseResume,
      indiaProfile: {
        ...createEmptyIndiaProfile(),
        ...(raw.masterProfile.indiaProfile as object)
      } as MasterProfile['indiaProfile'],
      searchPreferences: {
        targetRoles: [],
        workModes: ['remote', 'hybrid', 'onsite'],
        seniorityLevels: ['intern', 'fresher', 'junior'],
        countries: ['IN'],
        minSalaryLpa: null,
        minExperienceYears: null,
        maxExperienceYears: null
      },
      sourceResumeStoragePath: null,
      embeddingModel: null,
      embeddingModelVersion: null,
      embeddedAt: null,
      telemetryOptIn: false,
      onboardingCompletedAt: null,
      updatedAt: new Date().toISOString()
    };

    const stories = raw.stories.map((s) => ({
      situation: '',
      task: '',
      linkedExperienceId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(s as object)
    })) as ProfileStory[];

    let falsePositives = 0;
    for (const fc of raw.faithfulCases) {
      const tailored = structuredClone(masterProfile.jsonResume);
      tailored.basics.summary = fc.patch.summary;
      tailored.work[0]!.highlights = fc.patch.workHighlights;
      tailored.skills = [{ name: 'Technical', level: '', keywords: fc.patch.skills }];

      const res = runDeterministicVerification({
        masterProfile,
        stories,
        tailoredResume: tailored
      });
      if (!res.deterministicPassed) falsePositives++;
    }

    let caughtAdversarial = 0;
    for (const ac of raw.adversarialCases) {
      const tailored = structuredClone(masterProfile.jsonResume);
      if (ac.mutation.addSkill) {
        tailored.skills[0]!.keywords.push(ac.mutation.addSkill);
      }
      if (ac.mutation.overrideEmployer) {
        tailored.work[0]!.name = ac.mutation.overrideEmployer;
      }
      if (ac.mutation.overrideWorkStartDate) {
        tailored.work[0]!.startDate = ac.mutation.overrideWorkStartDate;
      }
      if (ac.mutation.overrideCgpa) {
        tailored.education[0]!.score = ac.mutation.overrideCgpa;
      }
      if (ac.mutation.overrideWorkHighlight) {
        tailored.work[0]!.highlights = [ac.mutation.overrideWorkHighlight];
      }

      const res = runDeterministicVerification({
        masterProfile,
        stories,
        tailoredResume: tailored
      });
      if (!res.deterministicPassed) caughtAdversarial++;
    }

    const falsePositiveRate = falsePositives / raw.faithfulCases.length;
    const catchRate = caughtAdversarial / raw.adversarialCases.length;

    expect(falsePositiveRate).toBe(0);
    expect(catchRate).toBe(1);
  });
});
