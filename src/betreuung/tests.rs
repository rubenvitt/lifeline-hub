//! Reine Tests des Fachkerns (LFH-639): Enum-Rundreise und ETB-Texte je Vorgang.

use super::etb_text::*;
use super::*;
use axum::http::StatusCode;

#[test]
fn enums_parse_rund() {
    for e in Erhebung::ALLE {
        assert_eq!(Erhebung::parse(e.as_str()), Some(e));
        assert_eq!(
            serde_json::to_value(e).unwrap(),
            e.as_str(),
            "Wire == as_str"
        );
    }
    for r in Raeumungszustand::ALLE {
        assert_eq!(Raeumungszustand::parse(r.as_str()), Some(r));
        assert_eq!(serde_json::to_value(r).unwrap(), r.as_str());
    }
    for a in BetreuungsstelleArt::ALLE {
        assert_eq!(BetreuungsstelleArt::parse(a.as_str()), Some(a));
        assert_eq!(serde_json::to_value(a).unwrap(), a.as_str());
    }
    for s in BetreuungsstelleStatus::ALLE {
        assert_eq!(BetreuungsstelleStatus::parse(s.as_str()), Some(s));
        assert_eq!(serde_json::to_value(s).unwrap(), s.as_str());
    }
    assert_eq!(Erhebung::parse("gezählt"), None, "Wire ohne Umlaut");
    assert_eq!(Raeumungszustand::parse("evakuiert"), None);
    assert_eq!(BetreuungsstelleArt::parse("uhs"), None);
    assert_eq!(BetreuungsstelleStatus::parse("aufgeloest"), None);
}

/// Spec „Unbekannter Räumungszustand“ / „Unbekannte Art“: 400, nicht 422.
#[test]
fn unbekannter_enum_wert_ist_400() {
    let e = enum_wert::<Raeumungszustand>("evakuiert").unwrap_err();
    assert_eq!(e.status(), StatusCode::BAD_REQUEST);
    let e = enum_wert::<BetreuungsstelleArt>("zelt").unwrap_err();
    assert_eq!(e.status(), StatusCode::BAD_REQUEST);
    let e = enum_wert::<Erhebung>("").unwrap_err();
    assert_eq!(e.status(), StatusCode::BAD_REQUEST);
    let e = enum_wert::<BetreuungsstelleStatus>("offen").unwrap_err();
    assert_eq!(e.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        enum_wert::<Raeumungszustand>("geraeumt").unwrap(),
        Raeumungszustand::Geraeumt
    );
}

#[test]
fn raeumung_etb_typ_nach_d5() {
    assert_eq!(Raeumungszustand::Angeordnet.etb_typ(), "entscheidung");
    assert_eq!(Raeumungszustand::Aufgehoben.etb_typ(), "entscheidung");
    assert_eq!(Raeumungszustand::Laeuft.etb_typ(), "meldung");
    assert_eq!(Raeumungszustand::Geraeumt.etb_typ(), "meldung");
}

const X: &str = "Uferstraße 12–40";
const Y: &str = "Turnhalle Ost";

#[test]
fn text_bezirk_angelegt() {
    assert_eq!(
        bezirk_angelegt(X, 640, Erhebung::Geschaetzt),
        "Evakuierung Bezirk ‚Uferstraße 12–40‘ angeordnet, Plangröße 640 (geschätzt)."
    );
}

#[test]
fn text_plan_geaendert() {
    assert_eq!(
        plan_geaendert(X, 820, Erhebung::Gezaehlt, 640, Erhebung::Geschaetzt),
        "Plangröße Bezirk ‚Uferstraße 12–40‘ auf 820 (gezählt) gesetzt, vorher 640 (geschätzt)."
    );
}

#[test]
fn text_raeumung_je_zustand() {
    assert_eq!(
        raeumung_gewechselt(X, Raeumungszustand::Aufgehoben),
        "Evakuierung Bezirk ‚Uferstraße 12–40‘ aufgehoben."
    );
    assert_eq!(
        raeumung_gewechselt(X, Raeumungszustand::Angeordnet),
        "Evakuierung Bezirk ‚Uferstraße 12–40‘ angeordnet."
    );
    assert_eq!(
        raeumung_gewechselt(X, Raeumungszustand::Geraeumt),
        "Bezirk ‚Uferstraße 12–40‘ geräumt."
    );
    assert_eq!(
        raeumung_gewechselt(X, Raeumungszustand::Laeuft),
        "Bezirk ‚Uferstraße 12–40‘: Räumung läuft."
    );
}

