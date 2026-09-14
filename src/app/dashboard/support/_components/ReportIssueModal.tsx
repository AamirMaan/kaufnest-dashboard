"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppDispatch } from "@/store/hooks";
import { submitReport, fetchReports } from "../_store/supportSlice";
import { validateAttachments, ALLOWED_MIME_TYPES } from "../_lib/attachmentRules";
import type { BugReportType, BugSeverity } from "@/types";

const FORM_ID = "report-issue-form";

const TYPE_OPTIONS: { value: BugReportType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "question", label: "Question" },
];

const SEVERITY_OPTIONS: { value: BugSeverity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function ReportIssueModal({
  open,
  onClose,
  pageUrl,
}: {
  open: boolean;
  onClose: () => void;
  pageUrl?: string;
}) {
  const dispatch = useAppDispatch();
  const toast = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<BugReportType>("bug");
  const [severity, setSeverity] = useState<BugSeverity>("normal");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Native `required` blocks submission but leaves the button looking
  // clickable — this is what actually disables it.
  const isFormValid =
    title.trim().length > 0 && description.trim().length >= 20 && !fileError && !saving;

  function onFilesPicked(picked: FileList | null) {
    const next = Array.from(picked ?? []);
    setFileError(
      validateAttachments(next.map((f) => ({ name: f.name, size: f.size, type: f.type })))
    );
    setFiles(next);
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setType("bug");
    setSeverity("normal");
    setFiles([]);
    setFileError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid) return;

    setSaving(true);
    const form = new FormData();
    form.append("title", title.trim());
    form.append("description", description.trim());
    form.append("type", type);
    form.append("severity", severity);
    if (pageUrl) form.append("pageUrl", pageUrl);
    for (const file of files) form.append("files", file);

    try {
      const result = await dispatch(submitReport(form)).unwrap();
      if (result.warning) {
        toast.warning("Report sent", result.warning);
      } else {
        toast.success("Report sent", "We'll post updates on this page.");
      }
      await dispatch(fetchReports());
      resetForm();
      onClose();
    } catch (err) {
      toast.error("Could not send", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Report an issue"
      open={open}
      onClose={handleClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={saving || !isFormValid}>
            {saving ? "Sending…" : "Send report"}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of the issue"
            required
          />
        </Field>

        <Field label="Description" required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="At least 20 characters — what you expected, and what happened"
            required
          />
        </Field>

        <Row>
          <Field label="Type" required>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as BugReportType)}
              required
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Severity" required>
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as BugSeverity)}
              required
            >
              {SEVERITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </Field>
        </Row>

        <Field label="Screenshots" error={fileError ?? undefined}>
          <Input
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            multiple
            onChange={(e) => onFilesPicked(e.target.files)}
          />
          <p className="mt-1 text-xs text-[var(--color-text-faint)]">
            Up to 3 images, 4 MB total.
          </p>
        </Field>
      </form>
    </Modal>
  );
}
