import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 630
};
export const contentType = 'image/png';
export const alt = 'JobPilot — Job discovery, grounded resume tailoring, and autofill';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#f8f8f7',
          color: '#111111',
          padding: '56px 64px',
          border: '1px solid #d4d4d0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #d4d4d0',
            paddingBottom: '24px'
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.12em' }}>JOBPILOT</span>
          <span style={{ fontSize: 18, color: '#555550' }}>jobpilot.singulr.tech</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.12, maxWidth: '960px' }}>
            Job discovery, grounded tailoring, and calm autofill.
          </div>
          <div style={{ fontSize: 24, color: '#555550', maxWidth: '880px' }}>
            Verified against your Master Profile. Single-column ATS PDFs, instant ATS scoring,
            and Chrome MV3 autofill with review before submit.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '24px',
            borderTop: '1px solid #d4d4d0',
            paddingTop: '24px',
            fontSize: 18,
            color: '#111111'
          }}
        >
          <span>[01] Automated Job Matching</span>
          <span>·</span>
          <span>[02] Dual-Verified Resumes</span>
          <span>·</span>
          <span>[03] Chrome Extension Autofill</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
