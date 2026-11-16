import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Map as MapIcon, ListChecks, Diamond, Layers, Database, MapPin, Spline, Pentagon, Plus, Undo2, Check, X,
  Footprints, Hand, Crosshair, RefreshCw, FileText, Package, Table2, Braces, Upload, Trash2, Eye, EyeOff, Focus, CloudUpload, Camera, ClipboardList,
} from "lucide-react";
import { PhotoCapture } from "../components/PhotoCapture";
import { FichaEditor } from "../components/FichaEditor";
import { useAllFichas } from "../helpers/useAllFichas";
import { backup } from "../helpers/backup";
import { ExportPanel } from "../components/ExportPanel";
import { pullGroupPhotos } from "../helpers/pullGroupPhotos";
import { geoid } from "../helpers/geoid";
import { owner } from "../helpers/owner";
import { OnlineLayerDialog } from "../components/OnlineLayerDialog";
import { NavPanel, type NavTargetFull } from "../components/NavPanel";
import { TargetPicker } from "../components/TargetPicker";
import { demSampler } from "../helpers/demSampler";
import { StructuralPlots } from "../components/StructuralPlots";
import { Navigation } from "lucide-react";
import { GnssAverage, type GnssResult } from "../components/GnssAverage";
import { CoordPanel } from "../components/CoordPanel";
import { FieldMap, type MapFocus } from "../components/FieldMap";
import { RecordSheet, geometrySummary } from "../components/RecordSheet";
import { StationSheet } from "../components/StationSheet";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Badge } from "../components/Badge";
import { Switch } from "../components/Switch";
import { ThemeModeSwitch } from "../components/ThemeModeSwitch";
import { CrsPickerDialog } from "../components/CrsPickerDialog";
import { useGps } from "../helpers/useGps";
import { geo } from "../helpers/geo";
import { localDb, type FieldRecord, type Station } from "../helpers/localDb";
import { newId } from "../helpers/newId";
import { importLayer } from "../helpers/importLayer";
import { CrsUnknownError } from "../helpers/crsRegistry";
import { syncEngine } from "../helpers/syncEngine";
import { exportData } from "../helpers/exportData";
import { reportPdf } from "../helpers/reportPdf";
import { getMe } from "../endpoints/me_GET.schema";
import { toast } from "../helpers/toast";
import styles from "./_index.module.css";

type Tab = "mapa" | "registros" | "estacoes" | "camadas" | "dados";
type Draft = { kind: "line" | "polygon"; coords: [number, number][]; auto: boolean; manual: boolean };

const TABS: { id: Tab; label: string; icon: typeof MapIcon }[] = [
  { id: "mapa", label: "Mapa", icon: MapIcon },
  { id: "registros", label: "Registros", icon: ListChecks },
  { id: "estacoes", label: "Estações", icon: Diamond },
  { id: "camadas", label: "Camadas", icon: Layers },
  { id: "dados", label: "Dados", icon: Database },
];

const kindIcon = { point: MapPin, line: Spline, polygon: Pentagon };
const kindLabel = { point: "Ponto", line: "Linha", polygon: "Polígono" };

function useOnline() {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener("online", a);
    window.addEventListener("offline", b);
    return () => {
      window.removeEventListener("online", a);
      window.removeEventListener("offline", b);
    };
  }, []);
  return on;
}

