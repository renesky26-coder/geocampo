import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Plus, Trash2, Save, Navigation, LocateFixed } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./Sheet";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { PhotoStrip } from "./PhotoStrip";
import { PhotoCapture } from "./PhotoCapture";
import { measurementTypes } from "../helpers/dictionaries";
import { geo } from "../helpers/geo";
import { useGps } from "../helpers/useGps";
import { localDb, type Station } from "../helpers/localDb";
import { newId } from "../helpers/newId";
import { owner } from "../helpers/owner";
import { toast } from "../helpers/toast";
import styles from "./StationSheet.module.css";

type Props = { station: Station; isNew: boolean; author: string; onClose: () => void };

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function StationSheet({ station, isNew, author, onClose }: Props) {
  const gps = useGps();
  const [s, setS] = useState(station);
  const [editing, setEditing] = useState(isNew);
  const mine = isNew || owner.canEdit(station, author);
  const [cam, setCam] = useState(false);
  const [mType, setMType] = useState(measurementTypes[0].value);
  const [mValue, setMValue] = useState("");
  const [mNotes, setMNotes] = useState("");
  useEffect(() => setS(station), [station]);

  const measurements = useLiveQuery(() => localDb.measurements.where("stationId").equals(station.id).sortBy("measuredAt"), [station.id]) ?? [];
  const live = measurements.filter((m) => !m.deleted);
  const types = Array.from(new Set(live.map((m) => m.type)));
  const [chartType, setChartType] = useState<string | null>(null);
  const activeChart = chartType ?? types[0] ?? null;
  const chartData = useMemo(
    () => live.filter((m) => m.type === activeChart).map((m) => ({ t: fmtDate(m.measuredAt), v: m.value })),
    [live, activeChart],
  );

  const distance = gps.lat !== null && gps.lon !== null ? geo.distanceM([gps.lon, gps.lat], [s.lon, s.lat]) : null;
  const u = geo.toUtm(s.lat, s.lon);

  async function saveStation() {
    if (!s.code.trim()) {
      toast.error("Informe o código do pino");
      return;
    }
    await localDb.stations.put({ ...s, code: s.code.trim(), author: s.author || author, updatedAt: Date.now(), synced: 0 });
    toast.success(isNew ? "Estação criada" : "Estação atualizada");
    if (isNew) onClose();
    else setEditing(false);
  }

  async function addMeasurement() {
    const v = Number(mValue.replace(",", "."));
    if (!isFinite(v) || mValue.trim() === "") {
      toast.error("Valor inválido");
      return;
    }
    const t = measurementTypes.find((x) => x.value === mType)!;
    await localDb.measurements.put({
      id: newId(),
      stationId: station.id,
      type: mType,
      value: v,
      unit: t.unit,
      notes: mNotes,
      measuredAt: Date.now(),
      createdAt: Date.now(),
      author,
      ownerId: owner.id(),
      synced: 0,
    });
    setMValue("");
    setMNotes("");
    setChartType(mType);
    toast.success("Medida adicionada ao histórico");
  }

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className={styles.sheet}>
          <SheetHeader>
            <SheetTitle className={styles.title}>
              <span className={styles.pin} /> {isNew ? "Nova estação de monitoramento" : `${s.code} · ${s.name || "Estação"}`}
            </SheetTitle>
            <SheetDescription className={styles.mono}>
              UTM {u.label} E {u.easting.toFixed(2)} N {u.northing.toFixed(2)} · Z {s.altitude != null ? `${s.altitude.toFixed(1)} m` : "—"}
            </SheetDescription>
          </SheetHeader>
          <div className={styles.body}>
            {!isNew && distance !== null && (
              <div className={styles.nav}>
                <Navigation size={18} />
                <span>
                  Você está a <b>{geo.formatLength(distance)}</b> do pino
                </span>
              </div>
            )}

            {editing ? (
              <section className={styles.section}>
                <div className={styles.row}>
                  <label className={styles.f}>
                    <span>Código do pino</span>
                    <Input value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} placeholder="PN-01" />
                  </label>
                  <label className={`${styles.f} ${styles.grow}`}>
                    <span>Nome</span>
                    <Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Voçoroca Cabeceira Sul" />
                  </label>
                </div>
                <label className={styles.f}>
                  <span>Descrição / referência</span>
                  <Textarea rows={2} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} placeholder="Vergalhão a 3 m da borda, lado direito da cerca" />
                </label>
                <div className={styles.row}>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (gps.lat === null || gps.lon === null) return toast.error("Sem posição GPS");
                      setS({ ...s, lat: gps.lat, lon: gps.lon, altitude: gps.altitude });
                      toast("Posição atualizada para o GPS atual");
                    }}
                  >
                    <LocateFixed size={16} /> Usar GPS atual
                  </Button>
                  <div className={styles.spacer} />
                  {!isNew && (
                    <Button variant="ghost" onClick={() => setEditing(false)}>
                      Cancelar
                    </Button>
                  )}
                  <Button onClick={saveStation}>
                    <Save size={16} /> Salvar estação
                  </Button>
                </div>
              </section>
            ) : (
              <section className={styles.section}>
                {s.description && <p className={styles.desc}>{s.description}</p>}
                {!mine && (
                  <p className={styles.desc}>
                    🔒 Pino criado por {s.author || "outro coletor"} — só quem criou pode editar ou excluir. Você pode adicionar medidas e fotos.
                  </p>
                )}
                <div className={styles.row}>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={!mine}>
                    Editar dados do pino
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.danger}
                    disabled={!mine}
                    onClick={async () => {
                      if (!confirm("Excluir esta estação e seu histórico?")) return;
                      await localDb.stations.put({ ...s, deleted: 1, synced: 0, updatedAt: Date.now() });
                      onClose();
                    }}
                  >
                    <Trash2 size={14} /> Excluir
                  </Button>
                </div>
              </section>
            )}

            {!isNew && (
              <>
                <section className={styles.section}>
                  <div className={styles.label}>Nova medida</div>
                  <div className={styles.row}>
                    <div className={styles.grow}>
                      <Select value={mType} onValueChange={setMType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {measurementTypes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label} {t.unit && `(${t.unit})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input className={styles.value} inputMode="decimal" value={mValue} onChange={(e) => setMValue(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className={styles.row}>
                    <Input className={styles.grow} value={mNotes} onChange={(e) => setMNotes(e.target.value)} placeholder="Observação (opcional)" />
                    <Button size="lg" onClick={addMeasurement}>
                      <Plus size={18} /> Adicionar
                    </Button>
                  </div>
                </section>

                <section className={styles.section}>
                  <div className={styles.label}>Série temporal</div>
                  {types.length > 1 && (
                    <div className={styles.typeTabs}>
                      {types.map((t) => (
                        <button key={t} className={`${styles.typeTab} ${t === activeChart ? styles.typeTabOn : ""}`} onClick={() => setChartType(t)}>
                          {measurementTypes.find((x) => x.value === t)?.label ?? t}
                        </button>
                      ))}
                    </div>
                  )}
                  {chartData.length >= 2 ? (
                    <div className={styles.chart}>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                          <XAxis dataKey="t" tick={{ fontSize: 11, fontFamily: "var(--font-family-monospace)" }} />
                          <YAxis tick={{ fontSize: 11, fontFamily: "var(--font-family-monospace)" }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <p className={styles.empty}>Adicione ao menos duas medidas do mesmo tipo para ver a evolução.</p>
                  )}
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Medida</th>
                        <th>Valor</th>
                        <th>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...live].reverse().map((m) => {
                        const prev = live.filter((x) => x.type === m.type && x.measuredAt < m.measuredAt).pop();
                        const d = prev ? m.value - prev.value : null;
                        return (
                          <tr key={m.id}>
                            <td>{fmtDate(m.measuredAt)}</td>
                            <td>
                              {measurementTypes.find((x) => x.value === m.type)?.label ?? m.type}
                              {m.notes && <div className={styles.note}>{m.notes}</div>}
                            </td>
                            <td className={styles.num}>
                              {m.value.toLocaleString("pt-BR")} {m.unit}
                            </td>
                            <td className={`${styles.num} ${d !== null && d < 0 ? styles.neg : ""}`}>{d !== null ? `${d > 0 ? "+" : ""}${d.toFixed(2)}` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>

                <section className={styles.section}>
                  <div className={styles.label}>Fotos do pino</div>
                  <PhotoStrip stationId={station.id} onAdd={() => setCam(true)} />
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <PhotoCapture open={cam} onOpenChange={setCam} recordId={null} stationId={station.id} author={author} />
    </>
  );
}