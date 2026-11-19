import type { ComponentProps, ReactNode } from "react";

/** One icon family: 24px grid, 1.75 stroke, round ends. Decorative unless given a label. */
function Icon({ children, ...props }: ComponentProps<"svg"> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = ComponentProps<"svg">;

export const DashboardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
    <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
  </Icon>
);

export const DropIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5c3.2 3.9 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.8-6.7 6-10.6Z" />
    <path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.4" />
  </Icon>
);

export const AgeIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const BodyIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="2" />
    <path d="M6 9.5h12M12 9.5v5M12 14.5 9 21M12 14.5l3 6.5" />
  </Icon>
);

export const PillIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" />
    <path d="m9.5 9.5 5 5" />
  </Icon>
);

/** GitHub's mark (filled, unlike the line icons). */
export const GitHubIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.3-3.3-1.3-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.2-4.5-1.1-4.5-4.9 0-1.1.4-2 1-2.6-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.5 1 2.6 0 3.8-2.3 4.7-4.5 4.9.4.3.7.9.7 1.8v2.7c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.2Z" />
  </svg>
);

export const StarIcon = (p: P) => (
  <Icon {...p}>
    <path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.6l-5 2.6.9-5.6-4-3.9 5.6-.8L12 3.8Z" />
  </Icon>
);

/** A bowl: meals. */
export const BowlIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
    <path d="M9 21h6M8.5 8c0-1.5 1-2 1-3.5M12 8c0-1.5 1-2 1-3.5M15.5 8c0-1.5 1-2 1-3.5" />
  </Icon>
);

/** A clipboard with a list: protocols. */
export const ClipboardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
    <path d="M9 4.5V3.8c0-.7.5-1.3 1.2-1.3h3.6c.7 0 1.2.6 1.2 1.3v.7M9 10h6M9 13.5h6M9 17h4" />
  </Icon>
);

/** An open book: the research knowledge base (Supplementation). */
export const BookIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 6.5c-1.8-1.3-4.3-2-7.5-2v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2Z" />
    <path d="M12 6.5v13" />
  </Icon>
);

export const FlaskIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9.5 3.5h5M10.5 3.5v5.2L5.4 18a1.7 1.7 0 0 0 1.5 2.5h10.2a1.7 1.7 0 0 0 1.5-2.5l-5.1-9.3V3.5" />
    <path d="M7.6 14.5h8.8" />
  </Icon>
);

export const PhoneSyncIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 18.5h3M9.5 10.5a3.5 3.5 0 0 1 5-.4M14.5 12.5a3.5 3.5 0 0 1-5 .4" />
  </Icon>
);

export const ChatIcon = (p: P) => (
  <Icon {...p}>
    <path d="M20.5 11.5a8 8 0 0 1-11.6 7.1L3.5 20.5l1.9-4.9A8 8 0 1 1 20.5 11.5Z" />
    <path d="M8.5 10.5h7M8.5 13.5h4" />
  </Icon>
);

export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MenuIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ArrowRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

/** A chevron pointing down; rotated by its parent when open. */
export const ChevronIcon = (p: P) => (
  <Icon {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </Icon>
);

export const MinusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const BrainIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5.5a3 3 0 0 0-5.6-1.4A3 3 0 0 0 4 8.6a3.2 3.2 0 0 0 .3 5.7A3.4 3.4 0 0 0 9 19.6a2.9 2.9 0 0 0 3-1.4Z" />
    <path d="M12 5.5a3 3 0 0 1 5.6-1.4A3 3 0 0 1 20 8.6a3.2 3.2 0 0 1-.3 5.7 3.4 3.4 0 0 1-4.7 5.3 2.9 2.9 0 0 1-3-1.4" />
    <path d="M12 5.5v12.7M8.5 9.5a2.5 2.5 0 0 0 1.5 2.3M15.5 9.5a2.5 2.5 0 0 1-1.5 2.3M7.5 15h1.5M16.5 15H15" />
  </Icon>
);

export const PaperclipIcon = (p: P) => (
  <Icon {...p}>
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />
  </Icon>
);

export const SendIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const StopIcon = (p: P) => (
  <Icon {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Icon>
);

export const NewChatIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5" />
  </Icon>
);

export const HistoryIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const ToolsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0Z" />
    <path d="M12 16.5v4" />
  </Icon>
);

export const FileIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13.5 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-10Z" />
    <path d="M13.5 3.5v5h5" />
  </Icon>
);

export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
);

/** Bars of different heights on a line: the intake analyzer. */
export const IntakeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20h16" />
    <path d="M7 16v-5M12 16V6M17 16v-8" />
  </Icon>
);

export const SunIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);

export const LeafIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 19c0-8 5-13.5 14-14-.5 9-6 14-14 14Z" />
    <path d="M5 19c3-4 6-7 9.5-9" />
  </Icon>
);
