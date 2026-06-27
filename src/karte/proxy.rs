//! Server-Proxy für Style/Tile (LFH-182): reine Bausteine (URL-Bauer, Template-/Glyphs-
//! Substitution, Validatoren, Rewrite-Walker, `contains_secret`) plus eine nicht-validierende
//! Service-Schicht (`proxy_client`, pinnender SSRF-Resolver, `hole_asset`/`hole_style`/
//! `hole_tilejson`). Die reinen Teile sind unit-getestet; die Service-Schicht ist gegen einen
//! Loopback-Fixture testbar (sie validiert NICHT selbst — das SSRF-Gate sitzt im Handler).

use crate::config::OnlineStyleTyp;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};

/// Art eines Proxy-Assets — bestimmt Endpunkt-Form und bindet einen Slot an seinen Abruf-Pfad
/// (Defense-in-Depth: ein Sprite-Slot darf nicht als Tile geladen werden).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotArt {
    Static,
    Template,
    Tilejson,
    Sprite,
    Glyphs,
}

impl SlotArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            SlotArt::Static => "static",
            SlotArt::Template => "template",
            SlotArt::Tilejson => "tilejson",
            SlotArt::Sprite => "sprite",
            SlotArt::Glyphs => "glyphs",
        }
    }

    pub fn aus_str(s: &str) -> Option<SlotArt> {
        match s {
            "static" => Some(SlotArt::Static),
            "template" => Some(SlotArt::Template),
            "tilejson" => Some(SlotArt::Tilejson),
            "sprite" => Some(SlotArt::Sprite),
            "glyphs" => Some(SlotArt::Glyphs),
            _ => None,
        }
    }
}

/// Client-URL, die `/api/karte/config` für eine proxied Quelle ausgibt (statt der Upstream-URL).
/// Vektor → Style-JSON-Endpunkt; Raster → XYZ-Tile-Template, das MapLibre clientseitig füllt.
pub fn proxy_config_url(id: i64, typ: &OnlineStyleTyp) -> String {
    match typ {
        OnlineStyleTyp::Vektor => format!("/api/karte/proxy/{id}/style.json"),
        OnlineStyleTyp::Raster => format!("/api/karte/proxy/{id}/raster/{{z}}/{{x}}/{{y}}"),
    }
}

/// Client-URL für einen gemnteten Slot, je nach Asset-Art. Template-/Glyphs-Formen tragen die
/// MapLibre-Platzhalter, die der Client einsetzt; Sprite trägt nur die Basis (MapLibre hängt
/// `.json`/`.png`/`@2x` an).
pub fn proxy_url(id: i64, art: SlotArt, slot: i64) -> String {
    match art {
        SlotArt::Template => format!("/api/karte/proxy/{id}/tile/{slot}/{{z}}/{{x}}/{{y}}"),
        SlotArt::Tilejson => format!("/api/karte/proxy/{id}/tilejson/{slot}"),
        SlotArt::Sprite => format!("/api/karte/proxy/{id}/sprite/{slot}"),
        SlotArt::Glyphs => format!("/api/karte/proxy/{id}/glyphs/{slot}/{{fontstack}}/{{range}}"),
        SlotArt::Static => format!("/api/karte/proxy/{id}/asset/{slot}"),
    }
}

/// True für absolute http(s)- und protokoll-relative (`//host/…`) URLs. Lehnt relative Pfade,
/// `pmtiles://`, `mapbox://`, `data:` etc. ab — nur fetchbare http-Ressourcen werden geproxyt.
pub fn ist_absolute_http_url(s: &str) -> bool {
    let l = s.trim().to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://") || l.starts_with("//")
}

/// Ersetzt die MapLibre-Tile-Platzhalter `{z}/{x}/{y}` (namensbasiert, Reihenfolge-unabhängig)
/// und `{-y}` (TMS-Flip = `2^z - 1 - y`) **rein textuell** im rohen Template (kein Url-Roundtrip,
/// damit `{}` nicht percent-kodiert wird). Ein Template ohne Platzhalter bleibt unverändert.
pub fn subst_template(template: &str, z: i64, x: i64, y: i64) -> String {
    let flip = (1i64 << z) - 1 - y;
    template
        .replace("{-y}", &flip.to_string())
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string())
}

/// Zeichen, die in einem `{fontstack}`-Pfadsegment percent-kodiert werden müssen. Nicht-ASCII
/// wird von `utf8_percent_encode` ohnehin immer kodiert.
const FONTSTACK_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b',')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'\\')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

