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

// ===== Rewrite-Walker (Task 2): strukturell-zuerst + neutralize =====

use reqwest::Url;
use serde_json::Value;

/// Fehler beim Rewrite eines Style-/TileJSON-Dokuments.
#[derive(Debug, PartialEq, Eq)]
pub enum RewriteFehler {
    /// Mehr umzuschreibende URLs als die Obergrenze erlaubt (DoS-Schutz / fehlerhafte Quelle).
    ZuVieleSlots,
}

impl std::fmt::Display for RewriteFehler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RewriteFehler::ZuVieleSlots => write!(f, "Style referenziert zu viele Assets"),
        }
    }
}

/// Löst eine (relative oder absolute) Asset-Referenz gegen die Style-Basis auf — **brace-sicher**
/// (kein `Url::join`, das `{}` percent-kodieren würde). Absolute http(s)-URLs bleiben unverändert;
/// `//host/…` bekommt das Basis-Schema; relative Pfade werden gegen Host+Verzeichnis der Basis
/// aufgelöst. `None`, wenn die Basis keinen Host hat.
fn absolutiere(basis: &Url, referenz: &str) -> Option<String> {
    let r = referenz.trim();
    if r.to_ascii_lowercase().starts_with("http://") || r.to_ascii_lowercase().starts_with("https://") {
        return Some(r.to_string());
    }
    let scheme = basis.scheme();
    if let Some(rest) = r.strip_prefix("//") {
        return Some(format!("{scheme}://{rest}"));
    }
    let host = basis.host_str()?;
    let port = basis.port().map(|p| format!(":{p}")).unwrap_or_default();
    if let Some(rest) = r.strip_prefix('/') {
        return Some(format!("{scheme}://{host}{port}/{rest}"));
    }
    // Relativ zum Verzeichnis der Basis (alles bis zum letzten '/').
    let pfad = basis.path();
    let dir_ende = pfad.rfind('/').map(|i| i + 1).unwrap_or(0);
    Some(format!("{scheme}://{host}{port}{}{r}", &pfad[..dir_ende]))
}

/// Hilfsfunktion mit Slot-Obergrenze: zählt jede Slot-Vergabe, bricht über `max` ab.
fn mint_mit_cap(
    zaehler: &mut usize,
    max: usize,
    mint: &mut dyn FnMut(&str, SlotArt) -> String,
    url: &str,
    art: SlotArt,
) -> Result<String, RewriteFehler> {
    *zaehler += 1;
    if *zaehler > max {
        return Err(RewriteFehler::ZuVieleSlots);
    }
    Ok(mint(url, art))
}

/// Entfernt/neutralisiert verbleibende absolute http-URLs an **unbekannten** Positionen (nach dem
/// strukturellen Rewrite): Objekt-Schlüssel werden gelöscht, Array-Elemente auf `null` gesetzt.
/// Verhindert, dass beliebige (ggf. key-tragende) URLs als fetchbare Slots oder im Klartext im
/// Client-Dokument landen. Strings, in denen eine URL nur *eingebettet* ist (z.B. attribution-HTML),
/// werden NICHT angefasst — die fängt der `contains_secret`-Backstop.
fn neutralisiere_unbekannte(v: &mut Value) {
    match v {
        Value::Object(map) => {
            let zu_entfernen: Vec<String> = map
                .iter()
                .filter(|(_, val)| val.as_str().is_some_and(ist_absolute_http_url))
                .map(|(k, _)| k.clone())
                .collect();
            for k in zu_entfernen {
                map.remove(&k);
            }
            for val in map.values_mut() {
                neutralisiere_unbekannte(val);
            }
        }
        Value::Array(arr) => {
            for el in arr.iter_mut() {
                if el.as_str().is_some_and(ist_absolute_http_url) {
                    *el = Value::Null;
                } else {
                    neutralisiere_unbekannte(el);
                }
            }
        }
        _ => {}
    }
}

