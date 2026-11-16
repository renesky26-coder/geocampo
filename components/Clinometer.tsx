import { useState } from "react";
import { Lock, Compass } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./Dialog";
import { Button } from "./Button";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
import { useDeviceSensors } from "../helpers/useDeviceSensors";
import styles from "./Clinometer.module.css";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCapture: (r: { dip: number; dipDirection: number | null }) => void;
};

export function Clinometer({ open, onOpenChange, onCapture }: Props) {
  const s = useDeviceSensors(open);
  const [mode, setMode] = useState<"edge" | "face">("edge");
  const angle = mode === "edge" ? s.edgeTilt : s.faceTilt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Clinômetro</DialogTitle>
          <DialogDescription>
            {mode === "edge"
              ? "Encoste a lateral comprida do aparelho na linha de maior declive do talude."
              : "Deite o aparelho sobre o plano (camada, fratura) com o topo apontando para baixo do mergulho."}
          </DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as any)} className={styles.toggle}>
          <ToggleGroupItem value="edge">Lateral (talude)</ToggleGroupItem>
          <ToggleGroupItem value="face">Face (plano)</ToggleGroupItem>
        </ToggleGroup>
        {s.needsPermission ? (
          <Button size="lg" onClick={() => s.requestPermission()}>
            Permitir acesso aos sensores
          </Button>
        ) : (
          <div className={styles.gauge}>
            <div className={styles.dial} style={{ ["--a" as any]: `${-(angle ?? 0)}deg` }}>
              <div className={styles.horizon} />
              <div className={styles.needle} />
            </div>
            <div className={styles.reading}>
              <span className={styles.angle}>{angle !== null ? angle.toFixed(1) : "—"}°</span>
              <span className={styles.pct}>{angle !== null ? `${(Math.tan((angle * Math.PI) / 180) * 100).toFixed(0)}% de declividade` : s.available ? "" : "Sensores indisponíveis neste aparelho"}</span>
              <span className={styles.heading}>
                <Compass size={14} /> Direção {s.heading !== null ? `${s.heading.toFixed(0)}°` : "—"} · N verdadeiro
                {s.declination !== null && ` (decl. ${s.declination.toFixed(1).replace(".", ",")}°)`}
              </span>
            </div>
          </div>
        )}
        <Button
          size="lg"
          disabled={angle === null}
          onClick={() => {
            onCapture({ dip: Math.round(angle! * 10) / 10, dipDirection: s.heading !== null ? Math.round(s.heading) : null });
            onOpenChange(false);
          }}
        >
          <Lock size={18} /> Registrar leitura
        </Button>
      </DialogContent>
    </Dialog>
  );
}