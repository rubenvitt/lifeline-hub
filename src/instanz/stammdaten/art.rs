//! Beschreibung je verteilter Stammdatenart (design.md D1, D2, D5): Tabelle, Schlüssel, Spalten
//! der Lieferung, Verweise auf andere Arten, natürlicher Schlüssel für den ersten Abgleich, wie eine
//! verwendete Zeile stillgelegt wird, und Unterlisten. Liefern und Übernehmen lesen nur diese
//! Tabelle; eine neue Art braucht hier einen Eintrag und ihre Trigger in einer Migration (der Guard
//! unten prüft beides gegeneinander).

use super::StammdatenArt;

/// Wie eine Zeile ihrer Art eindeutig heißt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Schluessel {
    /// `id INTEGER PRIMARY KEY`, je Instanz vergeben: die Gegenseite bildet sie über die Herkunft ab.
    Id,
    /// Eine Textspalte, die mit `org_id` den Primärschlüssel bildet; sie heißt überall gleich.
    Spalte(&'static str),
    /// Genau eine Zeile je Org (`org_id` ist der Primärschlüssel).
    Org,
}

/// Ein Verweis einer Spalte auf eine Zeile einer anderen (oder derselben) Art.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Verweis {
    pub spalte: &'static str,
    pub ziel: StammdatenArt,
}

/// Eine Unterliste, die mit ihrer Elternzeile geliefert und ersetzt wird.
#[derive(Debug, Clone, Copy)]
pub struct Unterliste {
    pub tabelle: &'static str,
    pub eltern_spalte: &'static str,
    pub spalten: &'static [&'static str],
    pub verweise: &'static [Verweis],
}

/// Alles, was Liefern und Übernehmen über eine Art wissen müssen.
#[derive(Debug, Clone, Copy)]
pub struct ArtBeschreibung {
    pub art: StammdatenArt,
    pub tabelle: &'static str,
    pub schluessel: Schluessel,
    /// Spalten der Lieferung ohne `id`, `org_id` und Spalten, die nur hier gelten (Zeitstempel,
    /// „geändert von“).
    pub spalten: &'static [&'static str],
    pub verweise: &'static [Verweis],
    /// Spalte im Format `[{"q": <qualifikation_id>, "n": <anzahl>}]` (`personal::quali_soll`).
    pub quali_soll: Option<&'static str>,
    /// Natürlicher Schlüssel für den ersten Abgleich (D5), eine oder mehrere Spalten, die alle
    /// gleich sein müssen (Change `kjezbk06-stammdaten-kataloge`, D3); leer = nie abgleichen
    /// (Konten) oder der Schlüssel ist ohnehin gleich ([`Schluessel::Spalte`], [`Schluessel::Org`]).
    pub natuerlich: &'static [&'static str],
    /// Spalte und Wert, mit denen eine verwendete Zeile stillgelegt wird, wenn die Quelle sie
    /// löscht; `None` = die Zeile wird gelöscht.
    pub stilllegen: Option<(&'static str, &'static str)>,
    /// Nur dieser Teil der Tabelle ist die Art, als SQL-Bedingung über ihre Spalten (D2 der Change
    /// `kjezbk06-stammdaten-kataloge`): Sprechgruppen nur im Org-Katalog. Gilt beim Liefern, im
    /// ersten Abgleich und in den Log-Triggern der Migration; eine Konstante dieser Datei.
    pub bereich: Option<&'static str>,
    /// Markierung, die es je Org nur einmal gibt (`ist_vorgabe`, `zustaendig`). Trägt die gelieferte
    /// Zeile sie, verlieren die übrigen Zeilen der Org sie bei der Übernahme (D4 der Change
    /// `kjezbk06-stammdaten-kataloge`).
    pub exklusiv: Option<&'static str>,
    pub unterlisten: &'static [Unterliste],
}

const FAHRZEUG: StammdatenArt = StammdatenArt::Fahrzeug;
const PERSONAL: StammdatenArt = StammdatenArt::Personal;
const MATERIAL: StammdatenArt = StammdatenArt::Material;
const SCHICHTMODELL: StammdatenArt = StammdatenArt::Schichtmodell;
const EINSATZ_VORLAGE: StammdatenArt = StammdatenArt::EinsatzVorlage;

