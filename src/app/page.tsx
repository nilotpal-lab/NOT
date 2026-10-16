"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  FileText,
  Presentation,
  Download,
  Eye,
  ChevronDown,
  RefreshCw,
  SlidersHorizontal,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { ChapterWithFiles, FileRecord } from "@/types/database";
import { PdfReaderModal, PptxOptionModal } from "@/components/ReaderModals";
import { FloatingTutor } from "@/components/FloatingTutor";

const CLASSES = [6, 7, 8, 9, 10];
const SUBJECTS = [
  { id: "all", label: "All Subjects" },
  { id: "History", label: "History" },
  { id: "Geography", label: "Geography" },
  { id: "Civics", label: "Civics" },
  { id: "Economics", label: "Economics" },
  { id: "SocialScience", label: "Social Science" },
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
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});

  const [readerModal, setReaderModal] = useState<{
    isOpen: boolean;
    fileId: string;
    fileName: string;
  }>({ isOpen: false, fileId: "", fileName: "" });

  const [pptxModal, setPptxModal] = useState<{
    isOpen: boolean;
    pptxFile: FileRecord | null;
    pairedPdfFile: FileRecord | null;
  }>({ isOpen: false, pptxFile: null, pairedPdfFile: null });

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedClass) params.set("class", String(selectedClass));
      if (selectedSubject !== "all") params.set("subject", selectedSubject);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());

      const res = await fetch(`/api/catalog?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load chapters (${res.status})`);
      const data = await res.json();
      setChapters(data.chapters || []);

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

  useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

  const toggleChapter = (id: string) =>
    setExpandedChapters((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleFileClick = (file: FileRecord, allFiles: FileRecord[]) => {
    if (file.kind === "ppt") {
      const paired =
        allFiles.find(
          (f) =>
            f.kind === "ppt_pdf" &&
            (f.parent_file_id === file.id ||
              f.file_name.replace(".pdf", "") === file.file_name.replace(".pptx", ""))
        ) || null;
      setPptxModal({ isOpen: true, pptxFile: file, pairedPdfFile: paired });
    } else {
      setReaderModal({ isOpen: true, fileId: file.id, fileName: file.file_name });
    }
  };

  const subjectLabel = SUBJECTS.find((s) => s.id === selectedSubject)?.label || "All Subjects";

  return (
    <div className="pb-24">
      {/* ── Hero Banner ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden mx-4 sm:mx-6 lg:mx-auto max-w-6xl mt-5 rounded-2xl bg-gradient-to-br from-[#e8eeff] via-[#dde4ff] to-[#cdd6ff] border border-[#c5ceff] shadow-sm">
        {/* Background decorative blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-white/40 to-transparent rounded-full -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-56 h-56 bg-gradient-to-tr from-[#6c72f8]/10 to-transparent rounded-full -ml-10 -mb-10" />
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4 px-8 sm:px-10 py-8 sm:py-10">
          {/* Left Text Content */}
          <div className="flex-1 space-y-3 max-w-md">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/70 text-[var(--primary)] border border-[var(--primary)]/20 backdrop-blur-sm">
              <Sparkles className="w-3 h-3" />
              Teacher &amp; Student Dedicated Portal
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-[#1a1f35] leading-tight">
              Social Science{" "}
              <span className="text-[var(--primary)]">Study Library</span>
            </h1>
            <p className="text-sm text-[#4a5380] leading-relaxed">
              Direct chapter access, notes, textbooks, and interactive presentations{" "}
              for Classes 6 to 10. Read online with instant streaming or download
              files in one click.
            </p>
          </div>

          {/* Right Illustration */}
          <div className="hidden md:flex shrink-0 items-end justify-center w-64 h-44 relative">
            {/* Floating education icons */}
            <div className="absolute top-2 left-8 w-11 h-11 rounded-full bg-[#6c72f8]/15 border border-[#6c72f8]/25 flex items-center justify-center text-[#6c72f8] text-lg shadow-sm">
              🏛️
            </div>
            <div className="absolute top-1 right-10 w-10 h-10 rounded-full bg-[#2dd4bf]/20 border border-[#2dd4bf]/30 flex items-center justify-center text-[#0f766e] text-base shadow-sm">
              🗺️
            </div>
            <div className="absolute top-16 right-2 w-10 h-10 rounded-full bg-[#fbbf24]/20 border border-[#fbbf24]/30 flex items-center justify-center text-[#92400e] text-base shadow-sm">
              📜
            </div>
            <div className="absolute top-12 left-0 w-10 h-10 rounded-full bg-[#f87171]/15 border border-[#f87171]/25 flex items-center justify-center text-[#b91c1c] text-base shadow-sm">
              👥
            </div>
            {/* Central book + globe */}
            <div className="relative flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#6c72f8] to-[#4f46e5] flex items-center justify-center text-4xl shadow-lg mb-2">
                🌍
              </div>
              <div className="text-5xl">📖</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Filters (CLASS tabs + SUBJECT chips + Search) ─────────────────── */}
      <div className="sticky top-[57px] z-30 bg-[var(--page-bg)]/95 backdrop-blur-md border-b border-[var(--border)] shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 space-y-2.5">
          {/* CLASS row */}
          <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-none">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] shrink-0 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              Class:
            </span>
            {CLASSES.map((cls) => {
              const active = selectedClass === cls;
              return (
                <button
                  key={cls}
                  onClick={() => setSelectedClass(cls)}
                  className={`px-5 py-1.5 rounded-full text-sm font-semibold shrink-0 cursor-pointer transition-all duration-150 ${
                    active
                      ? "bg-[var(--primary)] text-white shadow-md shadow-[var(--primary)]/25"
                      : "bg-white text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/5"
                  }`}
                >
                  Class {cls}
                </button>
              );
            })}
          </div>

          {/* SUBJECT chips + Search */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-between">
            {/* Subject chips row */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-wrap sm:flex-nowrap">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] shrink-0 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                Subject:
              </span>
              {SUBJECTS.map((sub) => {
                const active = selectedSubject === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setSelectedSubject(sub.id)}
                    className={`px-3.5 py-1 rounded-full text-xs font-semibold shrink-0 cursor-pointer transition-all ${
                      active
                        ? "bg-[var(--primary)] text-white shadow-sm"
                        : "bg-white text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--primary)]/8 hover:text-[var(--primary)] hover:border-[var(--primary)]/30"
                    }`}
                  >
                    {sub.label}
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="relative flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-56">
                <Search className="w-3.5 h-3.5 text-[var(--muted-foreground)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search chapters, notes, or files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-full border border-[var(--border)] bg-white text-xs text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-[var(--primary)]/50 shadow-xs"
                />
              </div>
              <button className="p-1.5 rounded-lg border border-[var(--border)] bg-white text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:border-[var(--primary)]/30 transition-colors cursor-pointer shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-5">
        {loading ? (
          <div className="bg-white rounded-2xl border border-[var(--border)] shadow-xs p-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex gap-4 items-center">
                <div className="w-10 h-10 rounded-xl bg-[var(--muted)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[var(--muted)] rounded-full w-1/3" />
                  <div className="h-3 bg-[var(--muted)]/70 rounded-full w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-red-200 p-6 flex items-center justify-between shadow-xs">
            <span className="text-sm text-red-600">{error}</span>
            <button
              onClick={fetchCatalog}
              className="px-4 py-1.5 rounded-full bg-red-100 text-red-700 font-bold text-xs flex items-center gap-1.5 cursor-pointer hover:bg-red-200 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : chapters.length === 0 ? (
          /* Empty State */
          <div className="bg-white rounded-2xl border border-[var(--border)] shadow-xs px-8 py-16 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center mx-auto">
              <BookOpen className="w-8 h-8 text-[var(--primary)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--foreground)]">No chapters available yet</h3>
              <p className="text-sm text-[var(--muted-foreground)] mt-1 max-w-xs mx-auto">
                Your teacher has not uploaded any materials for Class {selectedClass}{" "}
                in this subject category.
              </p>
            </div>
          </div>
        ) : (
          /* Chapters List */
          <div className="space-y-3">
            {/* Results summary bar */}
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)] px-1">
              <span>
                <span className="font-semibold text-[var(--foreground)]">{chapters.length}</span>{" "}
                {chapters.length === 1 ? "chapter" : "chapters"} found for{" "}
                <span className="font-semibold text-[var(--primary)]">Class {selectedClass}</span>
                {selectedSubject !== "all" && (
                  <> · <span className="font-semibold">{subjectLabel}</span></>
                )}
              </span>
            </div>

            {chapters.map((chapter) => {
              const isExpanded = expandedChapters[chapter.id] !== false;
              const files = chapter.files || [];

              return (
                <div
                  key={chapter.id}
                  className="bg-white rounded-2xl border border-[var(--border)] shadow-xs overflow-hidden hover:border-[var(--primary)]/30 hover:shadow-md transition-all duration-200"
                >
                  {/* Chapter Header */}
                  <button
                    onClick={() => toggleChapter(chapter.id)}
                    className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--primary)]/3 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--primary)]/15 to-[var(--primary)]/5 text-[var(--primary)] font-extrabold text-sm flex items-center justify-center shrink-0 border border-[var(--primary)]/15">
                        {chapter.chapter_no}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">
                            Ch {chapter.chapter_no}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">
                            {chapter.subject}
                          </span>
                        </div>
                        <h3 className="text-sm sm:text-base font-bold text-[var(--foreground)] truncate">
                          {chapter.title}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="hidden sm:inline-block text-xs font-medium text-[var(--muted-foreground)] bg-[var(--muted)] px-2.5 py-1 rounded-full">
                        {files.length} {files.length === 1 ? "file" : "files"}
                      </span>
                      <span className={`w-6 h-6 rounded-full bg-[var(--muted)] flex items-center justify-center text-[var(--muted-foreground)] transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </button>

                  {/* Chapter Files */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border)] bg-[var(--page-bg)]/50 px-4 sm:px-5 py-4">
                      {files.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)] text-center py-4">
                          No materials attached to this chapter yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {files.map((file) => {
                            const isPpt = file.kind === "ppt";
                            return (
                              <div
                                key={file.id}
                                className="p-3.5 rounded-xl border border-[var(--border)] bg-white shadow-xs hover:border-[var(--primary)]/40 hover:shadow-sm transition-all flex items-center justify-between gap-3 group"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <span
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                      isPpt
                                        ? "bg-amber-100 text-amber-600"
                                        : "bg-[var(--primary)]/12 text-[var(--primary)]"
                                    }`}
                                  >
                                    {isPpt ? (
                                      <Presentation className="w-4 h-4" />
                                    ) : (
                                      <FileText className="w-4 h-4" />
                                    )}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-[var(--foreground)] truncate group-hover:text-[var(--primary)] transition-colors">
                                      {file.file_name}
                                    </div>
                                    <div className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1.5 mt-0.5">
                                      <span>{formatBytes(file.size_bytes)}</span>
                                      <span>·</span>
                                      <span className="capitalize">{file.kind.replace("_", " ")}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() => handleFileClick(file, files)}
                                    className="px-3 py-1.5 rounded-full bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-xs transition-all active:scale-95"
                                    title="Read online"
                                  >
                                    <Eye className="w-3 h-3" />
                                    {isPpt ? "View" : "Read"}
                                  </button>
                                  <a
                                    href={`/api/files/${file.id}/download`}
                                    download={file.file_name}
                                    className="w-7 h-7 rounded-full border border-[var(--border)] hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/8 text-[var(--muted-foreground)] hover:text-[var(--primary)] flex items-center justify-center transition-colors cursor-pointer"
                                    title="Download"
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
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <PdfReaderModal
        isOpen={readerModal.isOpen}
        fileId={readerModal.fileId}
        fileName={readerModal.fileName}
        onClose={() => setReaderModal({ isOpen: false, fileId: "", fileName: "" })}
      />
      <PptxOptionModal
        isOpen={pptxModal.isOpen}
        pptxFile={pptxModal.pptxFile}
        pairedPdfFile={pptxModal.pairedPdfFile}
        onClose={() => setPptxModal({ isOpen: false, pptxFile: null, pairedPdfFile: null })}
        onSelectPreview={(fileId, fileName) =>
          setReaderModal({ isOpen: true, fileId, fileName })
        }
      />

      {/* ── Floating AI Tutor ───────────────────────────────────────────────── */}
      <FloatingTutor
        currentClass={selectedClass}
        currentSubject={selectedSubject}
      />
    </div>
  );
}
