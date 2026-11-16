import { useEffect, useRef, useState } from "react";
import { Camera, Undo2, Eraser, Pencil, Minus, Compass, Check, ImagePlus, Aperture, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { useGps } from "../helpers/useGps";
import { useDeviceSensors } from "../helpers/useDeviceSensors";
import { photoExif } from "../helpers/photoExif";
import { localDb } from "../helpers/localDb";
import { newId } from "../helpers/newId";
import { owner } from "../helpers/owner";
import { toast } from "../helpers/toast";
import styles from "./PhotoCapture.module.css";

type Stroke = { color: string; width: number; mode: "free" | "line"; pts: [number, number][] };

const COLORS = ["#ff3b1f", "#ffd400", "#00e5ff", "#39ff6a", "#ffffff", "#111111"];

export type SavedPhotoInfo = { photoId: string; lat: number | null; lon: number | null; altitude: number | null; accuracy: number | null };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordId: string | null;
  stationId: string | null;
  author: string;
  onSaved?: (info: SavedPhotoInfo) => void;
  title?: string;
};

type GeoAt = { lat: number | null; lon: number | null; altitude: number | null; accuracy: number | null; t: number };

export function PhotoCapture({ open, onOpenChange, recordId, stationId, author, onSaved, title }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [fromGallery, setFromGallery] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [camState, setCamState] = useState<"off" | "starting" | "live" | "error">("off");
  const [camError, setCamError] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string; w: number; h: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [mode, setMode] = useState<"free" | "line">("free");
  const [caption, setCaption] = useState("");
  const [azimuth, setAzimuth] = useState<string>("");
  const [geoAt, setGeoAt] = useState<GeoAt | null>(null);
  const [saving, setSaving] = useState(false);
  const [, force] = useState(0);
  const sensors = useDeviceSensors(open);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamState("off");
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamState("error");
      setCamError("Este navegador não libera a câmera dentro do app. Use “Câmera do celular / galeria”.");
      return;
    }
    setCamState("starting");
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setCamState("live");
    } catch (e: any) {
      setCamState("error");
      setCamError(
        e?.name === "NotAllowedError"
          ? "Permissão da câmera negada. Libere a câmera para este site nas configurações do navegador, ou use “Câmera do celular / galeria”."
          : "Não foi possível abrir a câmera aqui. Use “Câmera do celular / galeria”.",
      );
    }
  }

  // Open: start the in-app camera. Close: reset everything.
  useEffect(() => {
    if (open) {
      if (sensors.needsPermission) sensors.requestPermission().catch(() => undefined);
      startCamera();
    } else {
      stopCamera();
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto(null);
      setStrokes([]);
      setCaption("");
      setAzimuth("");
      setGeoAt(null);
    }
    return () => {
      if (!open) return;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => stopCamera(), []);

  // Attach the live stream to the <video> once it is mounted (dialog portal / after "Refazer").
  useEffect(() => {
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => undefined);
    }
  });

  function stampGeo() {
    const g = useGps.current();
    setGeoAt({ lat: g.lat, lon: g.lon, altitude: g.altitude, accuracy: g.accuracy, t: Date.now() });
    if (sensors.heading !== null) setAzimuth(sensors.heading.toFixed(0));
  }

  async function loadIntoEditor(blob: Blob) {
    const n = await photoExif.normalizeImage(blob);
    const url = URL.createObjectURL(n.blob);
    const img = new Image();
    img.src = url;
    await img.decode().catch(
      () =>
        new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("Não foi possível exibir a foto"));
        }),
    );
    imgRef.current = img;
    setStrokes([]);
    setPhoto({ blob: n.blob, url, w: n.width, h: n.height });
  }

  async function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return toast.error("A câmera ainda está iniciando");
    stampGeo();
    try {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await photoExif.canvasToJpeg(c, 0.92);
      stopCamera();
      await loadIntoEditor(blob);
    } catch (e: any) {
      toast.error("Falha ao capturar a foto", { description: e?.message });
    }
  }

  function pickFromDevice() {
    stampGeo();
    stopCamera();
    setFromGallery(false);
    fileRef.current?.click();
  }

  function pickFromGallery() {
    stopCamera();
    galleryRef.current?.click();
  }

  async function onGalleryFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) {
      startCamera();
      return;
    }
    try {
      const ex = await photoExif.readExifGeo(f);
      if (ex.lat !== null && ex.lon !== null) {
        setGeoAt({ lat: ex.lat, lon: ex.lon, altitude: ex.altitude, accuracy: null, t: ex.takenAt ?? Date.now() });
        setAzimuth(ex.azimuth !== null ? ex.azimuth.toFixed(0) : "");
        toast.success("Posição e data lidas da própria foto");
      } else {
        const g = useGps.current();
        setGeoAt({ lat: g.lat, lon: g.lon, altitude: g.altitude, accuracy: g.accuracy, t: ex.takenAt ?? Date.now() });
        setAzimuth("");
        toast.warning("A foto não tem localização gravada — usei a posição atual do GPS. Confira antes de salvar.");
      }
      setFromGallery(true);
      await loadIntoEditor(f);
    } catch (err: any) {
      toast.error("Não foi possível abrir a foto", { description: err?.message });
      startCamera();
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) {
      startCamera();
      return;
    }
    try {
      await loadIntoEditor(f);
    } catch (err: any) {
      toast.error("Não foi possível abrir a foto", { description: err?.message });
      startCamera();
    }
  }

  function retake() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setStrokes([]);
    startCamera();
  }

  // Redraw photo + sketch strokes
  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !photo) return;
    if (c.width !== photo.w) c.width = photo.w;
    if (c.height !== photo.h) c.height = photo.h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, photo.w, photo.h);
    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const s of all) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = s.width * 0.6;
      ctx.beginPath();
      const pts = s.mode === "line" && s.pts.length > 1 ? [s.pts[0], s.pts[s.pts.length - 1]] : s.pts;
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  });

  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  }

  const width = photo ? Math.max(4, Math.round(Math.max(photo.w, photo.h) / 220)) : 6;

  async function save() {
    if (!photo) return;
    setSaving(true);
    try {
      const az = azimuth.trim() === "" ? null : Number(azimuth.replace(",", "."));
      const g = geoAt ?? { lat: null, lon: null, altitude: null, accuracy: null, t: Date.now() };
      const geoData = {
        lat: g.lat,
        lon: g.lon,
        altitude: g.altitude,
        accuracy: g.accuracy,
        azimuth: az !== null && isFinite(az) ? az : null,
        takenAt: g.t,
        comment: caption,
      };
      const original = await photoExif.writeExif(photo.blob, geoData);
      let annotated: Blob | null = null;
      if (strokes.length && canvasRef.current) {
        const raw = await photoExif.canvasToJpeg(canvasRef.current, 0.88);
        annotated = await photoExif.writeExif(raw, geoData);
      }
      const id = newId();
      await localDb.photos.put({
        id,
        recordId,
        stationId,
        blob: original,
        annotated,
        lat: geoData.lat,
        lon: geoData.lon,
        altitude: geoData.altitude,
        accuracy: geoData.accuracy,
        azimuth: geoData.azimuth,
        caption,
        takenAt: geoData.takenAt,
        author,
        ownerId: owner.id(),
        synced: 0,
      });
      toast.success(annotated ? "Foto e croqui salvos" : "Foto salva");
      onSaved?.({ photoId: id, lat: g.lat, lon: g.lon, altitude: g.altitude, accuracy: g.accuracy });
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Falha ao salvar a foto", { description: err?.message ?? String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialog} onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title ?? "Foto georreferenciada"}</DialogTitle>
          <DialogDescription>Posição, altitude, precisão e azimute vão junto com a foto. Depois, desenhe o croqui por cima.</DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onGalleryFile} />
        {!photo ? (
          <div className={styles.cameraWrap}>
            <div className={styles.viewfinder}>
              <video ref={videoRef} className={styles.video} playsInline muted autoPlay />
              {camState !== "live" && (
                <div className={styles.camMsg}>{camState === "starting" ? "Abrindo câmera…" : camState === "error" ? camError : "Câmera desligada"}</div>
              )}
              <div className={styles.live}>
                <Compass size={16} />
                <strong>{sensors.heading !== null ? `${sensors.heading.toFixed(0)}°` : "—"}</strong>
              </div>
            </div>
            <div className={styles.shutterRow}>
              <div className={styles.altCol}>
                <Button variant="outline" onClick={pickFromGallery}>
                  <ImagePlus size={18} /> Galeria / arquivo
                </Button>
                <Button variant="ghost" size="sm" onClick={pickFromDevice}>
                  <Camera size={16} /> Câmera do celular
                </Button>
              </div>
              <button className={styles.shutter} onClick={shoot} disabled={camState !== "live"} aria-label="Fotografar">
                <Aperture size={30} />
              </button>
              {camState === "error" ? (
                <Button variant="ghost" onClick={startCamera} className={styles.alt}>
                  <RotateCcw size={18} /> Tentar câmera de novo
                </Button>
              ) : (
                <span className={styles.alt} />
              )}
            </div>
            <p className={styles.hint}>Aponte para o alvo antes de disparar — o azimute é registrado no momento do clique.</p>
          </div>
        ) : (
          <div className={styles.editor}>
            <div className={styles.toolbar}>
              <div className={styles.colors}>
                {COLORS.map((c) => (
                  <button key={c} className={`${styles.swatch} ${c === color ? styles.swatchOn : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label="Cor" />
                ))}
              </div>
              <div className={styles.tools}>
                <Button size="icon-md" variant={mode === "free" ? "primary" : "outline"} onClick={() => setMode("free")} aria-label="Traço livre">
                  <Pencil size={18} />
                </Button>
                <Button size="icon-md" variant={mode === "line" ? "primary" : "outline"} onClick={() => setMode("line")} aria-label="Linha reta">
                  <Minus size={18} />
                </Button>
                <Button size="icon-md" variant="outline" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length} aria-label="Desfazer">
                  <Undo2 size={18} />
                </Button>
                <Button size="icon-md" variant="outline" onClick={() => setStrokes([])} disabled={!strokes.length} aria-label="Limpar">
                  <Eraser size={18} />
                </Button>
              </div>
            </div>
            <div className={styles.croquiHint}>Croqui: desenhe com o dedo sobre a foto (opcional)</div>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onPointerDown={(e) => {
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
                drawing.current = { color, width, mode, pts: [toCanvas(e)] };
                force((n) => n + 1);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                e.preventDefault();
                drawing.current.pts.push(toCanvas(e));
                force((n) => n + 1);
              }}
              onPointerUp={() => {
                const d = drawing.current;
                drawing.current = null;
                if (d && d.pts.length > 1) setStrokes((s) => [...s, d]);
                else force((n) => n + 1);
              }}
              onPointerCancel={() => {
                drawing.current = null;
                force((n) => n + 1);
              }}
            />
            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Legenda</span>
                <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Ex.: cabeceira da voçoroca, face norte" />
              </label>
              <label className={styles.fieldSmall}>
                <span>Azimute (°)</span>
                <Input inputMode="decimal" value={azimuth} onChange={(e) => setAzimuth(e.target.value)} placeholder="—" />
              </label>
            </div>
            <div className={styles.meta}>
              {fromGallery && <b>Foto da galeria · </b>}
              {geoAt?.lat != null
                ? `${geoAt.lat.toFixed(6)}, ${geoAt.lon?.toFixed(6)} · Z ${geoAt.altitude != null ? geoAt.altitude.toFixed(1) + " m" : "—"} · ±${geoAt.accuracy?.toFixed(0)} m`
                : "Sem posição GPS no momento da foto"}
            </div>
            <div className={styles.actions}>
              <Button variant="outline" onClick={retake}>
                <Camera size={18} /> Refazer
              </Button>
              <Button onClick={save} disabled={saving}>
                <Check size={18} /> {saving ? "Salvando…" : "Salvar foto"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
