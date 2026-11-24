import type { MasterProfile } from '@jobpilot/shared';

export interface DiscoveryQueries {
  targetRoles: string[];
  topSkills: string[];
  remotiveCategories: string[];
  jobicyTag?: string;
  theMuseCategories: string[];
  searchQuery: string;
  regionPriority: 'india' | 'global';
}

export function buildDiscoveryQueriesFromProfile(
  profile?: MasterProfile | null
): DiscoveryQueries {
  const rolesFromPrefs =
    profile?.searchPreferences.targetRoles.map((r) => r.trim()).filter(Boolean) ?? [];
  const headline = profile?.jsonResume.basics.label?.trim();
  const workTitles =
    profile?.jsonResume.work.map((w) => w.position.trim()).filter(Boolean).slice(0, 2) ?? [];

  const targetRoles = Array.from(
    new Set([
      ...rolesFromPrefs,
      ...(headline ? [headline] : []),
      ...workTitles
    ])
  ).slice(0, 4);

  const topSkills = Array.from(
    new Set(
      (profile?.jsonResume.skills ?? [])
        .flatMap((g) => g.keywords)
        .map((k) => k.trim())
        .filter(Boolean)
    )
  ).slice(0, 8);

  const combinedText = `${targetRoles.join(' ')} ${topSkills.join(' ')}`.toLowerCase();

  const remotiveSet = new Set<string>(['software-dev']);
  if (/\b(data|ml|machine learning|ai|analytics|scientist)\b/.test(combinedText)) {
    remotiveSet.add('data');
  }
  if (/\b(design|ui|ux|figma|product designer)\b/.test(combinedText)) {
    remotiveSet.add('design');
  }
  if (/\b(product manager|product management|\bpm\b)\b/.test(combinedText)) {
    remotiveSet.add('product');
  }
  if (/\b(devops|sre|platform|cloud|infra|kubernetes)\b/.test(combinedText)) {
    remotiveSet.add('devops');
  }
  const remotiveCategories = Array.from(remotiveSet).slice(0, 2);

  let jobicyTag: string | undefined;
  if (/\bpython\b/.test(combinedText)) jobicyTag = 'python';
  else if (/\breact\b|\bfrontend\b/.test(combinedText)) jobicyTag = 'react';
  else if (/\bnode\b|\btypescript\b|\bjavascript\b/.test(combinedText)) jobicyTag = 'javascript';
  else if (/\bdata\b|\bml\b|\bai\b/.test(combinedText)) jobicyTag = 'data';
  else if (/\bdevops\b|\bsre\b|\bkubernetes\b/.test(combinedText)) jobicyTag = 'devops';
  else if (/\bdesign\b|\bux\b|\bui\b/.test(combinedText)) jobicyTag = 'design';
  else if (/\bproduct\b/.test(combinedText)) jobicyTag = 'product';

  const museSet = new Set<string>(['Software Engineering']);
  if (/\b(data|ml|machine learning|analytics|scientist)\b/.test(combinedText)) {
    museSet.add('Data Science');
    museSet.add('Data and Analytics');
  }
  if (/\b(design|ui|ux|figma)\b/.test(combinedText)) {
    museSet.add('Design and UX');
  }
  if (/\b(product manager|product management)\b/.test(combinedText)) {
    museSet.add('Product Management');
  }
  const theMuseCategories = Array.from(museSet).slice(0, 2);

  const countries =
    profile?.searchPreferences.countries.map((c) => c.toUpperCase()) ?? ['IN'];
  const regionPriority: 'india' | 'global' =
    countries.length === 0 || countries.includes('IN') ? 'india' : 'global';

  const searchQuery =
    targetRoles[0] || (topSkills.length > 0 ? `software engineer ${topSkills[0]}` : 'software engineer');

  return {
    targetRoles,
    topSkills,
    remotiveCategories,
    jobicyTag,
    theMuseCategories,
    searchQuery,
    regionPriority
  };
}
