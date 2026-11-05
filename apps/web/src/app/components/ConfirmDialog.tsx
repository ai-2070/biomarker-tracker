import type { ReactNode } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { buttonStyles, cx } from "./ui";

/** A confirmation step for anything that deletes or overwrites data. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  triggerVariant = "secondary",
  triggerClassName,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  triggerVariant?: keyof typeof buttonStyles;
  triggerClassName?: string;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger className={cx(buttonStyles[triggerVariant], triggerClassName)}>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 min-h-dvh bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-[28rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line bg-surface p-5 text-ink shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div className="flex flex-col gap-2">
            <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-ink-2">{description}</AlertDialog.Description>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close className={buttonStyles.secondary}>Cancel</AlertDialog.Close>
            <AlertDialog.Close className={buttonStyles.danger} onClick={() => void onConfirm()}>
              {confirmLabel}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
