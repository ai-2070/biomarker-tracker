/** Light (white) is the default; dark only when the user picks it. Kept per browser. */
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

function apply(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && darkQuery().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  apply(choice);
}

/** Called once at start; follows the device while "Match my device" is chosen. */
export function initTheme(): void {
  apply(getThemeChoice());
  darkQuery().addEventListener("change", () => apply(getThemeChoice()));
}
