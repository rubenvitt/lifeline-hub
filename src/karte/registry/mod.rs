//! DB-gestützte Karten-Registry (LFH-179): Online-Quellen + Offline-Karten.
//!
//! Ersetzt die frühere ENV-only-`KarteConfig` durch laufzeit-schreibbare DB-Tabellen
//! (`karte_online_quelle`, `karte_offline_karte`, Migration 0076). Die Karte-Routen lesen
//! zur Laufzeit fresh aus der DB (kein Cache); Admin-CRUD pflegt die Registry.

pub mod repo;
