import type { FieldRecord } from "../helpers/localDb";
import styles from "./StructuralPlots.module.css";

const R = 100;
const rad = (d: number) => (d * Math.PI) / 180;

/** Equal-area (Schmidt) lower-hemisphere position of a line with trend/plunge. */
function schmidt(trend: number, plunge: number): [number, number] {
  const r = R * Math.SQRT2 * Math.sin(rad(90 - plunge) / 2);
  return [r * Math.sin(rad(trend)), -r * Math.cos(rad(trend))];
}

/** Rose diagram of dip directions + Schmidt stereonet of poles to planes (true north). */
export function StructuralPlots({ records }: { records: FieldRecord[] }) {
  const data = records.filter((r) => !r.deleted && r.dip !== null && r.dipDirection !== null) as (FieldRecord & { dip: number; dipDirection: number })[];
  if (!data.length) return null;

  // Rose: 10° bins of dip direction
  const bins = new Array(36).fill(0);
  data.forEach((r) => bins[Math.floor((((r.dipDirection % 360) + 360) % 360) / 10)]++);
  const maxBin = Math.max(...bins);
  const petals = bins.map((n, i) => {
    if (!n) return null;
    const len = (Math.sqrt(n / maxBin) * R);
    const a0 = rad(i * 10);
    const a1 = rad(i * 10 + 10);
    const p = (a: number) => `${len * Math.sin(a)},${-len * Math.cos(a)}`;
    return <path key={i} d={`M0,0 L${p(a0)} A${len},${len} 0 0 1 ${p(a1)} Z`} className={styles.petal} />;
  });

  // Poles to planes and their vector mean
  let sx = 0, sy = 0, sz = 0;
  const poles = data.map((r, i) => {
    const trend = (r.dipDirection + 180) % 360;
    const plunge = 90 - r.dip;
    const t = rad(trend), pl = rad(plunge);
    sx += Math.cos(pl) * Math.sin(t);
    sy += Math.cos(pl) * Math.cos(t);
    sz += Math.sin(pl);
    const [x, y] = schmidt(trend, plunge);
    return <circle key={i} cx={x} cy={y} r={3.2} className={styles.pole} />;
  });
  const n = Math.hypot(sx, sy, sz);
  const meanTrend = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
  const meanPlunge = (Math.asin(sz / n) * 180) / Math.PI;
  const [mx, my] = schmidt(meanTrend, meanPlunge);
  const meanDipDir = (meanTrend + 180) % 360;
  const meanDip = 90 - meanPlunge;
  const consistency = n / data.length; // 1 = all parallel

  const frame = (
    <>
      <circle r={R} className={styles.frame} />
      {[0, 90, 180, 270].map((a) => (
        <line key={a} x1={0} y1={0} x2={R * Math.sin(rad(a))} y2={-R * Math.cos(rad(a))} className={styles.axis} />
      ))}
      <text x={0} y={-R - 6} className={styles.n}>
        N
      </text>
    </>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.plot}>
        <svg viewBox="-115 -120 230 235" role="img" aria-label="Rosa de direções de mergulho">
          {frame}
          {petals}
        </svg>
        <span>Rosa · direção do mergulho (10°)</span>
      </div>
      <div className={styles.plot}>
        <svg viewBox="-115 -120 230 235" role="img" aria-label="Estereograma de polos">
          {frame}
          {poles}
          <path d={`M${mx - 7},${my} L${mx + 7},${my} M${mx},${my - 7} L${mx},${my + 7}`} className={styles.mean} />
        </svg>
        <span>Estereograma · polos (Schmidt, hemisf. inferior)</span>
      </div>
      <p className={styles.summary}>
        n = {data.length} · plano médio <b>{meanDip.toFixed(0)}°/{meanDipDir.toFixed(0).padStart(3, "0")}°</b> (mergulho/direção, N verdadeiro) · consistência {(consistency * 100).toFixed(0)}%
      </p>
    </div>
  );
}
