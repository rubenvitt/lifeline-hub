use super::*;

#[test]
fn reihenfolge_ist_die_des_katalogs() {
    let wire: Vec<&str> = Fuehrungsfunktion::ALLE.iter().map(|f| f.as_str()).collect();
    assert_eq!(
        wire,
        [
            "el",
            "s1",
            "s2",
            "s3",
            "s4",
            "s5",
            "s6",
            "s7",
            "fuehrungshilfspersonal",
            "fachberater"
        ]
    );
}

#[test]
fn art_je_code() {
    assert_eq!(Fuehrungsfunktion::El.art(), FunktionsArt::Leitung);
    for f in [
        Fuehrungsfunktion::S1,
        Fuehrungsfunktion::S6,
        Fuehrungsfunktion::S7,
    ] {
        assert_eq!(f.art(), FunktionsArt::Sachgebiet, "{f:?}");
    }
    assert_eq!(
        Fuehrungsfunktion::Fuehrungshilfspersonal.art(),
        FunktionsArt::Fuehrungshilfspersonal
    );
    assert_eq!(
        Fuehrungsfunktion::Fachberater.art(),
        FunktionsArt::Fachberater
    );
}

#[test]
fn sachgebiet_nur_fuer_s1_bis_s6() {
    for sg in Sachgebiet::ALLE {
        let f = Fuehrungsfunktion::aus_sachgebiet(sg);
        assert_eq!(f.sachgebiet(), Some(sg));
    }
    for f in [
        Fuehrungsfunktion::El,
        Fuehrungsfunktion::S7,
        Fuehrungsfunktion::Fuehrungshilfspersonal,
        Fuehrungsfunktion::Fachberater,
    ] {
        assert_eq!(f.sachgebiet(), None, "{f:?}");
    }
}

#[test]
fn standardlabel_der_sachgebiete_kommt_aus_dem_stab() {
    for sg in Sachgebiet::ALLE {
        assert_eq!(
            Fuehrungsfunktion::aus_sachgebiet(sg).standard_label(),
            sg.label()
        );
    }
    assert_eq!(
        Fuehrungsfunktion::S7.standard_label(),
        "Psychosoziale Notfallversorgung"
    );
}

#[test]
fn anzeige_traegt_nie_einen_namen_sondern_label_und_bezeichnung() {
    let k = Labelkarte::standard();
    assert_eq!(k.anzeige(Fuehrungsfunktion::S3, None), "S3 Einsatz");
    assert_eq!(k.anzeige(Fuehrungsfunktion::El, None), "Einsatzleitung");
    assert_eq!(
        k.anzeige(Fuehrungsfunktion::Fachberater, Some("THW")),
        "Fachberater: THW"
    );
    assert_eq!(
        k.vorbelegung(Fuehrungsfunktion::S2, None),
        "S2",
        "Vorbelegung ist das Kürzel"
    );
    assert_eq!(
        k.vorbelegung(Fuehrungsfunktion::Fuehrungshilfspersonal, Some("Lagekarte")),
        "Führungshilfspersonal: Lagekarte"
    );
}

#[test]
fn mandantenlabel_gilt_in_anzeige_und_katalog() {
    let mut k = Labelkarte::standard();
    k.ueberschrieben
        .insert(Fuehrungsfunktion::S4, "Versorgung (Logistik)".into());
    assert_eq!(
        k.anzeige(Fuehrungsfunktion::S4, None),
        "S4 Versorgung (Logistik)"
    );
    let s4 = k
        .katalog()
        .into_iter()
        .find(|e| e.funktion == Fuehrungsfunktion::S4)
        .unwrap();
    assert_eq!(s4.label, "Versorgung (Logistik)");
    assert_eq!(s4.standard_label, "Versorgung");
}

#[test]
fn katalog_zeigt_s7_nur_eingeschaltet() {
    let mut k = Labelkarte::standard();
    assert!(!k
        .katalog()
        .iter()
        .any(|e| e.funktion == Fuehrungsfunktion::S7));
    k.s7_aktiv = true;
    assert!(k
        .katalog()
        .iter()
        .any(|e| e.funktion == Fuehrungsfunktion::S7));
}