/// Reihenfolge der Übernahme: wer verwiesen wird, kommt vorher. Verweise auf die eigene Art
/// (Qualifikation, Vorlage) setzt erst der zweite Durchgang.
pub const BESCHREIBUNGEN: &[ArtBeschreibung] = &[
    ArtBeschreibung {
        art: StammdatenArt::Konto,
        tabelle: "benutzer",
        schluessel: Schluessel::Id,
        spalten: &[
            "benutzername",
            "anzeigename",
            "system_rolle",
            "org_rolle",
            "aktiv",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &[],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::OrgEinstellungen,
        tabelle: "org_einstellungen",
        schluessel: Schluessel::Org,
        spalten: &[
            "zeitzone",
            "zeitdarstellung",
            "einheiten",
            "koordinatenformat",
            "retention_dauer_tage",
            "etb_nummer_praefix",
            "meldung_nummer_praefix",
            "auftrag_nummer_praefix",
            "meldung_bestaetigung_frist_min",
            "auftrag_quittierung_frist_min",
            "auto_etb_eintraege",
            "geocoder_url",
            "rueckmeldung_frist_min",
            "einsatz_nummer_praefix",
            "skelett_dauer_tage",
            "nachbereitung_tage",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &[],
        stilllegen: None,
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::ModulEinstellung,
        tabelle: "org_modul_einstellung",
        schluessel: Schluessel::Spalte("modul_key"),
        spalten: &["benoetigte_rolle", "sichtbar"],
        verweise: &[],
        quali_soll: None,
        natuerlich: &[],
        stilllegen: None,
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::Fuehrungsfunktion,
        tabelle: "org_fuehrungsfunktion",
        schluessel: Schluessel::Spalte("funktion"),
        spalten: &["label", "aktiv"],
        verweise: &[],
        quali_soll: None,
        natuerlich: &[],
        stilllegen: None,
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::FahrzeugStatus,
        tabelle: "fahrzeug_status",
        schluessel: Schluessel::Id,
        spalten: &[
            "label",
            "kategorie",
            "farbe",
            "fms_anker",
            "sortier",
            "aktiv",
            "zeitachse_marke",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["label"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::PersonalStatus,
        tabelle: "personal_status",
        schluessel: Schluessel::Id,
        spalten: &[
            "label",
            "kategorie",
            "farbe",
            "sortier",
            "aktiv",
            "zeitachse_marke",
            "pause",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["label"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::Qualifikation,
        tabelle: "qualifikation",
        schluessel: Schluessel::Id,
        spalten: &["label", "sortier", "aktiv", "schliesst_ein_id"],
        verweise: &[Verweis {
            spalte: "schliesst_ein_id",
            ziel: StammdatenArt::Qualifikation,
        }],
        quali_soll: None,
        natuerlich: &["label"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::EinheitTyp,
        tabelle: "einheit_typ",
        schluessel: Schluessel::Id,
        spalten: &[
            "label",
            "soll_fuehrer",
            "soll_unterfuehrer",
            "soll_mannschaft",
            "sortier",
            "aktiv",
            "quali_soll",
        ],
        verweise: &[],
        quali_soll: Some("quali_soll"),
        natuerlich: &["label"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: FAHRZEUG,
        tabelle: "fahrzeug",
        schluessel: Schluessel::Id,
        spalten: &[
            "funkrufname",
            "fahrzeugtyp",
            "traegerorganisation",
            "kennzeichen",
            "opta",
            "standort",
            "fms_issi",
            "sondersignal",
            "tragenkapazitaet",
            "staerke_fuehrer",
            "staerke_unterfuehrer",
            "staerke_mannschaft",
            "bemerkung",
            "dienststatus",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["funkrufname"],
        stilllegen: Some(("dienststatus", "ausser_dienst")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: MATERIAL,
        tabelle: "material",
        schluessel: Schluessel::Id,
        spalten: &[
            "bezeichnung",
            "kategorie",
            "bestandsnummer",
            "traegerorganisation",
            "standort",
            "bemerkung",
            "dienststatus",
            "art",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["bestandsnummer"],
        stilllegen: Some(("dienststatus", "ausser_dienst")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: PERSONAL,
        tabelle: "personal",
        schluessel: Schluessel::Id,
        spalten: &[
            "benutzer_id",
            "name",
            "personalnummer",
            "traegerorganisation",
            "telefon",
            "staerke_position",
            "bemerkung",
            "dienststatus",
        ],
        verweise: &[Verweis {
            spalte: "benutzer_id",
            ziel: StammdatenArt::Konto,
        }],
        quali_soll: None,
        natuerlich: &["personalnummer"],
        stilllegen: Some(("dienststatus", "ausser_dienst")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[Unterliste {
            tabelle: "personal_qualifikation",
            eltern_spalte: "personal_id",
            spalten: &["qualifikation_id"],
            verweise: &[Verweis {
                spalte: "qualifikation_id",
                ziel: StammdatenArt::Qualifikation,
            }],
        }],
    },
    ArtBeschreibung {
        art: StammdatenArt::EinheitVorlage,
        tabelle: "einheit_vorlage",
        schluessel: Schluessel::Id,
        spalten: &[
            "name",
            "typ_id",
            "ueber_vorlage_id",
            "funkrufname",
            "tz_fachaufgabe",
            "tz_organisation",
            "soll_fuehrer",
            "soll_unterfuehrer",
            "soll_mannschaft",
            "bemerkung",
            "sortier",
            "aktiv",
            "quali_soll",
        ],
        verweise: &[
            Verweis {
                spalte: "typ_id",
                ziel: StammdatenArt::EinheitTyp,
            },
            Verweis {
                spalte: "ueber_vorlage_id",
                ziel: StammdatenArt::EinheitVorlage,
            },
        ],
        quali_soll: Some("quali_soll"),
        natuerlich: &["name"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[
            Unterliste {
                tabelle: "einheit_vorlage_fahrzeug",
                eltern_spalte: "vorlage_id",
                spalten: &["fahrzeug_id", "sortier"],
                verweise: &[Verweis {
                    spalte: "fahrzeug_id",
                    ziel: FAHRZEUG,
                }],
            },
            Unterliste {
                tabelle: "einheit_vorlage_personal",
                eltern_spalte: "vorlage_id",
                spalten: &["personal_id", "fahrzeug_id", "staerke_position"],
                verweise: &[
                    Verweis {
                        spalte: "personal_id",
                        ziel: PERSONAL,
                    },
                    Verweis {
                        spalte: "fahrzeug_id",
                        ziel: FAHRZEUG,
                    },
                ],
            },
            Unterliste {
                tabelle: "einheit_vorlage_material",
                eltern_spalte: "vorlage_id",
                spalten: &["material_id", "menge", "fahrzeug_id", "sortier"],
                verweise: &[
                    Verweis {
                        spalte: "material_id",
                        ziel: MATERIAL,
                    },
                    Verweis {
                        spalte: "fahrzeug_id",
                        ziel: FAHRZEUG,
                    },
                ],
            },
        ],
    },
    // ── Übrige Kataloge (LLH-1613, Change `kjezbk06-stammdaten-kataloge`, D1) ──
    ArtBeschreibung {
        art: SCHICHTMODELL,
        tabelle: "schichtmodell",
        schluessel: Schluessel::Id,
        spalten: &[
            "bezeichnung",
            "typ",
            "rhythmus_minuten",
            "wechselzeiten",
            "mindestdauer_minuten",
            "vorwarnung_minuten",
            "planungsvorlauf_minuten",
            "ist_vorgabe",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["bezeichnung"],
        stilllegen: None,
        bereich: None,
        exklusiv: Some("ist_vorgabe"),
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: EINSATZ_VORLAGE,
        tabelle: "einsatz_vorlage",
        schluessel: Schluessel::Id,
        spalten: &["bezeichnung", "einsatzart", "sortier", "schichtmodell_id"],
        verweise: &[Verweis {
            spalte: "schichtmodell_id",
            ziel: SCHICHTMODELL,
        }],
        quali_soll: None,
        natuerlich: &["bezeichnung"],
        stilllegen: None,
        bereich: None,
        exklusiv: None,
        unterlisten: &[Unterliste {
            tabelle: "einsatz_vorlage_modul_aus",
            eltern_spalte: "vorlage_id",
            spalten: &["modul_key"],
            verweise: &[],
        }],
    },
    ArtBeschreibung {
        art: StammdatenArt::StichwortVorschlag,
        tabelle: "einsatz_stichwort_vorschlag",
        schluessel: Schluessel::Id,
        spalten: &["text", "sortier", "vorlage_id"],
        verweise: &[Verweis {
            spalte: "vorlage_id",
            ziel: EINSATZ_VORLAGE,
        }],
        quali_soll: None,
        natuerlich: &["text"],
        stilllegen: None,
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::VerpflegungVorlage,
        tabelle: "verpflegung_vorlage",
        schluessel: Schluessel::Id,
        spalten: &["bezeichnung", "beginn", "ende", "verpflegungsart", "aktiv"],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["bezeichnung"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::Sprechgruppe,
        tabelle: "sprechgruppe",
        schluessel: Schluessel::Id,
        spalten: &[
            "bezeichnung",
            "betriebsart",
            "hinweis",
            "aktiv",
            "sortier",
            "netz",
            "sicherheit",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["betriebsart", "bezeichnung"],
        stilllegen: Some(("aktiv", "0")),
        bereich: Some("einsatz_id IS NULL"),
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::EtbBaustein,
        tabelle: "etb_baustein",
        schluessel: Schluessel::Id,
        spalten: &[
            "label",
            "typ",
            "inhalt",
            "meldeweg",
            "veranlassung",
            "sortier",
            "aktiv",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["label"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
    ArtBeschreibung {
        art: StammdatenArt::ExterneStelle,
        tabelle: "org_externe_stelle",
        schluessel: Schluessel::Id,
        spalten: &[
            "bezeichnung",
            "art",
            "rufnummer",
            "funkrufname",
            "aktiv",
            "zustaendig",
        ],
        verweise: &[],
        quali_soll: None,
        natuerlich: &["bezeichnung"],
        stilllegen: Some(("aktiv", "0")),
        bereich: None,
        exklusiv: Some("zustaendig"),
        unterlisten: &[],
    },
    // `geaendert_at` ist NOT NULL ohne Vorgabe: der Zeitpunkt des Hubs geht mit (D1).
    ArtBeschreibung {
        art: StammdatenArt::UnterkunftRichtwert,
        tabelle: "org_unterkunft_richtwert",
        schluessel: Schluessel::Spalte("schluessel"),
        spalten: &["wert", "geaendert_at"],
        verweise: &[],
        quali_soll: None,
        natuerlich: &[],
        stilllegen: None,
        bereich: None,
        exklusiv: None,
        unterlisten: &[],
    },
];

/// Die Beschreibung einer Art.
pub fn beschreibung(art: StammdatenArt) -> &'static ArtBeschreibung {
    BESCHREIBUNGEN
        .iter()
        .find(|b| b.art == art)
        .expect("jede Art ist beschrieben (Test `jede_art_ist_genau_einmal_beschrieben`)")
}

/// Rang in der Übernahme (Position in [`BESCHREIBUNGEN`]).
pub fn rang(art: StammdatenArt) -> usize {
    BESCHREIBUNGEN
        .iter()
        .position(|b| b.art == art)
        .unwrap_or(usize::MAX)
}

/// `json_object('a', a, 'b', b, …)` über die Spalten, für Lieferungen (D2). Die Spalten sind
/// Konstanten dieser Datei, kein Wert von außen.
pub fn json_object_sql(spalten: &[&str], praefix: &str) -> String {
    let teile: Vec<String> = spalten
        .iter()
        .map(|s| format!("'{s}', {praefix}{s}"))
        .collect();
    format!("json_object({})", teile.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn jede_art_ist_genau_einmal_beschrieben() {
        for art in StammdatenArt::ALLE {
            assert_eq!(
                BESCHREIBUNGEN.iter().filter(|b| b.art == art).count(),
                1,
                "{art:?}"
            );
        }
    }

    #[test]
    fn verweise_zeigen_nie_auf_eine_spaetere_art_ausser_auf_sich_selbst() {
        for b in BESCHREIBUNGEN {
            let alle = b
                .verweise
                .iter()
                .chain(b.unterlisten.iter().flat_map(|u| u.verweise.iter()));
            for v in alle {
                assert!(
                    v.ziel == b.art || rang(v.ziel) < rang(b.art),
                    "{:?} verweist auf {:?}",
                    b.art,
                    v.ziel
                );
            }
        }
    }

    #[test]
    fn verweise_und_quali_soll_stehen_in_den_spalten() {
        for b in BESCHREIBUNGEN {
            let spalten: HashSet<_> = b.spalten.iter().collect();
            for v in b.verweise {
                assert!(spalten.contains(&v.spalte), "{:?}.{}", b.art, v.spalte);
            }
            if let Some(q) = b.quali_soll {
                assert!(spalten.contains(&q), "{:?}.{q}", b.art);
            }
            for n in b.natuerlich {
                assert!(spalten.contains(n), "{:?}.{n}", b.art);
            }
            if let Some(x) = b.exklusiv {
                assert!(spalten.contains(&x), "{:?}.{x}", b.art);
            }
            for u in b.unterlisten {
                let us: HashSet<_> = u.spalten.iter().collect();
                for v in u.verweise {
                    assert!(us.contains(&v.spalte), "{}.{}", u.tabelle, v.spalte);
                }
            }
        }
    }

    /// Jede beschriebene Tabelle hat Log- und Schutz-Trigger (ein Neubau einer Tabelle verliert
    /// sie still), jede Spalte gibt es, und keine andere Tabelle schreibt ins Log.
    #[tokio::test]
    async fn trigger_und_spalten_passen_zur_beschreibung() {
        let pool = crate::db::test_pool().await;
        let trigger: Vec<(String, String)> =
            sqlx::query_as("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger'")
                .fetch_all(&pool)
                .await
                .unwrap();
        let hat = |name: &str| trigger.iter().any(|(n, _)| n == name);
        let mut tabellen: Vec<&str> = Vec::new();
        for b in BESCHREIBUNGEN {
            tabellen.push(b.tabelle);
            tabellen.extend(b.unterlisten.iter().map(|u| u.tabelle));
        }
        for t in &tabellen {
            for endung in ["log_i", "log_u", "log_d", "schutz_u", "schutz_d"] {
                assert!(hat(&format!("{t}_{endung}")), "Trigger {t}_{endung} fehlt");
            }
        }
        // Unterlisten brauchen zusätzlich den Schutz beim Einfügen: sonst hängte jeder lokale
        // Schreibweg Einträge an eine Zeile vom Hub.
        for u in BESCHREIBUNGEN.iter().flat_map(|b| b.unterlisten) {
            let t = u.tabelle;
            assert!(hat(&format!("{t}_schutz_i")), "Trigger {t}_schutz_i fehlt");
        }
        for b in BESCHREIBUNGEN {
            let spalten: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT name FROM pragma_table_info('{}')",
                b.tabelle
            )))
            .fetch_all(&pool)
            .await
            .unwrap();
            for s in b.spalten {
                assert!(spalten.iter().any(|x| x == s), "{}.{s}", b.tabelle);
            }
            for u in b.unterlisten {
                let us: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                    "SELECT name FROM pragma_table_info('{}')",
                    u.tabelle
                )))
                .fetch_all(&pool)
                .await
                .unwrap();
                for s in u.spalten.iter().chain([&u.eltern_spalte]) {
                    assert!(us.iter().any(|x| x == s), "{}.{s}", u.tabelle);
                }
            }
        }
        // Log-Trigger nur an beschriebenen Tabellen und an den Passkeys (sie ändern, ob die
        // Geheimnisse eines Admins hinausgehen, D7).
        for (name, tbl) in &trigger {
            if name.ends_with("_log_i") || name.ends_with("_log_u") || name.ends_with("_log_d") {
                assert!(
                    tabellen.contains(&tbl.as_str()) || tbl == "webauthn_credential",
                    "{name} an {tbl}"
                );
            }
        }
    }
}
