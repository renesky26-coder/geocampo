import { useEffect, useMemo, useState } from "react";
import { Ruler, Trash2, Save, MapPin, Spline, Pentagon, CopyPlus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "./Sheet";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Clinometer } from "./Clinometer";
import { PhotoCapture } from "./PhotoCapture";
import { PhotoStrip } from "./PhotoStrip";
import { fichas, fichasOf, numberError, type DictField, type DictGroup } from "../helpers/dictionaries";
import { useAllFichas } from "../helpers/useAllFichas";
import { owner } from "../helpers/owner";
import { DemProfile } from "./DemProfile";
import { geo } from "../helpers/geo";
import { localDb, type FieldRecord, type Station } from "../helpers/localDb";
import { toast } from "../helpers/toast";
import styles from "./RecordSheet.module.css";

type Props = {
  record: FieldRecord | null;
  isNew: boolean;
  stations: Station[];
  author: string;
  onClose: () => void;
};

export function geometrySummary(r: Pick<FieldRecord, "geometry">) {
  const g = r.geometry;
  if (g.type === "Point") {
    const u = geo.toUtm(g.coordinates[1], g.coordinates[0]);
    return `UTM ${u.label} E ${u.easting.toFixed(1)} N ${u.northing.toFixed(1)}`;
  }
  if (g.type === "LineString") return `${g.coordinates.length} vértices · ${geo.formatLength(geo.lineLengthM(g.coordinates))}`;
  const ring = g.coordinates[0].slice(0, -1);
  return `${ring.length} vértices · ${geo.formatArea(geo.polygonAreaM2(ring))} · perímetro ${geo.formatLength(geo.lineLengthM(g.coordinates[0]))}`;
}

const kindIcon = { point: MapPin, line: Spline, polygon: Pentagon };
const kindLabel = { point: "Ponto", line: "Linha / rastro", polygon: "Polígono" };

function lastFichas(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("gc-fichas") ?? "null");
    if (Array.isArray(v) && v.length) return v.filter((k) => typeof k === "string");
  } catch {
    /* ignore */
  }
  return ["geomorfologia"];
}

function initialFichas(r: FieldRecord | null, isNew: boolean): string[] {
  if (!r) return [];
  const own = fichasOf(r.attributes);
  if (own.length) return own;
  return isNew ? lastFichas() : ["geomorfologia"];
}

