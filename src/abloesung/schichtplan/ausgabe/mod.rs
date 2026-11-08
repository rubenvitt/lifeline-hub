//! Schichtplan ausgeben (LLH-1557, Change `jwqanxja-schichtplan-ausgeben`, Spec
//! `kraefte-schichtplan`, „Schichtplan als Excel“).
//!
//! **Eine Form, zwei Quellen** (design.md D1): Der Plan eines Einsatzes und eine Vorplanung
//! (`crate::planung`) werden zu demselben [`plan::AusgabePlan`]; daraus schreibt
//! [`mappe::schreibe`] die Excel-Mappe. Der Druck im Browser arbeitet auf derselben Form
//! (`frontend/src/abloesung/schichtplan/ausgabe/ausgabePlan.ts`).
//!
//! **Rundweg** (design.md D6): Das erste Blatt „Austausch“ hat das Format, das der Leser aus
//! LLH-1556 einliest (`uebernahme::datei`). Jede Person trägt einen Bezug, den der Abgleich
//! wiedererkennt ([`crate::abloesung::schichtplan::uebernahme::abgleich::eigener_treffer`]):
//! Export und erneutes Einlesen in denselben Einsatz ändern nichts.
//!
//! Nur Lesen: kein ETB, kein Live-Ereignis.

pub mod mappe;
pub mod plan;
pub mod repo;
