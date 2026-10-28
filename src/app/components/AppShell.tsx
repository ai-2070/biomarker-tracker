import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useProfile } from "../hooks";
import { useProfiles, useSaveStatus } from "../profiles";
import { href, type Route } from "../router";
import { Brain } from "../brain/Brain";
import { openBrain, useBrain } from "../brain/store";
import { AgeIcon, BrainIcon, CloseIcon, DashboardIcon, DropIcon, MenuIcon, PhoneSyncIcon, PillIcon, PlusIcon, SettingsIcon, BodyIcon } from "./icons";
import { ProfileMenu } from "./ProfileMenu";
import { buttonStyles, cx } from "./ui";

interface NavItem {
  label: string;
  to: Route;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  active: (r: Route) => boolean;
  soon?: boolean;
}

const DASHBOARD: NavItem = { label: "Dashboard", to: { name: "dashboard" }, icon: DashboardIcon, active: (r) => r.name === "dashboard" };
const BLOOD: NavItem = {
  label: "Blood tests",
  to: { name: "overview" },
  icon: DropIcon,
  active: (r) => r.name === "overview" || r.name === "marker" || r.name === "add" || r.name === "import",
};
const AGE: NavItem = { label: "Biological age", to: { name: "phenoage" }, icon: AgeIcon, active: (r) => r.name === "phenoage" };
const BODY: NavItem = { label: "Body", to: { name: "soon", section: "body" }, icon: BodyIcon, active: (r) => r.name === "soon" && r.section === "body", soon: true };
const HABITS: NavItem = { label: "Habits", to: { name: "habits" }, icon: PillIcon, active: (r) => r.name === "habits" || r.name === "experiment" };
const DEVICES: NavItem = { label: "Devices", to: { name: "soon", section: "devices" }, icon: PhoneSyncIcon, active: (r) => r.name === "soon" && r.section === "devices", soon: true };
const SETTINGS: NavItem = { label: "Settings", to: { name: "data" }, icon: SettingsIcon, active: (r) => r.name === "data" || r.name === "profiles" || r.name === "setup" };

const GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [DASHBOARD] },
  { label: "Health", items: [BLOOD, AGE, HABITS, BODY] },
  { label: "Connect", items: [DEVICES] },
];

function Logo({ className }: { className?: string }) {
  return (
    <a href={href({ name: "dashboard" })} className={cx("flex min-h-11 items-center gap-2.5 font-serif text-xl text-ink no-underline", className)}>
      <img src="./favicon.svg" alt="" width={26} height={26} />
      Biomarker Tracker
    </a>
  );
}

function SidebarLink({ item, route, onNavigate }: { item: NavItem; route: Route; onNavigate?: () => void }) {
  const active = item.active(route);
  const Icon = item.icon;
  return (
    <a
      href={href(item.to)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] no-underline transition-colors duration-150",
        active ? "bg-accent-soft font-medium text-accent" : item.soon ? "text-ink-2 hover:bg-sunken" : "text-ink-2 hover:bg-sunken hover:text-ink",
      )}
    >
      <Icon className={cx("shrink-0", active ? "text-accent" : "text-ink-2 group-hover:text-ink")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.soon && <span className="rounded-full border border-line px-1.5 font-mono text-[10px] tracking-[0.1em] text-ink-2 uppercase">Soon</span>}
    </a>
  );
}

