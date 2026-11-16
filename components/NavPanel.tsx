import { useEffect, useRef } from "react";
import { Navigation2, X, MapPin, CheckCircle2 } from "lucide-react";
import { Button } from "./Button";
import { useDeviceSensors } from "../helpers/useDeviceSensors";
import { geo } from "../helpers/geo";
import type { GpsState } from "../helpers/useGps";
import { toast } from "../helpers/toast";
import styles from "./NavPanel.module.css";

export type NavTargetFull = { lat: number; lon: number; label: string; layerId?: string; featureIdx?: number };

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

type Props = {
  target: NavTargetFull;
  gps: GpsState;
  onClose: () => void;
  onCreatePoint: () => void;
  onVisited?: () => void;
};

export function NavPanel({ target, gps, onClose, onCreatePoint, onVisited }: Props) {
  const sensors = useDeviceSensors(true);
  const arrived = useRef(false);
  const has = gps.lat !== null && gps.lon !== null;
  const dist = has ? geo.distanceM([gps.lon!, gps.lat!], [target.lon, target.lat]) : null;
  const brg = has ? bearing(gps.lat!, gps.lon!, target.lat, target.lon) : null;
  const rel = brg !== null && sensors.heading !== null ? brg - sensors.heading : brg;
  const near = dist !== null && dist <= Math.max(5, (gps.accuracy ?? 5) * 1.2);

  useEffect(() => {
    if (near && !arrived.current) {
      arrived.current = true;
      try {
        navigator.vibrate?.([80, 60, 80]);
      } catch {
        /* ignore */
      }
      toast.success(`Você chegou em ${target.label}`);
    }
    if (!near) arrived.current = false;
  }, [near, target.label]);

  return (
    <div className={`${styles.panel} ${near ? styles.near : ""}`}>
      <div className={styles.top}>
        <div className={styles.arrowWrap} aria-hidden>
          <Navigation2 size={44} className={styles.arrow} style={{ transform: `rotate(${rel ?? 0}deg)` }} />
        </div>
        <div className={styles.info}>
          <span className={styles.label}>{target.label}</span>
          <span className={styles.dist}>{dist !== null ? geo.formatLength(dist) : "aguardando GPS"}</span>
          <span className={styles.meta}>
            rumo {brg !== null ? `${brg.toFixed(0)}°` : "—"} (N verdadeiro){sensors.heading === null ? " · gire o celular para ativar a bússola" : ""}
          </span>
        </div>
        <Button size="icon-md" variant="ghost" onClick={onClose} aria-label="Encerrar navegação">
          <X size={20} />
        </Button>
      </div>
      {near && (
        <div className={styles.actions}>
          {onVisited && (
            <Button variant="outline" onClick={onVisited}>
              <CheckCircle2 size={18} /> Marcar visitado
            </Button>
          )}
          <Button onClick={onCreatePoint}>
            <MapPin size={18} /> Registrar ponto aqui
          </Button>
        </div>
      )}
      {sensors.needsPermission && (
        <Button variant="ghost" size="sm" onClick={() => sensors.requestPermission()}>
          Ativar bússola
        </Button>
      )}
    </div>
  );
}
