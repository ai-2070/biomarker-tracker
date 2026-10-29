import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { PlanCategory, PlanItem } from "../../core/plans";
import { newId, savePlan } from "../../db/db";
import { usePlans } from "../hooks";
import { href } from "../router";
import { WhenFields, whenFields, whenOf, type WhenValue } from "./PlanWhen";
import { Button, buttonStyles, cx, inputStyles, labelStyles } from "./ui";

/**
 * "Add to a protocol" from a supplement's page: the item's name, the person's own amount (optional, never
 * suggested), when it's taken, and which protocol (or a new one). Saved straight to the protocol.
 */
export function AddToProtocol({ label, category = "supplement", extra, amountHint = "e.g. 25 µg" }: { label: string; category?: PlanCategory; extra?: Pick<PlanItem, "mealId" | "note">; amountHint?: string }) {
  const plans = usePlans() ?? [];
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState<string>("");
  const [name, setName] = useState(label);
  const [amount, setAmount] = useState("");
  const [timing, setTiming] = useState<WhenValue>(() => whenOf(undefined));
  const [saved, setSaved] = useState<{ id: string; name: string }>();
  const target = planId === "new" ? undefined : plans.find((p) => p.id === (planId || plans[0]?.id));
  const full = target ? target.items.length >= 60 : false;

  function add() {
    const item = { id: newId(), label: name.trim().slice(0, 80) || label, ...(amount.trim() ? { amount: amount.trim().slice(0, 40) } : {}), category, ...whenFields(timing), ...extra };
    if (target) void savePlan({ ...target, items: [...target.items, item] }).then(() => setSaved({ id: target.id, name: target.name }));
    else {
      const p = { id: newId(), name: "My protocol", items: [item], createdAt: new Date().toISOString() };
      void savePlan(p).then(() => setSaved({ id: p.id, name: p.name }));
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setSaved(undefined);
      }}
    >
      <Dialog.Trigger className={buttonStyles.secondary}>Add to a protocol</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[34rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink shadow-xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <div>
            <Dialog.Title className="font-serif text-2xl font-normal">Add to a protocol</Dialog.Title>
            <Dialog.Description className="mt-1 text-ink-2">Your own amount, from the label or your doctor. The app never suggests what or how much to take.</Dialog.Description>
          </div>
          {saved ? (
            <p role="status">
              Added to <a href={href({ name: "plan", id: saved.id })}>{saved.name}</a>.
            </p>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!full) add();
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className={labelStyles}>Protocol</span>
                <select value={target?.id ?? "new"} onChange={(e) => setPlanId(e.target.value)} className={inputStyles}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="new">A new protocol</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                <label className="flex flex-col gap-1.5">
                  <span className={labelStyles}>Item</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" className={inputStyles} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelStyles}>Amount (optional)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={40} placeholder={amountHint} autoComplete="off" className={inputStyles} />
                </label>
              </div>
              <WhenFields value={timing} onChange={setTiming} />
              {full && <p className="text-sm text-danger">That protocol already has 60 items, the most it can hold.</p>}
              <div className={cx("flex flex-wrap gap-2")}>
                <Button type="submit" disabled={full}>
                  Add
                </Button>
                <Dialog.Close className={buttonStyles.quiet}>Cancel</Dialog.Close>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
