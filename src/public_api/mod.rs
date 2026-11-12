//! Öffentliche API für Fremdsysteme unter `/api/v1/` (ADR-0022). Das Gerüst (Router, Dokument,
//! Fehler mit `code`) kommt aus LLH-1653; hier der Maschinenzugang (LLH-1652).

pub mod drossel;
pub mod kommando;
pub mod scope;
pub mod zugang;
