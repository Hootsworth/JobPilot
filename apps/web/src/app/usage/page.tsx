'use client';

import React, { useEffect, useState } from 'react';
import type { LlmUsageSummary } from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  SectionBlock,
  SkeletonBlock
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatTaskLabel } from '@/lib/format';

export default function UsagePage() {
  const [summary, setSummary] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadUsage = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getUsage();
      setSummary(data);
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
      actions={
        <Button variant="secondary" size="sm" onClick={loadUsage} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* Uniform Hairline KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--hairline)] border border-[var(--hairline)]">
            <div className="bg-[var(--surface-soft)] p-4">
              <p className="text-xs text-[var(--mute)]">Total calls</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{summary.totalCalls}</p>
            </div>
            <div className="bg-[var(--surface-soft)] p-4">
              <p className="text-xs text-[var(--mute)]">Total tokens</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}
              </p>
            </div>
            <div className="bg-[var(--surface-soft)] p-4">
              <p className="text-xs text-[var(--mute)]">Avg latency</p>
              <p className="text-2xl font-bold tabular-nums mt-1">{summary.avgLatencyMs} ms</p>
            </div>
            <div className="bg-[var(--surface-soft)] p-4">
              <p className="text-xs text-[var(--mute)]">Est. cost</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                ${summary.totalCostUsd.toFixed(4)}
              </p>
            </div>
          </div>

          <SectionBlock title="Breakdown by Provider">
            {summary.byProvider.length === 0 ? (
              <EmptyState
                title="No calls recorded yet"
                description="Verify an API key in Settings or parse a resume PDF to view activity here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse tabular-nums">
                  <thead>
                    <tr className="border-b border-[var(--hairline-strong)] text-xs text-[var(--mute)]">
                      <th className="py-2 pr-4">Provider</th>
                      <th className="py-2 pr-4">Calls</th>
                      <th className="py-2 pr-4">Tokens</th>
                      <th className="py-2 pr-4">Avg Latency</th>
                      <th className="py-2">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--hairline)]">
                    {summary.byProvider.map((row) => (
                      <tr key={row.provider}>
                        <td className="py-2.5 pr-4 font-bold capitalize">{row.provider}</td>
                        <td className="py-2.5 pr-4">{row.calls}</td>
                        <td className="py-2.5 pr-4">{row.tokens.toLocaleString()}</td>
                        <td className="py-2.5 pr-4">{row.avgLatencyMs} ms</td>
                        <td className="py-2.5">${row.costUsd.toFixed(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionBlock>

          <SectionBlock title="Recent Activity">
            {summary.recentLogs.length === 0 ? (
              <p className="text-sm text-[var(--mute)]">No recent activity recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse tabular-nums">
                  <thead>
                    <tr className="border-b border-[var(--hairline-strong)] text-[var(--mute)]">
                      <th className="py-2 pr-3">Task</th>
                      <th className="py-2 pr-3">Provider</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3">In / Out</th>
                      <th className="py-2 pr-3">Latency</th>
                      <th className="py-2 pr-3">Retries</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--hairline)]">
                    {summary.recentLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 pr-3 font-medium">{formatTaskLabel(log.taskType)}</td>
                        <td className="py-2 pr-3 capitalize">{log.provider}</td>
                        <td className="py-2 pr-3 max-w-[180px] truncate">{log.model}</td>
                        <td className="py-2 pr-3">
                          {log.inputTokens} / {log.outputTokens}
                        </td>
                        <td className="py-2 pr-3">{log.latencyMs} ms</td>
                        <td className="py-2 pr-3">
                          {log.retryCount}
                          {log.usedRepair ? ' (repaired)' : ''}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={log.status === 'ok' ? 'success' : 'danger'}>
                            {log.status === 'ok' ? 'OK' : 'Error'}
                          </Badge>
                        </td>
                        <td className="py-2 text-[var(--mute)]">
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
    </AppShell>
  );
}
