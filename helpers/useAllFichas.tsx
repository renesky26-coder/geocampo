import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "./localDb";
import { fichas, customToFicha, type Ficha } from "./dictionaries";

/** Built-in fichas followed by the group's custom fichas (live, offline). */
export function useAllFichas(): { all: Ficha[]; custom: Ficha[] } {
  const forms = useLiveQuery(() => localDb.forms.orderBy("createdAt").toArray(), []) ?? [];
  const custom = forms.filter((f) => !f.deleted).map(customToFicha);
  return { all: [...fichas, ...custom], custom };
}