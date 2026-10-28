import { useState } from "react";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../theme";
import { ChoiceGroup } from "../ChoiceGroup";
import { Card } from "../ui";

/** Light (white, the default), dark, or follow the device. Kept in this browser. */
export function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  return (
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
  );
}
