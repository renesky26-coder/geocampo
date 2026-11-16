import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, Save, ArrowLeft, Copy } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./Sheet";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { Switch } from "./Switch";
import { localDb, type CustomForm } from "../helpers/localDb";
import { fichas } from "../helpers/dictionaries";
import { newId } from "../helpers/newId";
import { owner } from "../helpers/owner";
import { toast } from "../helpers/toast";
import styles from "./FichaEditor.module.css";

type FieldType = "single" | "multi" | "number" | "text";
type EditField = { key: string; label: string; type: FieldType; unit: string; options: string; placeholder: string; required: boolean; min: string; max: string };
type EditForm = { id: string; key: string; title: string; short: string; description: string; fields: EditField[]; createdAt: number; isNew: boolean };

const TYPE_LABEL: Record<FieldType, string> = {
  single: "Lista (uma opção)",
  multi: "Lista (várias opções)",
  number: "Número com unidade",
  text: "Texto livre",
};

function slug(s: string) {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "campo"
  );
}

function toEdit(c: CustomForm): EditForm {
  return {
    id: c.id,
    key: c.key,
    title: c.title,
    short: c.short,
    description: c.description,
    createdAt: c.createdAt,
    isNew: false,
    fields: (c.fields ?? []).map((f: any) => ({
      key: f.key,
      label: f.label,
      type: f.type === "number" ? "number" : f.type === "text" ? "text" : f.multi ? "multi" : "single",
      unit: f.unit ?? "",
      options: (f.options ?? []).map((o: any) => o.label).join("\n"),
      placeholder: f.placeholder ?? "",
      required: !!f.required,
      min: f.min !== undefined ? String(f.min) : "",
      max: f.max !== undefined ? String(f.max) : "",
    })),
  };
}

function emptyField(): EditField {
  return { key: "", label: "", type: "single", unit: "", options: "", placeholder: "", required: false, min: "", max: "" };
}