export function RecordSheet({ record, isNew, stations, author, onClose }: Props) {
  const { all: allFichas, custom } = useAllFichas();
  const [draft, setDraft] = useState<FieldRecord | null>(record);
  const [selected, setSelected] = useState<string[]>(() => initialFichas(record, isNew));
  const [clino, setClino] = useState(false);
  const [cam, setCam] = useState(false);
  const [otherOpen, setOtherOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDraft(record);
    setSelected(initialFichas(record, isNew));
  }, [record, isNew]);

  const groups: DictGroup[] = useMemo(() => {
    const seen = new Set<string>();
    const out: DictGroup[] = [];
    for (const f of allFichas) {
      if (!selected.includes(f.key)) continue;
      for (const g of f.groups) {
        if (seen.has(g.key)) continue;
        seen.add(g.key);
        out.push(g);
      }
    }
    return out;
  }, [selected, allFichas]);

  if (!draft) return null;
  const mine = isNew || owner.canEdit(record, author);

  const set = (patch: Partial<FieldRecord>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setAttr = (key: string, value: string | string[] | undefined) => {
    setDraft((d) => {
      if (!d) return d;
      const attrs = { ...d.attributes };
      if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete attrs[key];
      else attrs[key] = value;
      return { ...d, attributes: attrs };
    });
  };
  const toggleAttr = (key: string, value: string, multi?: boolean) => {
    const cur = draft.attributes[key];
    if (multi) {
      const arr = Array.isArray(cur) ? cur : cur ? [cur] : [];
      setAttr(key, arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]);
    } else {
      setAttr(key, cur === value ? undefined : value);
    }
  };

  function toggleFicha(key: string) {
    setSelected((s) => {
      const next = s.includes(key) ? s.filter((k) => k !== key) : [...s, key];
      try {
        if (next.length) localStorage.setItem("gc-fichas", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    const problems: string[] = [];
    for (const g of groups) {
      for (const f of g.fields) {
        const k = `${g.key}.${f.key}`;
        const v = draft.attributes[k];
        const empty = v === undefined || v === "" || (Array.isArray(v) && !v.length);
        if (f.required && empty && !draft.attributes[`${k}.outro`]) problems.push(`${f.label}: obrigatório`);
        const err = numberError(f, v);
        if (err) problems.push(`${f.label}: ${err}`);
      }
    }
    if (problems.length) {
      toast.error("Corrija antes de salvar", { description: problems.slice(0, 5).join(" · ") });
      return;
    }
    const name = draft.name.trim() || `${kindLabel[draft.kind]} ${new Date(draft.createdAt).toLocaleString("pt-BR")}`;
    const attributes = { ...draft.attributes };
    for (const [k, v] of Object.entries(attributes)) {
      if (k === "_fichas") continue;
      if (typeof v === "string") {
        const t = v.trim();
        if (!t) delete attributes[k];
        else attributes[k] = t;
      }
    }
    if (selected.length) attributes["_fichas"] = selected;
    else delete attributes["_fichas"];
    await localDb.records.put({ ...draft, attributes, name, author: draft.author || author, updatedAt: Date.now(), synced: 0 });
    toast.success(isNew ? "Registro salvo no aparelho" : "Registro atualizado");
    onClose();
  }

  async function cancel() {
    if (isNew) {
      const orphan = await localDb.photos.where("recordId").equals(draft!.id).primaryKeys();
      if (orphan.length && !confirm("Descartar o registro e as fotos tiradas?")) return;
      await localDb.photos.bulkDelete(orphan);
    }
    onClose();
  }

  async function remove() {
    if (!confirm("Excluir este registro?")) return;
    await localDb.records.put({ ...draft!, deleted: 1, synced: 0, updatedAt: Date.now() });
    toast("Registro excluído");
    onClose();
  }

  async function copyLast() {
    const last = await localDb.records
      .orderBy("createdAt")
      .reverse()
      .filter((r) => !r.deleted && r.id !== draft!.id)
      .first();
    if (!last) return toast("Ainda não há registro anterior para copiar");
    const attrs: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(last.attributes)) if (!k.startsWith("gnss.") && k !== "_fichas") attrs[k] = v;
    setDraft((d) => (d ? { ...d, attributes: { ...attrs, ...Object.fromEntries(Object.entries(d.attributes).filter(([k]) => k.startsWith("gnss."))) }, stationId: d.stationId ?? last.stationId } : d));
    const f = fichasOf(last.attributes, custom);
    if (f.length) setSelected(f);
    toast.success(`Respostas copiadas de “${last.name}” — ajuste o que mudou`);
  }

  function renderField(group: DictGroup, f: DictField) {
    const k = `${group.key}.${f.key}`;
    const cur = draft!.attributes[k];
    if (f.type === "number") {
      return (
        <div key={k} className={styles.numField}>
          <span className={styles.fieldName}>
            {f.label}
            {f.required && <b className={styles.req}> *</b>}
          </span>
          <div className={styles.numInput}>
            <Input
              inputMode="decimal"
              value={(cur as string) ?? ""}
              onChange={(e) => setAttr(k, e.target.value.replace(",", "."))}
              placeholder={f.min !== undefined && f.max !== undefined ? `${f.min}–${f.max}` : "—"}
              aria-invalid={!!numberError(f, cur)}
            />
            {f.unit && <span className={styles.unit}>{f.unit}</span>}
          </div>
          {numberError(f, cur) && <span className={styles.err}>{numberError(f, cur)}</span>}
        </div>
      );
    }
    if (f.type === "text") {
      return (
        <div key={k} className={styles.field}>
          <div className={styles.fieldName}>
            {f.label}
            {f.required && <b className={styles.req}> *</b>}
          </div>
          <Input value={(cur as string) ?? ""} onChange={(e) => setAttr(k, e.target.value)} placeholder={f.placeholder} />
        </div>
      );
    }
    const otherKey = `${k}.outro`;
    const otherOn = otherOpen.has(k) || draft!.attributes[otherKey] !== undefined;
    return (
      <div key={k} className={styles.field}>
        <div className={styles.fieldName}>
          {f.label}
          {f.multi && <em> (várias)</em>}
          {f.required && <b className={styles.req}> *</b>}
        </div>
        <div className={styles.chips}>
          {f.options.map((opt) => {
            const on = Array.isArray(cur) ? cur.includes(opt.value) : cur === opt.value;
            return (
              <button key={opt.value} className={`${styles.chip} ${on ? styles.chipOn : ""}`} onClick={() => toggleAttr(k, opt.value, f.multi)}>
                {opt.label}
              </button>
            );
          })}
          <button
            className={`${styles.chip} ${styles.chipOther} ${otherOn ? styles.chipOn : ""}`}
            onClick={() => {
              setOtherOpen((s) => {
                const n = new Set(s);
                if (otherOn) n.delete(k);
                else n.add(k);
                return n;
              });
              if (otherOn) setAttr(otherKey, undefined);
            }}
          >
            Outro…
          </button>
        </div>
        {otherOn && (
          <Input
            autoFocus={otherOpen.has(k) && !draft!.attributes[otherKey]}
            value={(draft!.attributes[otherKey] as string) ?? ""}
            onChange={(e) => setDraft((d) => (d ? { ...d, attributes: { ...d.attributes, [otherKey]: e.target.value } } : d))}
            placeholder={`Descreva: ${f.label.toLowerCase()} não listado(a)`}
          />
        )}
      </div>
    );
  }

  const Icon = kindIcon[draft.kind];

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && cancel()}>
        <SheetContent side="right" className={styles.sheet} onInteractOutside={(e) => e.preventDefault()}>
          <SheetHeader>
            <SheetTitle className={styles.title}>
              <Icon size={18} /> {isNew ? `Novo registro · ${kindLabel[draft.kind]}` : kindLabel[draft.kind]}
            </SheetTitle>
            <SheetDescription className={styles.geom}>{geometrySummary(draft)}</SheetDescription>
          </SheetHeader>
          {!mine && (
            <div className={styles.lock}>
              🔒 Coletado por <b>{draft.author || "outro coletor"}</b> — somente leitura. Só quem coletou pode editar ou excluir este registro.
            </div>
          )}
          <fieldset disabled={!mine} className={styles.body}>
            <section className={styles.section}>
              <label className={styles.label}>Identificação</label>
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: P-012 cabeceira norte" />
              {draft.kind === "point" && (
                <div className={styles.meta}>
                  Z {draft.altitude != null ? `${draft.altitude.toFixed(1)} m` : "—"} · precisão ±{draft.accuracy != null ? draft.accuracy.toFixed(1) : "—"} m
                </div>
              )}
            </section>

            <section className={styles.section}>
              <label className={styles.label}>Fichas temáticas</label>
              {isNew && (
                <Button variant="outline" size="sm" onClick={copyLast} className={styles.copyBtn}>
                  <CopyPlus size={16} /> Repetir respostas do último registro
                </Button>
              )}
              <div className={styles.fichaGrid}>
                {allFichas.map((f) => {
                  const on = selected.includes(f.key);
                  const isCustom = custom.some((c) => c.key === f.key);
                  return (
                    <button key={f.key} className={`${styles.ficha} ${on ? styles.fichaOn : ""}`} onClick={() => toggleFicha(f.key)}>
                      <span className={styles.fichaTitle}>
                        {f.short}
                        {isCustom && <em className={styles.customTag}> · do grupo</em>}
                      </span>
                      <span className={styles.fichaDesc}>{f.description}</span>
                    </button>
                  );
                })}
              </div>
              {!selected.length && <div className={styles.meta}>Escolha uma ou mais fichas para ver os campos.</div>}
            </section>

            <section className={styles.section}>
              <label className={styles.label}>Estação de monitoramento</label>
              <Select value={draft.stationId ?? "__none"} onValueChange={(v) => set({ stationId: v === "__none" ? null : v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Nenhuma</SelectItem>
                  {stations.filter((s) => !s.deleted).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            {groups.map((group) => {
              const numbers = group.fields.filter((f) => f.type === "number");
              const others = group.fields.filter((f) => f.type !== "number");
              return (
                <section key={group.key} className={styles.section}>
                  <label className={styles.label}>{group.title}</label>
                  {others.map((f) => renderField(group, f))}
                  {numbers.length > 0 && <div className={styles.numGrid}>{numbers.map((f) => renderField(group, f))}</div>}
                </section>
              );
            })}

            {draft.geometry.type !== "Point" && (
              <section className={styles.section}>
                <label className={styles.label}>Perfil topográfico (MDT)</label>
                <DemProfile coords={draft.geometry.type === "LineString" ? draft.geometry.coordinates : draft.geometry.coordinates[0]} />
              </section>
            )}

            <section className={styles.section}>
              <label className={styles.label}>Atitude (clinômetro)</label>
              <div className={styles.dipRow}>
                <div className={styles.dipField}>
                  <span>Mergulho °</span>
                  <Input inputMode="decimal" value={draft.dip ?? ""} onChange={(e) => set({ dip: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} />
                </div>
                <div className={styles.dipField}>
                  <span>Direção °</span>
                  <Input inputMode="decimal" value={draft.dipDirection ?? ""} onChange={(e) => set({ dipDirection: e.target.value === "" ? null : Number(e.target.value.replace(",", ".")) })} />
                </div>
                <Button variant="outline" size="lg" onClick={() => setClino(true)}>
                  <Ruler size={18} /> Medir
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <label className={styles.label}>Fotos e croquis</label>
              <PhotoStrip recordId={draft.id} onAdd={() => setCam(true)} />
            </section>

            <section className={styles.section}>
              <label className={styles.label}>Observações</label>
              <Textarea rows={4} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Descrição livre do ponto, contexto, o que não coube nas fichas…" />
            </section>
          </fieldset>
          <SheetFooter className={styles.footer}>
            {!isNew && mine && (
              <Button variant="ghost" onClick={remove} className={styles.danger}>
                <Trash2 size={18} /> Excluir
              </Button>
            )}
            <div className={styles.spacer} />
            <Button variant="outline" size="lg" onClick={cancel}>
              {mine ? "Cancelar" : "Fechar"}
            </Button>
            {mine && (
              <Button size="lg" onClick={save}>
                <Save size={18} /> Salvar
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Clinometer open={clino} onOpenChange={setClino} onCapture={(r) => set({ dip: r.dip, dipDirection: r.dipDirection })} />
      <PhotoCapture open={cam} onOpenChange={setCam} recordId={draft.id} stationId={draft.stationId} author={author} />
    </>
  );
}
