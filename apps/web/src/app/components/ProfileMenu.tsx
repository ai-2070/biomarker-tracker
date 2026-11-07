import { Menu } from "@base-ui/react/menu";
import { useProfile } from "../hooks";
import { Avatar } from "../pages/ProfilesPage";
import { switchProfile, useProfiles, useSaveStatus } from "../profiles";
import { href } from "../router";
import { CheckIcon, ChevronDownIcon, cx, eyebrowSmallStyles } from "./ui";

const itemStyles =
  "flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-ink outline-none select-none transition-colors duration-100 data-highlighted:bg-sunken";

/** The open profile, and a menu to switch, add or manage profiles. */
export function ProfileMenu({ variant = "compact" }: { variant?: "compact" | "sidebar" }) {
  const { mode, profiles, active, refresh } = useProfiles();
  const person = useProfile();
  const save = useSaveStatus();
  if (mode !== "folders" || !active) return null;
  const name = person.name || active.person.name || "Profile";

  return (
    <Menu.Root modal={false} onOpenChange={(open) => open && void refresh()}>
      <Menu.Trigger
        aria-label={`Profile: ${name}. Switch profile`}
        className={cx(
          "group flex min-h-11 items-center gap-2 text-ink transition-colors duration-150 hover:bg-sunken data-popup-open:bg-sunken",
          variant === "sidebar" ? "w-full rounded-xl border border-line bg-surface p-2 text-left" : "rounded-full border border-line py-1 pr-2.5 pl-1",
        )}
      >
        <Avatar name={name} size="sm" />
        {variant === "sidebar" ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-ink-2">
              {profiles.length > 1 ? `${profiles.length} profiles · switch` : "Switch or add a profile"}
            </span>
          </span>
        ) : (
          <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{name}</span>
        )}
        {save === "error" && <span className="size-2 rounded-full bg-danger" title="Not saved to the folder yet" />}
        <ChevronDownIcon className="text-ink-2 transition-transform duration-200 group-data-popup-open:rotate-180" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align={variant === "sidebar" ? "start" : "end"} className="z-50 outline-none">
          <Menu.Popup className="flex w-72 max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] flex-col gap-0.5 rounded-xl border border-line bg-surface p-1.5 text-ink shadow-lg outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.Group>
              <Menu.GroupLabel className={cx("px-3 pt-1.5 pb-1", eyebrowSmallStyles)}>Profiles</Menu.GroupLabel>
              {profiles.map((p) => {
                const current = p.id === active.id;
                return (
                  <Menu.Item key={p.id} className={itemStyles} onClick={() => !current && void switchProfile(p.id)}>
                    <Avatar name={p.person.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{p.id === active.id ? name : p.person.name || "Unnamed"}</span>
                    {current && <CheckIcon className="text-accent" />}
                  </Menu.Item>
                );
              })}
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.LinkItem href={href({ name: "setup" })} className={itemStyles}>
              New profile
            </Menu.LinkItem>
            <Menu.LinkItem href={href({ name: "profiles" })} className={itemStyles}>
              Manage profiles
            </Menu.LinkItem>
            <p className={cx("px-3 pt-1 pb-1.5 text-xs", save === "error" ? "text-danger" : "text-ink-2")}>
              {save === "error"
                ? "Couldn't save to the folder. Is the app's server running? Changes are kept here and saved when it's back."
                : save === "saving"
                  ? "Saving…"
                  : "All changes saved to the profile folder."}
            </p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