/// Schreibt einen MapLibre-Style **in place** um: bekannte Asset-Positionen → Proxy-Slot-URLs
/// (`mint(upstream_url, art)` liefert die fertige Client-URL), unbekannte absolute URLs werden
/// neutralisiert. `mint` wird synchron aufgerufen (im Handler: zweiphasig um den async Slot-Upsert,
/// siehe `hole_style`). Bricht über `max_slots` mit `ZuVieleSlots` ab.
pub fn rewrite_style(
    style: &mut Value,
    basis: &Url,
    mint: &mut dyn FnMut(&str, SlotArt) -> String,
    max_slots: usize,
) -> Result<(), RewriteFehler> {
    let mut n = 0usize;
    if let Some(sources) = style.get_mut("sources").and_then(Value::as_object_mut) {
        for src in sources.values_mut() {
            let Some(obj) = src.as_object_mut() else { continue };
            if let Some(tiles) = obj.get_mut("tiles").and_then(Value::as_array_mut) {
                for t in tiles.iter_mut() {
                    if let Some(s) = t.as_str() {
                        if let Some(abs) = absolutiere(basis, s) {
                            let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Template)?;
                            *t = Value::String(pu);
                        }
                    }
                }
            }
            if let Some(u) = obj.get("url").and_then(Value::as_str) {
                if let Some(abs) = absolutiere(basis, u) {
                    let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Tilejson)?;
                    obj.insert("url".into(), Value::String(pu));
                }
            }
            if let Some(d) = obj.get("data").and_then(Value::as_str) {
                if ist_absolute_http_url(d) {
                    if let Some(abs) = absolutiere(basis, d) {
                        let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Static)?;
                        obj.insert("data".into(), Value::String(pu));
                    }
                }
            }
        }
    }
    match style.get_mut("sprite") {
        Some(Value::String(s)) => {
            if let Some(abs) = absolutiere(basis, s) {
                let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Sprite)?;
                *style.get_mut("sprite").unwrap() = Value::String(pu);
            }
        }
        Some(Value::Array(arr)) => {
            for entry in arr.iter_mut() {
                if let Some(u) = entry.get("url").and_then(Value::as_str) {
                    if let Some(abs) = absolutiere(basis, u) {
                        let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Sprite)?;
                        entry.as_object_mut().unwrap().insert("url".into(), Value::String(pu));
                    }
                }
            }
        }
        _ => {}
    }
    if let Some(g) = style.get("glyphs").and_then(Value::as_str) {
        if let Some(abs) = absolutiere(basis, g) {
            let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Glyphs)?;
            style.as_object_mut().unwrap().insert("glyphs".into(), Value::String(pu));
        }
    }
    neutralisiere_unbekannte(style);
    Ok(())
}

/// Schreibt ein TileJSON-Dokument um: top-level `tiles[]` → Template-Slots. Bei `scheme: "tms"`
/// wird `{y}`→`{-y}` in der gespeicherten Upstream-URL ersetzt (Server flippt) und `scheme` auf
/// `xyz` normalisiert, damit MapLibre nicht ein zweites Mal flippt (kein Doppel-Flip).
pub fn rewrite_tilejson(
    tj: &mut Value,
    basis: &Url,
    mint: &mut dyn FnMut(&str, SlotArt) -> String,
    max_slots: usize,
) -> Result<(), RewriteFehler> {
    let mut n = 0usize;
    let ist_tms = tj.get("scheme").and_then(Value::as_str) == Some("tms");
    if let Some(tiles) = tj.get_mut("tiles").and_then(Value::as_array_mut) {
        for t in tiles.iter_mut() {
            if let Some(s) = t.as_str() {
                if let Some(mut abs) = absolutiere(basis, s) {
                    if ist_tms {
                        abs = abs.replace("{y}", "{-y}");
                    }
                    let pu = mint_mit_cap(&mut n, max_slots, mint, &abs, SlotArt::Template)?;
                    *t = Value::String(pu);
                }
            }
        }
    }
    if ist_tms {
        if let Some(obj) = tj.as_object_mut() {
            obj.insert("scheme".into(), Value::String("xyz".into()));
        }
    }
    neutralisiere_unbekannte(tj);
    Ok(())
}

/// Backstop: true, wenn ein nicht-leerer Query-Param-**Wert** der Upstream-URL als Substring im
/// serialisierten Dokument vorkommt (Key wäre durchgerutscht → fail-closed im Aufrufer).
/// Ehrliche Grenze: Keys in Pfadsegmenten/Subdomains werden so nicht erkannt.
pub fn contains_secret(serialisiert: &str, upstream: &Url) -> bool {
    upstream
        .query_pairs()
        .any(|(_, val)| !val.is_empty() && serialisiert.contains(val.as_ref()))
}

// ===== Service-Schicht (Task 5+): pinnender SSRF-Resolver + dedizierter Client =====

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

