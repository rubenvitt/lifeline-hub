//! Eingebettete Offline-Glyphs/Sprite (LFH-195/197). Die echten Assets erzeugt
//! `karten-build/gen-assets.sh` aus gepinnten Upstream-Releases (versatiles-fonts: OFL-Glyphs
//! „Noto Sans Regular", kuratierte Latein-Ranges; versatiles-style: CC0-Sprite `basics` →
//! `basemap`); hier nur die Einbettung via rust-embed.

#[derive(rust_embed::Embed)]
#[folder = "assets/karten/"]
pub struct KartenAssets;

// --- Optionale eingebettete Welt-Übersicht (Low-Zoom-Basis, LFH-207) ---
// Eine kleine, grob aufgelöste Welt (z2–6, Shortbread-MBTiles) wird — falls eingebettet — IMMER
// offline als unterste Basis-Ebene mitgezeichnet, sodass die Lagekarte nie leer ist und Regional-
// Packs sich mit Straßendetail darüberlegen. Der Operator erzeugt sie via
// `karten-build/gen-world-overview.sh` und checkt sie unter `assets/karten/welt/` ein; fehlt sie
// (Standard), ist die App voll funktionsfähig — nur ohne globale Basis-Ebene.

/// Dateiname der extrahierten Welt-Übersicht unter `karten_dir`.
pub const WELT_UEBERSICHT_DATEI: &str = "welt-uebersicht.mbtiles";
/// Embed-Pfad der optionalen Welt-Übersicht.
const WELT_EMBED_PFAD: &str = "welt/welt-uebersicht.mbtiles";

/// Ist eine Welt-Übersicht eingebettet? Dann wird sie immer offline als unterste Basis gezeichnet.
pub fn welt_uebersicht_eingebettet() -> bool {
    KartenAssets::get(WELT_EMBED_PFAD).is_some()
}

/// Cache-Bust-Token der Welt-Übersicht (Hex-Präfix des Embed-sha256), oder `None` wenn nicht eingebettet.
/// Wechselt bei einer neuen Welt-Version → MapLibre lädt die Kacheln frisch (kein Stale-Cache).
pub fn welt_uebersicht_version() -> Option<String> {
    KartenAssets::get(WELT_EMBED_PFAD)
        .map(|f| f.metadata.sha256_hash().iter().take(8).map(|b| format!("{b:02x}")).collect())
}

/// Extrahiert die eingebettete Welt-Übersicht (falls vorhanden) nach
/// `<karten_dir>/welt-uebersicht.mbtiles`. Graceful (kein Asset → no-op) und idempotent (schreibt
/// nur, wenn die Zieldatei fehlt oder die Größe abweicht). Beim Serverstart aufgerufen, BEVOR Tiles
/// ausgeliefert werden → kein Reader-Cache-Bruch (der Reader-Cache ist zu diesem Zeitpunkt leer).
pub fn extrahiere_welt_uebersicht(karten_dir: &std::path::Path) {
    let Some(embedded) = KartenAssets::get(WELT_EMBED_PFAD) else {
        return;
    };
    let ziel = karten_dir.join(WELT_UEBERSICHT_DATEI);
    if std::fs::metadata(&ziel).map(|m| m.len()).ok() == Some(embedded.data.len() as u64) {
        return; // schon aktuell
    }
    if let Err(e) = std::fs::write(&ziel, &embedded.data) {
        tracing::warn!("Welt-Übersicht konnte nicht extrahiert werden: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprite_json_ist_eingebettet() {
        assert!(KartenAssets::get("sprites/basemap.json").is_some());
    }

    // Font-Positivpfad: der Fontstack trägt Leerzeichen (`Noto Sans Regular`) — regressions-
    // relevant, weil ein Embed-Pfad mit Space leicht durch Umbenennen/Umbau brechen kann und
    // MapLibre die Glyphs sonst 404-t (Karte ohne Beschriftung).
    #[test]
    fn font_positivpfad_mit_leerzeichen_ist_eingebettet() {
        assert!(KartenAssets::get("fonts/Noto Sans Regular/0-255.pbf").is_some());
    }

    // Regressions-Guard gegen Placeholder-Rückfall (LFH-197): die 0-Byte-Dummy-Glyphs ließen
    // die Offline-Karte ohne Beschriftung rendern (`.is_some()` allein greift zu kurz — ein
    // leeres File ist ebenfalls „some"). Ein echter SDF-Glyph-Range (Noto Sans Regular 0-255)
    // ist ein mehrere Kilobyte großes Protobuf. Erzeugt via karten-build/gen-assets.sh.
    #[test]
    fn font_0_255_ist_echter_glyph_kein_placeholder() {
        let f = KartenAssets::get("fonts/Noto Sans Regular/0-255.pbf")
            .expect("0-255.pbf muss eingebettet sein");
        assert!(
            f.data.len() > 1000,
            "0-255.pbf wirkt wie Placeholder ({} Bytes) — echte Glyphs via gen-assets.sh einspielen",
            f.data.len()
        );
    }

    // Ebenso das CC0-Sprite: der 1×1-Placeholder (70 Bytes) ist zwar ein gültiges leeres Sprite,
    // aber nicht das reale Icon-Set. Ein echtes Sprite-PNG ist deutlich größer.
    #[test]
    fn sprite_png_ist_echt_kein_placeholder() {
        let f = KartenAssets::get("sprites/basemap.png").expect("basemap.png muss eingebettet sein");
        assert!(
            f.data.len() > 1000,
            "basemap.png wirkt wie 1×1-Placeholder ({} Bytes) — echtes CC0-Sprite via gen-assets.sh",
            f.data.len()
        );
    }

    #[test]
    fn welt_uebersicht_extraktion_graceful_und_idempotent() {
        // Ohne „nie eingebettet" hart zu verdrahten (bricht sonst, sobald der Operator das Asset
        // einspielt): geprüft wird die Invariante „Datei genau dann, wenn eingebettet" + Idempotenz.
        let tmp = tempfile::tempdir().unwrap();
        extrahiere_welt_uebersicht(tmp.path());
        let existiert = tmp.path().join(WELT_UEBERSICHT_DATEI).exists();
        assert_eq!(existiert, welt_uebersicht_eingebettet(), "Datei genau dann, wenn eingebettet");
        assert_eq!(welt_uebersicht_version().is_some(), welt_uebersicht_eingebettet());
        // Zweiter Aufruf panickt nicht (idempotent).
        extrahiere_welt_uebersicht(tmp.path());
    }
}
