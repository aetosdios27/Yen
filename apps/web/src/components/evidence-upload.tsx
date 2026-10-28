"use client";

import { validateGstinChecksum } from "@yen/shared";
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Button } from "./button";
import { cn } from "./cn";
import {
  AlertTriangleIcon,
  CameraIcon,
  CheckCircleIcon,
  FileTextIcon,
  UploadCloudIcon,
  XIcon,
  ZoomInIcon,
} from "./icons";
import { Input } from "./input";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type EvidenceItem = {
  evidenceId: string;
  fundId?: string | undefined;
  expenseId?: string | undefined;
  fileSha256: string;
  mimeType: string;
  fileSizeBytes: number;
  duplicateDetected?: boolean | undefined;
  isDuplicate?: boolean | undefined;
  duplicateExpenseId?: string | undefined;
  vendorName?: string | undefined;
  gstin?: string | undefined;
  invoiceNumber?: string | undefined;
  invoiceDate?: string | undefined;
  createdAt: string;
  fileUrl?: string | undefined;
};

export type EvidenceUploadProps = {
  fundId?: string | undefined;
  expenseId?: string | undefined;
  existingEvidence?: readonly EvidenceItem[] | undefined;
  onUpload?: ((formData: FormData) => Promise<EvidenceItem | undefined>) | undefined;
  onSuccess?: ((item: EvidenceItem) => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
  className?: string | undefined;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EvidenceUpload({
  fundId,
  expenseId,
  existingEvidence = [],
  onUpload,
  onSuccess,
  onError,
  className,
}: EvidenceUploadProps) {
  const { t } = useI18n();
  const fileInputId = useId();
  const cameraInputId = useId();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [gstin, setGstin] = useState("");
  const [gstinError, setGstinError] = useState<string | undefined>(undefined);
  const [invoiceNumber, setInvoiceNumber] = useState("");

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<readonly EvidenceItem[]>(existingEvidence);
  const [zoomedItem, setZoomedItem] = useState<{
    title: string;
    isPdf: boolean;
    metadata?: Partial<EvidenceItem>;
  } | null>(null);

  // Sync with existing evidence updates
  useEffect(() => {
    setItems(existingEvidence);
  }, [existingEvidence]);

  // Handle escape key to close zoom dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && zoomedItem !== null) {
        setZoomedItem(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomedItem]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMimeType)) {
      setErrorMessage(t("evidence.errors.invalidType"));
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage(t("evidence.errors.fileTooLarge"));
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleGstinChange = (value: string) => {
    setGstin(value);
    if (!value.trim()) {
      setGstinError(undefined);
      return;
    }
    const trimmed = value.trim().toUpperCase();
    if (!validateGstinChecksum(trimmed)) {
      setGstinError(t("evidence.errors.invalidGstin"));
    } else {
      setGstinError(undefined);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setErrorMessage(t("evidence.errors.noFile"));
      return;
    }

    if (gstin.trim() && !validateGstinChecksum(gstin.trim().toUpperCase())) {
      setGstinError(t("evidence.errors.invalidGstin"));
      setErrorMessage(t("evidence.errors.invalidGstin"));
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    if (vendorName.trim()) formData.append("vendorName", vendorName.trim());
    if (gstin.trim()) formData.append("gstin", gstin.trim().toUpperCase());
    if (invoiceNumber.trim()) formData.append("invoiceNumber", invoiceNumber.trim());

    try {
      setUploadProgress(40);
      let createdItem: EvidenceItem;

      if (onUpload) {
        const result = await onUpload(formData);
        setUploadProgress(90);
        createdItem = result ?? {
          evidenceId: crypto.randomUUID(),
          fileSha256: "uploaded",
          mimeType: selectedFile.type,
          fileSizeBytes: selectedFile.size,
          vendorName: vendorName.trim() || undefined,
          gstin: gstin.trim().toUpperCase() || undefined,
          invoiceNumber: invoiceNumber.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      } else if (fundId && expenseId) {
        // Direct API upload via standard endpoint
        const res = await fetch(`/v1/funds/${fundId}/expenses/${expenseId}/evidence`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => null)) as {
            error?: { message?: string; details?: Array<{ message: string }> };
          } | null;
          throw new Error(
            errData?.error?.details?.[0]?.message ??
              errData?.error?.message ??
              t("evidence.errors.uploadFailed"),
          );
        }

        setUploadProgress(90);
        createdItem = (await res.json()) as EvidenceItem;
      } else {
        // Mock success fallback for preview / standalone usage
        await new Promise((resolve) => setTimeout(resolve, 300));
        createdItem = {
          evidenceId: crypto.randomUUID(),
          fileSha256: "preview-hash",
          mimeType: selectedFile.type,
          fileSizeBytes: selectedFile.size,
          vendorName: vendorName.trim() || undefined,
          gstin: gstin.trim().toUpperCase() || undefined,
          invoiceNumber: invoiceNumber.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
      }

      setUploadProgress(100);
      setItems((prev) => [...prev, createdItem]);
      setSelectedFile(null);
      setVendorName("");
      setGstin("");
      setInvoiceNumber("");
      onSuccess?.(createdItem);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(t("evidence.errors.uploadFailed"));
      setErrorMessage(error.message);
      onError?.(error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const openZoom = (item: EvidenceItem) => {
    const isPdf = item.mimeType === "application/pdf";
    setZoomedItem({
      title: item.vendorName ?? item.invoiceNumber ?? t("evidence.zoomTitle"),
      isPdf,
      metadata: item,
    });
  };

  return (
    <section
      aria-labelledby="evidence-section-title"
      className={cn(
        "flex flex-col gap-6 rounded-card border border-border bg-surface p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id="evidence-section-title" className="text-title font-semibold text-ink">
          {t("evidence.title")}
        </h2>
        <p className="text-small text-ink-muted">{t("evidence.uploadDescription")}</p>
      </div>

      {/* Accessible Error State */}
      {errorMessage ? (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2.5 rounded-control border border-danger/40 bg-danger/10 p-3 text-small text-danger"
        >
          <AlertTriangleIcon className="h-5 w-5 shrink-0" />
          <p className="font-semibold">{errorMessage}</p>
        </div>
      ) : null}

      {/* Upload Box / Input Area */}
      <div className="flex flex-col gap-4 rounded-control border-2 border-dashed border-border-strong bg-canvas p-4 text-center">
        {/* Hidden mobile-first inputs */}
        <input
          ref={cameraInputRef}
          id={cameraInputId}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="sr-only"
          disabled={isUploading}
          aria-label={t("evidence.cameraButton")}
        />
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          className="sr-only"
          disabled={isUploading}
          aria-label={t("evidence.browseButton")}
        />

        {!selectedFile ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <UploadCloudIcon className="h-10 w-10 text-ink-muted" />
            <div className="flex flex-col gap-1">
              <span className="text-body font-semibold text-ink">{t("evidence.uploadTitle")}</span>
              <span className="text-small text-ink-muted">{t("evidence.uploadDescription")}</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button
                variant="primary"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isUploading}
              >
                <CameraIcon className="h-5 w-5" />
                <span>{t("evidence.cameraButton")}</span>
              </Button>
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                <FileTextIcon className="h-5 w-5" />
                <span>{t("evidence.browseButton")}</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-left">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <span className="text-small font-semibold text-ink">
                {t("evidence.fileSelected", {
                  fileName: selectedFile.name,
                  fileSize: formatFileSize(selectedFile.size),
                })}
              </span>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="tap-target inline-flex items-center justify-center rounded-control p-1 text-ink-muted hover:text-ink"
                aria-label={t("common.dismiss")}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Selected File Preview Icon */}
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-control border border-border bg-surface">
                {selectedFile.type.startsWith("image/") ? (
                  <CameraIcon className="h-8 w-8 text-primary" />
                ) : (
                  <FileTextIcon className="h-8 w-8 text-ink-muted" />
                )}
              </div>
              <div className="flex flex-col text-small">
                <span className="font-semibold text-ink">{selectedFile.name}</span>
                <span className="text-ink-muted">{formatFileSize(selectedFile.size)}</span>
                <span className="text-ink-muted">{selectedFile.type}</span>
              </div>
            </div>

            {/* Structured Metadata Fields */}
            <div className="flex flex-col gap-3 pt-2">
              <Input
                label={t("evidence.vendorLabel")}
                placeholder={t("evidence.vendorPlaceholder")}
                hint={t("evidence.vendorHint")}
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                disabled={isUploading}
              />
              <Input
                label={t("evidence.gstinLabel")}
                placeholder={t("evidence.gstinPlaceholder")}
                hint={t("evidence.gstinHint")}
                value={gstin}
                onChange={(e) => handleGstinChange(e.target.value)}
                error={gstinError}
                disabled={isUploading}
              />
              <Input
                label={t("evidence.invoiceNumberLabel")}
                placeholder={t("evidence.invoiceNumberPlaceholder")}
                hint={t("evidence.invoiceNumberHint")}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={isUploading}
              />
            </div>

            {/* Uploading Progress State */}
            {isUploading ? (
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex justify-between text-small font-semibold text-ink">
                  <span>{t("evidence.uploading")}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={uploadProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t("evidence.uploading")}
                  className="h-2 w-full overflow-hidden rounded-full bg-border"
                >
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={isUploading}
                loadingLabel={t("evidence.uploading")}
              >
                {t("evidence.uploadAction")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Gallery / List of uploaded evidence */}
      <div className="flex flex-col gap-3">
        <h3 className="text-small font-semibold text-ink">{t("evidence.title")}</h3>

        {items.length === 0 && !selectedFile ? (
          <div className="rounded-control border border-border bg-canvas p-4 text-center">
            <p className="text-small font-semibold text-ink">{t("evidence.emptyHeading")}</p>
            <p className="text-small text-ink-muted">{t("evidence.emptyDescription")}</p>
          </div>
        ) : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-3" aria-label={t("evidence.title")}>
            {items.map((item) => {
              const isPdf = item.mimeType === "application/pdf";
              const isDuplicate = item.duplicateDetected || item.isDuplicate;

              return (
                <li
                  key={item.evidenceId}
                  className="flex flex-col gap-2 rounded-control border border-border bg-canvas p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openZoom(item)}
                        className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control border border-border bg-surface"
                        aria-label={t("evidence.viewDocument")}
                      >
                        {isPdf ? (
                          <FileTextIcon className="h-6 w-6 text-primary" />
                        ) : (
                          <CameraIcon className="h-6 w-6 text-primary" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                          <ZoomInIcon className="h-4 w-4 text-white" />
                        </span>
                      </button>

                      <div className="flex flex-col text-small">
                        <span className="font-semibold text-ink">
                          {item.vendorName || item.invoiceNumber || t("evidence.pdfDocument")}
                        </span>
                        {item.gstin ? (
                          <span className="text-ink-muted">GSTIN: {item.gstin}</span>
                        ) : null}
                        <span className="text-ink-muted">{formatFileSize(item.fileSizeBytes)}</span>
                      </div>
                    </div>

                    <Button variant="ghost" onClick={() => openZoom(item)}>
                      <ZoomInIcon className="h-4 w-4" />
                      <span>{t("evidence.viewDocument")}</span>
                    </Button>
                  </div>

                  {/* Duplicate warning banner */}
                  {isDuplicate ? (
                    <div
                      role="note"
                      className="mt-1 flex items-start gap-2 rounded-control border border-border-strong bg-surface p-2 text-small text-ink"
                    >
                      <AlertTriangleIcon className="h-4 w-4 shrink-0 text-danger" />
                      <span>{t("evidence.duplicateWarning")}</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* Approver Zoom Dialog Modal */}
      {zoomedItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="zoom-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button
            type="button"
            aria-label={t("evidence.closeZoom")}
            className="fixed inset-0 bg-black/60"
            onClick={() => setZoomedItem(null)}
            tabIndex={-1}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-card bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h4 id="zoom-dialog-title" className="text-body font-semibold text-ink">
                {zoomedItem.title}
              </h4>
              <button
                type="button"
                onClick={() => setZoomedItem(null)}
                className="tap-target inline-flex items-center justify-center rounded-control p-1 text-ink-muted hover:text-ink"
                aria-label={t("evidence.closeZoom")}
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col items-center justify-center overflow-auto p-4">
              {zoomedItem.isPdf ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <FileTextIcon className="h-16 w-16 text-primary" />
                  <span className="text-body font-semibold text-ink">
                    {t("evidence.pdfDocument")}
                  </span>
                  {zoomedItem.metadata?.invoiceNumber ? (
                    <span className="text-small text-ink-muted">
                      Invoice: {zoomedItem.metadata.invoiceNumber}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <CameraIcon className="h-16 w-16 text-primary" />
                  <span className="text-body font-semibold text-ink">{zoomedItem.title}</span>
                </div>
              )}

              {zoomedItem.metadata ? (
                <div className="mt-4 flex w-full flex-col gap-1 rounded-control border border-border bg-canvas p-3 text-small text-ink">
                  {zoomedItem.metadata.vendorName ? (
                    <div>
                      <span className="font-semibold">Vendor: </span>
                      {zoomedItem.metadata.vendorName}
                    </div>
                  ) : null}
                  {zoomedItem.metadata.gstin ? (
                    <div>
                      <span className="font-semibold">GSTIN: </span>
                      {zoomedItem.metadata.gstin}
                    </div>
                  ) : null}
                  {zoomedItem.metadata.invoiceNumber ? (
                    <div>
                      <span className="font-semibold">Invoice: </span>
                      {zoomedItem.metadata.invoiceNumber}
                    </div>
                  ) : null}
                  {zoomedItem.metadata.fileSizeBytes ? (
                    <div>
                      <span className="font-semibold">Size: </span>
                      {formatFileSize(zoomedItem.metadata.fileSizeBytes)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end border-t border-border p-3">
              <Button variant="secondary" onClick={() => setZoomedItem(null)}>
                {t("evidence.closeZoom")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