#[test]
fn text_bezirk_geaendert_nennt_nur_felder() {
    assert_eq!(
        bezirk_geaendert(
            X,
            BezirkStammdaten {
                bezeichnung_vorher: Some("Uferstraße"),
                abschnitt: true,
                weitere_angaben: true,
            }
        ),
        "Bezirk ‚Uferstraße 12–40‘ geändert: Bezeichnung (vorher ‚Uferstraße‘), Einsatzabschnitt, weitere Angaben."
    );
    assert_eq!(
        bezirk_geaendert(
            X,
            BezirkStammdaten {
                weitere_angaben: true,
                ..Default::default()
            }
        ),
        "Bezirk ‚Uferstraße 12–40‘ geändert: weitere Angaben."
    );
}

#[test]
fn text_bezirk_storniert() {
    assert_eq!(
        bezirk_storniert(X),
        "Evakuierungsbezirk ‚Uferstraße 12–40‘ storniert."
    );
}

#[test]
fn text_stand_gemeldet_mit_und_ohne_vorwert() {
    assert_eq!(
        stand_gemeldet(X, 480, Erhebung::Gezaehlt, Some(212), 640),
        "Bezirk ‚Uferstraße 12–40‘: 480 evakuiert (gezählt), vorher 212, Plan 640."
    );
    assert_eq!(
        stand_gemeldet(X, 212, Erhebung::Geschaetzt, None, 640),
        "Bezirk ‚Uferstraße 12–40‘: 212 evakuiert (geschätzt), Plan 640."
    );
}

#[test]
fn text_stand_zurueckgenommen() {
    assert_eq!(
        stand_zurueckgenommen(X, Some(212)),
        "Meldung zurückgenommen, Stand Bezirk ‚Uferstraße 12–40‘ wieder 212."
    );
    assert_eq!(
        stand_zurueckgenommen(X, None),
        "Meldung zurückgenommen, Bezirk ‚Uferstraße 12–40‘ ohne Standmeldung."
    );
}

#[test]
fn text_stelle_angelegt() {
    assert_eq!(
        stelle_angelegt(Y, BetreuungsstelleArt::Notunterkunft, Some(150)),
        "Betreuungsstelle ‚Turnhalle Ost‘ (Notunterkunft) angelegt, Kapazität 150."
    );
    assert_eq!(
        stelle_angelegt(Y, BetreuungsstelleArt::Anlaufstelle, None),
        "Betreuungsstelle ‚Turnhalle Ost‘ (Anlaufstelle) angelegt."
    );
}

#[test]
fn text_stelle_geaendert() {
    assert_eq!(
        stelle_geaendert(
            Y,
            StelleStammdaten {
                bezeichnung_vorher: Some("Turnhalle"),
                art: Some((
                    BetreuungsstelleArt::Betreuungsstelle,
                    BetreuungsstelleArt::Notunterkunft
                )),
                kapazitaet: Some((Some(150), Some(200))),
                abschnitt: true,
                weitere_angaben: true,
            }
        ),
        "Betreuungsstelle ‚Turnhalle Ost‘ geändert: Bezeichnung (vorher ‚Turnhalle‘), \
         Art Notunterkunft (vorher Betreuungsstelle), Kapazität 200 (vorher 150), \
         Einsatzabschnitt, weitere Angaben."
    );
    assert_eq!(
        stelle_geaendert(
            Y,
            StelleStammdaten {
                kapazitaet: Some((None, Some(80))),
                ..Default::default()
            }
        ),
        "Betreuungsstelle ‚Turnhalle Ost‘ geändert: Kapazität 80 (vorher ohne Angabe)."
    );
    assert_eq!(
        stelle_geaendert(
            Y,
            StelleStammdaten {
                kapazitaet: Some((Some(150), None)),
                ..Default::default()
            }
        ),
        "Betreuungsstelle ‚Turnhalle Ost‘ geändert: Kapazität ohne Angabe (vorher 150)."
    );
}

