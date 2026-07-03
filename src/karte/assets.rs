//! Eingebettete Offline-Glyphs/Sprite (LFH-195/197). Die echten Assets erzeugt
//! `karten-build/gen-assets.sh` aus gepinnten Upstream-Releases (versatiles-fonts: OFL-Glyphs
//! „Noto Sans Regular", kuratierte Latein-Ranges; versatiles-style: CC0-Sprite `basics` →
//! `basemap`); hier nur die Einbettung via rust-embed.

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
}
