//! Einheitstests des Verteilers (LLH-1172): Wortlaut, `an` und Lesen aus SQLite-JSON. Die Wege
//! über die Routen (Ersetzen, Freigabe, Fortschreiben) belegt `tests/dokument_verteiler.rs`.

use super::*;
use crate::befehl::Befehl;
use crate::lagebericht::Lagebericht;
use crate::presse::mitteilung::Pressemitteilung;

fn eintrag(snap: &str) -> VerteilerEintragAnzeige {
    VerteilerEintragAnzeige {
        id: 1,
        empfaenger_typ: EmpfaengerTyp::Abschnitt,
        abschnitt_id: Some(1),
        einheit_id: None,
        funktion: None,
        funktion_text: None,
        extern_kategorie: None,
        extern_bezeichnung: None,
        snap_anzeige: snap.into(),
    }
}

#[test]
fn befehl_und_lagebericht_tragen_einen_verteiler_die_pressemitteilung_nicht() {
    assert_eq!(
        Befehl::VERTEILER,
        Some(&VerteilerTabelle {
            tabelle: "befehl_verteiler",
            dokument_spalte: "befehl_id",
        })
    );
    assert_eq!(
        Lagebericht::VERTEILER,
        Some(&VerteilerTabelle {
            tabelle: "lagebericht_verteiler",
            dokument_spalte: "lagebericht_id",
        })
    );
    assert_eq!(Pressemitteilung::VERTEILER, None);
    assert_eq!(json_spalte::<Pressemitteilung>("l"), "'[]'");
}

#[test]
fn ohne_verteiler_kein_abschnitt_und_kein_an() {
    assert_eq!(render_abschnitt(&[]), "");
    assert_eq!(an_fuer(&[]), None);
}

#[test]
fn abschnitt_verteiler_nennt_jeden_eintrag_als_listenpunkt() {
    let v = [eintrag("EA Süd"), eintrag("S3 Einsatz")];
    assert_eq!(
        render_abschnitt(&v),
        "\n## Verteiler\n- EA Süd\n- S3 Einsatz\n"
    );
    assert_eq!(an_fuer(&v).as_deref(), Some("EA Süd, S3 Einsatz"));
}

#[test]
fn langer_verteiler_wird_im_an_gekappt_aber_im_wortlaut_vollstaendig_genannt() {
    let v: Vec<_> = (0..40)
        .map(|i| eintrag(&format!("Einheit mit langem Namen Nummer {i:02}")))
        .collect();
    let an = an_fuer(&v).unwrap();
    assert!(an.chars().count() <= crate::etb::PARTEI_MAX, "{an}");
    assert!(an.contains(" … und "), "{an}");
    assert!(an.ends_with(" weitere"), "{an}");
    let wortlaut = render_abschnitt(&v);
    assert_eq!(wortlaut.matches("\n- ").count(), 40);
}

#[test]
fn json_wird_mit_typ_und_kategorie_gelesen() {
    let json = r#"[{"id":7,"empfaenger_typ":"extern","abschnitt_id":null,"einheit_id":null,
        "funktion":null,"funktion_text":null,"extern_kategorie":"leitstelle",
        "extern_bezeichnung":"ILS Musterstadt","snap_anzeige":"ILS Musterstadt"},
        {"id":8,"empfaenger_typ":"funktion","abschnitt_id":null,"einheit_id":null,
        "funktion":"s3","funktion_text":null,"extern_kategorie":null,
        "extern_bezeichnung":null,"snap_anzeige":"S3 Einsatz"}]"#;
    let v = aus_json(json).unwrap();
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].empfaenger_typ, EmpfaengerTyp::Extern);
    assert_eq!(v[0].extern_kategorie, Some(AdressatKategorie::Leitstelle));
    assert_eq!(v[1].funktion.as_deref(), Some("s3"));
    assert_eq!(aus_json("[]").unwrap(), vec![]);
}

#[test]
fn unbekannter_typ_im_json_ist_ein_datenfehler() {
    let json = r#"[{"id":1,"empfaenger_typ":"person","abschnitt_id":null,"einheit_id":null,
        "funktion":null,"funktion_text":null,"extern_kategorie":null,
        "extern_bezeichnung":null,"snap_anzeige":"x"}]"#;
    // `person` ist ein gültiger EmpfaengerTyp; nur ein ganz fremder Wert scheitert.
    assert!(aus_json(json).is_ok());
    let kaputt = json.replace("\"person\"", "\"zug\"");
    assert!(matches!(aus_json(&kaputt), Err(AppError::Internal(_))));
}
