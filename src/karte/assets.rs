//! Eingebettete Offline-Glyphs/Sprite (LFH-195, Task 2.4). `assets/karten/` enthält aktuell
//! Placeholder-Dateien (`assets/karten/README.md`) — das karten-build-Projekt (Planetiler-
//! Shortbread + OFL-Fonts/CC0-Sprite) erzeugt die echten Assets; hier nur die Einbettung.

#[derive(rust_embed::Embed)]
#[folder = "assets/karten/"]
pub struct KartenAssets;

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
}
