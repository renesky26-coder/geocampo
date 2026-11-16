import { useState } from "react";
import { Package, Table2, Braces, Globe, FileArchive } from "lucide-react";
import { Button } from "./Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Switch } from "./Switch";
import { useAllFichas } from "../helpers/useAllFichas";
import { exportData, defaultExportOptions, type ExportOptions, type ExportLayers, type ExportCrs } from "../helpers/exportData";
import { toast } from "../helpers/toast";
import styles from "./ExportPanel.module.css";

const LAYERS: { key: keyof ExportLayers; label: string }[] = [
  { key: "pontos", label: "Pontos" },
  { key: "linhas", label: "Linhas" },
  { key: "poligonos", label: "Polígonos" },
  { key: "estacoes", label: "Estações" },
  { key: "medicoes", label: "Medições" },
  { key: "fotos", label: "Fotos" },
];

const PERIODS = [
  { v: "all", label: "Todo o período" },
  { v: "today", label: "Hoje" },
  { v: "7", label: "Últimos 7 dias" },
  { v: "30", label: "Últimos 30 dias" },
];

function fromDateOf(p: string): number | null {
  if (p === "all") return null;
  if (p === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return Date.now() - Number(p) * 86400000;
}

export function ExportPanel({ busy, setBusy, campanhas = [] }: { busy: string | null; setBusy: (v: string | null) => void; campanhas?: string[] }) {
  const { all } = useAllFichas();
  const [allFichas, setAllFichas] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  const [layers, setLayers] = useState<ExportLayers>(defaultExportOptions.layers);
  const [crs, setCrs] = useState<ExportCrs>("4674");
  const [period, setPeriod] = useState("all");
  const [photoBlobs, setPhotoBlobs] = useState(true);
  const [camp, setCamp] = useState("__todas");

  const opts = (): ExportOptions => ({ fichas: allFichas ? null : sel, layers, crs, fromDate: fromDateOf(period), photoBlobs, campanha: camp === "__todas" ? null : camp });

  async function go(label: string, fn: (o: ExportOptions) => Promise<{ count: number; warning: string | null }>) {
    if (!allFichas && !sel.length) return toast.error("Escolha ao menos uma ficha (ou marque “Todas as fichas”)");
    setBusy(label);
    try {
      const r = await fn(opts());
      if (!r.count) toast.warning("Nada para exportar com esses filtros.");
      else toast.success(`${r.count} itens exportados`, { description: r.warning ?? "Inclui o dicionário de dados." });
    } catch (e: any) {
      toast.error("Falha na exportação", { description: e?.message });
    } finally {
      setBusy(null);
    }
  }

  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  return (
    <div className={styles.wrap}>
      <div className={styles.block}>
        <div className={styles.head}>
          <span>Fichas</span>
          <label className={styles.inline}>
            <Switch checked={allFichas} onCheckedChange={(v) => setAllFichas(!!v)} /> Todas as fichas
          </label>
        </div>
        {!allFichas && (
          <div className={styles.chips}>
            {all.map((f) => (
              <button key={f.key} className={`${styles.chip} ${sel.includes(f.key) ? styles.on : ""}`} onClick={() => toggle(f.key)}>
                {f.short}
              </button>
            ))}
            <button className={`${styles.chip} ${sel.includes("__sem") ? styles.on : ""}`} onClick={() => toggle("__sem")}>
              Sem ficha
            </button>
          </div>
        )}
        {!allFichas && <p className={styles.hint}>Só os registros dessas fichas, e só as colunas delas.</p>}
      </div>

      <div className={styles.block}>
        <div className={styles.head}>
          <span>Camadas</span>
        </div>
        <div className={styles.chips}>
          {LAYERS.map((l) => (
            <button key={l.key} className={`${styles.chip} ${layers[l.key] ? styles.on : ""}`} onClick={() => setLayers({ ...layers, [l.key]: !layers[l.key] })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.row}>
        <label className={styles.f}>
          <span>Sistema de coordenadas</span>
          <Select value={crs} onValueChange={(v) => setCrs(v as ExportCrs)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4674">SIRGAS 2000 geográfico (EPSG:4674)</SelectItem>
              <SelectItem value="utm">SIRGAS 2000 UTM (fuso automático)</SelectItem>
              <SelectItem value="4326">WGS 84 geográfico (EPSG:4326)</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className={styles.f}>
          <span>Período</span>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.v} value={p.v}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {campanhas.length > 0 && (
        <label className={styles.f}>
          <span>Campanha</span>
          <Select value={camp} onValueChange={setCamp}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas">Todas as campanhas</SelectItem>
              {campanhas.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
              <SelectItem value="__sem">Sem campanha</SelectItem>
            </SelectContent>
          </Select>
        </label>
      )}

      {layers.fotos && (
        <label className={styles.inline}>
          <Switch checked={photoBlobs} onCheckedChange={(v) => setPhotoBlobs(!!v)} /> Incluir as imagens dentro do GeoPackage (arquivo maior)
        </label>
      )}

      <div className={styles.buttons}>
        <Button size="lg" disabled={!!busy} onClick={() => go("Gerando GeoPackage…", exportData.exportGpkg)}>
          <Package size={18} /> GeoPackage (.gpkg)
        </Button>
        <Button size="lg" variant="outline" disabled={!!busy} onClick={() => go("Gerando CSV…", exportData.exportCsv)}>
          <Table2 size={18} /> CSV
        </Button>
        <Button size="lg" variant="outline" disabled={!!busy} onClick={() => go("Gerando GeoJSON…", exportData.exportGeoJson)}>
          <Braces size={18} /> GeoJSON
        </Button>
        <Button size="lg" variant="outline" disabled={!!busy} onClick={() => go("Gerando Shapefile…", exportData.exportShapefile)}>
          <FileArchive size={18} /> Shapefile (.zip)
        </Button>
        <Button size="lg" variant="outline" disabled={!!busy} onClick={() => go("Gerando KML…", exportData.exportKml)}>
          <Globe size={18} /> KML (Google Earth)
        </Button>
      </div>
      <p className={styles.hint}>KML sai sempre em WGS 84 (padrão do Google Earth). O Shapefile usa o sistema escolhido acima.</p>
    </div>
  );
}
