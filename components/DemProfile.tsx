import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { localDb } from "../helpers/localDb";
import { demSampler } from "../helpers/demSampler";
import styles from "./DemProfile.module.css";

/** Topographic profile of a line/polygon border, sampled from the visible MDT layers. */
export function DemProfile({ coords }: { coords: [number, number][] }) {
  const layers = useLiveQuery(() => localDb.layers.toArray(), []);
  const [data, setData] = useState<{ layer: string | null; points: { d: number; z: number | null }[] } | null>(null);

  // Stable keys: re-run only when visible layers or the line itself change.
  const layersKey = layers ? layers.map((l) => `${l.id}:${l.visible}`).join("|") : null;
  const coordsKey = JSON.stringify(coords);
  useEffect(() => {
    if (layersKey === null) return;
    let alive = true;
    demSampler.refresh().then((n) => {
      if (!alive) return;
      setData(n ? demSampler.profile(JSON.parse(coordsKey)) : { layer: null, points: [] });
    });
    return () => {
      alive = false;
    };
  }, [layersKey, coordsKey]);

  if (!data) return <p className={styles.note}>Calculando perfil…</p>;
  const valid = data.points.filter((p) => p.z !== null) as { d: number; z: number }[];
  if (!valid.length)
    return <p className={styles.note}>Sem MDT visível sob esta linha. Importe um GeoTIFF de uma banda (MDT do P50, SRTM, ALOS…) na aba Camadas e deixe-o visível.</p>;
  const zs = valid.map((p) => p.z);
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const len = valid[valid.length - 1].d - valid[0].d;
  const drop = valid[0].z - valid[valid.length - 1].z;
  const slope = len > 0 ? (Math.atan(Math.abs(drop) / len) * 180) / Math.PI : 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.stats}>
        <span>
          <b>{(zmax - zmin).toFixed(1)} m</b> amplitude
        </span>
        <span>
          <b>{drop.toFixed(1)} m</b> desnível início→fim
        </span>
        <span>
          <b>{slope.toFixed(1)}°</b> declividade média ({len > 0 ? ((Math.abs(drop) / len) * 100).toFixed(0) : 0}%)
        </span>
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height={170}>
          <AreaChart data={data.points} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="d" tick={{ fontSize: 10, fontFamily: "var(--font-family-monospace)" }} unit=" m" />
            <YAxis domain={[Math.floor(zmin - 1), Math.ceil(zmax + 1)]} tick={{ fontSize: 10, fontFamily: "var(--font-family-monospace)" }} />
            <Tooltip formatter={(v: any) => [`${v} m`, "Elevação"]} labelFormatter={(d: any) => `${d} m do início`} />
            <Area type="monotone" dataKey="z" stroke="var(--primary)" fill="var(--accent)" strokeWidth={2} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.note}>Fonte: {data.layer}</p>
    </div>
  );
}
