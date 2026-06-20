//! Geocoding & Peilung für die Koordinaten-Plausibilitätsprüfung (LFH Ort-Vorschau).
//!
//! Zwei Schichten:
//! - `peilung` — reine Mathematik (Haversine + 8-Strich-Bearing) zum nächsten bekannten
//!   verorteten Einsatz-Marker. Funktioniert IMMER offline, ohne externen Dienst.
//! - Reverse-Geocoding (Phase 2) — ergänzt einen Ortsnamen über einen konfigurierbaren
//!   Nominatim-kompatiblen Dienst, mit hartem Timeout, Token-Bucket-Rate-Limit und Cache.
//!
//! DATENSCHUTZ (bewusste Abwägung, Stil der GK-~3m-Grenze in `frontend/.../koordinaten.ts`):
//! Der Default-Geocoder (öffentlicher Nominatim) sendet die Einsatz-Koordinate an einen
//! Dritt-Server — anders als die bestehenden *Pulls* öffentlicher Warndaten (NINA/DWD/Pegel).
//! Der Cache-Key wird auf ~100 m gerundet (Nachbarpunkte teilen einen Eintrag). Admins können
//! eine eigene Geocoder-URL hinterlegen. Die Peilung kommt ohne jeden externen Dienst aus.

pub mod peilung;
pub mod marker;
pub mod cache;
