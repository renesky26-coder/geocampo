// geotiff.js browser build, loaded from a CDN on first GeoTIFF import
// (the npm package pulls Node-only modules into the frontend bundle).
const SRC = "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js";

let promise: Promise<any> | null = null;

export function loadGeoTiff(): Promise<any> {
  if (promise) return promise;
  promise = new Promise<any>((resolve, reject) => {
    const w = window as any;
    if (w.GeoTIFF) return resolve(w.GeoTIFF);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.GeoTIFF ? resolve(w.GeoTIFF) : reject(new Error("Leitor GeoTIFF não carregou")));
    s.onerror = () => {
      promise = null;
      reject(new Error("Sem conexão para carregar o leitor GeoTIFF. Conecte-se uma vez para importar GeoTIFF."));
    };
    document.head.appendChild(s);
  });
  return promise;
}
