import { useEffect, useState } from "react";
import { Satellite, CloudOff, Cloud, Sun } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
import { geo, type CoordFormat } from "../helpers/geo";
import type { GpsState } from "../helpers/useGps";
import styles from "./CoordPanel.module.css";

type Props = { gps: GpsState; online: boolean; pending: number; className?: string };

export function CoordPanel({ gps, online, pending, className }: Props) {
  const [sun, setSun] = useState(() => {
    try {
      return localStorage.getItem("gc-sun") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("sun", sun);
    try {
      localStorage.setItem("gc-sun", sun ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sun]);
  const [fmt, setFmt] = useState<CoordFormat>(() => {
    try {
      return (localStorage.getItem("gc-coordfmt") as CoordFormat) || "UTM";
    } catch {
      return "UTM";
    }
  });
  const change = (v: string) => {
    if (!v) return;
    setFmt(v as CoordFormat);
    try {
      localStorage.setItem("gc-coordfmt", v);
    } catch {
      /* ignore */
    }
  };
  const has = gps.lat !== null && gps.lon !== null;
  const c = has ? geo.formatCoord(gps.lat!, gps.lon!, fmt) : null;
  const acc = gps.accuracy;
  const accClass = acc === null ? styles.accNone : acc <= 5 ? styles.accGood : acc <= 15 ? styles.accMid : styles.accBad;

  return (
    <header className={`${styles.panel} ${className ?? ""}`}>
      <div className={styles.row}>
        <div className={styles.brand}>
          <span className={styles.brandName}>GeoCampo</span>
          <span className={`${styles.net} ${online ? styles.netOn : styles.netOff}`}>
            {online ? <Cloud size={14} /> : <CloudOff size={14} />}
            {online ? "online" : "offline"}
            {pending > 0 && <b> · {pending} pend.</b>}
          </span>
        </div>
        <div className={styles.right}>
          <button
            className={`${styles.sunBtn} ${sun ? styles.sunOn : ""}`}
            onClick={() => setSun((v) => !v)}
            aria-label="Modo sol forte"
            aria-pressed={sun}
            title="Sol forte: contraste máximo"
          >
            <Sun size={18} />
          </button>
          <ToggleGroup type="single" size="sm" value={fmt} onValueChange={change} className={styles.toggle}>
            <ToggleGroupItem value="DD">DD</ToggleGroupItem>
            <ToggleGroupItem value="GMS">GMS</ToggleGroupItem>
            <ToggleGroupItem value="UTM">UTM</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <div className={styles.coords}>
        {c ? (
          <>
            <div className={styles.values}>
              <span>{c.primary}</span>
              <span>{c.secondary}</span>
            </div>
            <div className={styles.side}>
              <span className={`${styles.acc} ${accClass}`}>
                <Satellite size={13} /> ±{acc !== null ? acc.toFixed(acc < 10 ? 1 : 0) : "—"} m
              </span>
              <span className={styles.z}>Z {gps.altitude !== null ? `${gps.altitude.toFixed(1)} m` : "—"}</span>
            </div>
          </>
        ) : (
          <div className={styles.waiting}>{gps.error ?? (gps.status === "waiting" ? "Aguardando sinal GPS…" : "Iniciando GPS…")}</div>
        )}
      </div>
      {c && <div className={styles.meta}>{c.meta}</div>}
    </header>
  );
}