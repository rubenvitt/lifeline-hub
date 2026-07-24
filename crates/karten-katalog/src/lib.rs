use serde::{Deserialize, Serialize};

/// Ein kuratierter, herunterladbarer Offline-Karten-Vorschlag (LFH-181). `groesse` ist die
/// UNGEFÄHRE Dateigröße in Bytes (für den Plattenplatz-Check vorab; die exakte Größe liefert
/// die Content-Length bzw. der fertige Download). Einträge sind Shortbread-MBTiles (LFH-195)
/// und rendern mit dem beschrifteten Offline-Style (Shortbread-Layer + eingebettete Glyphs/Sprite).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
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

/// Adjacently-tagged Status eines karten-service-Build-Jobs (LFH-323, verschoben aus
/// `karten-service/src/jobs.rs`). Wire: `{"status":"building"}` bzw. `{"status":"failed","fehler":"…"}`.
/// `karten-service` serialisiert ihn, `lifeline-hub` deserialisiert die Proxy-Antwort und exponiert
/// ihn (eingebettet in [`BuildJob`]) durch den Typ-Codegen. `Failed(String)` macht ihn
/// **datentragend** — deshalb bewusst NICHT in `tests/enum_wire_kontrakt.rs` gepinnt (dessen Makros
/// verlangen feldlose Enums) und in [`BuildJob`] `inline` statt als eigenes Component-Schema
/// registriert; die Wire-Treue sichert stattdessen der Round-Trip-Test unten.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "status", content = "fehler", rename_all = "lowercase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum JobStatus {
    Queued,
    Building,
    Uploading,
    Publishing,
    Done,
    Failed(String),
}

/// Ein Build-Job des zentralen karten-service (LFH-323, verschoben aus `karten-service`). Damit
/// läuft der Cross-Service-Vertrag durch die bestehende Codegen-Kette statt als roher
/// `serde_json::Value` daran vorbei.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct BuildJob {
    pub id: u64,
    pub slug: String,
    /// Inline statt `$ref`: [`JobStatus`] ist datentragend und bewusst kein registriertes
    /// Component-Schema — utoipa bettet die Union direkt hier ein.
    #[cfg_attr(feature = "schema", schema(inline))]
    pub status: JobStatus,
    pub gestartet: String,
    pub beendet: Option<String>,
}

/// Eine vom zentralen karten-service baubare Region (LFH-323, verschoben aus `karten-service`).
/// Auf `String`-Felder umgebaut (vorher `&'static str`), damit `lifeline-hub` die Proxy-Antwort
/// deserialisieren kann; `karten-service`s `dtos()` klont die `alle()`-Refs entsprechend.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct RegionDto {
    pub slug: String,
    pub name: String,
    pub region: String,
    pub gruppe: String,
}

/// Merged den kompilierten Default-Katalog mit einem optionalen Remote-Manifest (Hybrid, LFH-199).
/// Override per `name`: ein gültiger Remote-Eintrag mit gleichem Namen ersetzt den compiled-in
/// Eintrag; neue Namen werden angehängt. Der compiled-in Katalog ist immer die Baseline
/// (Offline-Fallback); `remote == None` (Fetch fehlgeschlagen/offline) → unveränderter Default.
pub fn merge_offline_katalog(
    compiled: Vec<OfflineKatalogEintrag>,
    remote: Option<Vec<OfflineKatalogEintrag>>,
) -> Vec<OfflineKatalogEintrag> {
    let Some(remote) = remote else {
        return compiled;
    };
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
/// lowercase-hex-sha256, sichere URL (https — ODER http nur für Loopback wie einen lokalen
/// Dev-Object-Store/MinIO), kein TODO-Platzhalter, Größe > 0, Lizenz gesetzt.
pub fn remote_eintrag_ist_gueltig(e: &OfflineKatalogEintrag) -> bool {
    matches!(&e.sha256, Some(h)
        if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
        && (e.url.starts_with("https://") || url_ist_loopback_http(&e.url))
        && !e.url.contains("TODO")
        && e.groesse > 0
        && !e.lizenz.is_empty()
}

/// http NUR für Loopback erlauben (lokaler Dev-Object-Store): der GEPARSTE Host muss ein Loopback
/// sein (127.0.0.0/8, ::1 oder „localhost"). Echtes URL-Parsing statt String-Präfix — behandelt
/// Userinfo, IPv6-Klammern und Ports korrekt und schützt gegen Bypass wie `http://[::1].evil.com/`,
/// `http://localhost@evil.com/`, `http://127.0.0.1.evil.com/`. Produktive Remote-URLs bleiben
/// https-pflichtig (dieser Zweig greift nur für http).
fn url_ist_loopback_http(url_str: &str) -> bool {
    let Ok(u) = url::Url::parse(url_str) else {
        return false;
    };
    if u.scheme() != "http" {
        return false;
    }
    match u.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(d)) => d == "localhost",
        None => false,
    }
}

