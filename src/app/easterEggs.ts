/** Easter eggs (jokes, always labelled as such): on unless turned off in Settings → Appearance. Kept per browser. */
const KEY = "easterEggs";

export function easterEggsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setEasterEggs(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
}

/** Shown about once in this many views. */
export const EGG_ODDS = 50;
