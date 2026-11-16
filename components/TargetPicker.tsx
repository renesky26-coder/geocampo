import { useMemo, useState } from "react";
import { Navigation, CheckCircle2, Diamond, Crosshair } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./Sheet";
import { Input } from "./Input";
import { Switch } from "./Switch";
import { geo } from "../helpers/geo";
import type { GpsState } from "../helpers/useGps";
import type { ImportedLayer, Station } from "../helpers/localDb";
import type { NavTargetFull } from "./NavPanel";
import styles from "./TargetPicker.module.css";

type Item = NavTargetFull & { kind: "station" | "feature"; visited: boolean; dist: number | null };

const NAME_KEYS = ["name", "Name", "NAME", "nome", "Nome", "NOME", "id", "ID", "Id", "codigo", "CODIGO", "ponto", "PONTO", "fid"];

function featureLabel(props: any, layerName: string, i: number) {
  for (const k of NAME_KEYS) if (props?.[k] !== undefined && props[k] !== null && String(props[k]).trim()) return String(props[k]);
  return `${layerName} #${i + 1}`;
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  layerId: string | null;
  gps: GpsState;
  stations: Station[];
  layers: ImportedLayer[];
  onPick: (t: NavTargetFull) => void;
};

export function TargetPicker({ open, onOpenChange, layerId, gps, stations, layers, onPick }: Props) {
  const [q, setQ] = useState("");
  const [hideVisited, setHideVisited] = useState(true);

  const items = useMemo(() => {
    const out: Item[] = [];
    const d = (lat: number, lon: number) => (gps.lat !== null && gps.lon !== null ? geo.distanceM([gps.lon, gps.lat], [lon, lat]) : null);
    if (!layerId) {
      for (const s of stations) if (!s.deleted) out.push({ kind: "station", lat: s.lat, lon: s.lon, label: `${s.code} ${s.name}`.trim(), visited: false, dist: d(s.lat, s.lon) });
    }
    for (const l of layers) {
      if (l.kind !== "vector" || !l.geojson || (layerId && l.id !== layerId)) continue;
      const visited = new Set<number>(l.meta?.visited ?? []);
      (l.geojson.features ?? []).forEach((f: any, i: number) => {
        const g = f?.geometry;
        let c: number[] | null = null;
        if (g?.type === "Point") c = g.coordinates;
        else if (g?.type === "MultiPoint") c = g.coordinates[0];
        if (!c) return;
        out.push({ kind: "feature", lat: c[1], lon: c[0], label: featureLabel(f.properties, l.name, i), layerId: l.id, featureIdx: i, visited: visited.has(i), dist: d(c[1], c[0]) });
      });
    }
    return out.sort((a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12));
  }, [layerId, stations, layers, gps.lat, gps.lon]);

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const shown = items.filter((i) => (!hideVisited || !i.visited) && (!q || norm(i.label).includes(norm(q)))).slice(0, 300);
  const visitedCount = items.filter((i) => i.visited).length;
  const layerName = layerId ? layers.find((l) => l.id === layerId)?.name : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={styles.sheet}>
        <SheetHeader>
          <SheetTitle>{layerName ? `Navegar · ${layerName}` : "Navegar até…"}</SheetTitle>
          <SheetDescription>
            Ordenado pelo mais próximo. {visitedCount > 0 && `${visitedCount} de ${items.length} já visitados.`}
          </SheetDescription>
        </SheetHeader>
        <div className={styles.body}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar ponto pelo nome" />
          <label className={styles.inline}>
            <Switch checked={hideVisited} onCheckedChange={(v) => setHideVisited(!!v)} /> Ocultar já visitados
          </label>
          {shown.length === 0 ? (
            <div className={styles.empty}>
              {items.length ? "Todos os pontos foram visitados 🎉" : "Nenhum ponto. Importe os pontos de amostragem (CSV com lat/lon ou UTM, GeoJSON, KML, GPX ou Shapefile) na aba Camadas."}
            </div>
          ) : (
            <ul className={styles.list}>
              {shown.map((i) => (
                <li key={`${i.layerId ?? "st"}-${i.featureIdx ?? i.label}`}>
                  <button
                    className={styles.item}
                    onClick={() => {
                      onPick(i);
                      onOpenChange(false);
                    }}
                  >
                    <span className={styles.icon}>{i.kind === "station" ? <Diamond size={16} /> : i.visited ? <CheckCircle2 size={16} /> : <Crosshair size={16} />}</span>
                    <span className={styles.name}>{i.label}</span>
                    <span className={styles.dist}>{i.dist !== null ? geo.formatLength(i.dist) : "—"}</span>
                    <Navigation size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