/// Ist ein Katalog-Eintrag tatsächlich auslieferbar/herunterladbar? Gleiche Kriterien wie die
/// Remote-Merge-Gültigkeit (Pin + echte, sichere URL) — auch auf compiled-in Platzhalter
/// (TODO-URL, kein Pin) angewandt, damit der Download-Katalog nur wirklich ladbare Regionen zeigt
/// (ungebaute erscheinen nicht; gebaut wird über „Region neu bauen").
pub fn eintrag_ist_lieferbar(e: &OfflineKatalogEintrag) -> bool {
    remote_eintrag_ist_gueltig(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn halb_gepinnter_remote_eintrag_ist_ungueltig() {
        let e = OfflineKatalogEintrag {
            name: "X".into(),
            url: "https://TODO/x.mbtiles".into(),
            region: "X".into(),
            groesse: 1,
            lizenz: "ODbL".into(),
            kachel_schema: "shortbread".into(),
            quelle: "t".into(),
            sha256: None,
            gruppe: None,
        };
        assert!(!remote_eintrag_ist_gueltig(&e));
    }

    fn gepinnt(url: &str) -> OfflineKatalogEintrag {
        OfflineKatalogEintrag {
            name: "X".into(),
            url: url.into(),
            region: "X".into(),
            groesse: 1,
            lizenz: "ODbL".into(),
            kachel_schema: "shortbread".into(),
            quelle: "t".into(),
            sha256: Some("a".repeat(64)),
            gruppe: None,
        }
    }

    #[test]
    fn https_remote_ist_gueltig() {
        assert!(remote_eintrag_ist_gueltig(&gepinnt(
            "https://cdn.example/x.mbtiles"
        )));
    }

    #[test]
    fn loopback_http_ist_gueltig() {
        assert!(remote_eintrag_ist_gueltig(&gepinnt(
            "http://127.0.0.1:9000/maps/x.mbtiles"
        )));
        assert!(remote_eintrag_ist_gueltig(&gepinnt(
            "http://localhost:9000/maps/x.mbtiles"
        )));
        assert!(remote_eintrag_ist_gueltig(&gepinnt(
            "http://[::1]:9000/maps/x.mbtiles"
        )));
    }

    #[test]
    fn nicht_loopback_http_ist_ungueltig() {
        assert!(!remote_eintrag_ist_gueltig(&gepinnt(
            "http://cdn.example/x.mbtiles"
        )));
        // Präfix-Spoofing: Host enthält/beginnt mit Loopback, ist aber eine fremde Domain.
        assert!(!remote_eintrag_ist_gueltig(&gepinnt(
            "http://127.0.0.1.evil.com/x.mbtiles"
        )));
        assert!(!remote_eintrag_ist_gueltig(&gepinnt(
            "http://[::1].evil.com/x.mbtiles"
        )));
        // Userinfo-Falle: der echte Host ist evil.com, nicht localhost/127.0.0.1.
        assert!(!remote_eintrag_ist_gueltig(&gepinnt(
            "http://localhost@evil.com/x.mbtiles"
        )));
        assert!(!remote_eintrag_ist_gueltig(&gepinnt(
            "http://127.0.0.1@evil.com/x.mbtiles"
        )));
    }

    // ── LFH-323: Wire-Treue der verschobenen karten-service-Kontrakt-Typen. ──
    // Reiner Serde-Test (kein `schema`-Feature nötig): läuft auch im standalone-`karten-service`
    // und ersetzt für das datentragende `JobStatus` den `enum_wire_kontrakt`-Pin, der hier nicht
    // greifen kann.

    #[test]
    fn jobstatus_serde_round_trip_je_variante() {
        let faelle = [
            (JobStatus::Queued, serde_json::json!({"status": "queued"})),
            (
                JobStatus::Building,
                serde_json::json!({"status": "building"}),
            ),
            (
                JobStatus::Uploading,
                serde_json::json!({"status": "uploading"}),
            ),
            (
                JobStatus::Publishing,
                serde_json::json!({"status": "publishing"}),
            ),
            (JobStatus::Done, serde_json::json!({"status": "done"})),
            (
                JobStatus::Failed("boom".into()),
                serde_json::json!({"status": "failed", "fehler": "boom"}),
            ),
        ];
        for (variante, wire) in faelle {
            let ser = serde_json::to_value(&variante).unwrap();
            assert_eq!(ser, wire, "Wire-Serialisierung von {variante:?}");
            let zurueck: JobStatus = serde_json::from_value(ser).unwrap();
            assert_eq!(
                serde_json::to_value(&zurueck).unwrap(),
                wire,
                "Round-Trip (deser→ser) von {variante:?}",
            );
        }
    }

    #[test]
    fn build_job_verschachtelter_status_round_trip() {
        // Genau die Form, die `lifeline-hub` vom karten-service proxyt (verschachteltes status.status).
        let job = BuildJob {
            id: 1,
            slug: "bayern".into(),
            status: JobStatus::Building,
            gestartet: "2026-01-01T00:00:00Z".into(),
            beendet: None,
        };
        let v = serde_json::to_value(&job).unwrap();
        assert_eq!(
            v["status"]["status"], "building",
            "verschachteltes status.status"
        );
        let zurueck: BuildJob = serde_json::from_value(v).unwrap();
        assert!(matches!(zurueck.status, JobStatus::Building));
        assert_eq!(zurueck.beendet, None);
    }

    #[test]
    fn region_dto_round_trip() {
        let dto = RegionDto {
            slug: "bayern".into(),
            name: "Bayern".into(),
            region: "DE-BY".into(),
            gruppe: "Bundesländer".into(),
        };
        let v = serde_json::to_value(&dto).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"slug": "bayern", "name": "Bayern", "region": "DE-BY", "gruppe": "Bundesländer"}),
        );
        let zurueck: RegionDto = serde_json::from_value(v).unwrap();
        assert_eq!(zurueck.slug, "bayern");
    }
}

