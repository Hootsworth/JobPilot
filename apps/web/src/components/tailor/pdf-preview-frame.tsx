'use client';

import React, { useEffect, useState } from 'react';
import { MoSpinner } from '@/components/ui/mo';
import { AlertBanner, Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';

interface PdfPreviewFrameProps {
  id: string;
  kind: 'resume' | 'cover-letter';
  refreshKey?: string | number;
  title: string;
  onDownload: () => void;
}

export function PdfPreviewFrame({
  id,
  kind,
  refreshKey,
  title,
  onDownload
}: PdfPreviewFrameProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrorMsg(null);

    const loader =
      kind === 'resume' ? api.fetchResumePdfBlobUrl(id) : api.fetchCoverLetterPdfBlobUrl(id);

    loader
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setBlobUrl(url);
      })
      .catch((err) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load PDF preview.');
          setBlobUrl(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [id, kind, refreshKey]);

  if (loading) {
    return (
      <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] h-[640px] flex flex-col items-center justify-center gap-3 text-xs text-[var(--mute)]">
        <MoSpinner name="braille" />
        <span>Rendering inline PDF preview...</span>
      </div>
    );
  }

  if (errorMsg || !blobUrl) {
    return (
      <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-6 space-y-3">
        <AlertBanner tone="error" message={errorMsg ?? 'PDF stream unavailable.'} />
        <Button type="button" size="sm" variant="secondary" onClick={onDownload}>
          Download PDF Directly
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--mute)]">
        <span>Rendered PDF 1.4 single-column ATS preview</span>
        <Button type="button" size="sm" variant="secondary" onClick={onDownload}>
          Download PDF
        </Button>
      </div>
      <iframe
        src={blobUrl}
        title={title}
        className="w-full h-[740px] border border-[var(--hairline-strong)] bg-white"
      />
    </div>
  );
}