function NavGroups({ route, onNavigate }: { route: Route; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {GROUPS.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col gap-0.5">
          {g.label && <p className="px-3 pb-1 font-mono text-[11px] font-medium tracking-[0.14em] text-ink-2 uppercase">{g.label}</p>}
          {g.items.map((item) => (
            <SidebarLink key={item.label} item={item} route={route} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function Sidebar({ route }: { route: Route }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-4 pt-3 pb-2">
        <Logo className="px-1" />
      </div>
      <div className="px-3 pb-4">
        <ProfileMenu variant="sidebar" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <NavGroups route={route} />
      </div>
      <div className="flex flex-col gap-1 border-t border-line p-3">
        <a href={href({ name: "add" })} className={cx(buttonStyles.primary, "mb-1 w-full no-underline")}>
          <PlusIcon />
          Add results
        </a>
        <SidebarLink item={SETTINGS} route={route} />
      </div>
    </aside>
  );
}

const TABS: NavItem[] = [DASHBOARD, { ...BLOOD, label: "Blood" }, HABITS];

function BottomTabs({ route }: { route: Route }) {
  const [open, setOpen] = useState(false);
  const moreActive = !TABS.some((t) => t.active(route));
  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map((t) => {
            const active = t.active(route);
            const Icon = t.icon;
            return (
              <li key={t.label}>
                <a
                  href={href(t.to)}
                  aria-current={active ? "page" : undefined}
                  className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] no-underline", active ? "font-medium text-accent" : "text-ink-2")}
                >
                  <Icon />
                  {t.label}
                </a>
              </li>
            );
          })}
          <li>
            <BrainTab />
          </li>
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className={cx("flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px]", moreActive ? "font-medium text-accent" : "text-ink-2")}
            >
              <MenuIcon />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-xl transition-transform duration-300 ease-[var(--ease-soft)] data-ending-style:translate-y-full data-starting-style:translate-y-full">
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="font-serif text-2xl">Menu</Dialog.Title>
              <Dialog.Close aria-label="Close menu" className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-sunken">
                <CloseIcon />
              </Dialog.Close>
            </div>
            <NavGroups route={route} onNavigate={() => setOpen(false)} />
            <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
              <SidebarLink item={SETTINGS} route={route} onNavigate={() => setOpen(false)} />
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** Phones and tablets open Brain from the bottom tabs (large screens have the pill at the bottom). */
function BrainTab() {
  const { open } = useBrain();
  return (
    <button
      type="button"
      onClick={() => openBrain()}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cx("flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px]", open ? "font-medium text-accent" : "text-ink-2")}
    >
      <BrainIcon />
      Brain
    </button>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/95 px-4 py-1.5 backdrop-blur-sm lg:hidden">
      <Logo className="text-lg" />
      <div className="flex items-center gap-1.5">
        <a href={href({ name: "add" })} aria-label="Add results" className="flex size-11 items-center justify-center rounded-full text-accent hover:bg-accent-soft">
          <PlusIcon />
        </a>
        <ProfileMenu />
      </div>
    </header>
  );
}

/** Banners that belong to the whole app: example data, unsaved changes. */
function AppBanners() {
  const person = useProfile();
  const save = useSaveStatus();
  const { mode } = useProfiles();
  return (
    <>
      {person.example && (
        <p className="animate-fade rounded-xl border border-warn/25 bg-warn-soft px-4 py-2.5 text-sm text-ink">
          <span className="font-medium">Example profile.</span> Every result here is made up, to show how the app works.
          {mode === "folders" && (
            <>
              {" "}
              <a href={href({ name: "setup" })} className="font-medium text-accent underline underline-offset-2">
                Create your own profile
              </a>
            </>
          )}
        </p>
      )}
      {save === "error" && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">
          Couldn't save to the profile folder. Is the app's server still running? Your changes are kept here and saved when it's back.
        </p>
      )}
    </>
  );
}

/** The working app: sidebar on large screens, top bar and bottom tabs on small ones. */
export function AppShell({ route, wide, children }: { route: Route; wide: boolean; children: ReactNode }) {
  const { mode } = useProfiles();
  return (
    <div className="min-h-dvh">
      <SkipLink />
      <Sidebar route={route} />
      <TopBar />
      <div className="lg:pl-64">
        <main id="main" tabIndex={-1} className={cx("mx-auto w-full px-4 pt-5 pb-28 outline-none sm:px-6 lg:px-10 lg:pt-8 lg:pb-28", wide ? "max-w-7xl" : "max-w-4xl")}>
          <div className="mb-5 flex flex-col gap-2 empty:hidden">
            <AppBanners />
          </div>
          {children}
          <footer className="mt-14 border-t border-line pt-5 text-sm text-ink-2">
            <p className="font-medium text-ink">Not medical advice. Not a medical device.</p>
            <p>
              {mode === "folders" ? "Each profile is kept in a folder on this computer." : "Your data stays in this browser."} It's only sent to an AI model when
              you ask Brain. Free and open source.
            </p>
          </footer>
        </main>
      </div>
      <BottomTabs route={route} />
      <Brain />
    </div>
  );
}

/** Setup and profile choice: no navigation yet, just the name. */
export function PlainShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SkipLink />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center px-4 py-1.5 sm:px-6">
          <Logo />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl px-4 py-6 outline-none sm:px-6 sm:py-8">
        {children}
        <footer className="mt-14 border-t border-line pt-5 text-sm text-ink-2">
          <p className="font-medium text-ink">Not medical advice. Not a medical device.</p>
        </footer>
      </main>
    </div>
  );
}

function SkipLink() {
  // A button, not href="#main": the hash is used for routing.
  return (
    <button
      type="button"
      onClick={() => document.getElementById("main")?.focus()}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3"
    >
      Skip to content
    </button>
  );
}
