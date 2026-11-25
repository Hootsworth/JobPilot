'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingSnapshot, LlmUsageSummary } from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  SectionBlock,
  SkeletonBlock,
  TabStrip
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { setCachedBillingSnapshot } from '@/lib/billing-cache';
import { formatTaskLabel } from '@/lib/format';

type UsageTab = 'activity' | 'providers' | 'credits';

export default function UsagePage() {
  const [summary, setSummary] = useState<LlmUsageSummary | null>(null);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<UsageTab>('activity');
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadUsage = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [data, billingSnap] = await Promise.all([
        api.getUsage(),
        api.getBillingStatus().catch(() => null)
      ]);
      setSummary(data);
      setBilling(billingSnap);
      if (billingSnap) {
        setCachedBillingSnapshot(billingSnap);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load usage logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsage();
  }, []);

  return (
    <AppShell
      title="Usage"
      subtitle="Track credits remaining, AI actions completed, and provider activity."
      actions={
        <div className="flex items-center gap-2">
          <Link href="/billing">
            <Button variant="secondary" size="sm">
              Plans &amp; Credits
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={loadUsage} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}

      {loading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </div>
          <SkeletonBlock className="h-64" />
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* Focused 3-Metric Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[var(--hairline)] border border-[var(--hairline)]">
            <div className="bg-[var(--surface-soft)] p-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                  Credits Remaining
                </p>
                <p className="text-2xl font-bold tabular-nums mt-1">
                  {billing
                    ? billing.executionMode === 'byok'
                      ? 'BYOK'
                      : `${billing.totalCreditsRemaining} cr`
                    : '—'}
                </p>
              </div>
              {billing ? (
                <div className="text-right space-y-1">
                  <Badge tone={billing.subscription.planId === 'free' ? 'neutral' : 'dark'}>
                    {billing.plan.name}
                  </Badge>
                  <Link href="/billing" className="block text-[11px] text-[var(--ink)] underline">
                    Manage plan
                  </Link>
                </div>
              ) : null}
            </div>

            <div className="bg-[var(--surface-soft)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                AI Actions Run
              </p>
              <p className="text-2xl font-bold tabular-nums mt-1">{summary.totalCalls}</p>
            </div>

            <div className="bg-[var(--surface-soft)] p-4">
              <p className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Avg Response Time
              </p>
              <p className="text-2xl font-bold tabular-nums mt-1">{summary.avgLatencyMs} ms</p>
            </div>
          </div>

          <TabStrip<UsageTab>
            label="Usage views"
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'activity', label: 'Recent Activity', badge: summary.recentLogs.length },
              { id: 'providers', label: 'By Provider', badge: summary.byProvider.length },
              { id: 'credits', label: 'Credit History', badge: billing?.recentLedger.length ?? 0 }
            ]}
          />

          {activeTab === 'activity' ? (
            <div role="tabpanel" aria-label="Recent Activity">
              <SectionBlock
                title="Recent AI Activity"
                action={
                  summary.recentLogs.length > 0 ? (
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--body)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showTechDetails}
                        onChange={(e) => setShowTechDetails(e.target.checked)}
                        className="w-3.5 h-3.5"
                      />
                      <span>Technical columns</span>
                    </label>
                  ) : undefined
                }
              >
                {summary.recentLogs.length === 0 ? (
                  <EmptyState
                    title="No AI actions recorded yet"
                    description="Parse a resume PDF, tailor a resume, or draft application answers to see activity here."
                  />
                ) : (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Recent AI activity logs"
                    className="oc-table-wrap"
                  >
                    <table className="oc-table text-xs">
                      <thead>
                        <tr className="text-[var(--mute)]">
                          <th className="py-2 pr-3">Task</th>
                          {showTechDetails ? <th className="py-2 pr-3">Provider</th> : null}
                          <th className="py-2 pr-3">Model</th>
                          {showTechDetails ? <th className="py-2 pr-3">In / Out Tokens</th> : null}
                          <th className="py-2 pr-3">Speed</th>
                          {showTechDetails ? <th className="py-2 pr-3">Retries</th> : null}
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recentLogs.map((log) => (
                          <tr key={log.id}>
                            <td data-label="Task" className="py-2.5 pr-3 font-medium text-[var(--ink)]">
                              {formatTaskLabel(log.taskType)}
                            </td>
                            {showTechDetails ? (
                              <td data-label="Provider" className="py-2.5 pr-3 capitalize">
                                {log.provider}
                              </td>
                            ) : null}
                            <td data-label="Model" className="py-2.5 pr-3 max-w-[200px] truncate">
                              {log.model}
                            </td>
                            {showTechDetails ? (
                              <td data-label="Tokens" className="py-2.5 pr-3">
                                {log.inputTokens} / {log.outputTokens}
                              </td>
                            ) : null}
                            <td data-label="Speed" className="py-2.5 pr-3">
                              {log.latencyMs} ms
                            </td>
                            {showTechDetails ? (
                              <td data-label="Retries" className="py-2.5 pr-3">
                                {log.retryCount}
                                {log.usedRepair ? ' (repaired)' : ''}
                              </td>
                            ) : null}
                            <td data-label="Status" className="py-2.5 pr-3">
                              <Badge tone={log.status === 'ok' ? 'success' : 'danger'}>
                                {log.status === 'ok' ? 'OK' : 'Error'}
                              </Badge>
                            </td>
                            <td data-label="Time" className="py-2.5 text-[var(--mute)]">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionBlock>
            </div>
          ) : null}

          {activeTab === 'providers' ? (
            <div role="tabpanel" aria-label="Breakdown by Provider" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-[var(--hairline)] border border-[var(--hairline)]">
                <div className="bg-[var(--surface-soft)] p-4">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    Total Tokens Processed
                  </p>
                  <p className="text-xl font-bold tabular-nums mt-1">
                    {(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}
                  </p>
                </div>
                <div className="bg-[var(--surface-soft)] p-4">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    Estimated Provider Cost (USD)
                  </p>
                  <p className="text-xl font-bold tabular-nums mt-1">
                    ${summary.totalCostUsd.toFixed(4)}
                  </p>
                </div>
              </div>

              <SectionBlock title="Breakdown by Provider">
                {summary.byProvider.length === 0 ? (
                  <EmptyState
                    title="No provider calls yet"
                    description="Provider usage statistics will appear once AI requests complete."
                  />
                ) : (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Provider usage breakdown"
                    className="oc-table-wrap"
                  >
                    <table className="oc-table text-sm">
                      <thead>
                        <tr className="text-xs text-[var(--mute)]">
                          <th className="py-2 pr-4">Provider</th>
                          <th className="py-2 pr-4">Calls</th>
                          <th className="py-2 pr-4">Tokens</th>
                          <th className="py-2 pr-4">Avg Latency</th>
                          <th className="py-2">Est. Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byProvider.map((row) => (
                          <tr key={row.provider}>
                            <td data-label="Provider" className="py-2.5 pr-4 font-bold capitalize">
                              {row.provider}
                            </td>
                            <td data-label="Calls" className="py-2.5 pr-4">
                              {row.calls}
                            </td>
                            <td data-label="Tokens" className="py-2.5 pr-4">
                              {row.tokens.toLocaleString()}
                            </td>
                            <td data-label="Avg Latency" className="py-2.5 pr-4">
                              {row.avgLatencyMs} ms
                            </td>
                            <td data-label="Est. Cost" className="py-2.5">
                              ${row.costUsd.toFixed(5)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionBlock>
            </div>
          ) : null}

          {activeTab === 'credits' ? (
            <div role="tabpanel" aria-label="Credit History">
              <SectionBlock
                title="Credit Ledger"
                action={
                  <Link href="/billing" className="text-xs font-medium text-[var(--ink)] underline">
                    Manage plans &amp; top-ups →
                  </Link>
                }
              >
                {!billing || billing.recentLedger.length === 0 ? (
                  <EmptyState
                    title="No credit transactions yet"
                    description="Credit grants and AI deductions will be logged here."
                  />
                ) : (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Credit balance history"
                    className="oc-table-wrap"
                  >
                    <table className="oc-table text-xs">
                      <thead>
                        <tr className="text-[var(--mute)]">
                          <th className="py-2 pr-4">Event</th>
                          <th className="py-2 pr-4">Bucket</th>
                          <th className="py-2 pr-4">Delta</th>
                          <th className="py-2 pr-4">Balance After</th>
                          <th className="py-2">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {billing.recentLedger.map((entry) => (
                          <tr key={entry.id}>
                            <td data-label="Event" className="py-2.5 pr-4 font-medium text-[var(--ink)]">
                              {entry.reason}
                            </td>
                            <td data-label="Bucket" className="py-2.5 pr-4 uppercase text-[var(--mute)]">
                              {entry.bucket}
                            </td>
                            <td
                              data-label="Delta"
                              className={`py-2.5 pr-4 font-bold ${
                                entry.delta >= 0
                                  ? 'text-[var(--success-text)]'
                                  : 'text-[var(--ink)]'
                              }`}
                            >
                              {entry.delta >= 0 ? `+${entry.delta}` : entry.delta}
                            </td>
                            <td data-label="Balance After" className="py-2.5 pr-4">
                              {entry.balanceAfter} cr
                            </td>
                            <td data-label="Time" className="py-2.5 text-[var(--mute)]">
                              {new Date(entry.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionBlock>
            </div>
          ) : null}
        </div>
      ) : null}
    </AppShell>
  );
}
