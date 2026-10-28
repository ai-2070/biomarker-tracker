import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { isOnboarded, setOnboarded } from "../../db/db";
import { buttonStyles } from "./ui";

/** First-visit explanation: where data lives, and what this app is not. */
export function Onboarding() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void isOnboarded().then((done) => setOpen(!done));
  }, []);

  async function accept() {
    await setOnboarded();
    // Ask the browser not to evict the database. Harmless if refused.
    void navigator.storage?.persist?.();
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && void accept()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 min-h-dvh bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <Dialog.Title className="text-xl font-semibold">Before you start</Dialog.Title>
          <Dialog.Description render={<div />} className="flex flex-col gap-3 text-ink-2">
            <p>
              <strong className="text-ink">Your data stays on this device.</strong> Results are saved in this browser only. There is no
              account and nothing is uploaded.
            </p>
            <p>
              <strong className="text-ink">Keep a backup.</strong> If you clear your browser data or switch devices, your results are gone
              unless you downloaded a backup file. You can do that on the Data page.
            </p>
            <p>
              <strong className="text-ink">Not medical advice. Not a medical device.</strong> This app explains what markers mean in general.
              It can't diagnose anything or tell you what to do. Talk to your doctor about your results.
            </p>
          </Dialog.Description>
          <div className="flex justify-end">
            <Dialog.Close className={buttonStyles.primary}>I understand</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
