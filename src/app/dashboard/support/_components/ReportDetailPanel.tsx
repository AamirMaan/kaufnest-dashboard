"use client";

import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils/date";
import type { BugReport } from "@/types";

export function ReportDetailPanel({
  report,
  onClose,
}: {
  report: BugReport | null;
  onClose: () => void;
}) {
  if (!report) return null;

  const contextEntries = report.context ? Object.entries(report.context) : [];

  return (
    <Modal title={report.title} open={!!report} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge label={report.type} />
          <Badge label={report.severity} />
          <Badge label={report.status.replace("_", " ")} />
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-text-faint) mb-1">
            Description
          </h3>
          <p className="text-sm text-(--color-text-base) whitespace-pre-wrap">{report.description}</p>
        </div>

        {contextEntries.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-text-faint) mb-1">
              Context
            </h3>
            <div className="rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface-subtle) px-3 py-2 space-y-1">
              {contextEntries.map(([key, value]) => (
                <p key={key} className="text-xs text-(--color-text-muted)">
                  <span className="font-medium text-(--color-text-base)">{key}:</span>{" "}
                  {typeof value === "string" ? value : JSON.stringify(value)}
                </p>
              ))}
            </div>
          </div>
        )}

        {report.attachments.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-text-faint) mb-2">
              Attachments
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {report.attachments.map((a) => (
                <img
                  key={a.id}
                  src={`/api/support/reports/${report.id}/attachments/${a.id}`}
                  alt={a.name}
                  className="w-full aspect-square object-cover rounded-(--radius-btn) border border-(--color-border)"
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-(--color-text-faint) mb-2">
            Updates
          </h3>
          {report.replies && report.replies.length > 0 ? (
            <div className="space-y-3">
              {report.replies.map((reply) => (
                <div
                  key={reply.id}
                  className="rounded-(--radius-btn) border border-(--color-border) bg-(--color-surface-subtle) px-3 py-2"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-(--color-text-strong)">
                      {reply.author ?? "Support"}
                    </span>
                    <span className="text-[11px] text-(--color-text-faint)">
                      {formatDateTime(reply.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-(--color-text-base) whitespace-pre-wrap">{reply.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-(--color-text-muted)">
              No updates yet — we&apos;ll post here when there&apos;s news.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
