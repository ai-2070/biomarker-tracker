import { useState } from "react";
import { setShowExpirationDate, useShowExpirationDate } from "../../hooks";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../theme";
import { ChoiceGroup } from "../ChoiceGroup";
import { Card } from "../ui";

/** Light (white, the default), dark, or follow the device (kept in this browser); and the expiration date (kept with the profile). */
export function AppearanceSettings() {
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice);
  const expiration = useShowExpirationDate();
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
      <h2 className="font-serif text-2xl font-normal">Expiration date</h2>
      <ChoiceGroup<"on" | "off">
        label="Show the expiration date"
        help="On the Biological age page: the date by which half of the people like you have died, from official life tables and your blood tests. A population figure, not a prediction. Off unless you turn it on; kept with this profile. Brain only mentions it when it's on."
        value={expiration ? "on" : "off"}
        onChange={(v) => void setShowExpirationDate(v === "on")}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
        ]}
      />
    </Card>
    </>
  );
}
