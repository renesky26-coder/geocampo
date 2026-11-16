import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
import { localDb } from "../helpers/localDb";
import { newId } from "../helpers/newId";
import { toast } from "../helpers/toast";
import styles from "./OnlineLayerDialog.module.css";

const PRESETS = [
  {
    name: "Relevo sombreado (Esri)",
    kind: "xyz" as const,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 16,
  },
  {
    name: "Limites e nomes (Esri)",
    kind: "xyz" as const,
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 19,
  },
];

export function OnlineLayerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [kind, setKind] = useState<"xyz" | "wms">("xyz");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [layers, setLayers] = useState("");

  async function save(preset?: (typeof PRESETS)[number]) {
    const k = preset?.kind ?? kind;
    const u = (preset?.url ?? url).trim();
    const n = (preset?.name ?? name).trim() || "Camada online";
    if (!/^https:\/\//i.test(u)) return toast.error("O endereço precisa começar com https://");
    if (k === "xyz" && !/\{z\}/.test(u)) return toast.error("Endereço XYZ precisa ter {z}, {x} e {y}. Ex.: …/{z}/{x}/{y}.png");
    if (k === "wms" && !layers.trim() && !preset) return toast.error("Informe o nome da camada (parâmetro LAYERS do WMS)");
    const count = await localDb.layers.count();
    await localDb.layers.put({
      id: newId(),
      name: n,
      kind: k,
      meta: k === "xyz" ? { url: u, maxzoom: preset?.maxzoom ?? 20 } : { url: u.split("?")[0], layers: layers.trim() },
      bounds: null,
      visible: 1,
      opacity: k === "xyz" ? 0.7 : 0.8,
      color: "#2e5e73",
      createdAt: Date.now() + count,
    });
    toast.success(`Camada "${n}" adicionada`, { description: "Áreas vistas com internet ficam guardadas para uso offline (XYZ)." });
    setName("");
    setUrl("");
    setLayers("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>Camada online</DialogTitle>
          <DialogDescription>Serviços de mapas por endereço: XYZ (tiles — inclusive mapas do Google Earth Engine) ou WMS (IBGE, INDE, MapBiomas, geoservidores).</DialogDescription>
        </DialogHeader>

        <div className={styles.presets}>
          <span className={styles.label}>Prontas</span>
          {PRESETS.map((p) => (
            <button key={p.name} className={styles.preset} onClick={() => save(p)}>
              + {p.name}
            </button>
          ))}
        </div>

        <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setKind(v as "xyz" | "wms")} className={styles.toggle}>
          <ToggleGroupItem value="xyz">XYZ / tiles</ToggleGroupItem>
          <ToggleGroupItem value="wms">WMS</ToggleGroupItem>
        </ToggleGroup>

        <label className={styles.f}>
          <span>Nome</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "xyz" ? "Ex.: NDVI out/2026 (GEE)" : "Ex.: Hidrografia IBGE"} />
        </label>
        <label className={styles.f}>
          <span>{kind === "xyz" ? "Endereço com {z}/{x}/{y}" : "Endereço do serviço WMS"}</span>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={kind === "xyz" ? "https://…/{z}/{x}/{y}" : "https://…/geoserver/wms"}
          />
        </label>
        {kind === "wms" && (
          <label className={styles.f}>
            <span>Camada (LAYERS)</span>
            <Input value={layers} onChange={(e) => setLayers(e.target.value)} autoCapitalize="none" placeholder="Ex.: workspace:nome_da_camada" />
          </label>
        )}
        <p className={styles.hint}>
          {kind === "xyz"
            ? "No Earth Engine: Map.addLayer(…) → getMap/getMapId fornece um endereço de tiles com {z}/{x}/{y}. Cole aqui."
            : "Os nomes das camadas aparecem no GetCapabilities do serviço (o mesmo que o QGIS lista ao conectar o WMS)."}
        </p>
        <DialogFooter className={styles.footer}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => save()}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