/// Filtert aufgelöste Adressen: liefert sie nur, wenn **keine** intern ist (fail-closed). Sobald
/// eine Adresse intern/nicht-routbar ist (auch bei gemischtem Ergebnis), kommt nichts zurück —
/// das schließt DNS-Rebinding (Name→intern) als SSRF-Vektor. Reine Funktion (unit-getestet).
pub fn nur_public(addrs: Vec<SocketAddr>) -> Vec<SocketAddr> {
    if addrs.iter().any(|a| crate::karte::download::ip_ist_intern(&a.ip())) {
        Vec::new()
    } else {
        addrs
    }
}

/// Auflösender, **pinnender** DNS-Resolver: löst den Host selbst auf, filtert über `nur_public`
/// und gibt nur public IPs an reqwest — reqwest connectet exakt auf diese Adressen, es gibt also
/// kein Re-Resolve-/Rebind-Fenster zwischen Prüfung und Connect. `url_ist_sicher` (Schema/Literal)
/// bleibt zusätzlich als Pre-Check im Handler.
pub struct SichererResolver;

impl Resolve for SichererResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            // Port 0: reqwest/hyper überschreibt ihn mit dem Ziel-Port aus der URL.
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
                .collect();
            Ok(Box::new(nur_public(addrs).into_iter()) as Addrs)
        })
    }
}

/// Dedizierter Proxy-Client: moderate Timeouts inkl. **Gesamt-Timeout** (Proxy-Assets sind klein —
/// anders als der GB-Download-Client ohne Globaltimeout), geteilte SSRF-Redirect-Policy und der
/// pinnende Resolver.
pub fn proxy_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("LifelineHub-Kartenproxy/1.0 (+https://github.com/)")
        .dns_resolver(Arc::new(SichererResolver))
        .redirect(crate::karte::download::ssrf_redirect_policy())
        .build()
        .expect("Proxy-Client baubar")
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

#[cfg(test)]
mod rewrite_tests {
    use super::*;
    use reqwest::Url;
    use serde_json::json;

