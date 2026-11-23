'use client';

import React, { useEffect, useState } from 'react';
import type { ProfileStory, StoryMetric, UpsertStoryRequest } from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  SectionBlock,
  Select,
  SkeletonBlock,
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

const EMPTY_FORM: UpsertStoryRequest = {
  title: '',
  category: 'project',
  situation: '',
  task: '',
  action: '',
  result: '',
  metrics: [],
  skillsUsed: []
};

export default function StoriesPage() {
  const [stories, setStories] = useState<ProfileStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UpsertStoryRequest>(EMPTY_FORM);
  const [skillsText, setSkillsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProfileStory | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const loadStories = async () => {
    setLoading(true);
    try {
      const data = await api.listStories();
      setStories(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load story bank.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStories();
  }, []);

  const resetEditor = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSkillsText('');
  };

  const startEdit = (story: ProfileStory) => {
    setEditingId(story.id);
    setForm({
      title: story.title,
      category: story.category,
      situation: story.situation,
      task: story.task,
      action: story.action,
      result: story.result,
      metrics: story.metrics,
      skillsUsed: story.skillsUsed,
      linkedExperienceId: story.linkedExperienceId
    });
    setSkillsText(story.skillsUsed.join(', '));
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const addMetricRow = () => {
    setForm({
      ...form,
      metrics: [...form.metrics, { label: '', value: '', unit: '' }]
    });
  };

  const updateMetric = (idx: number, patch: Partial<StoryMetric>) => {
    const next = [...form.metrics];
    const current = next[idx];
    if (!current) return;
    next[idx] = { ...current, ...patch };
    setForm({ ...form, metrics: next });
  };

  const removeMetric = (idx: number) => {
    setForm({ ...form, metrics: form.metrics.filter((_, i) => i !== idx) });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload: UpsertStoryRequest = {
      ...form,
      title: form.title.trim(),
      metrics: form.metrics.filter((m) => m.label.trim() && m.value.trim()),
      skillsUsed: skillsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    };

    try {
      if (editingId) {
        const updated = await api.updateStory(editingId, payload);
        setStories((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
        setSuccessMsg('Updated story.');
      } else {
        const created = await api.createStory(payload);
        setStories((prev) => [created, ...prev]);
        setSuccessMsg('Added story to Story Bank.');
      }
      resetEditor();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save story.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await api.deleteStory(id);
      setStories((prev) => prev.filter((s) => s.id !== id));
      if (editingId === id) resetEditor();
      setSuccessMsg('Story deleted.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete story.');
    }
  };

  const visibleStories =
    categoryFilter === 'all' ? stories : stories.filter((s) => s.category === categoryFilter);

  return (
    <AppShell
      title="Story Bank"
      subtitle="Grounded STAR stories and verified numeric metrics used during resume tailoring and application form drafting."
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {successMsg ? <AlertBanner tone="success" message={successMsg} /> : null}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2">
          <SectionBlock title={editingId ? 'Edit Story' : 'Add STAR Story'}>
            <form onSubmit={handleSave} className="space-y-4">
              <Field label="Story Title" htmlFor="story-title" required>
                {(props) => (
                  <Input
                    {...props}
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Cut checkout p95 latency by 62%"
                  />
                )}
              </Field>

              <Field label="Category" htmlFor="story-cat">
                {(props) => (
                  <Select
                    {...props}
                    value={form.category}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        category: e.target.value as UpsertStoryRequest['category']
                      })
                    }
                  >
                    <option value="project">Project</option>
                    <option value="optimization">Optimization</option>
                    <option value="incident">Incident / Debugging</option>
                    <option value="leadership">Leadership</option>
                    <option value="academic">Academic / Research</option>
                    <option value="hackathon">Hackathon</option>
                    <option value="other">Other</option>
                  </Select>
                )}
              </Field>

              <Field label="Situation" htmlFor="story-s">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={form.situation}
                    onChange={(e) => setForm({ ...form, situation: e.target.value })}
                    placeholder="Context & bottleneck..."
                  />
                )}
              </Field>

              <Field label="Task" htmlFor="story-t">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={form.task}
                    onChange={(e) => setForm({ ...form, task: e.target.value })}
                    placeholder="Your specific ownership..."
                  />
                )}
              </Field>

              <Field label="Action" htmlFor="story-a">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={form.action}
                    onChange={(e) => setForm({ ...form, action: e.target.value })}
                    placeholder="Architecture decisions, tools, and implementation..."
                  />
                )}
              </Field>

              <Field label="Result" htmlFor="story-r">
                {(props) => (
                  <Textarea
                    {...props}
                    rows={2}
                    value={form.result}
                    onChange={(e) => setForm({ ...form, result: e.target.value })}
                    placeholder="Verified outcome..."
                  />
                )}
              </Field>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--ink)]">
                    Quantified Metrics
                  </span>
                  <Button size="sm" variant="secondary" onClick={addMetricRow}>
                    [+] Metric
                  </Button>
                </div>
                {form.metrics.map((metric, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <Input
                        aria-label={`Metric ${idx + 1} label`}
                        placeholder="p95 latency"
                        value={metric.label}
                        onChange={(e) => updateMetric(idx, { label: e.target.value })}
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        aria-label={`Metric ${idx + 1} value`}
                        placeholder="62"
                        value={metric.value}
                        onChange={(e) => updateMetric(idx, { value: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        aria-label={`Metric ${idx + 1} unit`}
                        placeholder="%"
                        value={metric.unit ?? ''}
                        onChange={(e) => updateMetric(idx, { unit: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMetric(idx)}
                        aria-label={`Remove metric ${idx + 1}`}
                      >
                        [x]
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Field
                label="Skills Used"
                htmlFor="story-skills"
                hint="Comma-separated (e.g. TypeScript, PostgreSQL, Redis)"
              >
                {(props) => (
                  <Input
                    {...props}
                    value={skillsText}
                    onChange={(e) => setSkillsText(e.target.value)}
                    placeholder="Node.js, Redis, PostgreSQL"
                  />
                )}
              </Field>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Story' : 'Save Story'}
                </Button>
                {editingId ? (
                  <Button variant="secondary" onClick={resetEditor}>
                    Cancel Edit
                  </Button>
                ) : null}
              </div>
            </form>
          </SectionBlock>
        </div>

        <div className="xl:col-span-3 space-y-4">
          <SectionBlock
            title={`Saved Stories (${visibleStories.length})`}
            action={
              <Select
                aria-label="Filter stories by category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-auto min-h-[36px] text-xs py-1"
              >
                <option value="all">All categories</option>
                <option value="project">Project</option>
                <option value="optimization">Optimization</option>
                <option value="incident">Incident</option>
                <option value="leadership">Leadership</option>
                <option value="academic">Academic</option>
                <option value="hackathon">Hackathon</option>
                <option value="other">Other</option>
              </Select>
            }
          >
            {loading ? (
              <div className="space-y-3">
                <SkeletonBlock className="h-24 w-full" />
                <SkeletonBlock className="h-24 w-full" />
              </div>
            ) : visibleStories.length === 0 ? (
              <EmptyState
                title="No stories yet"
                description="Add concrete project or internship impact stories with real numbers. JobPilot's resume verifier checks tailored bullets against these facts."
              />
            ) : (
              <div className="divide-y divide-[var(--hairline)]">
                {visibleStories.map((story) => (
                  <article key={story.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-[var(--ink)]">{story.title}</h3>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <Badge tone="neutral">{story.category}</Badge>
                          {story.metrics.map((m, i) => (
                            <Badge key={i} tone="accent">
                              {m.label}: {m.value}
                              {m.unit}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => startEdit(story)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(story)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {story.action ? (
                      <p className="text-xs text-[var(--body)]">
                        <strong>Action:</strong> {story.action}
                      </p>
                    ) : null}
                    {story.result ? (
                      <p className="text-xs text-[var(--body)]">
                        <strong>Result:</strong> {story.result}
                      </p>
                    ) : null}
                    {story.skillsUsed.length > 0 ? (
                      <p className="text-xs text-[var(--mute)]">
                        Skills: {story.skillsUsed.join(' · ')}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </SectionBlock>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Story?"
        description={`Remove "${deleteTarget?.title ?? ''}" from your Story Bank? This cannot be undone.`}
        confirmLabel="Delete story"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
