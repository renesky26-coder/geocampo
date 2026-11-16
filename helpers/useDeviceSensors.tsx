import { useEffect, useRef, useState } from "react";
// @ts-ignore — geomagnetism ships without type declarations
import geomagnetism from "geomagnetism";
import { useGps } from "./useGps";

export type SensorState = {
  heading: number | null; // TRUE-north heading 0–360 (magnetic + declination, WMM-2025)
  magneticHeading: number | null; // raw compass heading (magnetic north)
  declination: number | null; // degrees, east positive (negative across Brazil)
  edgeTilt: number | null; // inclination of the device's long axis vs horizontal
  faceTilt: number | null; // inclination of the screen plane vs horizontal (dip)
  available: boolean;
  needsPermission: boolean;
};

let permissionGranted = false;

let declCache: { key: string; value: number } | null = null;
/** Magnetic declination (WMM-2025) for the current GPS position, cached per ~10 km. */
function currentDeclination(): number | null {
  const g = useGps.current();
  if (g.lat === null || g.lon === null) return declCache?.value ?? null;
  const key = `${g.lat.toFixed(1)},${g.lon.toFixed(1)}`;
  if (declCache?.key === key) return declCache.value;
  try {
    const m = geomagnetism.model(new Date(), { allowOutOfBoundsModel: true });
    const value = m.point([g.lat, g.lon]).decl as number;
    declCache = { key, value };
    return value;
  } catch {
    return null;
  }
}

async function requestPermission(): Promise<boolean> {
  try {
    const DOE: any = (window as any).DeviceOrientationEvent;
    const DME: any = (window as any).DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const r = await DOE.requestPermission();
      if (r !== "granted") return false;
    }
    if (DME && typeof DME.requestPermission === "function") {
      const r = await DME.requestPermission();
      if (r !== "granted") return false;
    }
    permissionGranted = true;
    return true;
  } catch {
    return false;
  }
}

function needsPermissionPrompt() {
  if (permissionGranted) return false;
  const DOE: any = typeof window !== "undefined" ? (window as any).DeviceOrientationEvent : undefined;
  return !!DOE && typeof DOE.requestPermission === "function";
}

/** Compass heading + clinometer angles from the phone's sensors, smoothed. */
export function useDeviceSensors(active: boolean): SensorState & { requestPermission: () => Promise<boolean> } {
  const [s, setS] = useState<SensorState>({
    heading: null,
    magneticHeading: null,
    declination: null,
    edgeTilt: null,
    faceTilt: null,
    available: false,
    needsPermission: needsPermissionPrompt(),
  });
  const g = useRef<[number, number, number] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const onOrient = (e: any) => {
      let magnetic: number | null = null;
      if (typeof e.webkitCompassHeading === "number") magnetic = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === "number") magnetic = (360 - e.alpha) % 360;
      const decl = currentDeclination();
      const heading = magnetic === null ? null : (((magnetic + (decl ?? 0)) % 360) + 360) % 360;
      let faceFromOrient: number | null = null;
      if (typeof e.beta === "number" && typeof e.gamma === "number") {
        const b = (e.beta * Math.PI) / 180;
        const gm = (e.gamma * Math.PI) / 180;
        faceFromOrient = (Math.acos(Math.min(1, Math.abs(Math.cos(b) * Math.cos(gm)))) * 180) / Math.PI;
      }
      setS((prev) => ({
        ...prev,
        available: true,
        needsPermission: false,
        heading: heading ?? prev.heading,
        magneticHeading: magnetic ?? prev.magneticHeading,
        declination: decl ?? prev.declination,
        faceTilt: g.current ? prev.faceTilt : faceFromOrient,
      }));
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const alpha = 0.15;
      const prev = g.current ?? [a.x, a.y, a.z];
      g.current = [
        prev[0] + alpha * (a.x - prev[0]),
        prev[1] + alpha * (a.y - prev[1]),
        prev[2] + alpha * (a.z - prev[2]),
      ];
      setTick((t) => (t + 1) % 1000000);
    };
    window.addEventListener("deviceorientationabsolute" as any, onOrient);
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("deviceorientationabsolute" as any, onOrient);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, [active, s.needsPermission]);

  useEffect(() => {
    if (!g.current) return;
    const [x, y, z] = g.current;
    const n = Math.sqrt(x * x + y * y + z * z) || 1;
    const edge = (Math.asin(Math.min(1, Math.abs(y) / n)) * 180) / Math.PI;
    const face = (Math.acos(Math.min(1, Math.abs(z) / n)) * 180) / Math.PI;
    setS((prev) => ({ ...prev, available: true, needsPermission: false, edgeTilt: edge, faceTilt: face }));
  }, [tick]);

  return {
    ...s,
    requestPermission: async () => {
      const ok = await requestPermission();
      if (ok) setS((prev) => ({ ...prev, needsPermission: false }));
      return ok;
    },
  };
}