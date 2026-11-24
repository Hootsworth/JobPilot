import type {
  AdapterTosRisk,
  AtsAdapterId,
  CaptureExtensionJobRequest,
  CaptureExtensionJobResponse,
  CapturedJobMetadata,
  DetectedFormField,
  DraftAnswersRequest,
  DraftAnswersResponse,
  FallbackFillRequest,
  FallbackFillResponse,
  FillExecutionItemResult,
  FillPlanItem
} from '@jobpilot/shared';

export interface PageScanPayload {
  adapterId: AtsAdapterId;
  disabledByUser: boolean;
  tosRiskLevel: AdapterTosRisk;
  tosWarning: string;
  url: string;
  jobMetadata: CapturedJobMetadata;
  fields: DetectedFormField[];
  hasSubmitControl: boolean;
}

export type ExtensionMessage =
  | { type: 'OPEN_SIDEPANEL' }
  | { type: 'SCAN_PAGE' }
  | {
      type: 'EXECUTE_FILL';
      planItems: FillPlanItem[];
      resumeVersionId?: string | null;
    }
  | { type: 'UNDO_FILL' }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | {
      type: 'PAGE_STRUCTURE_UPDATED';
      adapterId: AtsAdapterId;
      fieldCount: number;
    }
  | {
      type: 'API_DRAFT_ANSWERS';
      payload: DraftAnswersRequest;
    }
  | {
      type: 'API_FALLBACK_FILL';
      payload: FallbackFillRequest;
    }
  | {
      type: 'API_CAPTURE_JOB';
      payload: CaptureExtensionJobRequest;
    }
  | {
      type: 'API_FETCH_PDF_BYTES';
      versionId: string;
    }
  | {
      type: 'JOBPILOT_SAVE_ACTIVE_TAB_JOB';
    };

export type ApiProxyResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

export interface PdfBytesResponse {
  base64: string;
  filename: string;
}

export type ExecuteFillTabResponse =
  | {
      ok: true;
      filledCount: number;
      skippedAlreadyFilledCount: number;
      results: FillExecutionItemResult[];
    }
  | { ok: false; error: string };

export type UndoFillTabResponse = {
  ok: true;
  restoredCount: number;
};

export type CaptureJobProxyResponse = ApiProxyResponse<CaptureExtensionJobResponse>;
export type DraftAnswersProxyResponse = ApiProxyResponse<DraftAnswersResponse>;
