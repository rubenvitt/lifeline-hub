//! Fahrzeugortung aus dem Einwurf (LLH-2091). Entwurf:
//! `docs/superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md`.

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Woher die Position eines Einsatzfahrzeugs stammt. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum PositionQuelle {
        /// Von Hand auf der Lagekarte gesetzt.
        Manuell => "manuell",
        /// Aus dem Einwurf eines gekoppelten Geräts übernommen.
        Ortung => "ortung",
    }
    try_from = |s| format!("Ungültige Positionsquelle: {s}");
    sqlx = |s| format!("Ungültige Positionsquelle: {s}");
}
