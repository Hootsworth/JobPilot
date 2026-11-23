import type { JsonResume, ResumeDiffSummary } from '@jobpilot/shared';

function diffBullets(before: string[], after: string[]) {
  const result: Array<{
    before: string | null;
    after: string | null;
    changeType: 'unchanged' | 'rephrased' | 'added' | 'removed';
  }> = [];

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const maxLen = Math.max(before.length, after.length);

  for (let i = 0; i < maxLen; i++) {
    const b = before[i] ?? null;
    const a = after[i] ?? null;
    if (b && a) {
      if (b.trim() === a.trim()) {
        result.push({ before: b, after: a, changeType: 'unchanged' });
      } else {
        result.push({ before: b, after: a, changeType: 'rephrased' });
      }
    } else if (b && !a) {
      if (!afterSet.has(b)) {
        result.push({ before: b, after: null, changeType: 'removed' });
      }
    } else if (!b && a) {
      if (!beforeSet.has(a)) {
        result.push({ before: null, after: a, changeType: 'added' });
      }
    }
  }
  return result;
}

export function computeResumeDiff(
  master: JsonResume,
  tailored: JsonResume
): ResumeDiffSummary {
  const summaryBefore = (master.basics.summary ?? '').trim();
  const summaryAfter = (tailored.basics.summary ?? '').trim();

  const tailoredWorkIndexById = new Map(tailored.work.map((w, idx) => [w.id, { item: w, idx }]));
  const workDiffs = master.work.map((w, masterIndex) => {
    const match = tailoredWorkIndexById.get(w.id);
    if (!match) {
      return {
        id: w.id,
        title: `${w.position} @ ${w.name}`,
        status: 'omitted' as const,
        masterIndex,
        tailoredIndex: null,
        bulletDiffs: w.highlights.map((h) => ({
          before: h,
          after: null,
          changeType: 'removed' as const
        }))
      };
    }
    return {
      id: w.id,
      title: `${match.item.position} @ ${match.item.name}`,
      status: match.idx === masterIndex ? ('kept' as const) : ('reordered' as const),
      masterIndex,
      tailoredIndex: match.idx,
      bulletDiffs: diffBullets(w.highlights, match.item.highlights)
    };
  });

  const tailoredProjIndexById = new Map(
    tailored.projects.map((p, idx) => [p.id, { item: p, idx }])
  );
  const projectDiffs = master.projects.map((p, masterIndex) => {
    const match = tailoredProjIndexById.get(p.id);
    if (!match) {
      return {
        id: p.id,
        title: p.name,
        status: 'omitted' as const,
        masterIndex,
        tailoredIndex: null,
        bulletDiffs: p.highlights.map((h) => ({
          before: h,
          after: null,
          changeType: 'removed' as const
        }))
      };
    }
    return {
      id: p.id,
      title: match.item.name,
      status: match.idx === masterIndex ? ('kept' as const) : ('reordered' as const),
      masterIndex,
      tailoredIndex: match.idx,
      bulletDiffs: diffBullets(p.highlights, match.item.highlights)
    };
  });

  const skillsBefore = master.skills.flatMap((g) => g.keywords);
  const skillsAfter = tailored.skills.flatMap((g) => g.keywords);
  const beforeLower = new Set(skillsBefore.map((s) => s.toLowerCase()));
  const afterLower = new Set(skillsAfter.map((s) => s.toLowerCase()));

  const skillsDropped = skillsBefore.filter((s) => !afterLower.has(s.toLowerCase()));
  const skillsAdded = skillsAfter.filter((s) => !beforeLower.has(s.toLowerCase()));
  const skillsReordered =
    skillsBefore.join('|').toLowerCase() !== skillsAfter.join('|').toLowerCase();

  return {
    summaryChanged: summaryBefore !== summaryAfter,
    summaryBefore,
    summaryAfter,
    workDiffs,
    projectDiffs,
    skillsBefore,
    skillsAfter,
    skillsReordered,
    skillsDropped,
    skillsAdded
  };
}
