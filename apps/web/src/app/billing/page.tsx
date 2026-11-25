'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CREDIT_COSTS,
  CREDIT_PACKS,
  PLAN_CATALOG,
  type BillingCurrency,
  type BillingSnapshot,
  type CreditPackId,
  type PlanId
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { moToast } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  Disclosure,
  SectionBlock,
  SkeletonBlock,
  TabStrip
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { setCachedBillingSnapshot } from '@/lib/billing-cache';

type BillingTab = 'plans' | 'topups' | 'history';

const PLAN_ORDER: PlanId[] = ['free', 'pro', 'sprint_90', 'plus'];
const PACK_ORDER: CreditPackId[] = ['pack_150', 'pack_500'];

const ACTION_LABELS: Array<{
  key: keyof typeof CREDIT_COSTS;
  label: string;
}> = [
  { key: 'resume_tailor', label: 'Tailor Resume' },
  { key: 'cover_letter', label: 'Generate Cover Letter' },
  { key: 'resume_parse', label: 'Parse PDF Resume' },
  { key: 'form_draft', label: 'Chrome Extension Draft Answers' },
  { key: 'fallback_fill', label: 'Chrome Extension Fallback Fill' },
  { key: 'resume_verify', label: 'Re-run Dual LLM Verification' },
  { key: 'job_match_rerank', label: 'LLM Job Match Re-rank' }
];

function formatPrice(priceInr: number, priceUsd: number, currency: BillingCurrency): string {
  if (priceInr === 0 && priceUsd === 0) return currency === 'INR' ? '₹0' : '$0';
  return currency === 'INR' ? `₹${priceInr.toLocaleString('en-IN')}` : `$${priceUsd}`;
}

function formatInterval(interval: 'free' | 'monthly' | 'one_time_90d'): string {
  if (interval === 'free') return 'forever';
  if (interval === 'monthly') return '/ month';
  return 'one-time · 90 days';
}

