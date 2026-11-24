import type {
  AdapterTosRisk,
  AtsAdapterId,
  AtsScoreReport,
  AtsScoreRequest,
  CaptureExtensionJobRequest,
  CaptureExtensionJobResponse,
  CapturedJobMetadata,
  DetectedFormField,
  DraftAnswersRequest,
  DraftAnswersResponse,
  FallbackFillRequest,
  FallbackFillResponse,
  FillExecutionItemResult,
  FillPlanItem,
  ResumeVersionRecord,
  SavedAnswer,
  TailorResumeRequest,
  UpsertSavedAnswerRequest
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

export interface WebConfigSyncPayload {
  apiBaseUrl: string;
  webBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface WebSessionSyncPayload extends WebConfigSyncPayload {
  accessToken: string;
  refreshToken: string;
  email: string;
  expiresAt?: number;
}

export interface SubmitDetectedPayload {
  url: string;
  title: string;
  companyName: string;
}

export type ExtensionMessage =
  | { type: 'OPEN_SIDEPANEL' }
  | { type: 'SCAN_PAGE' }
  | {
      type: 'EXECUTE_FILL';
      planItems: FillPlanItem[];
      resumeVersionId?: string | null;
      coverLetterId?: string | null;
    }
  | { type: 'UNDO_FILL' }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | {
      type: 'PAGE_STRUCTURE_UPDATED';
      adapterId: AtsAdapterId;
      fieldCount: number;
    }
  | {
      type: 'WEB_CONFIG_SYNC';
      payload: WebConfigSyncPayload;
    }
  | {
      type: 'WEB_SESSION_SYNC';
      payload: WebSessionSyncPayload | null;
    }
  | { type: 'PULL_WEB_SESSION' }
  | { type: 'JOBPILOT_SYNC_FROM_WEB_TAB' }
  | {
      type: 'AUTH_SESSION_UPDATED';
      connected: boolean;
      email?: string;
    }
  | {
      type: 'APPLICATION_SUBMIT_DETECTED';
      payload: SubmitDetectedPayload;
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
      type: 'API_FETCH_COVER_LETTER_PDF_BYTES';
      coverLetterId: string;
    }
  | {
      type: 'API_ATS_SCORE';
      payload: AtsScoreRequest;
    }
  | {
      type: 'API_TAILOR_RESUME';
      payload: TailorResumeRequest;
    }
  | {
      type: 'API_SAVE_ANSWER';
      payload: UpsertSavedAnswerRequest;
    }
  | {
      type: 'API_MARK_APPLIED';
      payload: CaptureExtensionJobRequest & { coverLetterId?: string };
    }
  | {
      type: 'JOBPILOT_SAVE_ACTIVE_TAB_JOB';
    };

export type ApiProxyResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; code?: string; upgradeUrl?: string };

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
export type AtsScoreProxyResponse = ApiProxyResponse<AtsScoreReport>;
export type TailorResumeProxyResponse = ApiProxyResponse<ResumeVersionRecord>;
export type SaveAnswerProxyResponse = ApiProxyResponse<SavedAnswer>;
