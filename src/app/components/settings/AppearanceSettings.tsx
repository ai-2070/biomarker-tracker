import { useState } from "react";
import { easterEggsOn, setEasterEggs } from "../../easterEggs";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../theme";
import { ChoiceGroup } from "../ChoiceGroup";
import { Card } from "../ui";

/** Light (white, the default), dark, or follow the device; and the easter eggs. Kept in this browser. */
export function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const [eggs, setEggs] = useState(easterEggsOn);
  return (
    <>
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">Colours</h2>
        <ChoiceGroup<ThemeChoice>
          label="Theme"
          help="Light is white and calm. Dark is easier on the eyes at night. This choice is kept in this browser."
          value={theme}
          onChange={(v) => {
            setTheme(v);
            setThemeChoice(v);
          }}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "system", label: "Match my device" },
          ]}
        />
      </Card>
      <Card className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-normal">Jokes</h2>
        <ChoiceGroup<"on" | "off">
          label="Easter eggs"
          help="Now and then the expiration date shows a joke (always labelled as one) before your real date. Turn them off if dark humour isn't welcome right now. Kept in this browser."
          value={eggs ? "on" : "off"}
          onChange={(v) => {
            setEggs(v === "on");
            setEasterEggs(v === "on");
          }}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </Card>
    </>
  );
}
