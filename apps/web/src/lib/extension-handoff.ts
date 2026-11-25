'use client';

export interface WebTailorHandoffInput {
  applyUrl: string;
  jobId?: string;
  jobTitle?: string;
  companyName?: string;
  resumeVersionId?: string;
  coverLetterId?: string;
  profileVariantId?: string;
}

/**
 * Broadcasts the tailored resume/cover letter selection to the JobPilot Chrome extension
 * (via ExtensionAuthBridge) and opens the external job application link in a new tab.
 */
export function handoffToExtensionAndApply(input: WebTailorHandoffInput): void {
  if (typeof window === 'undefined') return;
  window.postMessage(
    {
      source: 'jobpilot-web-auth',
      type: 'TAILOR_HANDOFF',
      payload: {
        ...input,
        createdAt: Date.now()
      }
    },
    window.location.origin
  );
  window.open(input.applyUrl, '_blank', 'noopener,noreferrer');
}
