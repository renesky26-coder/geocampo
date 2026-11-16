import { useSyncExternalStore } from "react";

export type GpsState = {
  status: "idle" | "waiting" | "ok" | "error" | "unsupported";
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  timestamp: number | null;
  error: string | null;
};

let state: GpsState = {
  status: "idle",
  lat: null,
  lon: null,
  altitude: null,
  accuracy: null,
  altitudeAccuracy: null,
  speed: null,
  timestamp: null,
  error: null,
};
const listeners = new Set<() => void>();
let watchId: number | null = null;
const trackListeners = new Set<(s: GpsState) => void>();

function set(partial: Partial<GpsState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

function start() {
  if (watchId !== null) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    set({ status: "unsupported", error: "Este aparelho não oferece GPS ao navegador." });
    return;
  }
  set({ status: "waiting", error: null });
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      set({
        status: "ok",
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        altitude: pos.coords.altitude,
        accuracy: pos.coords.accuracy,
        altitudeAccuracy: pos.coords.altitudeAccuracy,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
        error: null,
      });
      trackListeners.forEach((fn) => fn(state));
    },
    (err) => {
      const msg =
        err.code === err.PERMISSION_DENIED
          ? "Permissão de localização negada. Libere o GPS nas configurações do navegador."
          : err.code === err.TIMEOUT
            ? "GPS demorando a responder — vá para céu aberto."
            : "Não foi possível obter a posição.";
      set({ status: state.lat !== null ? "ok" : "error", error: msg });
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  start();
  return () => {
    listeners.delete(l);
  };
}

/**
 * Live GPS position shared across the whole app (one watchPosition).
 * useGps.onFix registers a callback for every new fix (used for track recording).
 */
export const useGps = Object.assign(
  function useGps(): GpsState {
    return useSyncExternalStore(subscribe, () => state, () => state);
  },
  {
    onFix(fn: (s: GpsState) => void) {
      trackListeners.add(fn);
      start();
      return () => {
        trackListeners.delete(fn);
      };
    },
    current: () => state,
  },
);