export function FichaEditor({ open, onOpenChange, author }: { open: boolean; onOpenChange: (v: boolean) => void; author: string }) {
  const forms = useLiveQuery(() => localDb.forms.orderBy("createdAt").toArray(), []) ?? [];
  const live = forms.filter((f) => !f.deleted);
  const [edit, setEdit] = useState<EditForm | null>(null);

  function startNew(baseKey?: string) {
    const base = fichas.find((f) => f.key === baseKey);
    const fields: EditField[] = base
      ? base.groups.flatMap((g) =>
          g.fields.map((f: any) => ({
            key: slug(`${g.key}_${f.key}`),
            label: f.label,
            type: (f.type === "number" ? "number" : f.type === "text" ? "text" : f.multi ? "multi" : "single") as FieldType,
            unit: f.unit ?? "",
            options: (f.options ?? []).map((o: any) => o.label).join("\n"),
            placeholder: f.placeholder ?? "",
            required: false,
            min: f.min !== undefined ? String(f.min) : "",
            max: f.max !== undefined ? String(f.max) : "",
          })),
        )
      : [emptyField()];
    setEdit({
      id: newId(),
      key: "",
      title: base ? `${base.short} (adaptada)` : "",
      short: "",
      description: base ? base.description : "",
      fields,
      createdAt: Date.now(),
      isNew: true,
    });
  }

  const setField = (i: number, patch: Partial<EditField>) =>
    setEdit((e) => (e ? { ...e, fields: e.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) } : e));
  const move = (i: number, d: number) =>
    setEdit((e) => {
      if (!e) return e;
      const f = [...e.fields];
      const j = i + d;
      if (j < 0 || j >= f.length) return e;
      [f[i], f[j]] = [f[j], f[i]];
      return { ...e, fields: f };
    });

  async function save() {
    if (!edit) return;
    const title = edit.title.trim();
    if (!title) return toast.error("Dê um nome à ficha");
    const fields = edit.fields.filter((f) => f.label.trim());
    if (!fields.length) return toast.error("Adicione pelo menos um campo com nome");
    const used = new Set<string>();
    const out: any[] = [];
    for (const f of fields) {
      let key = f.key || slug(f.label);
      while (used.has(key)) key = `${key}_2`;
      used.add(key);
      const req = f.required ? { required: true } : {};
      if (f.type === "single" || f.type === "multi") {
        const opts = Array.from(new Set(f.options.split("\n").map((s) => s.trim()).filter(Boolean)));
        if (!opts.length) return toast.error(`O campo "${f.label}" precisa de opções (uma por linha)`);
        out.push({ key, label: f.label.trim(), options: opts.map((v) => ({ value: v, label: v })), ...(f.type === "multi" ? { multi: true } : {}), ...req });
      } else if (f.type === "number") {
        const min = f.min.trim() === "" ? undefined : Number(f.min.replace(",", "."));
        const max = f.max.trim() === "" ? undefined : Number(f.max.replace(",", "."));
        if ((min !== undefined && !isFinite(min)) || (max !== undefined && !isFinite(max))) return toast.error(`Mínimo/máximo inválido em "${f.label}"`);
        out.push({ key, label: f.label.trim(), type: "number", unit: f.unit.trim(), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...req });
      } else {
        out.push({ key, label: f.label.trim(), type: "text", placeholder: f.placeholder.trim() || undefined, ...req });
      }
    }
    const key = edit.key || `c_${slug(title).slice(0, 24)}_${edit.id.slice(0, 4)}`;
    await localDb.forms.put({
      id: edit.id,
      key,
      title,
      short: edit.short.trim() || title.slice(0, 28),
      description: edit.description.trim(),
      fields: out,
      createdAt: edit.createdAt,
      updatedAt: Date.now(),
      author,
      ownerId: forms.find((f) => f.id === edit.id)?.ownerId ?? owner.id(),
      synced: 0,
    });
    toast.success(edit.isNew ? "Ficha criada — já aparece nos registros" : "Ficha atualizada");
    setEdit(null);
  }

  async function remove(c: CustomForm) {
    if (!confirm(`Excluir a ficha "${c.title}"? Os dados já coletados com ela continuam nos registros.`)) return;
    await localDb.forms.put({ ...c, deleted: 1, synced: 0, updatedAt: Date.now() });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) setEdit(null);
        onOpenChange(v);
      }}
    >
      <SheetContent side="right" className={styles.sheet} onInteractOutside={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>{edit ? (edit.isNew ? "Nova ficha" : "Editar ficha") : "Fichas do grupo"}</SheetTitle>
          <SheetDescription>
            {edit
              ? "Monte os campos como quiser. A ficha vai para todos do grupo na próxima sincronização."
              : "Crie fichas próprias para a sua pesquisa. Elas aparecem ao lado das fichas prontas em cada registro."}
          </SheetDescription>
        </SheetHeader>

        {!edit ? (
          <div className={styles.body}>
            <div className={styles.newRow}>
              <Button size="lg" onClick={() => startNew()}>
                <Plus size={18} /> Nova ficha em branco
              </Button>
              <Select onValueChange={(v) => startNew(v)}>
                <SelectTrigger className={styles.baseSelect}>
                  <Copy size={16} /> <SelectValue placeholder="Partir de uma ficha pronta…" />
                </SelectTrigger>
                <SelectContent>
                  {fichas.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {live.length === 0 ? (
              <div className={styles.empty}>Nenhuma ficha personalizada ainda.</div>
            ) : (
              <ul className={styles.list}>
                {live.map((c) => (
                  <li key={c.id} className={styles.item}>
                    <div className={styles.itemBody}>
                      <strong>{c.title}</strong>
                      <span>
                        {c.fields.length} campo{c.fields.length === 1 ? "" : "s"} · {c.author || "sem autor"} · {c.synced ? "no grupo" : "só neste aparelho"}
                      </span>
                    </div>
                    <Button size="icon-md" variant="ghost" onClick={() => setEdit(toEdit(c))} aria-label="Editar" disabled={!owner.canEdit(c, author)}>
                      <Pencil size={18} />
                    </Button>
                    <Button size="icon-md" variant="ghost" onClick={() => remove(c)} aria-label="Excluir" disabled={!owner.canEdit(c, author)}>
                      <Trash2 size={18} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className={styles.body}>
            <section className={styles.section}>
              <label className={styles.f}>
                <span>Nome da ficha</span>
                <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Ex.: Monitoramento de nascentes" />
              </label>
              <div className={styles.row}>
                <label className={styles.f}>
                  <span>Nome curto (no botão)</span>
                  <Input value={edit.short} onChange={(e) => setEdit({ ...edit, short: e.target.value })} placeholder="Nascentes" />
                </label>
              </div>
              <label className={styles.f}>
                <span>Descrição</span>
                <Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Para que serve esta ficha" />
              </label>
            </section>

            {edit.fields.map((f, i) => (
              <section key={i} className={styles.fieldCard}>
                <div className={styles.fieldHead}>
                  <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
                  <Input className={styles.grow} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Nome do campo" />
                  <Button size="icon-sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
                    <ArrowUp size={16} />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === edit.fields.length - 1} aria-label="Descer">
                    <ArrowDown size={16} />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setEdit({ ...edit, fields: edit.fields.filter((_, j) => j !== i) })} aria-label="Remover campo">
                    <Trash2 size={16} />
                  </Button>
                </div>
                <Select value={f.type} onValueChange={(v) => setField(i, { type: v as FieldType })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(f.type === "single" || f.type === "multi") && (
                  <label className={styles.f}>
                    <span>Opções — uma por linha (o app acrescenta “Outro…” sozinho)</span>
                    <Textarea rows={4} value={f.options} onChange={(e) => setField(i, { options: e.target.value })} placeholder={"Ex.:\nAfloramento\nSurgência difusa\nOlho d'água"} />
                  </label>
                )}
                {f.type === "number" && (
                  <div className={styles.row}>
                    <label className={styles.f}>
                      <span>Unidade</span>
                      <Input value={f.unit} onChange={(e) => setField(i, { unit: e.target.value })} placeholder="m, %, mg/L…" />
                    </label>
                    <label className={styles.f}>
                      <span>Mínimo</span>
                      <Input inputMode="decimal" value={f.min} onChange={(e) => setField(i, { min: e.target.value })} placeholder="—" />
                    </label>
                    <label className={styles.f}>
                      <span>Máximo</span>
                      <Input inputMode="decimal" value={f.max} onChange={(e) => setField(i, { max: e.target.value })} placeholder="—" />
                    </label>
                  </div>
                )}
                {f.type === "text" && (
                  <label className={styles.f}>
                    <span>Dica dentro do campo (opcional)</span>
                    <Input value={f.placeholder} onChange={(e) => setField(i, { placeholder: e.target.value })} />
                  </label>
                )}
                <label className={styles.reqRow}>
                  <Switch checked={f.required} onCheckedChange={(v) => setField(i, { required: !!v })} />
                  <span>Campo obrigatório</span>
                </label>
              </section>
            ))}

            <Button variant="outline" size="lg" onClick={() => setEdit({ ...edit, fields: [...edit.fields, emptyField()] })}>
              <Plus size={18} /> Adicionar campo
            </Button>

            <div className={styles.footer}>
              <Button variant="ghost" onClick={() => setEdit(null)}>
                <ArrowLeft size={18} /> Voltar
              </Button>
              <Button size="lg" onClick={save}>
                <Save size={18} /> Salvar ficha
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