/// LFH-265: Beleg, dass das `schema`-Feature `ToSchema` wirklich anhängt. Der Test kompiliert
/// ohne das `cfg_attr`-Derive nicht — das ist seine Unterscheidungskraft. Er läuft NUR mit
/// aktivem Feature (`cargo test -p karten-katalog --features schema` oder, per
/// Feature-Unification, in jeder Workspace-Invocation); `cargo test -p karten-katalog` ohne
/// Feature belegt umgekehrt, dass das Crate weiterhin ohne utoipa baut.
#[cfg(all(test, feature = "schema"))]
mod schema_tests {
    use super::*;
    use utoipa::openapi::{RefOr, Schema};
    use utoipa::PartialSchema;

    #[test]
    fn offline_katalog_eintrag_hat_schema_mit_allen_feldern() {
        let RefOr::T(Schema::Object(o)) = OfflineKatalogEintrag::schema() else {
            panic!("OfflineKatalogEintrag muss ein Object-Schema sein");
        };
        for feld in [
            "name",
            "url",
            "region",
            "groesse",
            "lizenz",
            "kachel_schema",
            "quelle",
            "sha256",
            "gruppe",
        ] {
            assert!(
                o.properties.contains_key(feld),
                "Feld {feld} fehlt im Schema"
            );
        }
        // Die beiden Option-Felder dürfen NICHT required sein, alle anderen schon.
        assert!(!o.required.contains(&"sha256".to_string()));
        assert!(!o.required.contains(&"gruppe".to_string()));
        assert!(o.required.contains(&"name".to_string()));
    }

    /// LFH-323: `BuildJob`/`RegionDto` sind ToSchema-fähig, und `BuildJob.status` ist INLINE
    /// (kein `$ref` auf ein `JobStatus`-Component). Der Inline-Check ist die Unterscheidungskraft:
    /// wäre das `#[schema(inline)]` weg, zeigte `status` als `RefOr::Ref` auf ein nicht
    /// registriertes Schema — der generierte TS-Typ liefe ins Leere.
    #[test]
    fn build_job_und_region_dto_haben_schema_mit_inline_status() {
        let RefOr::T(Schema::Object(o)) = BuildJob::schema() else {
            panic!("BuildJob muss ein Object-Schema sein");
        };
        for feld in ["id", "slug", "status", "gestartet", "beendet"] {
            assert!(
                o.properties.contains_key(feld),
                "BuildJob-Feld {feld} fehlt"
            );
        }
        assert!(
            matches!(o.properties.get("status"), Some(RefOr::T(_))),
            "BuildJob.status muss inline sein (kein $ref auf ein JobStatus-Component)",
        );

        let RefOr::T(Schema::Object(o)) = RegionDto::schema() else {
            panic!("RegionDto muss ein Object-Schema sein");
        };
        for feld in ["slug", "name", "region", "gruppe"] {
            assert!(
                o.properties.contains_key(feld),
                "RegionDto-Feld {feld} fehlt"
            );
        }
    }
}
