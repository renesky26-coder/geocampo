import { useEffect, useRef, useState } from "react";
import { Satellite, Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./Dialog";
import { Button } from "./Button";
import { useGps, type GpsState } from "../helpers/useGps";
import styles from "./GnssAverage.module.css";

export type GnssResult = {
  lat: number;
  lon: number;
  altitude: number | null;
  accuracy: number;
  n: number;
  sdH: number | null;
  seconds: number;
};

type Fix = { lat: number; lon: number; alt: number | null; acc: number };

const TARGET_S = 30;
const MAX_ACC = 30;

function summarize(fixes: Fix[]) {
  if (!fixes.length) return null;
  // Weighted mean (weight = 1/accuracy²)
  let sw = 0, la = 0, lo = 0, swa = 0, al = 0;
  for (const f of fixes) {
    const w = 1 / Math.max(1, f.acc) ** 2;
    sw += w;
    la += f.lat * w;
    lo += f.lon * w;
    if (f.alt !== null) {
      swa += w;
      al += f.alt * w;
    }
  }
  const lat = la / sw;
  const lon = lo / sw;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const sdH = fixes.length > 1 ? Math.sqrt(fixes.reduce((s, f) => s + ((f.lon - lon) * kx) ** 2 + ((f.lat - lat) * ky) ** 2, 0) / (fixes.length - 1)) : null;
  const meanAcc = fixes.reduce((s, f) => s + f.acc, 0) / fixes.length;
  const accuracy = Math.max(sdH ?? meanAcc, meanAcc / Math.sqrt(fixes.length));
  return { lat, lon, altitude: swa ? al / swa : null, accuracy, sdH, meanAcc };
}

export function GnssAverage({ open, onCancel, onAccept }: { open: boolean; onCancel: () => void; onAccept: (r: GnssResult) => void }) {
  const gps = useGps();
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [rejected, setRejected] = useState(0);
  const start = useRef(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!open) return;
    setFixes([]);
    setRejected(0);
    start.current = Date.now();
    // Seed with the current fix so a quick tap still works.
    const c = useGps.current();
    if (c.lat !== null && c.lon !== null && (c.accuracy ?? 99) <= MAX_ACC) setFixes([{ lat: c.lat, lon: c.lon, alt: c.altitude, acc: c.accuracy ?? MAX_ACC }]);
    const off = useGps.onFix((s: GpsState) => {
      if (s.lat === null || s.lon === null) return;
      if ((s.accuracy ?? 99) > MAX_ACC) {
        setRejected((r) => r + 1);
        return;
      }
      setFixes((f) => [...f, { lat: s.lat!, lon: s.lon!, alt: s.altitude, acc: s.accuracy ?? MAX_ACC }]);
    });
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      off();
      clearInterval(t);
    };
  }, [open]);

  const elapsed = open ? Math.round((now - start.current) / 1000) : 0;
  const sum = summarize(fixes);
  const ready = elapsed >= TARGET_S && fixes.length >= 5;
  const pct = Math.min(100, (elapsed / TARGET_S) * 100);

  function accept() {
    if (!sum) return;
    try {
      navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }
    onAccept({ lat: sum.lat, lon: sum.lon, altitude: sum.altitude, accuracy: sum.accuracy, n: fixes.length, sdH: sum.sdH, seconds: elapsed });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Marcando ponto · média GNSS</DialogTitle>
          <DialogDescription>Fique parado sobre o ponto. Quanto mais leituras, melhor a posição — 30 s é o recomendado. Leituras com erro acima de {MAX_ACC} m são descartadas.</DialogDescription>
        </DialogHeader>
        <div className={styles.bar}>
          <div className={`${styles.fill} ${ready ? styles.fillReady : ""}`} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.grid}>
          <div>
            <b>{fixes.length}</b>
            <span>leituras</span>
          </div>
          <div>
            <b>{elapsed}s</b>
            <span>tempo</span>
          </div>
          <div>
            <b>{sum?.sdH != null ? `${sum.sdH.toFixed(1)} m` : "—"}</b>
            <span>dispersão</span>
          </div>
          <div>
            <b className={sum && sum.accuracy > 15 ? styles.bad : ""}>{sum ? `±${sum.accuracy.toFixed(1)} m` : "—"}</b>
            <span>precisão final</span>
          </div>
        </div>
        <div className={styles.live}>
          <Satellite size={14} /> GPS agora: ±{gps.accuracy != null ? gps.accuracy.toFixed(0) : "—"} m
          {rejected > 0 && ` · ${rejected} descartadas`}
          {sum && sum.altitude != null && ` · Z ${sum.altitude.toFixed(1)} m`}
        </div>
        {!fixes.length && <p className={styles.warn}>Aguardando leituras com precisão melhor que {MAX_ACC} m… vá para céu aberto.</p>}
        <div className={styles.actions}>
          <Button variant="outline" size="lg" onClick={onCancel}>
            <X size={18} /> Cancelar
          </Button>
          <Button size="lg" onClick={accept} disabled={!sum} className={styles.grow}>
            <Check size={18} /> {ready ? "Gravar ponto" : sum ? "Gravar agora" : "Aguardando…"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