fn status(e: AppError) -> u16 {
    match e {
        AppError::Validation(_) => 400,
        AppError::UnprocessableEntity(_) => 422,
        andere => panic!("unerwartet: {andere:?}"),
    }
}

#[test]
fn pruefe_funktion_unbekannter_code_ist_400() {
    assert_eq!(
        status(pruefe_funktion(Some("s9"), None, true).unwrap_err()),
        400
    );
}

#[test]
fn pruefe_funktion_fachberater_ohne_bezeichnung_ist_422() {
    assert_eq!(
        status(pruefe_funktion(Some("fachberater"), Some("  "), false).unwrap_err()),
        422
    );
}

#[test]
fn pruefe_funktion_sachgebiet_mit_text_ist_422() {
    assert_eq!(
        status(pruefe_funktion(Some("s3"), Some("Müller"), false).unwrap_err()),
        422
    );
}

#[test]
fn pruefe_funktion_s7_nur_eingeschaltet() {
    assert_eq!(
        status(pruefe_funktion(Some("s7"), None, false).unwrap_err()),
        422
    );
    assert_eq!(
        pruefe_funktion(Some("s7"), None, true).unwrap().funktion,
        Some(Fuehrungsfunktion::S7)
    );
}

#[test]
fn pruefe_funktion_text_zu_lang_ist_400() {
    let lang = "x".repeat(TEXT_MAX + 1);
    assert_eq!(
        status(pruefe_funktion(None, Some(&lang), false).unwrap_err()),
        400
    );
}

#[test]
fn freitext_s3_bleibt_freitext_ohne_code() {
    let a = pruefe_funktion(None, Some(" S3 "), false).unwrap();
    assert_eq!(
        a,
        Funktionsangabe {
            funktion: None,
            text: Some("S3".into())
        },
        "kein Rückschluss vom Freitext auf einen Code"
    );
}

#[test]
fn code_mit_bezeichnung_wird_getrimmt() {
    let a = pruefe_funktion(Some("fachberater"), Some(" THW "), false).unwrap();
    assert_eq!(a.funktion, Some(Fuehrungsfunktion::Fachberater));
    assert_eq!(a.text.as_deref(), Some("THW"));
}

#[test]
fn leer_ist_leer() {
    assert!(pruefe_funktion(None, Some(""), false).unwrap().ist_leer());
    assert!(pruefe_funktion(Some(""), None, false).unwrap().ist_leer());
}

/// Die vier CHECK-Listen der Migration 0128 müssen genau `ALLE` tragen — sonst lehnt die DB
/// einen gültigen Code ab (oder nimmt einen ungültigen an).
#[tokio::test]
async fn check_listen_entsprechen_dem_katalog() {
    let pool = crate::db::test_pool().await;
    let erwartet: Vec<&str> = Fuehrungsfunktion::ALLE.iter().map(|f| f.as_str()).collect();
    for (tabelle, spalte) in [
        ("erinnerung", "empfaenger_funktion_code"),
        ("auftrag_empfaenger", "funktion"),
        ("einsatz_mitgliedschaft", "fuehrungsfunktion"),
        ("org_fuehrungsfunktion", "funktion"),
    ] {
        let sql: String =
            sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
                .bind(tabelle)
                .fetch_one(&pool)
                .await
                .unwrap();
        let start = sql
            .find(&format!("CHECK ({spalte} IN ("))
            .unwrap_or_else(|| panic!("{tabelle}.{spalte}: CHECK fehlt"));
        let rest = &sql[start..];
        let ende = rest.find("))").unwrap();
        let liste: Vec<String> = rest[..ende]
            .split('(')
            .nth(2)
            .unwrap()
            .split(',')
            .map(|w| w.trim().trim_matches('\'').to_string())
            .collect();
        assert_eq!(liste, erwartet, "{tabelle}.{spalte}");
    }
}