/// Ersetzt `{fontstack}` (percent-kodiert) und `{range}` im rohen Glyphs-Template.
pub fn subst_glyphs(template: &str, fontstack: &str, range: &str) -> String {
    let fs = utf8_percent_encode(fontstack, FONTSTACK_SET).to_string();
    template.replace("{fontstack}", &fs).replace("{range}", range)
}

/// Glyphs-`range` muss strikt `\d+-\d+` sein (z.B. `0-255`) — verhindert Pfad-/Query-Injection.
pub fn validiere_range(range: &str) -> Result<(), String> {
    let (a, b) = range
        .split_once('-')
        .ok_or_else(|| format!("ungültiger range: {range}"))?;
    let ok = |s: &str| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit());
    if ok(a) && ok(b) {
        Ok(())
    } else {
        Err(format!("ungültiger range: {range}"))
    }
}

/// `{fontstack}` darf nur Buchstaben/Ziffern/Leerzeichen/Komma/Bindestrich enthalten — lehnt
/// `/`, `.` (und damit `..`), `#`, `?`, `%`, `\` ab. (Unicode-Fontnamen sind v1 nicht unterstützt.)
pub fn validiere_fontstack(fontstack: &str) -> Result<(), String> {
    if fontstack.is_empty() {
        return Err("leerer fontstack".into());
    }
    let ok = fontstack
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == ',' || c == '-');
    if ok {
        Ok(())
    } else {
        Err(format!("ungültiger fontstack: {fontstack}"))
    }
}

/// Erlaubte Sprite-Suffixe (MapLibre hängt sie an die Sprite-Basis an), längste zuerst.
const SPRITE_SUFFIXE: [&str; 4] = ["@2x.json", "@2x.png", ".json", ".png"];

/// Schiebt einen Sprite-Suffix (`.json`/`.png`/`@2x…`) **vor** den Upstream-Query
/// (`…/sprite?key=K` + `.png` → `…/sprite.png?key=K`).
pub fn sprite_upstream(base: &str, suffix: &str) -> String {
    match base.split_once('?') {
        Some((pfad, query)) => format!("{pfad}{suffix}?{query}"),
        None => format!("{base}{suffix}"),
    }
}

/// Zerlegt das `{rest}`-Segment des Sprite-Endpunkts (`7.png`, `7@2x.json`) in (slot, suffix).
/// Suffix nur aus der Allowlist; sonst Fehler (kein beliebiges Anhängsel in die Upstream-URL).
pub fn split_slot_suffix(rest: &str) -> Result<(i64, String), String> {
    for suf in SPRITE_SUFFIXE {
        if let Some(prefix) = rest.strip_suffix(suf) {
            if let Ok(slot) = prefix.parse::<i64>() {
                return Ok((slot, suf.to_string()));
            }
        }
    }
    Err(format!("ungültiges Sprite-Segment: {rest}"))
}

/// Die clientseitig vom Server unterstützten Template-Platzhalter (v1).
const BEKANNTE_PLATZHALTER: [&str; 6] = ["{z}", "{x}", "{y}", "{-y}", "{fontstack}", "{range}"];

