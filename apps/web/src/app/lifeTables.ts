import { type LifeTableFile, validateLifeTables } from "@bt/shared/core/lifeTable";
import { useEffect, useState } from "react";

let tables: Promise<LifeTableFile> | undefined;
function loadTables() {
  return (tables ??= import("../../../../knowledge/lifetables/countries.json").then((module) => {
    if (validateLifeTables(module.default).length) throw new Error("Invalid country life tables");
    return module.default as LifeTableFile;
  }));
}

/** Population and optional-date sections share one validated bundle, not fitted-model state. */
export function useLifeTables() {
  const [file, setFile] = useState<LifeTableFile>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void loadTables()
      .then((loaded) => {
        if (active) setFile(loaded);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return { file, failed };
}
