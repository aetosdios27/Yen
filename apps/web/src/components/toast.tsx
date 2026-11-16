"use client";
// Escape dismissal requires a browser listener.
import { useEffect } from "react";
import { ToastCard } from "./ui/toast";
export type ToastTone = "success" | "info" | "warning" | "error";
export type ToastProps = {
  title: string;
  description?: string;
  tone?: ToastTone;
  open?: boolean;
  onClose?: () => void;
};
export function Toast({ title, description, tone = "info", open = true, onClose }: ToastProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open, onClose]);
  return (
    <ToastCard
      toastId="inline"
      type={tone}
      title={title}
      description={description}
      isOpen={open}
      {...(onClose ? { onDismiss: onClose } : {})}
    />
  );
}
