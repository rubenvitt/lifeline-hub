//! Fetch-Logik je Quelle. Wird in den Phasen 2–5 befüllt.

use crate::error::AppError;
use crate::karte::typen::FachebeneAntwort;
use crate::karte::FachebenenState;

pub async fn fetch_dwd(_s: &FachebenenState) -> FachebeneAntwort {
    FachebeneAntwort::offline("dwd", "Datenbasis: Deutscher Wetterdienst")
}

pub async fn fetch_pegelonline(_s: &FachebenenState) -> FachebeneAntwort {
    FachebeneAntwort::offline("pegelonline", "PEGELONLINE / WSV")
}

pub async fn fetch_nina(_s: &FachebenenState) -> FachebeneAntwort {
    FachebeneAntwort::offline("nina", "BBK / MoWaS")
}

pub async fn fetch_kritis(_s: &FachebenenState, _bbox: &str) -> Result<FachebeneAntwort, AppError> {
    Ok(FachebeneAntwort::offline(
        "kritis",
        "© OpenStreetMap-Beitragende",
    ))
}
