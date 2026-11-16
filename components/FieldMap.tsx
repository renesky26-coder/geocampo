import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import proj4 from "proj4";
import { Layers, LocateFixed, Download, Crosshair, Grid3x3, Ruler, Undo2, X } from "lucide-react";
import { geo } from "../helpers/geo";
import { localDb, type FieldRecord, type ImportedLayer, type Station } from "../helpers/localDb";
import type { GpsState } from "../helpers/useGps";
import { loadSqlJs } from "../helpers/loadSqlJs";
import { toast } from "../helpers/toast";
import styles from "./FieldMap.module.css";

type Basemap = { id: string; label: string; url: string; maxNative: number; attribution: string };

const BASEMAPS: Basemap[] = [
  {
    id: "sat",
    label: "Satélite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNative: 19,
    attribution: "Esri, Maxar, Earthstar",
  },
  {
    id: "topo",
    label: "Topográfico",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNative: 17,
    attribution: "© OpenTopoMap (CC-BY-SA), © OpenStreetMap",
  },
  {
    id: "osm",
    label: "Ruas",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNative: 19,
    attribution: "© OpenStreetMap",
  },
];

function tileUrl(tpl: string, z: number, x: number, y: number) {
  const s = "abc"[(x + y) % 3];
  return tpl.replace("{s}", s).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

// Background saving of tiles for offline use: low priority, field scales only, never blocks display.
const CACHE_MIN_ZOOM = 13;
const saveQueue: { key: string; url: string }[] = [];
const queued = new Set<string>();
let saving = 0;
function pumpSave() {
  while (saving < 2 && saveQueue.length && navigator.onLine) {
    const job = saveQueue.shift()!;
    saving++;
    (async () => {
      try {
        if (!(await localDb.tiles.get(job.key))) {
          const r = await fetch(job.url, { mode: "cors" });
          if (r.ok) await localDb.tiles.put({ key: job.key, blob: await r.blob(), savedAt: Date.now() });
        }
      } catch {
        /* ignore — it is only a cache */
      } finally {
        saving--;
        queued.delete(job.key);
        const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
        idle(pumpSave);
      }
    })();
  }
}
function scheduleSave(key: string, url: string) {
  if (queued.has(key)) return;
  queued.add(key);
  saveQueue.push({ key, url });
  if (saveQueue.length > 400) queued.delete(saveQueue.shift()!.key); // keep only the most recent view
  pumpSave();
}

/**
 * Tile layer for field use. Online: tiles load straight from the server (fast, browser cache) and,
 * at field scales, are saved in the background for offline use. Offline or on error: tiles come
 * from the device's saved copy.
 */
const CachedTileLayer = L.TileLayer.extend({
  createTile(this: any, coords: L.Coords, done: L.DoneCallback) {
    const img = document.createElement("img");
    img.alt = "";
    img.setAttribute("role", "presentation");
    img.decoding = "async";
    const id: string = this.options.cacheId;
    const key = `${id}/${coords.z}/${coords.x}/${coords.y}`;
    const url = tileUrl(this._url, coords.z, coords.x, coords.y);
    let triedCache = false;
    const fromCache = () => {
      triedCache = true;
      localDb.tiles
        .get(key)
        .then((hit) => {
          if (hit) img.src = URL.createObjectURL(hit.blob);
          else done(new Error("tile"), img);
        })
        .catch(() => done(new Error("tile"), img));
    };
    img.onload = () => {
      done(undefined, img);
      if (img.src.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(img.src), 5000);
      else if (coords.z >= CACHE_MIN_ZOOM) scheduleSave(key, url);
    };
    img.onerror = () => (triedCache ? done(new Error("tile"), img) : fromCache());
    if (navigator.onLine) img.src = url;
    else fromCache();
    return img;
  },
});

const mbDbs = new Map<string, Promise<any>>();
async function openMb(layer: ImportedLayer) {
  if (!mbDbs.has(layer.id)) {
    mbDbs.set(
      layer.id,
      (async () => {
        const SQL = await loadSqlJs();
        const buf = new Uint8Array(await (layer.data as Blob).arrayBuffer());
        return new SQL.Database(buf);
      })(),
    );
  }
  return mbDbs.get(layer.id)!;
}

function makeMbLayer(layer: ImportedLayer) {
  const Grid = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const img = document.createElement("img");
      openMb(layer)
        .then((db) => {
          const tmsY = Math.pow(2, coords.z) - 1 - coords.y;
          const stmt = db.prepare("SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?");
          stmt.bind([coords.z, coords.x, tmsY]);
          if (stmt.step()) {
            const data = stmt.get()[0] as Uint8Array;
            const fmt = layer.meta?.format === "jpg" || layer.meta?.format === "jpeg" ? "image/jpeg" : layer.meta?.format === "webp" ? "image/webp" : "image/png";
            img.src = URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: fmt }));
            img.onload = () => done(undefined, img);
          } else {
            done(undefined, img);
          }
          stmt.free();
        })
        .catch(() => done(undefined, img));
      return img;
    },
  });
  const minZ = Number(layer.meta?.minzoom ?? 0);
  const maxZ = Number(layer.meta?.maxzoom ?? 18);
  return new (Grid as any)({ opacity: layer.opacity, minNativeZoom: minZ, maxNativeZoom: maxZ, maxZoom: 22, zIndex: 5 });
}

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function attributeTable(props: Record<string, unknown>) {
  const rows = Object.entries(props ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  return `<div class="${styles.attrWrap}"><table class="${styles.attrTable}">${rows || "<tr><td>Sem atributos</td></tr>"}</table></div>`;
}

export type MapFocus = { lat: number; lon: number; zoom?: number; key: number } | null;
export type NavTarget = { lat: number; lon: number; label: string } | null;

// Pixel grids: Sentinel-2 edges on multiples of 10 m; Landsat Collection 2 edges at 15 m (mod 30) in UTM.
const PIXEL_MODES = [
  { size: 0, label: "" },
  { size: 10, offset: 0, label: "Sentinel-2 · 10 m" },
  { size: 30, offset: 15, label: "Landsat · 30 m" },
] as const;

type Props = {
  gps: GpsState;
  records: FieldRecord[];
  stations: Station[];
  layers: ImportedLayer[];
  draft: { kind: "line" | "polygon"; coords: [number, number][] } | null;
  manualMode: boolean;
  onMapTap?: (lat: number, lon: number) => void;
  onSelectRecord?: (id: string) => void;
  onSelectStation?: (id: string) => void;
  focus?: MapFocus;
  navTarget?: NavTarget;
  className?: string;
};

export function FieldMap({ gps, records, stations, layers, draft, manualMode, onMapTap, onSelectRecord, onSelectStation, focus, navTarget, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const base = useRef<L.TileLayer | null>(null);
  const dataGroup = useRef<L.LayerGroup | null>(null);
  const importGroup = useRef<L.LayerGroup | null>(null);
  const draftGroup = useRef<L.LayerGroup | null>(null);
  const pixelGroup = useRef<L.LayerGroup | null>(null);
  const navGroup = useRef<L.LayerGroup | null>(null);
  const [pixelMode, setPixelMode] = useState(0);
  const measureGroup = useRef<L.LayerGroup | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [mPts, setMPts] = useState<[number, number][]>([]); // [lon, lat]
  const measuringRef = useRef(false);
  measuringRef.current = measuring;
  const gpsMarker = useRef<L.CircleMarker | null>(null);
  const gpsCircle = useRef<L.Circle | null>(null);
  const centeredOnce = useRef(false);
  const tapRef = useRef(onMapTap);
  const manualRef = useRef(manualMode);
  tapRef.current = onMapTap;
  manualRef.current = manualMode;
  const [basemapId, setBasemapId] = useState<string>(() => {
    try {
      return localStorage.getItem("gc-basemap") ?? "sat";
    } catch {
      return "sat";
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, maxZoom: 22 }).setView([-25.5, -54.5], 12);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(m);
    importGroup.current = L.layerGroup().addTo(m);
    dataGroup.current = L.layerGroup().addTo(m);
    draftGroup.current = L.layerGroup().addTo(m);
    pixelGroup.current = L.layerGroup().addTo(m);
    navGroup.current = L.layerGroup().addTo(m);
    measureGroup.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (measuringRef.current) {
        setMPts((p) => [...p, [e.latlng.lng, e.latlng.lat]]);
        return;
      }
      if (manualRef.current && tapRef.current) tapRef.current(e.latlng.lat, e.latlng.lng);
    });
    m.on("dragstart", () => setFollow(false));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Basemap
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const bm = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];
    base.current?.remove();
    base.current = new (CachedTileLayer as any)(bm.url, {
      cacheId: bm.id,
      maxNativeZoom: bm.maxNative,
      maxZoom: 22,
      attribution: bm.attribution,
      // Don't request tiles for every intermediate zoom level; load once the gesture ends.
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 3,
    }).addTo(m);
    base.current!.bringToBack();
    try {
      localStorage.setItem("gc-basemap", bm.id);
    } catch {
      /* ignore */
    }
  }, [basemapId]);

  // Imported layers
  useEffect(() => {
    const g = importGroup.current;
    if (!g) return;
    g.clearLayers();
    const urls: string[] = [];
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.kind === "vector" && layer.geojson) {
        L.geoJSON(layer.geojson, {
          style: () => ({ color: layer.color, weight: 2, opacity: 1, fillOpacity: 0.15 * layer.opacity * 2 }),
          pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 6, color: "#fff", weight: 2, fillColor: layer.color, fillOpacity: 1 }),
          onEachFeature: (f, lyr) => lyr.bindPopup(`<strong>${esc(layer.name)}</strong>${attributeTable(f.properties as any)}`, { maxWidth: 320 }),
        }).addTo(g);
      } else if (layer.kind === "geotiff" && layer.data && layer.bounds) {
        const url = URL.createObjectURL(layer.data);
        urls.push(url);
        L.imageOverlay(url, layer.bounds, { opacity: layer.opacity }).addTo(g);
      } else if (layer.kind === "mbtiles" && layer.data) {
        makeMbLayer(layer).addTo(g);
      } else if (layer.kind === "xyz" && layer.meta?.url) {
        // Online tile service (IBGE, MapBiomas, GEE…); tiles seen online are kept for offline use.
        new (CachedTileLayer as any)(layer.meta.url, {
          cacheId: `l-${layer.id}`,
          maxZoom: 22,
          maxNativeZoom: Number(layer.meta.maxzoom ?? 20),
          opacity: layer.opacity,
          zIndex: 5,
          attribution: layer.name,
        }).addTo(g);
      } else if (layer.kind === "wms" && layer.meta?.url) {
        L.tileLayer
          .wms(layer.meta.url, {
            layers: layer.meta.layers,
            styles: layer.meta.styles ?? "",
            format: "image/png",
            transparent: true,
            version: layer.meta.version ?? "1.3.0",
            opacity: layer.opacity,
            maxZoom: 22,
            zIndex: 5,
            attribution: layer.name,
          } as any)
          .addTo(g);
      }
    }
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [layers]);

  // Field data
  useEffect(() => {
    const g = dataGroup.current;
    if (!g) return;
    g.clearLayers();
    for (const r of records) {
      if (r.deleted) continue;
      const geom = r.geometry;
      let lyr: L.Layer;
      if (geom.type === "Point") {
        lyr = L.circleMarker([geom.coordinates[1], geom.coordinates[0]], {
          radius: 8,
          color: "#fff8f0",
          weight: 2,
          fillColor: "#b84a24",
          fillOpacity: 1,
        });
      } else if (geom.type === "LineString") {
        lyr = L.polyline(geom.coordinates.map(([x, y]) => [y, x] as [number, number]), { color: "#e0561f", weight: 4 });
      } else {
        lyr = L.polygon(geom.coordinates[0].map(([x, y]) => [y, x] as [number, number]), {
          color: "#e0561f",
          weight: 3,
          fillOpacity: 0.18,
        });
      }
      lyr.bindTooltip(r.name || "Sem nome", { direction: "top", className: styles.tip });
      lyr.on("click", (e: any) => {
        L.DomEvent.stopPropagation(e);
        onSelectRecord?.(r.id);
      });
      lyr.addTo(g);
    }
    for (const s of stations) {
      if (s.deleted) continue;
      const icon = L.divIcon({
        className: styles.stationIcon,
        html: `<span class="${styles.stationPin}"></span><span class="${styles.stationCode}">${esc(s.code)}</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([s.lat, s.lon], { icon })
        .on("click", (e: any) => {
          L.DomEvent.stopPropagation(e);
          onSelectStation?.(s.id);
        })
        .addTo(g);
    }
  }, [records, stations, onSelectRecord, onSelectStation]);

  // Draft geometry
  useEffect(() => {
    const g = draftGroup.current;
    if (!g) return;
    g.clearLayers();
    if (!draft || draft.coords.length === 0) return;
    const lls = draft.coords.map(([x, y]) => [y, x] as [number, number]);
    if (draft.kind === "polygon" && lls.length >= 3) {
      L.polygon(lls, { color: "#e0561f", weight: 3, dashArray: "6 6", fillOpacity: 0.12 }).addTo(g);
    } else {
      L.polyline(lls, { color: "#e0561f", weight: 4, dashArray: "6 6" }).addTo(g);
    }
    lls.forEach((ll) => L.circleMarker(ll, { radius: 4, color: "#fff", weight: 1, fillColor: "#e0561f", fillOpacity: 1 }).addTo(g));
  }, [draft]);

  // GPS
  useEffect(() => {
    const m = map.current;
    if (!m || gps.lat === null || gps.lon === null) return;
    const ll: [number, number] = [gps.lat, gps.lon];
    if (!gpsMarker.current) {
      gpsCircle.current = L.circle(ll, { radius: gps.accuracy ?? 10, color: "#e0561f", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(m);
      gpsMarker.current = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#e0561f", fillOpacity: 1, className: styles.gpsDot, interactive: false }).addTo(m);
    } else {
      gpsMarker.current.setLatLng(ll);
      gpsCircle.current?.setLatLng(ll).setRadius(gps.accuracy ?? 10);
    }
    if (!centeredOnce.current) {
      m.setView(ll, 17);
      centeredOnce.current = true;
    } else if (follow) {
      m.panTo(ll, { animate: true });
    }
  }, [gps.lat, gps.lon, gps.accuracy, follow]);

  useEffect(() => {
    if (focus && map.current) {
      setFollow(false);
      map.current.setView([focus.lat, focus.lon], focus.zoom ?? Math.max(map.current.getZoom(), 17));
    }
  }, [focus]);

  // Satellite pixel (and its 8 neighbours) around the current position, aligned to the sensor grid.
  useEffect(() => {
    const g = pixelGroup.current;
    if (!g) return;
    g.clearLayers();
    const mode = PIXEL_MODES[pixelMode];
    if (!mode.size || gps.lat === null || gps.lon === null) return;
    const zone = geo.utmZoneFromLon(gps.lon);
    const def = geo.utmDefinition(zone, gps.lat < 0).def;
    const t = proj4("EPSG:4326", def);
    const [e, n] = t.forward([gps.lon, gps.lat]);
    const s = mode.size;
    const off = "offset" in mode ? mode.offset : 0;
    const x0 = Math.floor((e - off) / s) * s + off;
    const y0 = Math.floor((n - off) / s) * s + off;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const xa = x0 + i * s;
        const ya = y0 + j * s;
        const ring = [
          [xa, ya],
          [xa + s, ya],
          [xa + s, ya + s],
          [xa, ya + s],
        ].map(([x, y]) => {
          const [lo, la] = t.inverse([x, y]);
          return [la, lo] as [number, number];
        });
        const center = i === 0 && j === 0;
        L.polygon(ring, {
          color: center ? "#ffd400" : "#ffffff",
          weight: center ? 3 : 1,
          opacity: center ? 1 : 0.7,
          fillOpacity: center ? 0.12 : 0,
          dashArray: center ? undefined : "4 4",
          interactive: false,
        }).addTo(g);
      }
    }
  }, [pixelMode, gps.lat, gps.lon]);

  // Navigation line from the GPS position to the target.
  useEffect(() => {
    const g = measureGroup.current;
    if (!g) return;
    g.clearLayers();
    if (!measuring || !mPts.length) return;
    const lls = mPts.map(([x, y]) => [y, x] as [number, number]);
    if (lls.length >= 3) L.polygon(lls, { color: "#00e5ff", weight: 1, dashArray: "4 4", fillOpacity: 0.12, interactive: false }).addTo(g);
    L.polyline(lls, { color: "#00e5ff", weight: 3, interactive: false }).addTo(g);
    lls.forEach((ll) => L.circleMarker(ll, { radius: 5, color: "#003a40", weight: 2, fillColor: "#00e5ff", fillOpacity: 1, interactive: false }).addTo(g));
  }, [measuring, mPts]);

  useEffect(() => {
    const g = navGroup.current;
    if (!g) return;
    g.clearLayers();
    if (!navTarget) return;
    L.circleMarker([navTarget.lat, navTarget.lon], { radius: 11, color: "#ffd400", weight: 4, fillOpacity: 0, interactive: false }).addTo(g);
    if (gps.lat !== null && gps.lon !== null) {
      L.polyline(
        [
          [gps.lat, gps.lon],
          [navTarget.lat, navTarget.lon],
        ],
        { color: "#ffd400", weight: 3, dashArray: "8 6", interactive: false },
      ).addTo(g);
    }
  }, [navTarget, gps.lat, gps.lon]);

  async function downloadArea() {
    const m = map.current;
    if (!m) return;
    if (!navigator.onLine) {
      toast.error("Sem conexão — conecte-se para baixar a área.");
      return;
    }
    const bm = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];
    const b = m.getBounds();
    const z0 = Math.max(10, Math.min(m.getZoom(), bm.maxNative));
    const z1 = Math.min(bm.maxNative, z0 + 3);
    const tiles: { z: number; x: number; y: number }[] = [];
    for (let z = z0; z <= z1; z++) {
      const nw = m.project(b.getNorthWest(), z).divideBy(256).floor();
      const se = m.project(b.getSouthEast(), z).divideBy(256).floor();
      for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) tiles.push({ z, x, y });
    }
    if (tiles.length > 2500) {
      toast.error(`Área grande demais (${tiles.length} blocos). Aproxime o mapa e tente de novo.`);
      return;
    }
    let ok = 0;
    setDownloading(`0/${tiles.length}`);
    const queue = [...tiles];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift()!;
        const key = `${bm.id}/${t.z}/${t.x}/${t.y}`;
        if (await localDb.tiles.get(key)) {
          ok++;
        } else {
          try {
            const r = await fetch(tileUrl(bm.url, t.z, t.x, t.y), { mode: "cors" });
            if (r.ok) {
              await localDb.tiles.put({ key, blob: await r.blob(), savedAt: Date.now() });
              ok++;
            }
          } catch {
            /* skip */
          }
        }
        setDownloading(`${ok}/${tiles.length}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setDownloading(null);
    toast.success(`Área salva offline: ${ok} de ${tiles.length} blocos (zoom ${z0}–${z1}).`);
  }

  return (
    <div className={`${styles.wrap} ${manualMode ? styles.manual : ""} ${className ?? ""}`}>
      <div ref={el} className={styles.map} />
      <div className={styles.controls}>
        <button className={styles.ctrl} onClick={() => setMenuOpen((v) => !v)} aria-label="Mapa base">
          <Layers size={20} />
        </button>
        <button
          className={`${styles.ctrl} ${follow ? styles.ctrlActive : ""}`}
          onClick={() => {
            setFollow(true);
            if (gps.lat !== null && gps.lon !== null) map.current?.setView([gps.lat, gps.lon], Math.max(map.current.getZoom(), 17));
          }}
          aria-label="Centralizar no GPS"
        >
          <LocateFixed size={20} />
        </button>
        <button className={styles.ctrl} onClick={downloadArea} disabled={!!downloading} aria-label="Baixar área para uso offline">
          <Download size={20} />
        </button>
        <button
          className={`${styles.ctrl} ${pixelMode ? styles.ctrlActive : ""}`}
          onClick={() => setPixelMode((v) => (v + 1) % PIXEL_MODES.length)}
          aria-label="Pixel do satélite"
          title="Pixel do satélite: desligado → Sentinel-2 10 m → Landsat 30 m"
        >
          <Grid3x3 size={20} />
        </button>
        <button
          className={`${styles.ctrl} ${measuring ? styles.ctrlActive : ""}`}
          onClick={() => {
            setMeasuring((v) => !v);
            setMPts([]);
          }}
          aria-label="Régua: medir distância e área"
          title="Régua: toque no mapa para medir"
        >
          <Ruler size={20} />
        </button>
      </div>
      {measuring && (
        <div className={styles.measure}>
          <span>
            {mPts.length < 2 ? "Toque no mapa para medir" : `${geo.formatLength(geo.lineLengthM(mPts))}`}
            {mPts.length >= 3 && ` · área ${geo.formatArea(geo.polygonAreaM2(mPts))}`}
          </span>
          <button onClick={() => setMPts((p) => p.slice(0, -1))} disabled={!mPts.length} aria-label="Desfazer ponto">
            <Undo2 size={16} />
          </button>
          <button
            onClick={() => {
              setMeasuring(false);
              setMPts([]);
            }}
            aria-label="Fechar régua"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {pixelMode > 0 && <div className={styles.pixelTag}>{PIXEL_MODES[pixelMode].label} · pixel em amarelo + vizinhos</div>}
      {menuOpen && (
        <div className={styles.menu}>
          <div className={styles.menuLabel}>Mapa base</div>
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              className={`${styles.menuItem} ${b.id === basemapId ? styles.menuItemActive : ""}`}
              onClick={() => {
                setBasemapId(b.id);
                setMenuOpen(false);
              }}
            >
              {b.label}
            </button>
          ))}
          <div className={styles.menuHint}>Áreas vistas online ficam salvas para uso offline. Use ⬇ para baixar a área da tela.</div>
        </div>
      )}
      {downloading && <div className={styles.progress}>Baixando área offline… {downloading}</div>}
      {manualMode && (
        <div className={styles.crosshairHint}>
          <Crosshair size={16} /> Toque no mapa para adicionar vértices
        </div>
      )}
    </div>
  );
}