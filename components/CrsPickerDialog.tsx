import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./Dialog";
import { Button } from "./Button";
import { Textarea } from "./Textarea";
import { crsChoices } from "../helpers/crsRegistry";
import styles from "./CrsPickerDialog.module.css";

type Props = {
  request: { fileName: string; message: string; hint: string } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (crs: string) => void;
};

export function CrsPickerDialog({ request, busy, onCancel, onConfirm }: Props) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [request]);
  return (
    <Dialog open={!!request} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Qual a projeção de “{request?.fileName}”?</DialogTitle>
          <DialogDescription>
            {request?.message} {request?.hint}
          </DialogDescription>
        </DialogHeader>
        <div className={styles.choices}>
          {crsChoices.map((c) => (
            <button key={c.code} className={`${styles.choice} ${value === String(c.code) ? styles.on : ""}`} onClick={() => setValue(String(c.code))}>
              <span>{c.label}</span>
              <code>EPSG:{c.code}</code>
            </button>
          ))}
        </div>
        <label className={styles.free}>
          <span>Ou digite qualquer código EPSG, uma string proj4 ou cole o conteúdo do .prj (WKT)</span>
          <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ex.: 31982  ·  EPSG:5880  ·  +proj=utm +zone=22 +south ..." />
        </label>
        <DialogFooter className={styles.footer}>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={!value.trim() || busy} onClick={() => onConfirm(value.trim())}>
            {busy ? "Importando…" : "Importar com esta projeção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}