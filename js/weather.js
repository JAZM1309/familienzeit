// Wetter für die Startseite über Open-Meteo (kostenlos, ohne Anmeldung, ohne Schlüssel).
// Übertragen wird nur der eingestellte Ort (Koordinaten), kein Standort des Geräts.
import { state } from './app.js';

const CACHE = 'fz-weather';
const MAX_AGE = 30 * 60 * 1000;

export function weatherPlace() {
  const own = state.me?.settings?.weather;
  if (own === null || own === false) return null; // ausdrücklich ausgeschaltet
  if (own?.lat != null) return own;
  const admin = state.members?.find((m) => m.user_id === state.family?.admin_id);
  const fromAdmin = admin?.settings?.weather;
  return fromAdmin?.lat != null ? fromAdmin : null;
}

// Wettercode (WMO) → Art und Text
export function condition(code) {
  if (code === 0) return { kind: 'klar', text: 'Sonnig', emoji: '☀️' };
  if (code === 1) return { kind: 'heiter', text: 'Heiter', emoji: '🌤️' };
  if (code === 2) return { kind: 'wolkig', text: 'Teils bewölkt', emoji: '⛅' };
  if (code === 3) return { kind: 'bedeckt', text: 'Bedeckt', emoji: '☁️' };
  if (code === 45 || code === 48) return { kind: 'nebel', text: 'Nebel', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { kind: 'regen', text: 'Nieselregen', emoji: '🌦️' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { kind: 'regen', text: code >= 80 ? 'Regenschauer' : 'Regen', emoji: '🌧️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'schnee', text: 'Schnee', emoji: '🌨️' };
  if (code >= 95) return { kind: 'gewitter', text: 'Gewitter', emoji: '⛈️' };
  return { kind: 'wolkig', text: 'Wechselhaft', emoji: '⛅' };
}

function readCache(place) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (c && c.lat === place.lat && c.lon === place.lon && Date.now() - c.at < MAX_AGE) return c.data;
  } catch { /* egal */ }
  return null;
}

// Liefert { temp, min, max, code, isDay, ...condition } oder null (nie ein Fehler – Wetter ist Beiwerk)
export async function currentWeather({ timeout = 1800 } = {}) {
  const place = weatherPlace();
  if (!place) return null;
  const cached = readCache(place);
  if (cached) return { ...cached, ...condition(cached.code), place: place.name };
  if (!navigator.onLine) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FBerlin&forecast_days=1';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    const data = {
      temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, isDay: !!j.current.is_day,
      max: Math.round(j.daily?.temperature_2m_max?.[0]), min: Math.round(j.daily?.temperature_2m_min?.[0]),
    };
    try { localStorage.setItem(CACHE, JSON.stringify({ lat: place.lat, lon: place.lon, at: Date.now(), data })); } catch { /* egal */ }
    return { ...data, ...condition(data.code), place: place.name };
  } catch { return null; }
}

// Ortssuche für die Einstellungen
export async function searchPlaces(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Suche fehlgeschlagen');
  const j = await res.json();
  return (j.results || []).map((r) => ({
    name: r.name, region: [r.admin1, r.country_code !== 'DE' ? r.country : null].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 100) / 100, lon: Math.round(r.longitude * 100) / 100,
  }));
}
