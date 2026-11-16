import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Trash2, PenLine } from "lucide-react";
import { localDb, type Photo } from "../helpers/localDb";
import { owner } from "../helpers/owner";
import styles from "./PhotoStrip.module.css";

function Thumb({ p, onDelete }: { p: Photo; onDelete: () => void }) {
  const url = useMemo(() => URL.createObjectURL(p.annotated ?? p.blob), [p]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [big, setBig] = useState(false);
  return (
    <div className={styles.thumb}>
      <img src={url} alt={p.caption || "Foto"} onClick={() => setBig(true)} />
      {p.annotated && (
        <span className={styles.tag}>
          <PenLine size={11} /> croqui
        </span>
      )}
      {p.azimuth !== null && <span className={styles.az}>{p.azimuth.toFixed(0)}°</span>}
      {(!p.ownerId || p.ownerId === owner.id()) && (
        <button className={styles.del} onClick={onDelete} aria-label="Excluir foto">
          <Trash2 size={14} />
        </button>
      )}
      {big && (
        <div className={styles.lightbox} onClick={() => setBig(false)}>
          <img src={url} alt="" />
          {p.caption && <div className={styles.caption}>{p.caption}</div>}
        </div>
      )}
    </div>
  );
}

export function PhotoStrip({ recordId, stationId, onAdd, className }: { recordId?: string; stationId?: string; onAdd: () => void; className?: string }) {
  const photos = useLiveQuery(
    () => (recordId ? localDb.photos.where("recordId").equals(recordId).toArray() : stationId ? localDb.photos.where("stationId").equals(stationId).toArray() : Promise.resolve([] as Photo[])),
    [recordId, stationId],
  );
  return (
    <div className={`${styles.strip} ${className ?? ""}`}>
      <button className={styles.add} onClick={onAdd}>
        <Camera size={22} />
        <span>Foto</span>
      </button>
      {(photos ?? []).map((p) => (
        <Thumb
          key={p.id}
          p={p}
          onDelete={() => {
            if (confirm("Excluir esta foto?")) localDb.photos.delete(p.id);
          }}
        />
      ))}
    </div>
  );
}