#[test]
fn text_stelle_status_und_storno() {
    assert_eq!(
        stelle_status(
            Y,
            BetreuungsstelleStatus::InBetrieb,
            BetreuungsstelleStatus::Vorbereitet
        ),
        "Betreuungsstelle ‚Turnhalle Ost‘: in Betrieb (vorher vorbereitet)."
    );
    assert_eq!(
        stelle_storniert(Y),
        "Betreuungsstelle ‚Turnhalle Ost‘ storniert."
    );
}

#[test]
fn text_belegung() {
    assert_eq!(
        belegung_gemeldet(Y, 89, Some(60), Some(150)),
        "Betreuungsstelle ‚Turnhalle Ost‘: 89 untergebracht, vorher 60, Kapazität 150."
    );
    assert_eq!(
        belegung_gemeldet(Y, 60, None, None),
        "Betreuungsstelle ‚Turnhalle Ost‘: 60 untergebracht."
    );
    assert_eq!(
        belegung_zurueckgenommen(Y, Some(60)),
        "Meldung zurückgenommen, Belegung Betreuungsstelle ‚Turnhalle Ost‘ wieder 60."
    );
    assert_eq!(
        belegung_zurueckgenommen(Y, None),
        "Meldung zurückgenommen, Betreuungsstelle ‚Turnhalle Ost‘ ohne Belegungsmeldung."
    );
}

/// D5: kein ETB-Text nennt Sammelstelle, Standort oder Notiz — weder ihren Inhalt (die
/// Funktionen nehmen ihn gar nicht an) noch das Feldwort.
#[test]
fn kein_text_nennt_sammelstelle_standort_notiz() {
    let alle = [
        bezirk_angelegt(X, 640, Erhebung::Geschaetzt),
        plan_geaendert(X, 820, Erhebung::Gezaehlt, 640, Erhebung::Geschaetzt),
        raeumung_gewechselt(X, Raeumungszustand::Geraeumt),
        bezirk_geaendert(
            X,
            BezirkStammdaten {
                bezeichnung_vorher: Some("Alt"),
                abschnitt: true,
                weitere_angaben: true,
            },
        ),
        bezirk_storniert(X),
        stand_gemeldet(X, 480, Erhebung::Gezaehlt, Some(212), 640),
        stand_zurueckgenommen(X, Some(212)),
        stelle_angelegt(Y, BetreuungsstelleArt::Notunterkunft, Some(150)),
        stelle_geaendert(
            Y,
            StelleStammdaten {
                weitere_angaben: true,
                abschnitt: true,
                ..Default::default()
            },
        ),
        stelle_status(
            Y,
            BetreuungsstelleStatus::Geschlossen,
            BetreuungsstelleStatus::InBetrieb,
        ),
        stelle_storniert(Y),
        belegung_gemeldet(Y, 89, Some(60), Some(150)),
        belegung_zurueckgenommen(Y, Some(60)),
    ];
    for t in &alle {
        let klein = t.to_lowercase();
        for wort in ["sammelstelle", "standort", "notiz"] {
            assert!(!klein.contains(wort), "{wort:?} in {t:?}");
        }
    }
}

/// „Keine Meldung“ fehlt auf dem Draht, statt `null` oder `0` zu sein (LFH-265).
#[test]
fn optionale_felder_fehlen_auf_dem_draht() {
    let b = EvakuierungsbezirkAnzeige {
        id: 1,
        einsatz_id: 2,
        abschnitt_id: None,
        abschnitt_name: None,
        bezeichnung: X.into(),
        plan_personen: 640,
        plan_erhebung: Erhebung::Geschaetzt,
        raeumung: Raeumungszustand::Angeordnet,
        sammelstelle: None,
        notiz: None,
        stand: None,
        storniert_at: None,
        angelegt_at: "2026-09-23 10:00:00".into(),
        geaendert_at: None,
    };
    let v = serde_json::to_value(&b).unwrap();
    let o = v.as_object().unwrap();
    for k in [
        "abschnitt_id",
        "abschnitt_name",
        "sammelstelle",
        "notiz",
        "stand",
        "storniert_at",
        "geaendert_at",
    ] {
        assert!(!o.contains_key(k), "{k} muss fehlen");
    }
    assert_eq!(o["raeumung"], "angeordnet");
    assert_eq!(o["plan_erhebung"], "geschaetzt");
}
