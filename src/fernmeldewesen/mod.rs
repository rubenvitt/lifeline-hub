//! Modul Fernmeldewesen (LLH-1180): Kommunikationsplan (LFH-848) und Fernmeldeskizze (LFH-893).
//! Seit LLH-1602 eigenes Modul im Code; vorher lagen beide unter `crate::stab`. Die API-Pfade
//! bleiben `…/stab/kommunikationsplan…` und `…/stab/fernmeldeskizze…` (Grenzwert-Regel,
//! `AGENTS.md`). Regeln: `frontend/src/fernmeldewesen/AGENTS.md`.

pub mod fernmeldeskizze;
pub mod kommunikation;