    /// Deterministischer Fake-`mint`, der die (url, art)-Aufrufe protokolliert und eine
    /// relative Proxy-URL zurückgibt (key-frei, nicht-absolut → vom Sweep unangetastet).
    fn fake_mint(log: &mut Vec<(String, SlotArt)>) -> impl FnMut(&str, SlotArt) -> String + '_ {
        move |u, a| {
            log.push((u.to_string(), a));
            format!("/api/karte/proxy/1/{}/{}", a.as_str(), log.len())
        }
    }

    #[test]
    fn rewrite_style_mintet_strukturell_und_ist_keyfrei() {
        let basis = Url::parse("https://api.host/maps/x/style.json?key=K").unwrap();
        let mut style = json!({
            "version": 8,
            "sources": {
                "v": { "type": "vector", "url": "https://api.host/maps/x/tiles.json?key=K" },
                "r": { "type": "raster", "tiles": ["https://api.host/t/{z}/{x}/{y}.png?key=K"] },
                "g": { "type": "geojson", "data": "https://api.host/d.geojson?key=K" }
            },
            "sprite": "https://api.host/maps/x/sprite?key=K",
            "glyphs": "https://api.host/fonts/{fontstack}/{range}.pbf?key=K"
        });
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        drop(m); // Borrow von log freigeben, bevor wir es lesen
        let s = serde_json::to_string(&style).unwrap();
        assert!(!s.contains("key=K"), "kein Key im Ergebnis: {s}");
        assert!(!s.contains("api.host"), "kein Upstream-Host: {s}");
        let arten: Vec<&str> = log.iter().map(|(_, a)| a.as_str()).collect();
        for a in ["tilejson", "template", "static", "sprite", "glyphs"] {
            assert!(arten.contains(&a), "Art {a} gemintet");
        }
    }

    #[test]
    fn rewrite_style_absolutiert_relative_refs() {
        let basis = Url::parse("https://h/maps/x/style.json?key=K").unwrap();
        let mut style = json!({
            "version": 8, "sources": {},
            "sprite": "sprite",
            "glyphs": "fonts/{fontstack}/{range}.pbf"
        });
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        drop(m); // Borrow von log freigeben, bevor wir es lesen
        assert!(
            log.iter().any(|(u, a)| u == "https://h/maps/x/sprite" && *a == SlotArt::Sprite),
            "relative 'sprite' gegen Basis absolutiert: {log:?}"
        );
        assert!(
            log.iter().any(|(u, a)| u == "https://h/maps/x/fonts/{fontstack}/{range}.pbf" && *a == SlotArt::Glyphs),
            "relative glyphs absolutiert, braces erhalten: {log:?}"
        );
    }

    #[test]
    fn rewrite_style_neutralisiert_unbekannte_absolute_url() {
        let basis = Url::parse("https://h/s.json?key=K").unwrap();
        let mut style = json!({"version":8,"sources":{},"x_evil":"https://api.host/secret?key=K"});
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        drop(m); // Borrow von log freigeben, bevor wir es lesen
        let s = serde_json::to_string(&style).unwrap();
        assert!(!s.contains("api.host") && !s.contains("key=K"), "neutralisiert: {s}");
        assert!(log.is_empty(), "unbekannte Position wird NICHT zum fetchbaren Slot");
    }

    #[test]
    fn rewrite_style_laesst_attribution_html_unangetastet() {
        // URL ist nur EINGEBETTET (kein bare-URL-String) → Sweep fasst sie nicht an,
        // contains_secret fängt den Key später.
        let basis = Url::parse("https://h/s.json?key=K").unwrap();
        let mut style = json!({"version":8,"sources":{},"metadata":{"attribution":"<a href=\"https://h/x?key=K\">©</a>"}});
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        drop(m); // Borrow von log freigeben, bevor wir es lesen
        let s = serde_json::to_string(&style).unwrap();
        assert!(s.contains("key=K"), "eingebettete URL bleibt (Backstop-Fall): {s}");
        assert!(contains_secret(&s, &basis), "contains_secret erkennt den Rest-Key");
    }

    #[test]
    fn rewrite_style_slot_obergrenze() {
        let basis = Url::parse("https://h/s.json").unwrap();
        let tiles: Vec<String> = (0..10).map(|i| format!("https://h/{i}/{{z}}/{{x}}/{{y}}")).collect();
        let mut style = json!({"version":8,"sources":{"r":{"type":"raster","tiles": tiles}}});
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        assert_eq!(
            rewrite_style(&mut style, &basis, &mut m, 3),
            Err(RewriteFehler::ZuVieleSlots)
        );
    }

    #[test]
    fn rewrite_tilejson_normalisiert_tms() {
        let basis = Url::parse("https://h/tiles.json?key=K").unwrap();
        let mut tj = json!({"tiles":["https://h/{z}/{x}/{y}.pbf?key=K"], "scheme":"tms"});
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        rewrite_tilejson(&mut tj, &basis, &mut m, 500).unwrap();
        drop(m); // Borrow von log freigeben, bevor wir es lesen
        let s = serde_json::to_string(&tj).unwrap();
        assert!(!s.contains("key=K"), "key-frei: {s}");
        assert_eq!(tj.get("scheme").and_then(Value::as_str), Some("xyz"), "tms→xyz");
        // Upstream-Template trägt {-y} (Server flippt), nicht {y}.
        assert!(log[0].0.contains("{-y}"), "tms-Flip server-seitig: {:?}", log[0].0);
    }

    #[test]
    fn contains_secret_findet_query_werte() {
        let up = Url::parse("https://h/x?key=SECRET123&foo=bar").unwrap();
        assert!(contains_secret("...key=SECRET123...", &up));
        assert!(!contains_secret("nichts geheimes", &up));
    }

    #[test]
    fn nur_public_filtert_interne_fail_closed() {
        use std::net::SocketAddr;
        let pub1: SocketAddr = "8.8.8.8:0".parse().unwrap();
        let pub2: SocketAddr = "1.1.1.1:0".parse().unwrap();
        let intern: SocketAddr = "10.0.0.5:0".parse().unwrap();
        let loopback: SocketAddr = "127.0.0.1:0".parse().unwrap();
        assert_eq!(nur_public(vec![pub1, pub2]), vec![pub1, pub2], "alle public → durch");
        assert!(nur_public(vec![pub1, intern]).is_empty(), "gemischt → fail-closed leer");
        assert!(nur_public(vec![loopback]).is_empty(), "loopback raus");
        assert!(nur_public(vec![]).is_empty());
    }

    #[test]
    fn proxy_client_baut() {
        // Smoke: Client baubar (Gesamt-Timeout + pinnender Resolver + Redirect-Policy gesetzt).
        let _ = proxy_client();
    }
}
