import { PhoneSyncIcon } from "../components/icons";
import { PageTitle } from "../components/ui";
import type { SoonSection } from "../router";

const SECTIONS: Record<SoonSection, { title: string; sub: string; points: string[] }> = {
  devices: {
    title: "Devices",
    sub: "Coming soon. Your phone and wearables, synced to this computer without a cloud account.",
    points: [
      "An Android app that reads Health Connect on your phone (sleep, heart rate, steps, weight and more from the apps and watches that write there)",
      "Syncs with this computer over your home network; nothing goes through a server",
      "Shows up on the dashboard timeline next to your blood tests and log",
      "Until then: Body → Import from a device reads the export files from Google Fit, Samsung Health, Oura, Garmin or Apple Health",
    ],
  },
};

/** An honest placeholder for a section that is planned but not built. */
export function SoonPage({ section }: { section: SoonSection }) {
  const s = SECTIONS[section];
  const Icon = PhoneSyncIcon;
  return (
    <>
      <PageTitle sub={s.sub}>{s.title}</PageTitle>
      <section className="flex max-w-2xl flex-col gap-4 rounded-2xl border border-dashed border-line-strong bg-surface p-5 sm:p-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon width={24} height={24} />
        </span>
        <h2 className="font-serif text-2xl font-normal">What it will do</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
          {s.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="text-sm text-ink-2">Not built yet. Nothing here is collected or sent anywhere.</p>
      </section>
    </>
  );
}
