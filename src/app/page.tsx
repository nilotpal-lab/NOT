"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search,
  BookOpen,
  FileText,
  Presentation,
  Download,
  Eye,
  ChevronDown,
  Layers,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { ChapterWithFiles, FileRecord } from "@/types/database";
import { PdfReaderModal, PptxOptionModal } from "@/components/ReaderModals";
import { FloatingTutor } from "@/components/FloatingTutor";

const CLASSES = [6, 7, 8, 9, 10];
const SUBJECTS = [
  { id: "all", label: "All Subjects", color: "bg-[var(--muted)] text-[var(--foreground)]" },
  { id: "History", label: "History", color: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" },
  { id: "Geography", label: "Geography", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  { id: "Civics", label: "Civics", color: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" },
  { id: "Economics", label: "Economics", color: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300" },
  { id: "SocialScience", label: "Social Science", color: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function StudentHomePage() {
  const [selectedClass, setSelectedClass] = useState<number>(7);
  const [selectedSubject, setSelectedSubject] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [chapters, setChapters] = useState<ChapterWithFiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Accordion state
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});

  // Modals state
  const [readerModal, setReaderModal] = useState<{
    isOpen: boolean;
    fileId: string;
    fileName: string;
  }>({
    isOpen: false,
    fileId: "",
    fileName: "",
  });

  const [pptxModal, setPptxModal] = useState<{
    isOpen: boolean;
    pptxFile: FileRecord | null;
    pairedPdfFile: FileRecord | null;
  }>({
    isOpen: false,
    pptxFile: null,
    pairedPdfFile: null,
  });

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedClass) params.set("class", String(selectedClass));
      if (selectedSubject !== "all") params.set("subject", selectedSubject);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const res = await fetch(`/api/catalog?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load chapters (${res.status})`);
      }
      const data = await res.json();
      setChapters(data.chapters || []);

      // Auto-expand first 3 chapters by default
      const initialExpanded: Record<string, boolean> = {};
      (data.chapters || []).forEach((c: ChapterWithFiles, index: number) => {
        initialExpanded[c.id] = index < 3;
      });
      setExpandedChapters(initialExpanded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [selectedClass, selectedSubject, searchQuery]);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((prev) => ({
      ...prev,
      [chapterId]: !prev[chapterId],
    }));
  };

  const handleFileClick = (file: FileRecord, allFilesInChapter: FileRecord[]) => {
    if (file.kind === "ppt") {
      // Find paired PDF preview if present
      const pairedPdf = allFilesInChapter.find(
        (f) =>
          f.kind === "ppt_pdf" &&
          (f.parent_file_id === file.id || f.file_name.replace(".pdf", "") === file.file_name.replace(".pptx", ""))
      ) || null;

      setPptxModal({
        isOpen: true,
        pptxFile: file,
        pairedPdfFile: pairedPdf,
      });
    } else {
      // Direct PDF reader stream
      setReaderModal({
        isOpen: true,
        fileId: file.id,
        fileName: file.file_name,
      });
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Hero Welcome Card in Soft Pop Style */}
      <section className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-[var(--card)] via-[var(--card)] to-[var(--muted)]/50 border border-[var(--border)] shadow-sm relative overflow-hidden">
        <div className="max-w-2xl space-y-2.5 relative z-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[var(--primary)]/15 text-[var(--primary)]">
            <Sparkles className="w-3.5 h-3.5" />
            Teacher & Student Dedicated NCERT Portal
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-[var(--foreground)]">
            Social Science Study Library
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">
            Direct chapter access, notes, textbooks, and interactive presentations for Classes 6 to 10. Read online with instant streaming or download files in one click.
          </p>
        </div>

        {/* Decorative Soft Pop Blob */}
        <div className="absolute right-0 top-0 w-64 h-64 bg-gradient-to-bl from-[var(--primary)]/10 to-[var(--secondary)]/10 rounded-full blur-2xl pointer-events-none -mr-16 -mt-16" />
      </section>

      {/* Sticky Horizontal Navigation for Classes & Subjects */}
      <div className="sticky top-[57px] z-30 pt-2 pb-3 bg-[var(--background)]/90 backdrop-blur-md space-y-3">
        {/* Class Selection Tabs (Pill Style) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] px-2 shrink-0 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> Class:
          </span>
          {CLASSES.map((cls) => {
            const isSelected = selectedClass === cls;
            return (
              <button
                key={cls}
                onClick={() => setSelectedClass(cls)}
                className={`px-5 py-2 rounded-2xl text-xs sm:text-sm font-bold transition-all shrink-0 cursor-pointer shadow-xs ${
                  isSelected
                    ? "bg-[var(--primary)] text-white shadow-md shadow-[var(--primary)]/20 scale-105"
                    : "bg-[var(--card)] text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--primary)]/50 hover:bg-[var(--muted)]"
                }`}
              >
                Class {cls}
              </button>
            );
          })}
        </div>

        {/* Subject Chips & Search Bar Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {SUBJECTS.map((sub) => {
              const isSelected = selectedSubject === sub.id;
              return (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSubject(sub.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    isSelected
                      ? "bg-[var(--foreground)] text-[var(--card)] shadow-xs"
                      : "bg-[var(--card)] text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="w-4 h-4 text-[var(--muted-foreground)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search chapters & files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-hidden focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>
        </div>
      </div>

      {/* Chapters & Content Feed */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-6 rounded-3xl border border-[var(--border)] bg-[var(--card)] animate-pulse">
              <div className="h-6 bg-[var(--muted)] rounded-xl w-1/3 mb-4"></div>
              <div className="h-4 bg-[var(--muted)]/60 rounded-xl w-2/3"></div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="p-6 rounded-3xl border border-red-200 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchCatalog}
            className="px-3.5 py-1.5 rounded-full bg-red-100 dark:bg-red-900/60 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      ) : chapters.length === 0 ? (
        <div className="p-12 rounded-3xl border border-dashed border-[var(--border)] bg-[var(--card)] text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center mx-auto text-xl font-bold">
            📖
          </div>
          <h3 className="text-base font-bold text-[var(--foreground)]">No chapters available yet</h3>
          <p className="text-xs text-[var(--muted-foreground)] max-w-sm mx-auto">
            Your teacher has not uploaded any published materials for Class {selectedClass} in this subject category.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {chapters.map((chapter) => {
            const isExpanded = expandedChapters[chapter.id] !== false;
            const files = chapter.files || [];

            return (
              <div
                key={chapter.id}
                className="rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-xs overflow-hidden transition-all duration-200 hover:shadow-md"
              >
                {/* Chapter Card Header */}
                <div
                  onClick={() => toggleChapter(chapter.id)}
                  className="p-5 sm:p-6 flex items-center justify-between gap-4 cursor-pointer select-none bg-[var(--card)] hover:bg-[var(--muted)]/40 transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[var(--primary)]/20 to-[var(--primary)]/5 text-[var(--primary)] font-extrabold text-sm flex items-center justify-center shrink-0 border border-[var(--primary)]/20">
                      {chapter.chapter_no}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                          Ch {chapter.chapter_no}
                        </span>
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                          {chapter.subject}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-[var(--foreground)] truncate tracking-tight">
                        {chapter.title}
                      </h3>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)] hidden sm:inline-block">
                      {files.length} {files.length === 1 ? "resource" : "resources"}
                    </span>
                    <div className={`p-1.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)] transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                {/* Chapter Resources List */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] px-4 sm:px-6 py-4 bg-[var(--background)]/40 space-y-3">
                    {files.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)] text-center py-3">
                        No materials attached to this chapter.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {files.map((file) => {
                          const isPpt = file.kind === "ppt";
                          const isPdf = !isPpt;

                          return (
                            <div
                              key={file.id}
                              className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xs hover:border-[var(--primary)]/60 transition-all flex items-center justify-between gap-3 group"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                    isPpt
                                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                      : "bg-[var(--primary)]/15 text-[var(--primary)]"
                                  }`}
                                >
                                  {isPpt ? (
                                    <Presentation className="w-4 h-4" />
                                  ) : (
                                    <FileText className="w-4 h-4" />
                                  )}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-semibold text-xs text-[var(--foreground)] truncate group-hover:text-[var(--primary)] transition-colors">
                                    {file.file_name}
                                  </div>
                                  <div className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-2 mt-0.5">
                                    <span>{formatBytes(file.size_bytes)}</span>
                                    <span>•</span>
                                    <span className="capitalize">{file.kind.replace("_", " ")}</span>
                                    {file.teacher_name && (
                                      <>
                                        <span>•</span>
                                        <span>By {file.teacher_name}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => handleFileClick(file, files)}
                                  className="px-3 py-1.5 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs transition-transform active:scale-95"
                                  title="Read online"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>{isPpt ? "Options" : "Read"}</span>
                                </button>

                                <a
                                  href={`/api/files/${file.id}/download`}
                                  download={file.file_name}
                                  className="p-1.5 rounded-full border border-[var(--border)] hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                                  title="Download File"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Interactive PDF Reader Modal */}
      <PdfReaderModal
        isOpen={readerModal.isOpen}
        fileId={readerModal.fileId}
        fileName={readerModal.fileName}
        onClose={() => setReaderModal({ isOpen: false, fileId: "", fileName: "" })}
      />

      {/* Interactive PPTX Options Modal */}
      <PptxOptionModal
        isOpen={pptxModal.isOpen}
        pptxFile={pptxModal.pptxFile}
        pairedPdfFile={pptxModal.pairedPdfFile}
        onClose={() => setPptxModal({ isOpen: false, pptxFile: null, pairedPdfFile: null })}
        onSelectPreview={(fileId, fileName) => {
          setReaderModal({
            isOpen: true,
            fileId,
            fileName,
          });
        }}
      />

      {/* Floating Indian Traditional AI Tutor */}
      <FloatingTutor
        currentClass={selectedClass}
        currentSubject={selectedSubject}
      />
    </div>
  );
}
