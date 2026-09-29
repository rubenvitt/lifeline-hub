//! DB-gestützte Karten-Registry (LFH-179): Online-Quellen und Offline-Karten in
//! `karte_online_quelle`/`karte_offline_karte`. Die Karte-Routen lesen zur Laufzeit ohne Cache
//! aus der DB; Admin-CRUD pflegt die Registry.

pub mod repo;
