import type { ComponentProps, ReactNode } from "react";

/** One icon family: 24px grid, 1.75 stroke, round ends. Decorative unless given a label. */
function Icon({ children, ...props }: ComponentProps<"svg"> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
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

export const MinusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);
