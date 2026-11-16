// sql.js (SQLite compiled to WebAssembly) is loaded from a CDN on first use.
// It powers MBTiles reading and GeoPackage (.gpkg) writing in the browser.
const VERSION = "1.10.3";
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${VERSION}`;

let promise: Promise<any> | null = null;

export function loadSqlJs(): Promise<any> {
  if (promise) return promise;
  promise = new Promise<any>((resolve, reject) => {
    const w = window as any;
    const init = () =>
      w
        .initSqlJs({ locateFile: (f: string) => `${BASE}/${f}` })
        .then(resolve)
        .catch((e: any) => {
          promise = null;
          reject(new Error("Não foi possível iniciar o SQLite: " + (e?.message ?? e)));
        });
    if (w.initSqlJs) return init();
    const s = document.createElement("script");
    s.src = `${BASE}/sql-wasm.js`;
    s.async = true;
    s.onload = init;
    s.onerror = () => {
      promise = null;
      reject(new Error("Sem conexão para carregar o módulo SQLite. Conecte-se uma vez para habilitar MBTiles/GeoPackage."));
    };
    document.head.appendChild(s);
  });
  return promise;
}