/// Liefert alle `{…}`-Platzhalter eines Templates, die NICHT zur unterstützten Menge gehören
/// (z.B. `{quadkey}`, `{ratio}`, `{bbox-epsg-3857}`) — fürs Fail-fast beim Speichern.
pub fn unbekannte_platzhalter(template: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(rel) = template[i..].find('}') {
                let token = &template[i..=i + rel];
                if !BEKANNTE_PLATZHALTER.contains(&token) {
                    out.push(token.to_string());
                }
                i += rel + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::OnlineStyleTyp;

    #[test]
    fn proxy_config_url_je_typ() {
        assert_eq!(
            proxy_config_url(7, &OnlineStyleTyp::Vektor),
            "/api/karte/proxy/7/style.json"
        );
        assert_eq!(
            proxy_config_url(7, &OnlineStyleTyp::Raster),
            "/api/karte/proxy/7/raster/{z}/{x}/{y}"
        );
    }

    #[test]
    fn proxy_url_fuenf_formen() {
        assert_eq!(
            proxy_url(3, SlotArt::Template, 9),
            "/api/karte/proxy/3/tile/9/{z}/{x}/{y}"
        );
        assert_eq!(
            proxy_url(3, SlotArt::Tilejson, 9),
            "/api/karte/proxy/3/tilejson/9"
        );
        assert_eq!(proxy_url(3, SlotArt::Sprite, 9), "/api/karte/proxy/3/sprite/9");
        assert_eq!(
            proxy_url(3, SlotArt::Glyphs, 9),
            "/api/karte/proxy/3/glyphs/9/{fontstack}/{range}"
        );
        assert_eq!(proxy_url(3, SlotArt::Static, 9), "/api/karte/proxy/3/asset/9");
    }

    #[test]
    fn slot_art_round_trip() {
        for a in [
            SlotArt::Static,
            SlotArt::Template,
            SlotArt::Tilejson,
            SlotArt::Sprite,
            SlotArt::Glyphs,
        ] {
            assert_eq!(SlotArt::aus_str(a.as_str()), Some(a));
        }
        assert_eq!(SlotArt::aus_str("quatsch"), None);
    }

    #[test]
    fn subst_template_namensbasiert_und_tms() {
        // Reihenfolge {z}/{y}/{x}: z=3, x=5, y=1 → 3/1/5
        assert_eq!(
            subst_template("https://h/{z}/{y}/{x}.pbf?key=K", 3, 5, 1),
            "https://h/3/1/5.pbf?key=K"
        );
        // {-y} TMS: z=3, y=1 → 2^3-1-1 = 6
        assert_eq!(subst_template("https://h/{z}/{x}/{-y}", 3, 2, 1), "https://h/3/2/6");
        // Ohne Platzhalter unverändert.
        assert_eq!(
            subst_template("https://h/static.png", 3, 2, 1),
            "https://h/static.png"
        );
    }

    #[test]
    fn subst_glyphs_encodet_fontstack() {
        assert_eq!(
            subst_glyphs("https://h/fonts/{fontstack}/{range}.pbf?key=K", "Noto Sans,Arial", "0-255"),
            "https://h/fonts/Noto%20Sans%2CArial/0-255.pbf?key=K"
        );
    }

    #[test]
    fn validiere_range_und_fontstack() {
        assert!(validiere_range("0-255").is_ok());
        assert!(validiere_range("0-255?x=").is_err());
        assert!(validiere_range("0-255.pbf").is_err());
        assert!(validiere_range("255").is_err());
        assert!(validiere_fontstack("Noto Sans,Arial").is_ok());
        for bad in ["a/b", "..", "a#b", "a?b", "a%b", ""] {
            assert!(validiere_fontstack(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn sprite_upstream_suffix_vor_query() {
        assert_eq!(
            sprite_upstream("https://h/sprite?key=K", ".png"),
            "https://h/sprite.png?key=K"
        );
        assert_eq!(
            sprite_upstream("https://h/sprite?key=K", "@2x.json"),
            "https://h/sprite@2x.json?key=K"
        );
        assert_eq!(sprite_upstream("https://h/sprite", ".png"), "https://h/sprite.png");
    }

    #[test]
    fn split_slot_suffix_allowlist() {
        assert_eq!(split_slot_suffix("7.png").unwrap(), (7, ".png".into()));
        assert_eq!(split_slot_suffix("7@2x.png").unwrap(), (7, "@2x.png".into()));
        assert_eq!(split_slot_suffix("7.json").unwrap(), (7, ".json".into()));
        assert_eq!(split_slot_suffix("7@2x.json").unwrap(), (7, "@2x.json".into()));
        assert!(split_slot_suffix("7.exe").is_err());
        assert!(split_slot_suffix("7").is_err());
        assert!(split_slot_suffix("abc.png").is_err());
    }

    #[test]
    fn ist_absolute_http_url_erkennung() {
        for ok in ["https://h/a", "HTTPS://h/a", "http://h/a", "//h/a"] {
            assert!(ist_absolute_http_url(ok), "{ok}");
        }
        for no in ["/a/b", "a/b", "pmtiles://x", "mapbox://x", "data:foo"] {
            assert!(!ist_absolute_http_url(no), "{no}");
        }
    }

    #[test]
    fn unbekannte_platzhalter_findet_nur_unbekannte() {
        assert!(unbekannte_platzhalter("https://h/{z}/{x}/{y}").is_empty());
        assert!(unbekannte_platzhalter("https://h/fonts/{fontstack}/{range}.pbf").is_empty());
        assert_eq!(
            unbekannte_platzhalter("https://h/{z}/{quadkey}/{ratio}"),
            vec!["{quadkey}".to_string(), "{ratio}".to_string()]
        );
    }
}
