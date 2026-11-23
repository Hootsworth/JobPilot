'use client';

import React, { useEffect, useState } from 'react';
import {
  COMMON_QUESTION_TEMPLATES,
  type SavedAnswer,
  type UpsertSavedAnswerRequest
} from '@jobpilot/shared';
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
  SkeletonBlock,
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

const EMPTY_ANSWER: UpsertSavedAnswerRequest = {
  questionKey: '',
  questionPattern: '',
  answer: '',
  tags: []
};

export default function SavedAnswersPage() {
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UpsertSavedAnswerRequest>(EMPTY_ANSWER);
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedAnswer | null>(null);

  useEffect(() => {
    api
      .listAnswers()
      .then(setAnswers)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to load answers.'))
      .finally(() => setLoading(false));
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_ANSWER);
    setTagsText('');
  };

  const applyTemplate = (tpl: (typeof COMMON_QUESTION_TEMPLATES)[number]) => {
    setEditingId(null);
    setForm({
      questionKey: tpl.questionKey,
      questionPattern: tpl.questionPattern,
      answer: '',
      tags: [...tpl.tags]
    });
    setTagsText(tpl.tags.join(', '));
  };

  const startEdit = (item: SavedAnswer) => {
    setEditingId(item.id);
    setForm({
      questionKey: item.questionKey,
      questionPattern: item.questionPattern,
      answer: item.answer,
      tags: item.tags
    });
    setTagsText(item.tags.join(', '));
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const payload: UpsertSavedAnswerRequest = {
      questionKey: form.questionKey.trim() || 'custom_question',
      questionPattern: form.questionPattern.trim(),
      answer: form.answer.trim(),
      tags: tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    };

    try {
      if (editingId) {
        const updated = await api.updateAnswer(editingId, payload);
        setAnswers((prev) => prev.map((a) => (a.id === editingId ? updated : a)));
        setSuccessMsg('Updated saved answer.');
      } else {
        const created = await api.createAnswer(payload);
        setAnswers((prev) => [created, ...prev]);
        setSuccessMsg('Added saved answer.');
      }
      resetForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save answer.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await api.deleteAnswer(id);
      setAnswers((prev) => prev.filter((a) => a.id !== id));
      if (editingId === id) resetForm();
      setSuccessMsg('Deleted saved answer.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete saved answer.');
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? answers.filter(
        (a) =>
          a.questionPattern.toLowerCase().includes(q) ||
          a.questionKey.toLowerCase().includes(q) ||
          a.answer.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
      )
    : answers;

  return (
    <AppShell
      title="Saved Answers"
      subtitle="Reusable responses for recurring India & global job application questions (CTC, notice period, relocation, motivation)."
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {successMsg ? <AlertBanner tone="success" message={successMsg} /> : null}

      <SectionBlock title="Quick-Start Question Templates" marker="[>]">
        <div className="flex flex-wrap gap-2">
          {COMMON_QUESTION_TEMPLATES.map((tpl) => (
            <Button
              key={tpl.questionKey}
              size="sm"
              variant="secondary"
              onClick={() => applyTemplate(tpl)}
            >
              [+] {tpl.questionKey}
            </Button>
          ))}
        </div>
      </SectionBlock>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2">
          <SectionBlock title={editingId ? 'Edit Saved Answer' : 'New Saved Answer'}>
            <form onSubmit={handleSave} className="space-y-4">
              <Field
                label="Question Key"
                htmlFor="ans-key"
                hint="Slug identifier (e.g. ctc_expectation_india)"
                required
              >
                {(props) => (
                  <Input
                    {...props}
                    required
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={form.questionKey}
                    onChange={(e) => setForm({ ...form, questionKey: e.target.value })}
                    placeholder="why_this_company"
                  />
                )}
              </Field>

              <Field label="Question Pattern" htmlFor="ans-pattern" required>
                {(props) => (
                  <Input
                    {...props}
                    required
                    value={form.questionPattern}
                    onChange={(e) => setForm({ ...form, questionPattern: e.target.value })}
                    placeholder="What is your expected CTC (LPA)?"
                  />
                )}
              </Field>

              <Field label="Saved Answer" htmlFor="ans-body" required>
                {(props) => (
                  <Textarea
                    {...props}
                    rows={5}
                    required
                    value={form.answer}
                    onChange={(e) => setForm({ ...form, answer: e.target.value })}
                    placeholder="Write your clear, reusable answer..."
                  />
                )}
              </Field>

              <Field label="Tags" htmlFor="ans-tags" hint="Comma-separated">
                {(props) => (
                  <Input
                    {...props}
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="india, compensation, behavioral"
                  />
                )}
              </Field>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Answer' : 'Save Answer'}
                </Button>
                {editingId ? (
                  <Button variant="secondary" onClick={resetForm}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </SectionBlock>
        </div>

        <div className="xl:col-span-3">
          <SectionBlock
            title={`Saved Answers (${filtered.length})`}
            action={
              <search>
                <Input
                  type="search"
                  aria-label="Filter saved answers"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search questions or tags..."
                  className="min-h-[36px] text-xs w-56"
                />
              </search>
            }
          >
            {loading ? (
              <div className="space-y-3">
                <SkeletonBlock className="h-20 w-full" />
                <SkeletonBlock className="h-20 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No saved answers found"
                description="Use a quick-start template above or create a custom response for recurring form prompts."
              />
            ) : (
              <div className="divide-y divide-[var(--hairline)]">
                {filtered.map((item) => (
                  <article key={item.id} className="py-4 first:pt-0 last:pb-0 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs text-[var(--mute)]">{item.questionKey}</p>
                        <h3 className="text-sm font-bold text-[var(--ink)]">
                          {item.questionPattern}
                        </h3>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => startEdit(item)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(item)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-[var(--body)] whitespace-pre-wrap">{item.answer}</p>
                    {item.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.tags.map((tag) => (
                          <Badge key={tag} tone="neutral">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
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
        title="Delete Saved Answer?"
        description={`Delete "${deleteTarget?.questionPattern ?? ''}"?`}
        confirmLabel="Delete answer"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}
