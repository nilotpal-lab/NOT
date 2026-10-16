"use client";

import React, { useEffect, useState } from "react";
import { X, ExternalLink, Download, FileText, Presentation, FileCode } from "lucide-react";

interface PptxOptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  pptxFile: {
    id: string;
    file_name: string;
    size_bytes: number;
    parent_file_id?: string | null;
  } | null;
  pairedPdfFile?: {
    id: string;
    file_name: string;
    size_bytes: number;
  } | null;
  onSelectPreview: (fileId: string, fileName: string) => void;
}

export function PptxOptionModal({
  isOpen,
  onClose,
  pptxFile,
  pairedPdfFile,
  onSelectPreview,
}: PptxOptionModalProps) {
  if (!isOpen || !pptxFile) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
    >
      <div className="w-full max-w-md p-6 rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-2xl space-y-5 animate-in zoom-in-95">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#fbbf24] to-[#f59e0b] flex items-center justify-center text-white shadow-sm">
              <Presentation className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-[var(--foreground)] tracking-tight">
                Presentation Options
              </h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                How would you like to view this slide deck?
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close presentation options"
            className="p-1 rounded-full text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3.5 rounded-2xl bg-[var(--muted)]/60 border border-[var(--border)]">
          <p className="font-mono text-xs font-semibold text-[var(--foreground)] truncate">
            {pptxFile.file_name}
          </p>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
            Size: {(pptxFile.size_bytes / (1024 * 1024)).toFixed(2)} MB
          </p>
        </div>

        <div className="space-y-2.5">
          {pairedPdfFile ? (
            <button
              onClick={() => {
                onClose();
                onSelectPreview(pairedPdfFile.id, pairedPdfFile.file_name);
              }}
              className="w-full p-4 rounded-2xl border-2 border-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-left transition-all flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </span>
                <div>
                  <div className="font-bold text-xs text-[var(--primary)]">
                    View Instant PDF Slide Preview (Recommended)
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    Opens directly in your browser reader without downloading
                  </div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-[var(--primary)] group-hover:translate-x-0.5 transition-transform" />
            </button>
          ) : (
            <div className="p-3 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-xl">
              No paired PDF preview available for in-browser rendering.
            </div>
          )}

          <a
            href={`/api/files/${pptxFile.id}/download`}
            download={pptxFile.file_name}
            className="w-full p-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)] text-left transition-all flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center">
                <Download className="w-4 h-4" />
              </span>
              <div>
                <div className="font-bold text-xs text-[var(--foreground)]">
                  Download Raw PowerPoint (.pptx)
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  Save file to open in MS PowerPoint, Google Slides, or WPS
                </div>
              </div>
            </div>
            <Download className="w-4 h-4 text-[var(--muted-foreground)] group-hover:translate-y-0.5 transition-transform" />
          </a>
        </div>
      </div>
    </div>
  );
}

interface PdfReaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
}

export function PdfReaderModal({
  isOpen,
  onClose,
  fileId,
  fileName,
}: PdfReaderModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !fileId) return null;

  const streamUrl = `/api/files/${fileId}/stream`;
  const downloadUrl = `/api/files/${fileId}/download`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in"
    >
      <div className="w-full h-[96vh] max-w-5xl rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
        {/* Header Bar */}
        <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-3 bg-[var(--card)]/90">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[var(--primary)] to-[var(--secondary)] flex items-center justify-center text-white shrink-0">
              <FileText className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[var(--foreground)] truncate tracking-tight">
                {fileName}
              </h3>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                Streaming directly from Telegram Storage (Zero-disk buffering)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={downloadUrl}
              download={fileName}
              className="px-3.5 py-1.5 rounded-full bg-[var(--secondary)] hover:bg-[var(--secondary)]/90 text-[var(--secondary-foreground)] text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save PDF</span>
            </a>

            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-full border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              title="Open full page"
            >
              <ExternalLink className="w-4 h-4" />
            </a>

            <button
              onClick={onClose}
              aria-label="Close reader"
              className="p-2 rounded-full border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
              title="Close reader"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Embedded Viewer with Fallback */}
        <div className="flex-1 w-full bg-[var(--muted)]/40 relative">
          <iframe
            src={streamUrl}
            className="w-full h-full border-0"
            title="PDF Document Viewer"
          />
        </div>
      </div>
    </div>
  );
}
