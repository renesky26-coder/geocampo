import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { localDb, type FieldRecord, type Photo, type Station } from "./localDb";
import { geo } from "./geo";
import { exportData } from "./exportData";
import { measurementTypes, attrLabel, fichas, customToFicha, type Ficha } from "./dictionaries";

let extraFichas: Ficha[] = [];

const INK: [number, number, number] = [28, 42, 34];
const LATERITA: [number, number, number] = [184, 74, 36];
const MUTED: [number, number, number] = [96, 106, 98];

const TILE_URLS: Record<string, string> = {
  sat: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  topo: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

function project(lat: number, lon: number, z: number) {
  const s = 256 * Math.pow(2, z);
  const x = ((lon + 180) / 360) * s;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return [x, y];
}

async function tileBlob(base: string, z: number, x: number, y: number): Promise<Blob | null> {
  const hit = await localDb.tiles.get(`${base}/${z}/${x}/${y}`);
  if (hit) return hit.blob;
  if (!navigator.onLine) return null;
  try {
    const r = await fetch(TILE_URLS[base].replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)), { mode: "cors" });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** Renders a miniature map (basemap tiles from cache + collected features) to a JPEG data URL. */
async function miniMap(records: FieldRecord[], stations: Station[], W = 1400, H = 900): Promise<string | null> {
  const pts: [number, number][] = [];
  records.forEach((r) => {
    const g = r.geometry;
    if (g.type === "Point") pts.push([g.coordinates[0], g.coordinates[1]]);
    else if (g.type === "LineString") pts.push(...g.coordinates);
    else pts.push(...g.coordinates[0]);
  });
  stations.forEach((s) => pts.push([s.lon, s.lat]));
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  let z = 19;
  for (; z > 3; z--) {
    const [x0, y0] = project(Math.max(...lats), Math.min(...lons), z);
    const [x1, y1] = project(Math.min(...lats), Math.max(...lons), z);
    if (x1 - x0 < W * 0.8 && y1 - y0 < H * 0.8) break;
  }
  const base = (() => {
    try {
      return localStorage.getItem("gc-basemap") ?? "sat";
    } catch {
      return "sat";
    }
  })();
  const maxNative = base === "topo" ? 17 : 19;
  const tz = Math.min(z, maxNative);
  const k = Math.pow(2, z - tz);
  const [cx, cy] = project(cLat, cLon, z);
  const left = cx - W / 2;
  const top = cy - H / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e9e3d3";
  ctx.fillRect(0, 0, W, H);
  const ts = 256 * k;
  const tx0 = Math.floor(left / ts);
  const ty0 = Math.floor(top / ts);
  const tx1 = Math.floor((left + W) / ts);
  const ty1 = Math.floor((top + H) / ts);
  const jobs: Promise<void>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(
        (async () => {
          const b = await tileBlob(base, tz, tx, ty);
          if (!b) return;
          try {
            const bmp = await createImageBitmap(b);
            ctx.drawImage(bmp, tx * ts - left, ty * ts - top, ts, ts);
          } catch {
            /* ignore */
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);
  const P = (lon: number, lat: number) => {
    const [x, y] = project(lat, lon, z);
    return [x - left, y - top];
  };
  ctx.lineJoin = "round";
  records.forEach((r, i) => {
    const g = r.geometry;
    ctx.strokeStyle = "#ff6a2b";
    ctx.fillStyle = "rgba(255,106,43,0.22)";
    ctx.lineWidth = 5;
    if (g.type === "LineString" || g.type === "Polygon") {
      const cs = g.type === "LineString" ? g.coordinates : g.coordinates[0];
      ctx.beginPath();
      cs.forEach(([lo, la], j) => {
        const [x, y] = P(lo, la);
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      if (g.type === "Polygon") {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
    }
    const [lo, la] = g.type === "Point" ? g.coordinates : g.type === "LineString" ? g.coordinates[0] : g.coordinates[0][0];
    const [x, y] = P(lo, la);
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#b84a24";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x, y + 1);
  });
  stations.forEach((s) => {
    const [x, y] = P(s.lon, s.lat);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#1f2e26";
    ctx.strokeStyle = "#f3c34a";
    ctx.lineWidth = 4;
    ctx.fillRect(-10, -10, 20, 20);
    ctx.strokeRect(-10, -10, 20, 20);
    ctx.restore();
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#1f2e26";
    ctx.fillRect(x + 16, y - 13, ctx.measureText(s.code).width + 12, 26);
    ctx.fillStyle = "#f3c34a";
    ctx.fillText(s.code, x + 22, y + 1);
  });
  // north arrow + scale
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(W - 70, 16, 54, 70);
  ctx.fillStyle = "#1c2a22";
  ctx.beginPath();
  ctx.moveTo(W - 43, 26);
  ctx.lineTo(W - 55, 62);
  ctx.lineTo(W - 43, 54);
  ctx.lineTo(W - 31, 62);
  ctx.closePath();
  ctx.fill();
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", W - 43, 78);
  const mPerPx = (156543.03392 * Math.cos((cLat * Math.PI) / 180)) / Math.pow(2, z);
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((m) => m / mPerPx > 120) ?? 10000;
  const px = nice / mPerPx;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(16, H - 50, px + 40, 34);
  ctx.fillStyle = "#1c2a22";
  ctx.fillRect(28, H - 28, px, 6);
  ctx.font = "14px monospace";
  ctx.textAlign = "left";
  ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 28, H - 36);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function photoDataUrl(p: Photo): Promise<{ url: string; w: number; h: number }> {
  const b = p.annotated ?? p.blob;
  const bmp = await createImageBitmap(b);
  const scale = Math.min(1, 1100 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/jpeg", 0.8), w: c.width, h: c.height };
}

function attrLines(r: FieldRecord) {
  const labels: Record<string, string> = {
    "solo.horizonte": "Horizonte",
    "solo.textura": "Textura",
    "solo.cor": "Cor",
    "solo.estrutura": "Estrutura",
    "intemperismo.grau": "Intemperismo",
    "escoamento.tipo": "Escoamento",
    "escoamento.umidade": "Condição hídrica",
    "ruptura.mecanismo": "Ruptura",
    "ruptura.atividade": "Atividade",
  };
  void labels;
  const all = [...fichas, ...extraFichas];
  return Object.entries(r.attributes)
    .sort(([a], [b]) => (a === "_fichas" ? -1 : b === "_fichas" ? 1 : 0))
    .map(([k, v]) => {
      const val = Array.isArray(v) ? v.map((x) => (k === "_fichas" ? all.find((f) => f.key === x)?.short ?? x : x)).join(", ") : v;
      return [attrLabel(k, extraFichas), val];
    });
}

export type ReportOptions = { title: string; project: string; author: string; fromDate?: number | null; campanha?: string | null };

/** Builds the "Caderneta Digital" PDF field report and downloads it. */
export async function reportPdf(opts: ReportOptions) {
  const snap = await exportData.snapshot();
  extraFichas = (await localDb.forms.toArray()).filter((f) => !f.deleted).map(customToFicha);
  const records = snap.records.filter(
    (r) =>
      (!opts.fromDate || r.createdAt >= opts.fromDate) &&
      (!opts.campanha || (opts.campanha === "__sem" ? !r.attributes._campanha : r.attributes._campanha === opts.campanha)),
  );
  const stations = snap.stations;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210;
  const M = 16;
  const now = new Date();

  const header = () => {
    doc.setFillColor(...INK);
    doc.rect(0, 0, PW, 10, "F");
    doc.setTextColor(239, 233, 218);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("GEOCAMPO · CADERNETA DIGITAL DE CAMPO", M, 6.5);
    doc.setFont("helvetica", "normal");
    doc.text(now.toLocaleString("pt-BR"), PW - M, 6.5, { align: "right" });
  };
  const footer = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(`${opts.project || "Projeto"} · página ${i} de ${n}`, PW / 2, 288, { align: "center" });
      doc.setFontSize(6.5);
      doc.text("Gerado com GeoCampo · Responsável pelo app: Geógrafo Renesky Jean Mary", PW / 2, 292, { align: "center" });
    }
  };

  header();
  doc.setTextColor(...INK);
  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.text(opts.title || "Relatório de campo", M, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  const dates = records.map((r) => r.createdAt);
  const range = dates.length ? `${new Date(Math.min(...dates)).toLocaleDateString("pt-BR")} – ${new Date(Math.max(...dates)).toLocaleDateString("pt-BR")}` : "—";
  doc.text([`Projeto: ${opts.project || "—"}`, `Responsável: ${opts.author || "—"}`, `Período de coleta: ${range}`, `Gerado em: ${now.toLocaleString("pt-BR")}`], M, 34);

  const counts = [
    ["Pontos", records.filter((r) => r.kind === "point").length],
    ["Linhas", records.filter((r) => r.kind === "line").length],
    ["Polígonos", records.filter((r) => r.kind === "polygon").length],
    ["Estações", stations.length],
    ["Fotos", snap.photos.filter((p) => !p.recordId || records.some((r) => r.id === p.recordId)).length],
  ];
  counts.forEach(([label, n], i) => {
    const x = M + i * 36;
    doc.setDrawColor(207, 198, 176);
    doc.rect(x, 54, 33, 16);
    doc.setFont("courier", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...LATERITA);
    doc.text(String(n), x + 3, 62);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(String(label).toUpperCase(), x + 3, 67);
  });

  const map = await miniMap(records, stations);
  let y = 76;
  if (map) {
    const mw = PW - 2 * M;
    const mh = (mw * 900) / 1400;
    doc.addImage(map, "JPEG", M, y, mw, mh);
    doc.setDrawColor(...INK);
    doc.rect(M, y, mw, mh);
    y += mh + 4;
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("Mapa de localização — números = registros na ordem da tabela; losangos = estações de monitoramento.", M, y);
    y += 6;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 16 },
    head: [["#", "Tipo", "Identificação", "UTM (E / N)", "Z (m)", "±m", "Medida"]],
    body: records.map((r, i) => {
      const p: any = exportData.recordProps(r, stations);
      return [
        i + 1,
        p.tipo,
        r.name,
        `${p.utm_zona} ${p.utm_e.toFixed(1)} / ${p.utm_n.toFixed(1)}`,
        r.altitude != null ? r.altitude.toFixed(1) : "—",
        r.accuracy != null ? r.accuracy.toFixed(1) : "—",
        p.area_m2 != null ? geo.formatArea(p.area_m2) : p.comprimento_m != null ? geo.formatLength(p.comprimento_m) : r.dip != null ? `${r.dip}°/${r.dipDirection ?? "—"}°` : "",
      ];
    }),
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: INK },
    headStyles: { fillColor: INK, textColor: [239, 233, 218], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 242, 233] },
    didDrawPage: header,
  });

  // Detail per record
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    doc.addPage();
    header();
    const p: any = exportData.recordProps(r, stations);
    doc.setTextColor(...LATERITA);
    doc.setFont("courier", "bold");
    doc.setFontSize(10);
    doc.text(`REGISTRO ${String(i + 1).padStart(3, "0")} · ${p.tipo.toUpperCase()}`, M, 20);
    doc.setTextColor(...INK);
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.text(r.name || "Sem nome", M, 28);
    const rows: (string | number)[][] = [
      ["Data/hora", new Date(r.createdAt).toLocaleString("pt-BR")],
      ["Autor", r.author || "—"],
      ["Coordenadas (WGS 84)", `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`],
      ["UTM", `${p.utm_zona} · E ${p.utm_e.toFixed(2)} · N ${p.utm_n.toFixed(2)} (${p.datum_utm})`],
      ["Altitude / precisão", `${r.altitude != null ? r.altitude.toFixed(1) + " m" : "—"} / ±${r.accuracy != null ? r.accuracy.toFixed(1) : "—"} m`],
    ];
    if (p.area_m2 != null) rows.push(["Área", geo.formatArea(p.area_m2)]);
    if (p.comprimento_m != null) rows.push([r.kind === "polygon" ? "Perímetro" : "Comprimento", geo.formatLength(p.comprimento_m)]);
    if (r.dip != null) rows.push(["Mergulho / direção", `${r.dip}° / ${r.dipDirection ?? "—"}°`]);
    if (p.estacao) rows.push(["Estação", p.estacao]);
    rows.push(...attrLines(r));
    if (r.notes) rows.push(["Observações", r.notes]);
    autoTable(doc, {
      startY: 33,
      margin: { left: M, right: M, top: 16 },
      body: rows,
      theme: "plain",
      styles: { fontSize: 8.5, cellPadding: 1.4, textColor: INK },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 44, textColor: MUTED } },
      didDrawPage: header,
    });
    let py = (doc as any).lastAutoTable.finalY + 6;
    const photos = snap.photos.filter((ph) => ph.recordId === r.id).sort((a, b) => a.takenAt - b.takenAt);
    let col = 0;
    let rowH = 0;
    const cw = (PW - 2 * M - 6) / 2;
    for (const ph of photos) {
      const img = await photoDataUrl(ph);
      const h = Math.min(90, (cw * img.h) / img.w);
      if (col === 0 && py + h + 10 > 282) {
        doc.addPage();
        header();
        py = 18;
      }
      const x = M + col * (cw + 6);
      doc.addImage(img.url, "JPEG", x, py, cw, h);
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      const cap = `${ph.annotated ? "[croqui] " : ""}${ph.caption || "Foto"}${ph.azimuth != null ? ` · az. ${ph.azimuth.toFixed(0)}°` : ""} · ${new Date(ph.takenAt).toLocaleTimeString("pt-BR")}`;
      doc.text(doc.splitTextToSize(cap, cw), x, py + h + 3.5);
      rowH = Math.max(rowH, h + 9);
      col++;
      if (col === 2) {
        col = 0;
        py += rowH;
        rowH = 0;
      }
    }
  }

  // Stations
  if (stations.length) {
    doc.addPage();
    header();
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text("Estações de monitoramento", M, 22);
    autoTable(doc, {
      startY: 28,
      margin: { left: M, right: M, top: 16 },
      head: [["Pino", "Nome", "UTM", "Data", "Medida", "Valor", "Δ"]],
      body: stations.flatMap((s) => {
        const u = geo.toUtm(s.lat, s.lon);
        const ms = snap.measurements.filter((m) => m.stationId === s.id);
        if (!ms.length) return [[s.code, s.name, `${u.label} ${u.easting.toFixed(1)} / ${u.northing.toFixed(1)}`, "—", "—", "—", ""]];
        return ms.map((m, j) => {
          const prev = ms.slice(0, j).filter((x) => x.type === m.type).pop();
          return [
            j === 0 ? s.code : "",
            j === 0 ? s.name : "",
            j === 0 ? `${u.label} ${u.easting.toFixed(1)} / ${u.northing.toFixed(1)}` : "",
            new Date(m.measuredAt).toLocaleDateString("pt-BR"),
            measurementTypes.find((t) => t.value === m.type)?.label ?? m.type,
            `${m.value.toLocaleString("pt-BR")} ${m.unit}`,
            prev ? `${m.value - prev.value > 0 ? "+" : ""}${(m.value - prev.value).toFixed(2)}` : "",
          ];
        });
      }),
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: INK },
      headStyles: { fillColor: INK, textColor: [239, 233, 218] },
      didDrawPage: header,
    });
  }

  footer();
  const blob = doc.output("blob");
  exportData.download(blob, `caderneta_campo_${exportData.stamp()}.pdf`);
}
