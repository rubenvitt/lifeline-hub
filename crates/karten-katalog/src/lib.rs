use serde::{Deserialize, Serialize};

/// Ein kuratierter, herunterladbarer Offline-Karten-Vorschlag (LFH-181). `groesse` ist die
/// UNGEFÄHRE Dateigröße in Bytes (für den Plattenplatz-Check vorab; die exakte Größe liefert
/// die Content-Length bzw. der fertige Download). Einträge sind Shortbread-MBTiles (LFH-195)
/// und rendern mit dem beschrifteten Offline-Style (Shortbread-Layer + eingebettete Glyphs/Sprite).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OfflineKatalogEintrag {
    pub name: String,
    pub url: String,
    pub region: String,
    pub groesse: i64,
    pub lizenz: String,
    pub kachel_schema: String,
    /// Provenienz-Hinweis fürs UI (Eigenbau via karten-build/Planetiler, kein Community-Repo mehr).
    pub quelle: String,
    /// Optionaler SHA256-Pin (hex, lowercase). Gesetzt beim Eigen-Mirror: der Download
    /// verifiziert den berechneten gegen diesen Hash. `None` = kein Pin (vor erstem Release-Pin).
    pub sha256: Option<String>,
    /// Optionale UX-Gruppe für die geführte Auswahl (z. B. „Deutschland", „DACH",
    /// „Bundesländer"). Rein für die Frontend-Gruppierung; `None` = ungruppiert (LFH-199).
    pub gruppe: Option<String>,
}

/// Merged den kompilierten Default-Katalog mit einem optionalen Remote-Manifest (Hybrid, LFH-199).
/// Override per `name`: ein gültiger Remote-Eintrag mit gleichem Namen ersetzt den compiled-in
/// Eintrag; neue Namen werden angehängt. Der compiled-in Katalog ist immer die Baseline
/// (Offline-Fallback); `remote == None` (Fetch fehlgeschlagen/offline) → unveränderter Default.
pub fn merge_offline_katalog(
    compiled: Vec<OfflineKatalogEintrag>,
    remote: Option<Vec<OfflineKatalogEintrag>>,
) -> Vec<OfflineKatalogEintrag> {
    let Some(remote) = remote else { return compiled };
    let mut out = compiled;
    for e in remote {
        // Remote-Einträge müssen vollständig gepinnt sein — sonst käme ein Eintrag ohne
        // Integritätsprüfung/echte URL ins UI. Halb-gepinnte/Platzhalter-Remote-Einträge verwerfen.
        if !remote_eintrag_ist_gueltig(&e) {
            continue;
        }
        match out.iter_mut().find(|c| c.name == e.name) {
            Some(slot) => *slot = e, // Override per name
            None => out.push(e),     // neuer Eintrag ergänzt
        }
    }
    out
}

/// Ein Remote-Katalog-Eintrag ist nur auslieferbar, wenn vollständig gepinnt: 64-stelliger
/// lowercase-hex-sha256, echte https-URL (kein TODO-Platzhalter), Größe > 0, Lizenz gesetzt.
pub fn remote_eintrag_ist_gueltig(e: &OfflineKatalogEintrag) -> bool {
    matches!(&e.sha256, Some(h)
        if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
        && e.url.starts_with("https://")
        && !e.url.contains("TODO")
        && e.groesse > 0
        && !e.lizenz.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halb_gepinnter_remote_eintrag_ist_ungueltig() {
        let e = OfflineKatalogEintrag { name:"X".into(), url:"https://TODO/x.mbtiles".into(),
            region:"X".into(), groesse:1, lizenz:"ODbL".into(), kachel_schema:"shortbread".into(),
            quelle:"t".into(), sha256:None, gruppe:None };
        assert!(!remote_eintrag_ist_gueltig(&e));
    }
}
