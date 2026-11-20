import { useEffect, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Button } from "../components/ui";
import { clearChats, deleteChat, loadChats, onChatsChange, type SavedChat } from "./chatHistory";

/** Past conversations kept on this computer; picking one brings it back into the window. */
export function HistoryList({ onOpen }: { onOpen: (id: string) => void }) {
  const [chats, setChats] = useState<SavedChat[]>(loadChats);
  useEffect(() => {
    const refresh = () => setChats(loadChats());
    refresh();
    return onChatsChange(refresh);
  }, []);

  if (chats.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="font-serif text-xl">No past conversations yet</p>
        <p className="max-w-sm text-sm text-ink-2">Your conversations with Brain are kept here, on this computer, once you have asked something.</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-serif text-lg">Past conversations</h3>
        <ConfirmDialog
          trigger="Delete all"
          triggerVariant="link"
          title="Delete all past conversations?"
          description="They are removed from this computer. The conversation on screen is not affected."
          confirmLabel="Delete all"
          onConfirm={clearChats}
        />
      </div>
      <ul className="flex flex-col gap-2">
        {chats.map((c) => {
          const questions = c.turns.filter((t) => t.role === "user").length;
          return (
            <li key={c.id} className="flex items-stretch gap-1 rounded-xl border border-line bg-surface">
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left hover:bg-sunken"
              >
                <span className="w-full truncate font-medium">{c.title}</span>
                <span className="text-xs text-ink-2">
                  {new Date(c.updated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {questions}{" "}
                  {questions === 1 ? "question" : "questions"}
                </span>
              </button>
              <Button variant="link" onClick={() => deleteChat(c.id)} aria-label={`Delete “${c.title}”`} className="shrink-0 px-3">
                Delete
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
