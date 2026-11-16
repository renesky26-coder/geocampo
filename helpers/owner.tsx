// Collector identity without login: a private key kept on the device, and its public
// SHA-256 id stored on every item the collector creates. Only the key's holder can
// change or delete those items (enforced by the server).
const KEY = "gc-owner-key";
const ID = "gc-owner-id";

function randomKey() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

function key(): string {
  let k = "";
  try {
    k = localStorage.getItem(KEY) ?? "";
    if (!k) {
      k = randomKey();
      localStorage.setItem(KEY, k);
      localStorage.removeItem(ID);
    }
  } catch {
    /* ignore */
  }
  return k;
}

/** Makes sure the public id is computed and cached; call once at start-up. */
async function ensure(): Promise<string> {
  const k = key();
  let id = "";
  try {
    id = localStorage.getItem(ID) ?? "";
  } catch {
    /* ignore */
  }
  if (!id) {
    id = await sha256Hex(k);
    try {
      localStorage.setItem(ID, id);
    } catch {
      /* ignore */
    }
  }
  return id;
}

function id(): string | null {
  try {
    return localStorage.getItem(ID);
  } catch {
    return null;
  }
}

/** Use the same key as another device of the same person. */
async function setKey(k: string): Promise<string> {
  const v = k.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(v)) throw new Error("A chave tem 32 caracteres (0–9 e a–f). Copie exatamente do outro aparelho.");
  localStorage.setItem(KEY, v);
  localStorage.removeItem(ID);
  return ensure();
}

/** True when this device's collector may edit/delete the item. */
function canEdit(item: { ownerId?: string | null; author?: string } | null | undefined, myAuthor: string): boolean {
  if (!item) return true;
  if (item.ownerId) return item.ownerId === id();
  return !item.author || item.author === myAuthor;
}

export const owner = { key, ensure, id, setKey, canEdit };
