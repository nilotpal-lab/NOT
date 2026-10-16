"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChapterWithFiles, FileRecord } from "@/types/database";

interface ToastState {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface RenameModalState {
  isOpen: boolean;
  chapterId: string;
  chapterNo: number;
  classNum: number;
  subject: string;
  currentTitle: string;
  newTitle: string;
  saving: boolean;
  error?: string | null;
}

interface DeleteModalState {
  isOpen: boolean;
  fileId: string;
  fileName: string;
  partCount: number;
  deleting: boolean;
  error?: string | null;
}

interface UploadModalState {
  isOpen: boolean;
  classNum: number;
  subject: string;
  chapterNo: number;
  title: string;
  kind: "ncert_pdf" | "ppt" | "teacher_notes";
  teacherName: string;
  file: File | null;
  accompanyingPdf: File | null;
  uploading: boolean;
  progressMessage: string;
  progressPercent: number;
  error?: string | null;
}

function getSubjectColor(subject: string): string {
  switch (subject) {
    case "History":
      return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900";
    case "Geography":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900";
    case "Civics":
      return "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900";
    case "Economics":
      return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900";
    default:
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900";
  }
}

function getKindBadge(kind: string, teacherName?: string | null): React.ReactNode {
  switch (kind) {
    case "ncert_pdf":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
          NCERT PDF
        </span>
      );
    case "ppt":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">
          PPT
        </span>
      );
    case "ppt_pdf":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          PPT Preview
        </span>
      );
    case "teacher_notes":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Notes {teacherName ? `(${teacherName})` : ""}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300">
          {kind}
        </span>
      );
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AdminDashboardPage() {
  const router = useRouter();

  // Data & Lifecycle
  const [chapters, setChapters] = useState<ChapterWithFiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [selectedSubject, setSelectedSubject] = useState<string>("all");
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [publishedStatus, setPublishedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Accordion open/close state
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});

  // Modals & Actions
  const [renameModal, setRenameModal] = useState<RenameModalState>({
    isOpen: false,
    chapterId: "",
    chapterNo: 0,
    classNum: 0,
    subject: "",
    currentTitle: "",
    newTitle: "",
    saving: false,
  });

  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    isOpen: false,
    fileId: "",
    fileName: "",
    partCount: 1,
    deleting: false,
  });

  const [uploadModal, setUploadModal] = useState<UploadModalState>({
    isOpen: false,
    classNum: 7,
    subject: "Geography",
    chapterNo: 2,
    title: "Inside Our Earth",
    kind: "ncert_pdf",
    teacherName: "",
    file: null,
    accompanyingPdf: null,
    uploading: false,
    progressMessage: "",
    progressPercent: 0,
    error: null,
  });

  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  // Toast Helper
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Fetch Library Catalog
  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/library", {
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/admin/login?from=/admin");
          return;
        }
        throw new Error(`Failed to load catalog (${res.status})`);
      }

      const data = await res.json();
      const loaded: ChapterWithFiles[] = data.chapters ?? (Array.isArray(data) ? data : []);
      setChapters(loaded);

      // Default expand all loaded chapters
      const expandedMap: Record<string, boolean> = {};
      loaded.forEach((c) => {
        expandedMap[c.id] = true;
      });
      setExpandedChapters(expandedMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error connecting to server");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Handle Logout
  async function handleLogout() {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        headers: { origin: window.location.origin },
      });
      router.push("/admin/login");
      router.refresh();
    } catch {
      router.push("/admin/login");
    }
  }

  // Toggle Single File Visibility
  async function handleToggleFile(fileId: string, currentPublished: boolean) {
    const nextPublished = !currentPublished;

    // Optimistic UI update
    setChapters((prev) =>
      prev.map((c) => ({
        ...c,
        files: (c.files || []).map((f) =>
          f.id === fileId ? { ...f, is_published: nextPublished } : f
        ),
      }))
    );

    try {
      const res = await fetch(`/api/admin/library/${fileId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({ is_published: nextPublished }),
      });

      if (!res.ok) {
        throw new Error("Failed to update visibility");
      }

      showToast(
        nextPublished ? "File published to student library" : "File hidden from student library",
        "success"
      );
    } catch (err) {
      // Revert optimistic update
      setChapters((prev) =>
        prev.map((c) => ({
          ...c,
          files: (c.files || []).map((f) =>
            f.id === fileId ? { ...f, is_published: currentPublished } : f
          ),
        }))
      );
      showToast(err instanceof Error ? err.message : "Failed to toggle visibility", "error");
    }
  }

  // Bulk Toggle Teacher Notes
  async function handleBulkToggleNotes(publish: boolean) {
    if (bulkProcessing) return;
    setBulkProcessing(true);

    try {
      const res = await fetch("/api/admin/library/bulk-toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({ is_published: publish }),
      });

      if (!res.ok) {
        throw new Error("Bulk update failed");
      }

      const data = await res.json();
      const count = data.count ?? data.updatedCount ?? 0;
      showToast(
        `Successfully ${publish ? "published" : "hid"} ${count} teacher notes files.`,
        "success"
      );
      await fetchLibrary();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bulk action failed", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  // Rename Chapter Submission
  async function submitRenameChapter(e: React.FormEvent) {
    e.preventDefault();
    if (!renameModal.newTitle.trim() || renameModal.saving) return;

    setRenameModal((prev) => ({ ...prev, saving: true, error: null }));

    try {
      const res = await fetch(`/api/admin/library/chapter/${renameModal.chapterId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({ title: renameModal.newTitle.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to rename chapter");
      }

      const data = await res.json();
      showToast(
        `Renamed chapter title. ${data.updatedFilesCount} dependent file(s) updated.`,
        "success"
      );

      setRenameModal((prev) => ({ ...prev, isOpen: false, saving: false }));
      await fetchLibrary();
    } catch (err) {
      setRenameModal((prev) => ({
        ...prev,
        saving: false,
        error: err instanceof Error ? err.message : "Failed to rename chapter",
      }));
    }
  }

  // Confirm File Deletion
  async function submitDeleteFile() {
    if (deleteModal.deleting) return;
    setDeleteModal((prev) => ({ ...prev, deleting: true, error: null }));

    try {
      const res = await fetch(`/api/admin/library/${deleteModal.fileId}`, {
        method: "DELETE",
        headers: {
          origin: window.location.origin,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete file");
      }

      const data = await res.json();
      const purgedCount = data.deletedMessageIds?.length || 0;
      showToast(
        `Deleted file and purged ${purgedCount} Telegram chunk part(s).`,
        "success"
      );

      setDeleteModal((prev) => ({ ...prev, isOpen: false, deleting: false }));
      await fetchLibrary();
    } catch (err) {
      setDeleteModal((prev) => ({
        ...prev,
        deleting: false,
        error: err instanceof Error ? err.message : "Failed to delete file",
      }));
    }
  }

  // Upload Material Submission (with Browser Slicing)
  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadModal.file || uploadModal.uploading) return;

    setUploadModal((prev) => ({
      ...prev,
      uploading: true,
      error: null,
      progressPercent: 0,
      progressMessage: "Preparing file upload...",
    }));

    try {
      const file = uploadModal.file;
      // Allow tiny chunk size when testing
      const testChunkSize =
        typeof window !== "undefined" && (window as unknown as { __TEST_CHUNK_SIZE?: number }).__TEST_CHUNK_SIZE;
      const CHUNK_SIZE = testChunkSize || (19 * 1024 * 1024);

      const totalParts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      // Upload parts sequentially
      for (let part = 1; part <= totalParts; part++) {
        const start = (part - 1) * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);

        setUploadModal((prev) => ({
          ...prev,
          progressMessage: `Uploading ${file.name} (part ${part} of ${totalParts})...`,
          progressPercent: Math.round(((part - 1) / totalParts) * 85),
        }));

        const formData = new FormData();
        formData.append("uploadId", uploadId);
        formData.append("part", String(part));
        formData.append("total", String(totalParts));
        formData.append("fileName", file.name);
        formData.append("class", String(uploadModal.classNum));
        formData.append("subject", uploadModal.subject);
        formData.append("chapterNo", String(uploadModal.chapterNo));
        formData.append("title", uploadModal.title.trim());
        formData.append("kind", uploadModal.kind);
        formData.append("chunk", chunkBlob, file.name);

        const partRes = await fetch("/api/admin/upload/part", {
          method: "POST",
          headers: {
            origin: window.location.origin,
          },
          body: formData,
        });

        if (!partRes.ok) {
          const errJson = await partRes.json().catch(() => ({}));
          throw new Error(
            errJson.error || `Upload failed on part ${part}/${totalParts} (HTTP ${partRes.status})`
          );
        }
      }

      setUploadModal((prev) => ({
        ...prev,
        progressMessage: "Finalizing and indexing material in Supabase & Telegram...",
        progressPercent: 95,
      }));

      // Complete upload session
      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({
          uploadId,
          class: Number(uploadModal.classNum),
          subject: uploadModal.subject,
          chapterNo: Number(uploadModal.chapterNo),
          title: uploadModal.title.trim(),
          kind: uploadModal.kind,
          teacherName: uploadModal.kind === "teacher_notes" ? uploadModal.teacherName.trim() : undefined,
          hasAccompanyingPdf: Boolean(uploadModal.accompanyingPdf),
        }),
      });

      if (!completeRes.ok) {
        const completeJson = await completeRes.json().catch(() => ({}));
        throw new Error(
          completeJson.error || `Failed to finalize upload (HTTP ${completeRes.status})`
        );
      }

      const completeData = await completeRes.json();
      const finalFileName = completeData.file?.file_name || file.name;

      showToast(`Successfully uploaded ${finalFileName}!`, "success");
      setUploadModal((prev) => ({
        ...prev,
        isOpen: false,
        uploading: false,
        progressMessage: "",
        progressPercent: 0,
        file: null,
        accompanyingPdf: null,
      }));

      await fetchLibrary();
    } catch (err) {
      setUploadModal((prev) => ({
        ...prev,
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    }
  }

  // Filtered Chapters & Files
  const filteredChapters = useMemo(() => {
    return chapters
      .filter((chapter) => {
        if (selectedClass !== "all" && chapter.class !== Number(selectedClass)) return false;
        if (selectedSubject !== "all" && chapter.subject !== selectedSubject) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesTitle = chapter.title.toLowerCase().includes(q);
          const matchesFiles = (chapter.files || []).some((f) =>
            f.file_name.toLowerCase().includes(q)
          );
          if (!matchesTitle && !matchesFiles) return false;
        }

        return true;
      })
      .map((chapter) => {
        let files = chapter.files || [];

        if (selectedKind !== "all") {
          files = files.filter((f) => f.kind === selectedKind);
        }

        if (publishedStatus === "published") {
          files = files.filter((f) => f.is_published);
        } else if (publishedStatus === "hidden") {
          files = files.filter((f) => !f.is_published);
        }

        return { ...chapter, files };
      });
  }, [chapters, selectedClass, selectedSubject, selectedKind, publishedStatus, searchQuery]);

  // Overall Library Statistics
  const stats = useMemo(() => {
    let totalFiles = 0;
    let publishedFiles = 0;
    let hiddenFiles = 0;
    let totalBytes = 0;
    let teacherNotesCount = 0;

    chapters.forEach((c) => {
      (c.files || []).forEach((f) => {
        totalFiles++;
        totalBytes += f.size_bytes || 0;
        if (f.is_published) {
          publishedFiles++;
        } else {
          hiddenFiles++;
        }
        if (f.kind === "teacher_notes") {
          teacherNotesCount++;
        }
      });
    });

    return {
      chaptersCount: chapters.length,
      totalFiles,
      publishedFiles,
      hiddenFiles,
      totalMb: (totalBytes / (1024 * 1024)).toFixed(1),
      teacherNotesCount,
    };
  }, [chapters]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Toast Notification Stack */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-3.5 rounded-xl border shadow-lg text-xs font-medium flex items-center gap-2 pointer-events-auto transition-all animate-in fade-in slide-in-from-top-2 ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800"
                : toast.type === "error"
                  ? "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800"
                  : "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800"
            }`}
          >
            {toast.type === "success" && (
              <svg className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === "error" && (
              <svg className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-color)] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--foreground)]">
              Library Management
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
              Admin Session Active
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            Organize NCERT chapters, cascade renames, manage Telegram chunks, and control student access.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            data-testid="open-upload-modal-btn"
            onClick={() => setUploadModal((prev) => ({ ...prev, isOpen: true }))}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Upload Material
          </button>
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            Student View &rarr;
          </Link>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium transition-colors cursor-pointer"
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Library Summary Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Chapters</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">{stats.chaptersCount}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Total Files</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">{stats.totalFiles}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Published / Hidden</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">
            <span className="text-emerald-600 dark:text-emerald-400">{stats.publishedFiles}</span>
            <span className="text-[var(--muted)] font-normal text-lg"> / {stats.hiddenFiles}</span>
          </p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Storage Size</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">{stats.totalMb} MB</p>
        </div>
      </div>

      {/* Bulk Action & Controls Bar */}
      <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Bulk Actions</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Rapidly toggle entire sets of supplemental materials across classes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleBulkToggleNotes(true)}
            disabled={bulkProcessing || stats.teacherNotesCount === 0}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:border-emerald-300 text-[var(--foreground)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Publish All Teacher Notes ({stats.teacherNotesCount})
          </button>
          <button
            onClick={() => handleBulkToggleNotes(false)}
            disabled={bulkProcessing || stats.teacherNotesCount === 0}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-300 text-[var(--foreground)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Hide All Teacher Notes
          </button>
          <button
            onClick={fetchLibrary}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
            title="Refresh Catalog"
          >
            &#x21bb; Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Filter Catalog</span>
          {(selectedClass !== "all" ||
            selectedSubject !== "all" ||
            selectedKind !== "all" ||
            publishedStatus !== "all" ||
            searchQuery.trim() !== "") && (
            <button
              onClick={() => {
                setSelectedClass("all");
                setSelectedSubject("all");
                setSelectedKind("all");
                setPublishedStatus("all");
                setSearchQuery("");
              }}
              className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Class Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Class</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Classes</option>
              <option value="6">Class 6</option>
              <option value="7">Class 7</option>
              <option value="8">Class 8</option>
              <option value="9">Class 9</option>
              <option value="10">Class 10</option>
            </select>
          </div>

          {/* Subject Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Subject</label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Subjects</option>
              <option value="History">History</option>
              <option value="Geography">Geography</option>
              <option value="Civics">Civics</option>
              <option value="Economics">Economics</option>
              <option value="SocialScience">Social Science</option>
            </select>
          </div>

          {/* Kind Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Kind</label>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Kinds</option>
              <option value="ncert_pdf">NCERT Textbook</option>
              <option value="ppt">Presentation (PPT)</option>
              <option value="ppt_pdf">PPT Preview (PDF)</option>
              <option value="teacher_notes">Teacher Notes</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Status</label>
            <select
              value={publishedStatus}
              onChange={(e) => setPublishedStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Status</option>
              <option value="published">Published Only</option>
              <option value="hidden">Hidden Only</option>
            </select>
          </div>

          {/* Search Bar */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Search</label>
            <input
              type="text"
              placeholder="Title or filename..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchLibrary}
            className="px-3 py-1 rounded bg-red-100 dark:bg-red-900/50 hover:bg-red-200 font-medium text-xs cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && chapters.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] animate-pulse">
              <div className="h-5 bg-black/10 dark:bg-white/10 rounded w-1/3 mb-4"></div>
              <div className="space-y-2">
                <div className="h-10 bg-black/5 dark:bg-white/5 rounded"></div>
                <div className="h-10 bg-black/5 dark:bg-white/5 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredChapters.length === 0 && (
        <div className="p-10 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">No Matching Chapters or Files</h3>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-sm mx-auto">
            {chapters.length === 0
              ? "The database is empty. Upload your first NCERT chapter using the upload engine."
              : "No materials match your active filter settings. Try resetting filters or searching for another keyword."}
          </p>
          <div className="mt-4">
            <button
              data-testid="empty-upload-btn"
              onClick={() => setUploadModal((prev) => ({ ...prev, isOpen: true }))}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload Chapter Material
            </button>
          </div>
        </div>
      )}

      {/* Chapter Cards / Accordion */}
      {!loading && filteredChapters.length > 0 && (
        <div className="space-y-4">
          {filteredChapters.map((chapter) => {
            const isExpanded = expandedChapters[chapter.id] !== false;
            const files = chapter.files || [];

            return (
              <div
                key={chapter.id}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs overflow-hidden transition-all"
              >
                {/* Chapter Card Header */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-color)] bg-black/[0.01] dark:bg-white/[0.01]">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-xs font-bold border bg-black/5 dark:bg-white/5">
                      Class {chapter.class}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-semibold border ${getSubjectColor(chapter.subject)}`}
                    >
                      {chapter.subject}
                    </span>
                    <span className="text-xs font-medium text-[var(--muted)]">
                      Ch {chapter.chapter_no}
                    </span>
                    <h3 className="text-sm sm:text-base font-bold text-[var(--foreground)] tracking-tight">
                      {chapter.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-[var(--muted)] font-medium">
                      {files.length} file{files.length === 1 ? "" : "s"}
                    </span>

                    {/* Rename Trigger Button */}
                    <button
                      onClick={() =>
                        setRenameModal({
                          isOpen: true,
                          chapterId: chapter.id,
                          chapterNo: chapter.chapter_no,
                          classNum: chapter.class,
                          subject: chapter.subject,
                          currentTitle: chapter.title,
                          newTitle: chapter.title,
                          saving: false,
                          error: null,
                        })
                      }
                      className="px-2.5 py-1 rounded-md border border-[var(--border-color)] hover:border-[var(--accent)] text-xs font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors cursor-pointer flex items-center gap-1"
                      title="Rename chapter and cascade update filenames"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                      Rename
                    </button>

                    {/* Expand/Collapse Chevron */}
                    <button
                      onClick={() =>
                        setExpandedChapters((prev) => ({
                          ...prev,
                          [chapter.id]: !isExpanded,
                        }))
                      }
                      className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
                      aria-label={isExpanded ? "Collapse chapter" : "Expand chapter"}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Chapter Files Table / List */}
                {isExpanded && (
                  <div className="p-0">
                    {files.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[var(--muted)]">
                        No materials attached to this chapter matching current filters.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] font-medium">
                              <th className="py-2.5 px-4">File Name</th>
                              <th className="py-2.5 px-3">Kind</th>
                              <th className="py-2.5 px-3">Size</th>
                              <th className="py-2.5 px-3">Parts</th>
                              <th className="py-2.5 px-3">Visibility</th>
                              <th className="py-2.5 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-color)]">
                            {files.map((file: FileRecord) => (
                              <tr
                                key={file.id}
                                data-testid={`file-row-${file.id}`}
                                className="hover:bg-black/[0.015] dark:hover:bg-white/[0.015] transition-colors"
                              >
                                {/* File Name */}
                                <td
                                  data-testid="file-name-cell"
                                  className="py-3 px-4 font-mono text-[11px] text-[var(--foreground)] max-w-xs sm:max-w-md truncate"
                                >
                                  {file.file_name}
                                </td>

                                {/* Kind */}
                                <td className="py-3 px-3 whitespace-nowrap">
                                  {getKindBadge(file.kind, file.teacher_name)}
                                </td>

                                {/* Size */}
                                <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                                  {formatBytes(file.size_bytes)}
                                </td>

                                {/* Part Count */}
                                <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 font-mono text-[10px]">
                                    {file.part_count} {file.part_count === 1 ? "chunk" : "chunks"}
                                  </span>
                                </td>

                                {/* Published Toggle Switch */}
                                <td className="py-3 px-3 whitespace-nowrap">
                                  <label className="relative inline-flex items-center cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={file.is_published}
                                      onChange={() => handleToggleFile(file.id, file.is_published)}
                                      className="sr-only peer"
                                      aria-label={`Toggle visibility for ${file.file_name}`}
                                    />
                                    <div className="w-8 h-4 bg-gray-300 dark:bg-gray-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                                    <span className="ml-2 text-[11px] font-medium text-[var(--muted)]">
                                      {file.is_published ? (
                                        <span className="text-emerald-600 dark:text-emerald-400">Published</span>
                                      ) : (
                                        <span className="text-amber-600 dark:text-amber-400">Hidden</span>
                                      )}
                                    </span>
                                  </label>
                                </td>

                                {/* Actions */}
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <button
                                    data-testid={`delete-file-btn-${file.id}`}
                                    onClick={() =>
                                      setDeleteModal({
                                        isOpen: true,
                                        fileId: file.id,
                                        fileName: file.file_name,
                                        partCount: file.part_count,
                                        deleting: false,
                                        error: null,
                                      })
                                    }
                                    className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                    title="Delete file and clean up Telegram messages"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rename Chapter Modal */}
      {renameModal.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-lg p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">Rename Chapter</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                Class {renameModal.classNum} &bull; {renameModal.subject} &bull; Chapter {renameModal.chapterNo}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 text-xs">
              <span className="font-semibold">Cascade Warning:</span> Renaming this title recalculates the standardized
              deterministic filenames for all attached files in this chapter according to the auto-naming rule.
            </div>

            {renameModal.error && (
              <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs">
                {renameModal.error}
              </div>
            )}

            <form onSubmit={submitRenameChapter} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  New Chapter Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  disabled={renameModal.saving}
                  value={renameModal.newTitle}
                  onChange={(e) => setRenameModal((prev) => ({ ...prev, newTitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={renameModal.saving}
                  onClick={() => setRenameModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameModal.saving || !renameModal.newTitle.trim()}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {renameModal.saving ? "Saving Cascade..." : "Save & Recalculate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Material Modal */}
      {uploadModal.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-lg p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">Upload SST Material</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                Upload NCERT chapter PDFs, PPTX slides, or Teacher Notes with automatic chunking & Telegram sync.
              </p>
            </div>

            {uploadModal.error && (
              <div
                data-testid="upload-error-banner"
                className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs"
              >
                {uploadModal.error}
              </div>
            )}

            {uploadModal.uploading && (
              <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 space-y-2">
                <div className="flex items-center justify-between text-xs text-blue-800 dark:text-blue-300 font-medium">
                  <span data-testid="upload-progress-status">{uploadModal.progressMessage}</span>
                  <span>{uploadModal.progressPercent}%</span>
                </div>
                <div className="w-full bg-blue-200 dark:bg-blue-900/60 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[var(--accent)] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadModal.progressPercent}%` }}
                  ></div>
                </div>
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                {/* Class */}
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Class</label>
                  <select
                    data-testid="upload-class-select"
                    disabled={uploadModal.uploading}
                    value={uploadModal.classNum}
                    onChange={(e) => setUploadModal((prev) => ({ ...prev, classNum: Number(e.target.value) }))}
                    className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
                  >
                    <option value={6}>Class 6</option>
                    <option value={7}>Class 7</option>
                    <option value={8}>Class 8</option>
                    <option value={9}>Class 9</option>
                    <option value={10}>Class 10</option>
                  </select>
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Subject</label>
                  <select
                    data-testid="upload-subject-select"
                    disabled={uploadModal.uploading}
                    value={uploadModal.subject}
                    onChange={(e) => setUploadModal((prev) => ({ ...prev, subject: e.target.value }))}
                    className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
                  >
                    <option value="History">History</option>
                    <option value="Geography">Geography</option>
                    <option value="Civics">Civics</option>
                    <option value="Economics">Economics</option>
                    <option value="SocialScience">Social Science</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {/* Chapter Number */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Chapter No</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    required
                    data-testid="upload-chapterno-input"
                    disabled={uploadModal.uploading}
                    value={uploadModal.chapterNo}
                    onChange={(e) => setUploadModal((prev) => ({ ...prev, chapterNo: Number(e.target.value) }))}
                    className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>

                {/* Chapter Title */}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Chapter Title</label>
                  <input
                    type="text"
                    required
                    data-testid="upload-title-input"
                    disabled={uploadModal.uploading}
                    placeholder="e.g. Inside Our Earth"
                    value={uploadModal.title}
                    onChange={(e) => setUploadModal((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
              </div>

              {/* Material Kind */}
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Material Kind</label>
                <select
                  data-testid="upload-kind-select"
                  disabled={uploadModal.uploading}
                  value={uploadModal.kind}
                  onChange={(e) =>
                    setUploadModal((prev) => ({
                      ...prev,
                      kind: e.target.value as "ncert_pdf" | "ppt" | "teacher_notes",
                    }))
                  }
                  className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
                >
                  <option value="ncert_pdf">NCERT Official PDF</option>
                  <option value="ppt">Presentation Slides (.pptx)</option>
                  <option value="teacher_notes">Teacher Notes / Summary</option>
                </select>
              </div>

              {/* Teacher Name (Optional if Teacher Notes) */}
              {uploadModal.kind === "teacher_notes" && (
                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">Teacher / Author Name</label>
                  <input
                    type="text"
                    data-testid="upload-teacher-input"
                    disabled={uploadModal.uploading}
                    placeholder="e.g. Sharma Sir"
                    value={uploadModal.teacherName}
                    onChange={(e) => setUploadModal((prev) => ({ ...prev, teacherName: e.target.value }))}
                    className="w-full px-2.5 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
              )}

              {/* Primary File Input */}
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Primary File {uploadModal.kind === "ppt" ? "(.pptx)" : "(.pdf)"}
                </label>
                <input
                  type="file"
                  required
                  data-testid="upload-file-input"
                  disabled={uploadModal.uploading}
                  accept={uploadModal.kind === "ppt" ? ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" : ".pdf,application/pdf"}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setUploadModal((prev) => ({ ...prev, file: f }));
                  }}
                  className="w-full text-xs text-[var(--muted)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-[var(--border-color)] file:text-xs file:font-semibold file:bg-black/5 dark:file:bg-white/5 file:text-[var(--foreground)] hover:file:bg-black/10 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  disabled={uploadModal.uploading}
                  onClick={() => setUploadModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="upload-submit-btn"
                  disabled={uploadModal.uploading || !uploadModal.file}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-xs"
                >
                  {uploadModal.uploading ? "Uploading Chunks..." : "Start Upload"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-md p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-red-600 dark:text-red-400">Permanently Delete File</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                Are you sure you want to remove this file from the library?
              </p>
            </div>

            <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 text-xs space-y-1">
              <p className="font-semibold break-all">{deleteModal.fileName}</p>
              <p className="text-[11px] opacity-90">
                This operation will delete database records and immediately purge all {deleteModal.partCount} chunk message(s) from the private Telegram channel to prevent storage leaks.
              </p>
            </div>

            {deleteModal.error && (
              <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs">
                {deleteModal.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteModal.deleting}
                onClick={() => setDeleteModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-delete-btn"
                disabled={deleteModal.deleting}
                onClick={submitDeleteFile}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {deleteModal.deleting ? "Purging Telegram..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