function lsGet(k: string, d = "") {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export default function FieldNotebookPage() {
  const gps = useGps();
  const online = useOnline();
  const [tab, setTab] = useState<Tab>("mapa");
  const [author, setAuthor] = useState(() => lsGet("gc-author"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ record: FieldRecord; isNew: boolean } | null>(null);
  const [stationOpen, setStationOpen] = useState<{ station: Station; isNew: boolean } | null>(null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "point" | "line" | "polygon">("all");
  const [reportTitle, setReportTitle] = useState(() => lsGet("gc-report-title", "Relatório de campo"));
  const [reportProject, setReportProject] = useState(() => lsGet("gc-report-project"));
  const fileRef = useRef<HTMLInputElement>(null);
  const [crsAsk, setCrsAsk] = useState<{ file: File; fileName: string; message: string; hint: string } | null>(null);
  const [crsBusy, setCrsBusy] = useState(false);
  const [quickPhoto, setQuickPhoto] = useState<{ recordId: string } | null>(null);
  const [fichaEditor, setFichaEditor] = useState(false);
  const [averaging, setAveraging] = useState(false);
  const [query, setQuery] = useState("");
  const [, setOwnerKeyShown] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [pasteKey, setPasteKey] = useState("");
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [navTarget, setNavTarget] = useState<NavTargetFull | null>(null);
  const [picker, setPicker] = useState<{ layerId: string | null } | null>(null);
  const [campanha, setCampanha] = useState(() => lsGet("gc-campanha"));
  const [campFilter, setCampFilter] = useState<string>("__todas");
  const [groupCode, setGroupCode] = useState(() => lsGet("gc-group-code"));
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const lastBackupAt = useLiveQuery(() => localDb.kv.get("lastBackupAt"), [])?.value as number | undefined;
  useEffect(() => {
    backup.requestPersistence().then(setPersisted);
    geoid.load();
    owner.ensure().then(setOwnerKeyShown);
  }, []);
  const { custom: customFichas } = useAllFichas();

  const records = useLiveQuery(() => localDb.records.orderBy("createdAt").reverse().toArray(), []) ?? [];
  const stations = useLiveQuery(() => localDb.stations.orderBy("createdAt").toArray(), []) ?? [];
  const layers = useLiveQuery(() => localDb.layers.orderBy("createdAt").toArray(), []) ?? [];
  const measurements = useLiveQuery(() => localDb.measurements.toArray(), []) ?? [];
  const pending =
    useLiveQuery(async () => {
      const [a, b, c, d] = await Promise.all([
        localDb.records.where("synced").equals(0).count(),
        localDb.stations.where("synced").equals(0).count(),
        localDb.measurements.where("synced").equals(0).count(),
        localDb.photos.where("synced").equals(0).count(),
      ]);
      return { records: a, stations: b, measurements: c, photos: d, total: a + b + c + d };
    }, []) ?? { records: 0, stations: 0, measurements: 0, photos: 0, total: 0 };
  const lastSyncAt = useLiveQuery(() => localDb.kv.get("lastSyncAt"), [])?.value as number | undefined;
  const tileCount = useLiveQuery(() => localDb.tiles.count(), []) ?? 0;

  const liveRecords = useMemo(() => records.filter((r) => !r.deleted), [records]);
  const liveStations = useMemo(() => stations.filter((s) => !s.deleted), [stations]);
  // Elevation from visible MDT layers (single-band GeoTIFFs), for the map chip and new records.
  const [demCount, setDemCount] = useState(0);
  const demKey = layers.map((l) => `${l.id}:${l.visible}`).join("|");
  useEffect(() => {
    demSampler.refresh().then(setDemCount);
  }, [demKey]);
  const demHere = demCount && gps.lat !== null && gps.lon !== null ? demSampler.sample(gps.lat, gps.lon) : null;
  const demAttr = (lat: number, lon: number): Record<string, string> => {
    const r = demCount ? demSampler.sample(lat, lon) : null;
    return r ? { "gnss.altitude_mdt_m": r.value.toFixed(2) } : {};
  };
  const campanhas = useMemo(
    () => Array.from(new Set(liveRecords.map((r) => r.attributes._campanha).filter((c): c is string => typeof c === "string" && !!c))).sort(),
    [liveRecords],
  );

  // Who is signed in (internal app) — cached for offline use.
  useEffect(() => {
    if (!online) return;
    getMe()
      .then((me) => {
        if (me.email && !lsGet("gc-author")) {
          setAuthor(me.email);
          lsSet("gc-author", me.email);
        }
      })
      .catch(() => undefined);
  }, [online]);

  const doSync = useCallback(
    async (silent = false) => {
      if (!navigator.onLine) {
        if (!silent) toast.error("Sem conexão. Os dados continuam salvos no aparelho.");
        return;
      }
      setSyncing(true);
      try {
        const r = await syncEngine();
        if (!silent || r.sent || r.received || r.photos)
          toast.success("Sincronizado", {
            description: `${r.sent} enviados · ${r.received} recebidos · ${r.photos} fotos${r.photoErrors ? ` · ${r.photoErrors} fotos com erro` : ""}`,
          });
      } catch (e: any) {
        if (!silent) toast.error("Falha na sincronização", { description: e?.message });
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  // Sync when the app opens and whenever the connection comes back.
  useEffect(() => {
    if (online) doSync(true);
  }, [online, doSync]);

  // Continuous track recording
  useEffect(() => {
    if (!draft?.auto) return;
    return useGps.onFix((s) => {
      if (s.lat === null || s.lon === null || (s.accuracy ?? 99) > 25) return;
      setDraft((d) => {
        if (!d || !d.auto) return d;
        const p: [number, number] = [s.lon!, s.lat!];
        const last = d.coords[d.coords.length - 1];
        if (last && geo.distanceM(last, p) < Math.max(2, (s.accuracy ?? 5) * 0.5)) return d;
        return { ...d, coords: [...d.coords, p] };
      });
    });
  }, [draft?.auto]);

  function baseRecord(kind: FieldRecord["kind"], geometry: FieldRecord["geometry"]): FieldRecord {
    const now = Date.now();
    return {
      id: newId(),
      kind,
      name: "",
      geometry,
      altitude: gps.altitude,
      accuracy: gps.accuracy,
      attributes: {
        ...(gps.lat !== null && gps.lon !== null ? { ...geoid.orthoAttributes(gps.lat, gps.lon, gps.altitude), ...demAttr(gps.lat, gps.lon) } : {}),
        ...(campanha.trim() ? { _campanha: campanha.trim() } : {}),
      },
      dip: null,
      dipDirection: null,
      notes: "",
      stationId: null,
      createdAt: now,
      updatedAt: now,
      author,
      ownerId: owner.id(),
      synced: 0,
    };
  }

  function capturePoint() {
    if (gps.lat === null || gps.lon === null) return toast.error("Aguardando sinal GPS");
    setAveraging(true);
  }

  function pointFromAverage(r: GnssResult) {
    setAveraging(false);
    if (r.accuracy > 15) toast.warning(`Precisão final ±${r.accuracy.toFixed(1)} m — considere repetir em céu aberto.`);
    const n = liveRecords.filter((x) => x.kind === "point").length + 1;
    const rec = baseRecord("point", { type: "Point", coordinates: [r.lon, r.lat, r.altitude ?? undefined] });
    rec.altitude = r.altitude;
    rec.accuracy = Math.round(r.accuracy * 10) / 10;
    rec.attributes = {
      ...(campanha.trim() ? { _campanha: campanha.trim() } : {}),
      ...geoid.orthoAttributes(r.lat, r.lon, r.altitude),
      ...demAttr(r.lat, r.lon),
      "gnss.leituras": String(r.n),
      "gnss.tempo_s": String(r.seconds),
      ...(r.sdH != null ? { "gnss.dispersao_m": r.sdH.toFixed(2) } : {}),
    };
    rec.name = `P-${String(n).padStart(3, "0")}`;
    setEditing({ record: rec, isNew: true });
  }

  function startDraft(kind: "line" | "polygon") {
    setDraft({ kind, coords: [], auto: kind === "line", manual: false });
    setTab("mapa");
  }

  // Keep the screen on while a line/polygon is being recorded (long tracks).
  const recording = !!draft;
  useEffect(() => {
    if (!recording) return;
    let lock: any = null;
    (navigator as any).wakeLock
      ?.request("screen")
      .then((l: any) => (lock = l))
      .catch(() => undefined);
    return () => {
      lock?.release?.().catch?.(() => undefined);
    };
  }, [recording]);

  function addGpsVertex() {
    if (gps.lat === null || gps.lon === null) return toast.error("Aguardando sinal GPS");
    try {
      navigator.vibrate?.(25);
    } catch {
      /* ignore */
    }
    setDraft((d) => (d ? { ...d, coords: [...d.coords, [gps.lon!, gps.lat!]] } : d));
  }

  function finishDraft() {
    if (!draft) return;
    const min = draft.kind === "line" ? 2 : 3;
    if (draft.coords.length < min) return toast.error(`São necessários ao menos ${min} vértices`);
    const geometry: FieldRecord["geometry"] =
      draft.kind === "line" ? { type: "LineString", coordinates: draft.coords } : { type: "Polygon", coordinates: [[...draft.coords, draft.coords[0]]] };
    const rec = baseRecord(draft.kind, geometry);
    const n = liveRecords.filter((r) => r.kind === draft.kind).length + 1;
    rec.name = `${draft.kind === "line" ? "L" : "A"}-${String(n).padStart(3, "0")}`;
    setDraft(null);
    setEditing({ record: rec, isNew: true });
  }

  function newStation() {
    if (gps.lat === null || gps.lon === null) return toast.error("Aguardando sinal GPS");
    const now = Date.now();
    setStationOpen({
      station: {
        id: newId(),
        code: `PN-${String(liveStations.length + 1).padStart(2, "0")}`,
        name: "",
        lat: gps.lat,
        lon: gps.lon,
        altitude: gps.altitude,
        description: "",
        createdAt: now,
        updatedAt: now,
        author,
        ownerId: owner.id(),
        synced: 0,
      },
      isNew: true,
    });
  }

  const openRecord = useCallback(
    (id: string) => {
      const r = records.find((x) => x.id === id);
      if (r) setEditing({ record: r, isNew: false });
    },
    [records],
  );
  const openStation = useCallback(
    (id: string) => {
      const s = stations.find((x) => x.id === id);
      if (s) setStationOpen({ station: s, isNew: false });
    },
    [stations],
  );

  function showOnMap(lat: number, lon: number) {
    setFocus({ lat, lon, zoom: 18, key: Date.now() });
    setTab("mapa");
  }

  /** Returns false when the file needs the user to pick its projection. */
  async function importOne(f: File, crs?: string): Promise<boolean> {
    try {
      const l = await importLayer(f, crs);
      toast.success(`Camada "${l.name}" importada`, {
        description: l.kind === "vector" ? `${l.meta?.features ?? 0} feições` : l.kind === "geotiff" ? `GeoTIFF · ${typeof l.meta?.epsg === "number" ? `EPSG:${l.meta.epsg}` : "projeção informada"}` : "MBTiles",
      });
      if (l.bounds) {
        const [[s, w], [n, ea]] = l.bounds;
        setFocus({ lat: (s + n) / 2, lon: (w + ea) / 2, zoom: 15, key: Date.now() });
      }
      return true;
    } catch (err: any) {
      if (err instanceof CrsUnknownError || err?.name === "CrsUnknownError") {
        setCrsAsk({ file: f, fileName: f.name, message: err.message, hint: err.hint ?? "" });
        return false;
      }
      toast.error(`Não foi possível importar ${f.name}`, { description: err?.message });
      return true;
    }
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const f of files) {
      setBusy(`Importando ${f.name}…`);
      const done = await importOne(f);
      if (!done) break; // wait for the projection answer
    }
    setBusy(null);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      toast.error("Falhou", { description: e?.message });
    } finally {
      setBusy(null);
    }
  }

  const draftLen = draft ? geo.lineLengthM(draft.kind === "polygon" && draft.coords.length > 2 ? [...draft.coords, draft.coords[0]] : draft.coords) : 0;
  const draftArea = draft?.kind === "polygon" ? geo.polygonAreaM2(draft.coords) : 0;
  const q = query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const filtered = liveRecords.filter(
    (r) =>
      (filter === "all" || r.kind === filter) &&
      (campFilter === "__todas" || (campFilter === "__sem" ? !r.attributes._campanha : r.attributes._campanha === campFilter)) &&
      (!q || norm([r.name, r.notes, r.author, ...Object.values(r.attributes).flat()].join(" ")).includes(q)),
  );

  return (
    <div className={styles.app}>
      <Helmet>
        <title>GeoCampo — coleta de dados em campo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1f2e26" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="GeoCampo" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </Helmet>
      <CoordPanel gps={gps} online={online} pending={pending.total} />

      <div className={styles.shell}>
        <nav className={styles.nav}>
          {TABS.map((t) => (
            <button key={t.id} className={`${styles.navItem} ${tab === t.id ? styles.navOn : ""}`} onClick={() => setTab(t.id)}>
              <t.icon size={22} />
              <span>{t.label}</span>
              {t.id === "dados" && pending.total > 0 && <i className={styles.dot} />}
            </button>
          ))}
        </nav>

        <main className={styles.main}>
          {/* Map stays mounted so it keeps position and tiles between tabs */}
          <section className={`${styles.mapTab} ${tab === "mapa" ? "" : styles.hidden}`}>
            <FieldMap
              gps={gps}
              records={liveRecords}
              stations={liveStations}
              layers={layers}
              draft={draft}
              manualMode={!!draft?.manual}
              onMapTap={(lat, lon) => setDraft((d) => (d ? { ...d, coords: [...d.coords, [lon, lat]] } : d))}
              onSelectRecord={openRecord}
              onSelectStation={openStation}
              focus={focus}
              navTarget={navTarget}
            />
            {demHere && !navTarget && (
              <div className={styles.demChip}>
                MDT aqui <b>{demHere.value.toFixed(1)} m</b>
              </div>
            )}
            {navTarget && !draft && (
              <NavPanel
                target={navTarget}
                gps={gps}
                onClose={() => setNavTarget(null)}
                onCreatePoint={() => {
                  setNavTarget(null);
                  capturePoint();
                }}
                onVisited={
                  navTarget.layerId !== undefined && navTarget.featureIdx !== undefined
                    ? async () => {
                        const l = await localDb.layers.get(navTarget.layerId!);
                        if (l) {
                          const visited = Array.from(new Set([...(l.meta?.visited ?? []), navTarget.featureIdx!]));
                          await localDb.layers.update(l.id, { meta: { ...(l.meta ?? {}), visited } });
                        }
                        toast.success("Marcado como visitado");
                        setNavTarget(null);
                        setPicker({ layerId: navTarget.layerId! });
                      }
                    : undefined
                }
              />
            )}
            {draft ? (
              <div className={styles.captureBar}>
                <div className={styles.captureHead}>
                  <span className={styles.recDot} data-on={draft.auto} />
                  <strong>{draft.kind === "line" ? "Gravando linha" : "Gravando polígono"}</strong>
                  <span className={styles.mono}>
                    {draft.coords.length} vért. · {geo.formatLength(draftLen)}
                    {draft.kind === "polygon" && draft.coords.length > 2 && ` · ${geo.formatArea(draftArea)}`}
                  </span>
                </div>
                <div className={styles.captureModes}>
                  <button className={`${styles.mode} ${draft.auto ? styles.modeOn : ""}`} onClick={() => setDraft({ ...draft, auto: !draft.auto })}>
                    <Footprints size={18} /> Rastro automático
                  </button>
                  <button className={`${styles.mode} ${draft.manual ? styles.modeOn : ""}`} onClick={() => setDraft({ ...draft, manual: !draft.manual })}>
                    <Hand size={18} /> Tocar no mapa
                  </button>
                </div>
                <div className={styles.captureActions}>
                  <Button variant="outline" size="lg" onClick={() => setDraft(null)} aria-label="Cancelar">
                    <X size={20} />
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => setDraft({ ...draft, coords: draft.coords.slice(0, -1) })} disabled={!draft.coords.length} aria-label="Desfazer vértice">
                    <Undo2 size={20} />
                  </Button>
                  <Button variant="secondary" size="lg" onClick={addGpsVertex} className={styles.grow}>
                    <Crosshair size={20} /> Vértice GPS
                  </Button>
                  <Button size="lg" onClick={finishDraft}>
                    <Check size={20} /> Concluir
                  </Button>
                </div>
              </div>
            ) : (
              <div className={styles.fabRow}>
                <button className={`${styles.fab} ${styles.fabPhoto}`} onClick={() => setQuickPhoto({ recordId: newId() })}>
                  <Camera size={22} />
                  <span>Foto</span>
                </button>
                <button className={`${styles.fab} ${styles.fabMain}`} onClick={capturePoint}>
                  <MapPin size={24} />
                  <span>Ponto</span>
                </button>
                <button className={styles.fab} onClick={() => startDraft("line")}>
                  <Spline size={22} />
                  <span>Linha</span>
                </button>
                <button className={styles.fab} onClick={() => startDraft("polygon")}>
                  <Pentagon size={22} />
                  <span>Polígono</span>
                </button>
                <button className={styles.fab} onClick={newStation}>
                  <Diamond size={22} />
                  <span>Estação</span>
                </button>
              </div>
            )}
          </section>

          {tab === "registros" && (
            <section className={styles.page}>
              <div className={styles.pageHead}>
                <h1>Registros de campo</h1>
                <span className={styles.mono}>{liveRecords.length} no aparelho</span>
              </div>
              <div className={styles.campBox}>
                <label className={styles.f}>
                  <span>Campanha atual — vai em cada coleta nova</span>
                  <Input
                    list="gc-campanhas"
                    value={campanha}
                    onChange={(e) => (setCampanha(e.target.value), lsSet("gc-campanha", e.target.value))}
                    placeholder="Ex.: Voçoroca Sul – Nov/2026 (deixe vazio para nenhuma)"
                  />
                  <datalist id="gc-campanhas">
                    {campanhas.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                {campanhas.length > 0 && (
                  <div className={styles.filters}>
                    {["__todas", ...campanhas, "__sem"].map((c) => (
                      <button key={c} className={`${styles.filter} ${campFilter === c ? styles.filterOn : ""}`} onClick={() => setCampFilter(c)}>
                        {c === "__todas" ? "Todas as campanhas" : c === "__sem" ? "Sem campanha" : c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Input
                className={styles.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome, observação, autor ou resposta (ex.: Latossolo, R3, basalto)"
              />
              <div className={styles.filters}>
                {(["all", "point", "line", "polygon"] as const).map((f) => (
                  <button key={f} className={`${styles.filter} ${filter === f ? styles.filterOn : ""}`} onClick={() => setFilter(f)}>
                    {f === "all" ? "Todos" : kindLabel[f]}
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className={styles.empty}>Nenhum registro ainda. No mapa, toque em <b>Ponto</b>, <b>Linha</b> ou <b>Polígono</b>.</div>
              ) : (
                <ul className={styles.list}>
                  {filtered.map((r) => {
                    const Icon = kindIcon[r.kind];
                    const g = r.geometry;
                    const [lo, la] = g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates[0] : g.coordinates[0][0];
                    const tags = Object.values(r.attributes).flat().slice(0, 4);
                    return (
                      <li key={r.id} className={styles.card}>
                        <button className={styles.cardMain} onClick={() => setEditing({ record: r, isNew: false })}>
                          <span className={styles.kind}>
                            <Icon size={18} />
                          </span>
                          <span className={styles.cardBody}>
                            <span className={styles.cardTitle}>{r.name || "Sem nome"}</span>
                            <span className={styles.cardMeta}>{geometrySummary(r)}</span>
                            {tags.length > 0 && (
                              <span className={styles.tags}>
                                {tags.map((t) => (
                                  <em key={t}>{t}</em>
                                ))}
                              </span>
                            )}
                            <span className={styles.cardMeta}>
                              {new Date(r.createdAt).toLocaleString("pt-BR")} {r.author && `· ${r.author}`}
                            </span>
                          </span>
                        </button>
                        <div className={styles.cardSide}>
                          <Badge variant={r.synced ? "success" : "warning"}>{r.synced ? "nuvem" : "local"}</Badge>
                          <Button size="icon-md" variant="ghost" onClick={() => showOnMap(la, lo)} aria-label="Ver no mapa">
                            <Focus size={18} />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <StructuralPlots records={filtered} />
            </section>
          )}

          {tab === "estacoes" && (
            <section className={styles.page}>
              <div className={styles.pageHead}>
                <h1>Estações de monitoramento</h1>
                <div className={styles.keyRow}>
                  <Button variant="outline" onClick={() => setPicker({ layerId: null })}>
                    <Navigation size={18} /> Navegar até…
                  </Button>
                  <Button onClick={newStation}>
                    <Plus size={18} /> Nova estação aqui
                  </Button>
                </div>
              </div>
              <p className={styles.lead}>Pinos fixos de referência. Ao voltar a campo, abra o pino e adicione a nova medida — o histórico fica na mesma coordenada.</p>
              {liveStations.length === 0 ? (
                <div className={styles.empty}>Nenhuma estação. Fique sobre o pino e toque em <b>Nova estação aqui</b>.</div>
              ) : (
                <ul className={styles.list}>
                  {liveStations.map((s) => {
                    const ms = measurements.filter((m) => m.stationId === s.id && !m.deleted).sort((a, b) => a.measuredAt - b.measuredAt);
                    const last = ms[ms.length - 1];
                    const d = gps.lat !== null && gps.lon !== null ? geo.distanceM([gps.lon, gps.lat], [s.lon, s.lat]) : null;
                    return (
                      <li key={s.id} className={styles.card}>
                        <button className={styles.cardMain} onClick={() => setStationOpen({ station: s, isNew: false })}>
                          <span className={styles.stationMark} />
                          <span className={styles.cardBody}>
                            <span className={styles.cardTitle}>
                              <span className={styles.code}>{s.code}</span> {s.name}
                            </span>
                            <span className={styles.cardMeta}>
                              {ms.length} medida{ms.length === 1 ? "" : "s"}
                              {last && ` · última ${new Date(last.measuredAt).toLocaleDateString("pt-BR")}: ${last.value.toLocaleString("pt-BR")} ${last.unit}`}
                            </span>
                            {d !== null && <span className={styles.cardMeta}>a {geo.formatLength(d)} de você</span>}
                          </span>
                        </button>
                        <div className={styles.cardSide}>
                          <Badge variant={s.synced ? "success" : "warning"}>{s.synced ? "nuvem" : "local"}</Badge>
                          <Button size="icon-md" variant="ghost" onClick={() => showOnMap(s.lat, s.lon)} aria-label="Ver no mapa">
                            <Focus size={18} />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {tab === "camadas" && (
            <section className={styles.page}>
              <div className={styles.pageHead}>
                <h1>Camadas</h1>
                <div className={styles.keyRow}>
                  <Button variant="outline" onClick={() => setOnlineOpen(true)}>
                    <Layers size={18} /> Camada online
                  </Button>
                  <Button onClick={() => fileRef.current?.click()} disabled={!!busy}>
                    <Upload size={18} /> Importar arquivo
                  </Button>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                multiple
                accept=".kml,.kmz,.geojson,.json,.zip,.gpx,.csv,.txt,.tif,.tiff,.mbtiles"
                onChange={onImport}
              />
              <p className={styles.lead}>
                Vetor: KML, KMZ, GeoJSON, GPX e Shapefile (.zip com .shp/.dbf/.prj). Raster offline: GeoTIFF (ortomosaico, MDT — reprojetado para o mapa, MDT com rampa hipsométrica) e MBTiles raster. Aceita qualquer projeção (SIRGAS 2000, SAD69, Córrego Alegre, WGS 84, UTM, Policônica, Albers ou qualquer EPSG) — se o arquivo não informar, o app pergunta. Tudo fica guardado no aparelho.
              </p>
              {busy && <div className={styles.busy}>{busy}</div>}
              {layers.length === 0 ? (
                <div className={styles.empty}>Nenhuma camada importada.</div>
              ) : (
                <ul className={styles.list}>
                  {layers.map((l) => (
                    <li key={l.id} className={styles.layerCard}>
                      <span className={styles.swatch} style={{ background: l.kind === "vector" ? l.color : "linear-gradient(135deg,#2b6946,#e6d68c,#b86e3c)" }} />
                      <div className={styles.cardBody}>
                        <span className={styles.cardTitle}>{l.name}</span>
                        <span className={styles.cardMeta}>
                          {l.kind === "vector" ? `Vetor · ${l.meta?.features ?? 0} feições` : l.kind === "geotiff" ? `GeoTIFF · EPSG:${l.meta?.epsg}${l.meta?.min != null ? ` · ${Number(l.meta.min).toFixed(1)}–${Number(l.meta.max).toFixed(1)}` : ""}` : l.kind === "xyz" ? "Online · XYZ (guarda o que for visto)" : l.kind === "wms" ? `Online · WMS ${l.meta?.layers ?? ""}` : `MBTiles · zoom ${l.meta?.minzoom}–${l.meta?.maxzoom}`}
                        </span>
                        {l.kind !== "vector" && (
                          <label className={styles.opacity}>
                            Opacidade
                            <input
                              type="range"
                              min={0.1}
                              max={1}
                              step={0.05}
                              value={l.opacity}
                              onChange={(e) => localDb.layers.update(l.id, { opacity: Number(e.target.value) })}
                            />
                          </label>
                        )}
                      </div>
                      <div className={styles.layerActions}>
                        {l.kind === "vector" && (l.geojson?.features ?? []).some((f: any) => f?.geometry?.type === "Point" || f?.geometry?.type === "MultiPoint") && (
                          <Button size="icon-md" variant="ghost" onClick={() => setPicker({ layerId: l.id })} aria-label="Navegar pelos pontos">
                            <Navigation size={18} />
                          </Button>
                        )}
                        <Button size="icon-md" variant="ghost" onClick={() => localDb.layers.update(l.id, { visible: l.visible ? 0 : 1 })} aria-label="Mostrar/ocultar">
                          {l.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                        </Button>
                        <Button
                          size="icon-md"
                          variant="ghost"
                          disabled={!l.bounds}
                          onClick={() => {
                            if (!l.bounds) return;
                            const [[s, w], [n, e]] = l.bounds;
                            showOnMap((s + n) / 2, (w + e) / 2);
                          }}
                          aria-label="Ir para a camada"
                        >
                          <Focus size={18} />
                        </Button>
                        <Button size="icon-md" variant="ghost" onClick={() => confirm(`Remover a camada "${l.name}"?`) && localDb.layers.delete(l.id)} aria-label="Remover">
                          <Trash2 size={18} />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === "dados" && (
            <section className={styles.page}>
              <div className={styles.pageHead}>
                <h1>Dados e sincronização</h1>
                <ThemeModeSwitch />
              </div>

              <div className={styles.panel}>
                <div className={styles.panelLabel}>Sincronização com o grupo</div>
                <div className={styles.syncGrid}>
                  <div><b>{pending.records}</b><span>registros</span></div>
                  <div><b>{pending.stations}</b><span>estações</span></div>
                  <div><b>{pending.measurements}</b><span>medidas</span></div>
                  <div><b>{pending.photos}</b><span>fotos</span></div>
                </div>
                <p className={styles.small}>
                  {pending.total ? `${pending.total} itens pendentes de envio.` : "Tudo enviado."} {lastSyncAt ? `Última sincronização: ${new Date(lastSyncAt).toLocaleString("pt-BR")}.` : "Ainda não sincronizado."}{" "}
                  {online ? "" : "Sem conexão agora — o envio acontece sozinho quando a rede voltar."}
                </p>
                <label className={styles.f}>
                  <span>Código do grupo (o mesmo para toda a equipe — sem ele não sincroniza)</span>
                  <Input
                    value={groupCode}
                    autoCapitalize="none"
                    autoCorrect="off"
                    onChange={(e) => (setGroupCode(e.target.value), lsSet("gc-group-code", e.target.value.trim().toLowerCase()))}
                    placeholder="Peça ao responsável pelo app"
                  />
                </label>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={!!busy || !online}
                  onClick={() =>
                    run("Baixando fotos do grupo…", async () => {
                      const r = await pullGroupPhotos((m) => setBusy(`Baixando fotos do grupo… ${m}`));
                      toast.success(r.downloaded ? `${r.downloaded} fotos do grupo baixadas` : "Você já tem todas as fotos do grupo", {
                        description: r.failed ? `${r.failed} não puderam ser baixadas agora` : undefined,
                      });
                    })
                  }
                >
                  <Camera size={18} /> Baixar fotos do grupo
                </Button>
                <Button size="lg" onClick={() => doSync(false)} disabled={syncing || !online}>
                  {syncing ? <RefreshCw size={18} className={styles.spin} /> : <CloudUpload size={18} />} {syncing ? "Sincronizando…" : "Enviar e receber agora"}
                </Button>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelLabel}>Backup do aparelho</div>
                <p className={styles.small}>
                  Arquivo .zip com tudo deste celular: registros, estações, medidas, fichas, fotos, croquis e camadas. Guarde no computador ou no Drive ao fim de cada campanha.{" "}
                  {lastBackupAt ? `Último backup: ${new Date(lastBackupAt).toLocaleString("pt-BR")}.` : "Nenhum backup feito ainda."}
                </p>
                <p className={styles.small}>
                  Armazenamento: {persisted === true ? "protegido contra limpeza automática do navegador ✓" : persisted === false ? "o navegador ainda pode limpar os dados — instale o atalho na tela inicial e faça backups" : "verificando…"}
                </p>
                <div className={styles.exports}>
                  <Button size="lg" disabled={!!busy} onClick={() => run("Gerando backup…", () => backup.createBackup((m) => setBusy(`Backup: ${m}`)))}>
                    <Package size={18} /> Fazer backup completo
                  </Button>
                  <Button size="lg" variant="outline" disabled={!!busy} onClick={() => restoreRef.current?.click()}>
                    <Upload size={18} /> Restaurar backup
                  </Button>
                </div>
                <input
                  ref={restoreRef}
                  type="file"
                  accept=".zip"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    run("Restaurando…", async () => {
                      const r = await backup.restoreBackup(f, (m) => setBusy(`Restaurando: ${m}`));
                      toast.success("Backup restaurado", { description: `${r.added} itens novos · ${r.updated} atualizados` });
                    });
                  }}
                />
              </div>

              <div className={styles.panel}>
                <div className={styles.panelLabel}>Fichas personalizadas</div>
                <p className={styles.small}>
                  {customFichas.length
                    ? `${customFichas.length} ficha${customFichas.length === 1 ? "" : "s"} do grupo: ${customFichas.map((f) => f.short).join(", ")}.`
                    : "Crie fichas com os campos da sua pesquisa (listas, números com unidade, texto). Elas são compartilhadas com o grupo."}
                </p>
                <Button size="lg" variant="outline" onClick={() => setFichaEditor(true)}>
                  <ClipboardList size={18} /> Criar e editar fichas
                </Button>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelLabel}>Caderneta digital (PDF)</div>
                <div className={styles.row2}>
                  <label className={styles.f}>
                    <span>Título</span>
                    <Input value={reportTitle} onChange={(e) => (setReportTitle(e.target.value), lsSet("gc-report-title", e.target.value))} />
                  </label>
                  <label className={styles.f}>
                    <span>Projeto / área</span>
                    <Input value={reportProject} onChange={(e) => (setReportProject(e.target.value), lsSet("gc-report-project", e.target.value))} placeholder="Ex.: Voçorocas — Bacia do Rio X" />
                  </label>
                </div>
                <Button size="lg" disabled={!!busy} onClick={() => run("Gerando PDF…", () => reportPdf({ title: reportTitle, project: reportProject, author, campanha: campFilter === "__todas" ? null : campFilter }))}>
                  <FileText size={18} /> Gerar relatório PDF
                </Button>
                <p className={styles.small}>
                  Cabeçalho com data/hora, mapa de localização, tabela de registros, ficha de cada registro com fotos e croquis, e histórico das estações.{" "}
                  <b>
                    {campFilter === "__todas" ? "Inclui todas as campanhas." : campFilter === "__sem" ? "Só registros sem campanha." : `Só a campanha “${campFilter}”.`}
                  </b>{" "}
                  (muda no filtro de campanha da aba Registros)
                </p>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelLabel}>Exportação SIG</div>
                <ExportPanel busy={busy} setBusy={setBusy} campanhas={campanhas} />
                <p className={styles.small}>O .gpkg traz as camadas pontos, linhas, polígonos, estações, fotos (com JPEG e croqui embutidos) e a tabela de medições — abre direto no QGIS, ArcGIS, R (sf) ou Python (geopandas).</p>
                {busy && <div className={styles.busy}>{busy}</div>}
              </div>

              <div className={styles.panel}>
                <div className={styles.panelLabel}>Aparelho</div>
                <label className={styles.f}>
                  <span>Nome do coletor (vai em cada registro)</span>
                  <Input value={author} onChange={(e) => (setAuthor(e.target.value), lsSet("gc-author", e.target.value))} placeholder="Seu nome" />
                </label>
                <div className={styles.f}>
                  <span>
                    Chave de coletor — é ela que garante que só você edita e apaga as suas coletas. Para usar no celular e no tablet, cole a mesma chave nos dois
                    <b> antes</b> de coletar no segundo aparelho. Não passe para outras pessoas.
                  </span>
                  <div className={styles.keyRow}>
                    <code className={styles.key}>{showKey ? owner.key() : "•••• •••• •••• " + owner.key().slice(-4)}</code>
                    <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
                      {showKey ? "Ocultar" : "Mostrar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(owner.key()).then(
                          () => toast.success("Chave copiada"),
                          () => toast.error("Não foi possível copiar — use Mostrar e copie manualmente"),
                        );
                      }}
                    >
                      Copiar
                    </Button>
                  </div>
                  <div className={styles.keyRow}>
                    <Input value={pasteKey} onChange={(e) => setPasteKey(e.target.value)} placeholder="Colar a chave do meu outro aparelho" autoCapitalize="none" autoCorrect="off" />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!pasteKey.trim()}
                      onClick={async () => {
                        if (!confirm("Usar esta chave neste aparelho? As coletas feitas aqui com a chave antiga deixarão de poder ser editadas daqui.")) return;
                        try {
                          const id = await owner.setKey(pasteKey);
                          setOwnerKeyShown(id);
                          setPasteKey("");
                          toast.success("Chave aplicada — este aparelho agora é você");
                        } catch (e: any) {
                          toast.error(e?.message ?? "Chave inválida");
                        }
                      }}
                    >
                      Usar
                    </Button>
                  </div>
                </div>
                <div className={styles.rowBetween}>
                  <span className={styles.small}>{tileCount.toLocaleString("pt-BR")} blocos de mapa base guardados para uso offline</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirm("Apagar o mapa base guardado offline?") && localDb.tiles.clear().then(() => toast("Cache de mapa limpo"))}
                  >
                    Limpar cache
                  </Button>
                </div>
                <div className={styles.rowBetween}>
                  <span className={styles.small}>Manter tela ligada durante rastros longos</span>
                  <Switch
                    onCheckedChange={async (v) => {
                      try {
                        if (v) (window as any).__wl = await (navigator as any).wakeLock?.request("screen");
                        else await (window as any).__wl?.release();
                      } catch {
                        toast.error("Este navegador não permite manter a tela ligada");
                      }
                    }}
                  />
                </div>
              </div>
              <footer className={styles.credit}>
                <span className={styles.creditApp}>GeoCampo</span>
                <span>Responsável: Geógrafo Renesky Jean Mary</span>
              </footer>
            </section>
          )}
        </main>
      </div>

      {editing && <RecordSheet record={editing.record} isNew={editing.isNew} stations={liveStations} author={author} onClose={() => setEditing(null)} />}
      {stationOpen && <StationSheet station={stationOpen.station} isNew={stationOpen.isNew} author={author} onClose={() => setStationOpen(null)} />}
      <FichaEditor open={fichaEditor} onOpenChange={setFichaEditor} author={author} />
      <OnlineLayerDialog open={onlineOpen} onOpenChange={setOnlineOpen} />
      <TargetPicker
        open={!!picker}
        onOpenChange={(v) => !v && setPicker(null)}
        layerId={picker?.layerId ?? null}
        gps={gps}
        stations={liveStations}
        layers={layers}
        onPick={(t) => {
          setNavTarget(t);
          setTab("mapa");
        }}
      />
      <GnssAverage open={averaging} onCancel={() => setAveraging(false)} onAccept={pointFromAverage} />
      <PhotoCapture
        open={!!quickPhoto}
        onOpenChange={(v) => !v && setQuickPhoto(null)}
        recordId={quickPhoto?.recordId ?? null}
        stationId={null}
        author={author}
        title="Foto rápida"
        onSaved={(info) => {
          if (!quickPhoto) return;
          const lat = info.lat ?? gps.lat;
          const lon = info.lon ?? gps.lon;
          if (lat === null || lon === null) {
            toast.error("Foto salva, mas sem posição GPS", { description: "O registro ficará sem localização válida." });
          }
          const rec = baseRecord("point", { type: "Point", coordinates: [lon ?? 0, lat ?? 0, info.altitude ?? undefined] });
          rec.id = quickPhoto.recordId;
          rec.altitude = info.altitude;
          rec.accuracy = info.accuracy;
          const n = liveRecords.filter((r) => r.kind === "point").length + 1;
          rec.name = `F-${String(n).padStart(3, "0")}`;
          setQuickPhoto(null);
          setEditing({ record: rec, isNew: true });
        }}
      />
      <CrsPickerDialog
        request={crsAsk}
        busy={crsBusy}
        onCancel={() => setCrsAsk(null)}
        onConfirm={async (crs) => {
          if (!crsAsk) return;
          const f = crsAsk.file;
          setCrsBusy(true);
          setCrsAsk(null);
          await importOne(f, crs);
          setCrsBusy(false);
        }}
      />
    </div>
  );
}