export default function BillingPage() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [currency, setCurrency] = useState<BillingCurrency>('INR');
  const [activeTab, setActiveTab] = useState<BillingTab>('plans');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getBillingStatus();
      setSnapshot(data);
      setCachedBillingSnapshot(data);
      setCurrency(data.subscription.billingCurrency);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load plan & credits.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const handleCurrencyChange = async (next: BillingCurrency) => {
    setCurrency(next);
    if (!snapshot) return;
    try {
      const updated = await api.updateBillingPreferences({ billingCurrency: next });
      setSnapshot(updated);
      setCachedBillingSnapshot(updated);
    } catch {
      // Keep local currency selection even if preference update fails transiently
    }
  };

  const handleSelectPlan = async (planId: PlanId) => {
    setBusyKey(`plan:${planId}`);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.createCheckout({ kind: 'plan', planId, currency });
      if (res.mode === 'redirect' && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      setSnapshot(res.snapshot);
      setCachedBillingSnapshot(res.snapshot);
      setStatusMsg(res.message);
      moToast(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Plan change failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleBuyTopup = async (packId: CreditPackId) => {
    setBusyKey(`pack:${packId}`);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.createCheckout({ kind: 'topup', packId, currency });
      if (res.mode === 'redirect' && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      setSnapshot(res.snapshot);
      setCachedBillingSnapshot(res.snapshot);
      setStatusMsg(res.message);
      moToast(res.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Top-up purchase failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const sub = snapshot?.subscription;
  const currentPlanId = sub?.planId ?? 'free';

  return (
    <AppShell
      title="Plans & Credits"
      subtitle="Managed AI included on every plan — or toggle Developer BYOK in Settings."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {snapshot?.demoBillingEnabled ? (
            <Badge tone="accent">Sandbox Instant Checkout</Badge>
          ) : null}
          <div className="inline-flex border border-[var(--hairline-strong)] rounded-[4px] overflow-hidden">
            {(['INR', 'USD'] as BillingCurrency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => void handleCurrencyChange(c)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  currency === c
                    ? 'bg-[var(--ink)] text-[var(--on-primary)] font-bold'
                    : 'bg-[var(--canvas)] text-[var(--mute)] hover:text-[var(--ink)]'
                }`}
              >
                {c === 'INR' ? 'INR (₹)' : 'USD ($)'}
              </button>
            ))}
          </div>
          <Link href="/settings#byok">
            <Button variant="secondary" size="sm">
              BYOK Key
            </Button>
          </Link>
        </div>
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {loading ? (
        <div className="space-y-6">
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-96 w-full" />
        </div>
      ) : snapshot && sub ? (
        <div className="space-y-6">
          {/* Compact 4-Cell Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--hairline)] border border-[var(--hairline)]">
            <div className="p-4 bg-[var(--surface-soft)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Current Plan
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-base font-bold text-[var(--ink)]">{snapshot.plan.name}</span>
                <Badge tone={currentPlanId === 'free' ? 'neutral' : 'dark'}>
                  {sub.status.toUpperCase()}
                </Badge>
              </div>
            </div>

            <div className="p-4 bg-[var(--surface-soft)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Credits Remaining
              </div>
              <div className="text-base font-bold text-[var(--ink)] tabular-nums mt-1">
                {snapshot.totalCreditsRemaining}{' '}
                <span className="text-xs font-normal text-[var(--mute)]">
                  ({sub.monthlyCreditsRemaining} plan + {sub.topupCreditsRemaining} top-up)
                </span>
              </div>
            </div>

            <div className="p-4 bg-[var(--surface-soft)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Execution Mode
              </div>
              <div className="text-base font-bold text-[var(--ink)] mt-1">
                {snapshot.executionMode === 'byok'
                  ? 'Developer BYOK (0 cr)'
                  : sub.aiModePreference === 'precision'
                    ? 'Managed · Precision'
                    : 'Managed · Fast'}
              </div>
            </div>

            <div className="p-4 bg-[var(--surface-soft)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                {currentPlanId === 'sprint_90' ? 'Pass Expires' : 'Period Resets'}
              </div>
              <div className="text-base font-bold text-[var(--ink)] tabular-nums mt-1">
                {new Date(sub.currentPeriodEnd).toLocaleDateString()}
              </div>
            </div>
          </div>

          <TabStrip<BillingTab>
            label="Plans and credit views"
            activeTab={activeTab}
            onChange={setActiveTab}
            tabs={[
              { id: 'plans', label: 'Plans' },
              { id: 'topups', label: 'Top-Up Packs', badge: PACK_ORDER.length },
              { id: 'history', label: 'Credit History', badge: snapshot.recentLedger.length }
            ]}
          />

          {activeTab === 'plans' ? (
            <div role="tabpanel" aria-label="Plans" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
                {PLAN_ORDER.map((planId) => {
                  const plan = PLAN_CATALOG[planId];
                  const isCurrent = currentPlanId === planId;
                  const priceText = formatPrice(plan.priceInr, plan.priceUsd, currency);
                  const isBusy = busyKey === `plan:${planId}`;

                  return (
                    <div
                      key={planId}
                      className={`flex flex-col justify-between border p-5 space-y-5 ${
                        isCurrent
                          ? 'border-[var(--ink)] bg-[var(--surface-soft)]'
                          : 'border-[var(--hairline)] bg-[var(--canvas)]'
                      }`}
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h2 className="text-base font-bold text-[var(--ink)]">{plan.name}</h2>
                            <p className="text-xs text-[var(--mute)] mt-1">{plan.tagline}</p>
                          </div>
                          {plan.highlightBadge ? (
                            <Badge tone={isCurrent ? 'dark' : 'accent'}>
                              {plan.highlightBadge}
                            </Badge>
                          ) : null}
                        </div>

                        <div className="pt-2 border-t border-[var(--hairline)]">
                          <span className="text-2xl font-bold text-[var(--ink)] tabular-nums">
                            {priceText}
                          </span>{' '}
                          <span className="text-xs text-[var(--mute)]">
                            {formatInterval(plan.billingInterval)}
                          </span>
                        </div>

                        <ul className="space-y-2 text-xs text-[var(--body)] list-none p-0 m-0">
                          {plan.features.map((feat) => (
                            <li key={feat} className="flex items-start gap-2">
                              <span
                                aria-hidden="true"
                                className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[var(--mute)] shrink-0"
                              />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="pt-2 border-t border-[var(--hairline)]">
                        {isCurrent ? (
                          <Button variant="secondary" size="sm" className="w-full" disabled>
                            Current Plan
                          </Button>
                        ) : (
                          <Button
                            variant={planId === 'pro' || planId === 'plus' ? 'primary' : 'secondary'}
                            size="sm"
                            className="w-full"
                            disabled={busyKey !== null}
                            onClick={() => void handleSelectPlan(planId)}
                          >
                            {isBusy
                              ? 'Updating...'
                              : planId === 'free'
                                ? 'Switch to Free'
                                : planId === 'sprint_90'
                                  ? 'Get 90-Day Pass'
                                  : `Upgrade to ${plan.name}`}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Disclosure
                title="How credits work — Cost per AI action"
                summaryMeta={<Badge tone="neutral">0 cr for matching &amp; PDF export</Badge>}
              >
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Credit cost schedule"
                  className="oc-table-wrap"
                >
                  <table className="oc-table text-xs">
                    <thead>
                      <tr className="text-[var(--mute)]">
                        <th className="py-2 pr-4">Action</th>
                        <th className="py-2 pr-4">Fast Mode</th>
                        <th className="py-2 pr-4">Precision Mode (Plus)</th>
                        <th className="py-2">BYOK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ACTION_LABELS.map((item) => (
                        <tr key={item.key}>
                          <td data-label="Action" className="py-2.5 pr-4 font-medium text-[var(--ink)]">
                            {item.label}
                          </td>
                          <td data-label="Fast Mode" className="py-2.5 pr-4">
                            {CREDIT_COSTS[item.key].fast} cr
                          </td>
                          <td data-label="Precision Mode" className="py-2.5 pr-4">
                            {CREDIT_COSTS[item.key].precision} cr
                          </td>
                          <td data-label="BYOK" className="py-2.5 text-[var(--mute)]">
                            0 cr
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td data-label="Action" className="py-2.5 pr-4 font-medium text-[var(--ink)]">
                          Matching, ATS Score, PDF Export, Tracker, Core Autofill
                        </td>
                        <td
                          data-label="Fast Mode"
                          className="py-2.5 pr-4 text-[var(--success-text)] font-bold"
                        >
                          0 cr
                        </td>
                        <td
                          data-label="Precision Mode"
                          className="py-2.5 pr-4 text-[var(--success-text)] font-bold"
                        >
                          0 cr
                        </td>
                        <td data-label="BYOK" className="py-2.5 text-[var(--success-text)] font-bold">
                          0 cr
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Disclosure>
            </div>
          ) : null}

          {activeTab === 'topups' ? (
            <div role="tabpanel" aria-label="Top-Up Packs">
              <SectionBlock
                title="Non-Expiring Top-Up Packs"
                description="Monthly plan credits are spent first. Top-up credits carry over indefinitely across periods."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PACK_ORDER.map((packId) => {
                    const pack = CREDIT_PACKS[packId];
                    const isBusy = busyKey === `pack:${packId}`;
                    return (
                      <div
                        key={packId}
                        className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-5 flex flex-wrap items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-[var(--ink)]">{pack.name}</h3>
                            <Badge tone="success">Never Expires</Badge>
                          </div>
                          <p className="text-xs text-[var(--mute)]">{pack.tagline}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold text-[var(--ink)] tabular-nums">
                            {formatPrice(pack.priceInr, pack.priceUsd, currency)}
                          </span>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busyKey !== null}
                            onClick={() => void handleBuyTopup(packId)}
                          >
                            {isBusy ? 'Adding...' : 'Add Credits'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionBlock>
            </div>
          ) : null}

          {activeTab === 'history' ? (
            <div role="tabpanel" aria-label="Credit History">
              <SectionBlock
                title="Recent Credit Ledger"
                action={
                  <Link href="/usage" className="text-xs font-medium text-[var(--ink)] underline">
                    View AI activity logs →
                  </Link>
                }
              >
                {snapshot.recentLedger.length === 0 ? (
                  <p className="text-xs text-[var(--mute)]">No credit movements recorded yet.</p>
                ) : (
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Recent credit ledger"
                    className="oc-table-wrap"
                  >
                    <table className="oc-table text-xs">
                      <thead>
                        <tr className="text-[var(--mute)]">
                          <th className="py-2 pr-4">Event</th>
                          <th className="py-2 pr-4">Bucket</th>
                          <th className="py-2 pr-4">Mode</th>
                          <th className="py-2 pr-4">Delta</th>
                          <th className="py-2 pr-4">Balance After</th>
                          <th className="py-2">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recentLedger.map((entry) => (
                          <tr key={entry.id}>
                            <td data-label="Event" className="py-2.5 pr-4 font-medium text-[var(--ink)]">
                              {entry.reason}
                            </td>
                            <td data-label="Bucket" className="py-2.5 pr-4 uppercase text-[var(--mute)]">
                              {entry.bucket}
                            </td>
                            <td data-label="Mode" className="py-2.5 pr-4">
                              {entry.aiMode ?? '—'}
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
