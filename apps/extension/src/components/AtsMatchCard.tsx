import React from 'react';
import type { AtsScoreReport } from '@jobpilot/shared';

interface AtsMatchCardProps {
  report: AtsScoreReport | null;
  loading: boolean;
  hasEnoughJd: boolean;
  onOpenTailor: () => void;
}

export function AtsMatchCard({
  report,
  loading,
  hasEnoughJd,
  onOpenTailor
}: AtsMatchCardProps) {
  if (!hasEnoughJd && !loading && !report) return null;

  const scoreToneClass =
    report && report.overallScore >= 75
      ? 'jp-badge jp-badge-ok'
      : report && report.overallScore >= 50
        ? 'jp-badge jp-badge-warn'
        : 'jp-badge';

  return (
    <section className="jp-panel" aria-label="In-tab ATS match score">
      <div className="jp-field-top">
        <div className="jp-row">
          <span className="jp-label">Live ATS Match</span>
          {loading ? (
            <span className="jp-badge">SCORING...</span>
          ) : report ? (
            <span className={scoreToneClass}>{report.overallScore}% FIT</span>
          ) : null}
        </div>
        <button type="button" className="jp-link-btn" onClick={onOpenTailor}>
          Tailor Studio -&gt;
        </button>
      </div>

      {report ? (
        <>
          <div className="jp-meta">
            Must-have: {report.matchedMustHave.length}/
            {report.matchedMustHave.length + report.missingMustHave.length} · Keywords:{' '}
            {report.keywordScore}% · Impact: {report.impactScore}%
          </div>
          {(report.matchedMustHave.length > 0 || report.missingMustHave.length > 0) ? (
            <div className="jp-chip-grid">
              {report.matchedMustHave.slice(0, 5).map((skill) => (
                <span key={`m-${skill}`} className="jp-badge jp-badge-ok">
                  +{skill}
                </span>
              ))}
              {report.missingMustHave.slice(0, 5).map((skill) => (
                <span key={`miss-${skill}`} className="jp-badge jp-badge-warn">
                  !{skill}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
