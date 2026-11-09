//! Repo-Tests der Registrierstelle (LLH-1612) — je Szenario der Spec `betreuung-registrierung`
//! und der geänderten Anforderungen von `betreuung-evakuierung` mindestens ein Test. Die
//! Schreibpfade laufen wie in der Route in `write_retry!`.

use super::*;
use crate::betreuung::repo::{
    self as stellen_repo, BelegungEingabe, StelleAenderung, StelleEingabe,
};
use crate::betreuung::{
    BelegungQuelle, Belegungsart, BetreuungsstelleArt, BetreuungsstelleStatus as Status,
};
use crate::write_retry;
use axum::http::StatusCode;

const STARTWERT: i64 = 1;
const ZEIT: &str = "2026-11-09 10:00:00";

struct Welt {
    pool: SqlitePool,
    b: i64,
    e: i64,
    e2: i64,
}

async fn welt() -> Welt {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();
    let b: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut ids = Vec::new();
    for name in ["Hochwasser", "Anderer Einsatz"] {
        ids.push(
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id",
            )
            .bind(name)
            .fetch_one(&pool)
            .await
            .unwrap(),
        );
    }
    Welt {
        pool,
        b,
        e: ids[0],
        e2: ids[1],
    }
}

async fn stelle(w: &Welt, e: i64, name: &str, art: Belegungsart) -> i64 {
    let eingabe = StelleEingabe {
        bezeichnung: name.into(),
        art: BetreuungsstelleArt::Notunterkunft,
        abschnitt_id: None,
        kapazitaet_personen: Some(150),
        standort: None,
        notiz: None,
        leitung: None,
        kontaktweg: None,
        lat: None,
        lon: None,
        belegungsart: Some(art),
    };
    let (pool, b) = (&w.pool, w.b);
    write_retry!(pool, |conn| {
        stellen_repo::stelle_anlegen_tx(conn, e, b, STARTWERT, &eingabe).await
    })
    .unwrap()
    .id
}

async fn aendern(w: &Welt, sid: i64, eingabe: StelleAenderung) -> Result<(), AppError> {
    let (pool, b, e) = (&w.pool, w.b, w.e);
    write_retry!(pool, |conn| {
        stellen_repo::stelle_aendern_tx(conn, e, sid, b, STARTWERT, &eingabe).await
    })
    .map(|_| ())
}

fn person(name: &str, kostform: Kostform) -> RegistrierPerson {
    RegistrierPerson {
        name: name.into(),
        vorname: None,
        geburtsdatum: None,
        geschlecht: None,
        herkunft_adresse: Some("Lindenweg 3".into()),
        kontakt: None,
        kostform,
        unvertraeglichkeiten: None,
        notiz: None,
    }
}

async fn registrieren(
    w: &Welt,
    sid: i64,
    haushalt_id: Option<i64>,
    personen: Vec<RegistrierPerson>,
) -> Result<Registriert, AppError> {
    let eingabe = RegistrierEingabe {
        haushalt_id,
        personen,
        zeitpunkt_at: ZEIT.into(),
        client_id: None,
    };
    let (pool, b, e) = (&w.pool, w.b, w.e);
    write_retry!(pool, |conn| {
        registrieren_tx(conn, e, sid, b, STARTWERT, &eingabe).await
    })
}

async fn abmelden(
    w: &Welt,
    sid: i64,
    haushalt_id: Option<i64>,
    person_ids: Vec<i64>,
) -> Result<Registriert, AppError> {
    let eingabe = AbmeldeEingabe {
        haushalt_id,
        person_ids,
        ziel: Some("zu Verwandten".into()),
        zeitpunkt_at: "2026-11-09 12:00:00".into(),
        client_id: None,
    };
    let (pool, b, e) = (&w.pool, w.b, w.e);
    write_retry!(pool, |conn| {
        abmelden_tx(conn, e, sid, b, STARTWERT, &eingabe).await
    })
}

async fn belegung(w: &Welt, sid: i64) -> Option<i64> {
    stellen_repo::stelle_laden(&w.pool, w.e, sid)
        .await
        .unwrap()
        .belegung
        .map(|m| m.belegt)
}

async fn etb_inhalte(w: &Welt) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
        .bind(w.e)
        .fetch_all(&w.pool)
        .await
        .unwrap()
}

fn status(e: AppError) -> StatusCode {
    e.status()
}

fn familie() -> Vec<RegistrierPerson> {
    vec![
        person("Weber", Kostform::Vegetarisch),
        person("Weber", Kostform::Normal),
        person("Weber", Kostform::SaeuglingKleinkind),
    ]
}

/// Szenario „Familie registrieren“.
#[tokio::test]
async fn familie_registrieren() {
    let w = welt().await;
    let sid = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Gezaehlt).await;
    let r = registrieren(&w, sid, None, familie()).await.unwrap();
    assert_eq!(r.person_ids.len(), 3);
    assert_eq!(
        r.etb_ids.len(),
        1,
        "genau ein ETB-Eintrag, keine Belegung (gezählt)"
    );

    let liste = liste(&w.pool, w.e, sid).await.unwrap();
    assert_eq!(liste.haushalte.len(), 1);
    let h = &liste.haushalte[0];
    assert_eq!(h.nummer, 1);
    assert_eq!(h.bezugsperson_id, Some(r.person_ids[0]));
    assert_eq!(h.bezugsperson_name.as_deref(), Some("Weber"));
    assert_eq!(h.personen.len(), 3);
    assert_eq!(h.personen[0].kostform, Some(Kostform::Vegetarisch));

    for pid in &r.person_ids {
        let p = crate::person::repo::laden(&w.pool, w.e, *pid)
            .await
            .unwrap();
        assert_eq!(p.status, crate::person::PersonStatus::Betroffen);
        assert_eq!(p.aktuelle_verbleib_art, Some(VerbleibArt::Notunterkunft));
        assert_eq!(p.aktuelle_verbleib_betreuungsstelle_id, Some(sid));
        assert_eq!(p.haushalt_nummer, Some(1));
        assert_eq!(p.herkunft_adresse.as_deref(), Some("Lindenweg 3"));
    }
    let etb = etb_inhalte(&w).await;
    let eintrag = etb.last().unwrap();
    assert!(eintrag.contains("‚Turnhalle Ost‘"), "{eintrag}");
    assert!(eintrag.contains("H-1"), "{eintrag}");
    assert!(eintrag.contains("3 Personen"), "{eintrag}");
    assert!(eintrag.contains("R-001, R-002, R-003"), "{eintrag}");
    assert!(!etb.iter().any(|t| t.contains("Weber")), "kein Name im ETB");
    assert_eq!(
        belegung(&w, sid).await,
        None,
        "gezählte Stelle meldet nicht selbst"
    );
}

/// Szenario „Person einem Haushalt anhängen“; die Nummern zählen je Einsatz weiter.
#[tokio::test]
async fn person_anhaengen_und_neuer_haushalt() {
    let w = welt().await;
    let sid = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Gezaehlt).await;
    let erste = registrieren(&w, sid, None, familie()).await.unwrap();
    let h1 = erste.haushalt_id.unwrap();
    registrieren(&w, sid, Some(h1), vec![person("Weber", Kostform::Vegan)])
        .await
        .unwrap();
    registrieren(&w, sid, None, vec![person("Yilmaz", Kostform::OhneSchwein)])
        .await
        .unwrap();
    let liste = liste(&w.pool, w.e, sid).await.unwrap();
    assert_eq!(liste.haushalte.len(), 2);
    assert_eq!(liste.haushalte[0].personen.len(), 4);
    assert_eq!(
        liste.haushalte[0].bezugsperson_id,
        Some(erste.person_ids[0])
    );
    assert_eq!(liste.haushalte[1].nummer, 2);
}

/// Szenario „Geschlossene oder stornierte Stelle“ und die 404 der Prüfkette.
#[tokio::test]
async fn pruefkette_der_registrierung() {
    let w = welt().await;
    let sid = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Gezaehlt).await;
    let fremd = stelle(&w, w.e2, "Fremde Halle", Belegungsart::Gezaehlt).await;
    let p = || vec![person("Weber", Kostform::Normal)];
    assert_eq!(
        status(registrieren(&w, fremd, None, p()).await.unwrap_err()),
        StatusCode::NOT_FOUND
    );
    let fremder_haushalt: i64 = sqlx::query_scalar(
        "INSERT INTO haushalt (einsatz_id, nummer, angelegt_von_id) VALUES (?, 1, ?) RETURNING id",
    )
    .bind(w.e2)
    .bind(w.b)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(
        status(
            registrieren(&w, sid, Some(fremder_haushalt), p())
                .await
                .unwrap_err()
        ),
        StatusCode::NOT_FOUND
    );
    aendern(
        &w,
        sid,
        StelleAenderung {
            status: Some(Status::Geschlossen),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        status(registrieren(&w, sid, None, p()).await.unwrap_err()),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (pool, b, e) = (&w.pool, w.b, w.e);
    write_retry!(pool, |conn| {
        stellen_repo::stelle_stornieren_tx(conn, e, sid, b, STARTWERT).await
    })
    .unwrap();
    assert_eq!(
        status(registrieren(&w, sid, None, p()).await.unwrap_err()),
        StatusCode::CONFLICT
    );
    let personen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(personen, 0, "niemand angelegt");
}

/// Szenarien „Auf namentlich umstellen“, „Registrierung meldet die Belegung“,
/// „Handmeldung an namentlicher Stelle“ und „Zurück auf gezählt“.
#[tokio::test]
async fn namentliche_stelle_meldet_selbst() {
    let w = welt().await;
    let sid = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Gezaehlt).await;
    let (pool, b, e) = (&w.pool, w.b, w.e);
    let melden = |belegt: i64| BelegungEingabe {
        belegt,
        zeitpunkt_at: "2026-11-09 09:00:00".into(),
        client_id: None,
    };
    let m89 = melden(89);
    write_retry!(pool, |conn| {
        stellen_repo::belegung_melden_tx(conn, e, sid, b, STARTWERT, &m89).await
    })
    .unwrap();
    registrieren(&w, sid, None, familie()).await.unwrap();
    assert_eq!(
        belegung(&w, sid).await,
        Some(89),
        "gezählt: Meldung bleibt führend"
    );

    aendern(
        &w,
        sid,
        StelleAenderung {
            belegungsart: Some(Belegungsart::Namentlich),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(belegung(&w, sid).await, Some(3));
    let verlauf = stellen_repo::belegung_verlauf(&w.pool, w.e, sid)
        .await
        .unwrap();
    assert_eq!(
        verlauf
            .iter()
            .map(|v| (v.belegt, v.quelle))
            .collect::<Vec<_>>(),
        vec![
            (3, BelegungQuelle::Registrierung),
            (89, BelegungQuelle::Meldung)
        ]
    );

    let r = registrieren(&w, sid, None, vec![person("Yilmaz", Kostform::Normal)])
        .await
        .unwrap();
    assert!(r.belegung_nachgefuehrt);
    assert_eq!(belegung(&w, sid).await, Some(4));
    let etb = etb_inhalte(&w).await;
    assert!(
        etb.last()
            .unwrap()
            .contains("4 untergebracht (aus der Registrierung)"),
        "{etb:?}"
    );

    let m40 = melden(40);
    let fehler = write_retry!(pool, |conn| {
        stellen_repo::belegung_melden_tx(conn, e, sid, b, STARTWERT, &m40).await
    })
    .unwrap_err();
    assert_eq!(status(fehler), StatusCode::CONFLICT);
    let aktuell = verlauf_aktuell(&w, sid).await;
    let fehler = write_retry!(pool, |conn| {
        stellen_repo::belegung_zuruecknehmen_tx(conn, e, aktuell, b, STARTWERT).await
    })
    .unwrap_err();
    assert_eq!(status(fehler), StatusCode::CONFLICT);

    aendern(
        &w,
        sid,
        StelleAenderung {
            belegungsart: Some(Belegungsart::Gezaehlt),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        belegung(&w, sid).await,
        Some(4),
        "zurück auf gezählt: bleibt"
    );
    // Die Meldung aus der Registrierung bleibt auch an der gezählten Stelle unumkehrbar.
    let fehler = write_retry!(pool, |conn| {
        stellen_repo::belegung_zuruecknehmen_tx(conn, e, aktuell, b, STARTWERT).await
    })
    .unwrap_err();
    assert_eq!(status(fehler), StatusCode::CONFLICT);
    let m12 = melden(12);
    write_retry!(pool, |conn| {
        stellen_repo::belegung_melden_tx(conn, e, sid, b, STARTWERT, &m12).await
    })
    .expect("gezählt nimmt wieder Handmeldungen an");
}

async fn verlauf_aktuell(w: &Welt, sid: i64) -> i64 {
    stellen_repo::belegung_verlauf(&w.pool, w.e, sid)
        .await
        .unwrap()
        .into_iter()
        .find(|v| v.aktuell)
        .unwrap()
        .id
}

/// Szenario „Verbleibwechsel an anderer Stelle“: jeder Weg über `verbleib_repo::erfassen_tx`
/// führt die Belegung nach, auch für die Stelle, die die Person verlässt.
#[tokio::test]
async fn verbleibwechsel_fuehrt_beide_stellen_nach() {
    let w = welt().await;
    let ost = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Namentlich).await;
    let west = stelle(&w, w.e, "Turnhalle West", Belegungsart::Namentlich).await;
    let r = registrieren(&w, ost, None, familie()).await.unwrap();
    assert_eq!(belegung(&w, ost).await, Some(3));

    let (pool, b, e) = (&w.pool, w.b, w.e);
    let pid = r.person_ids[0];
    let transport = write_retry!(pool, |conn| {
        verbleib_repo::erfassen_tx(
            conn,
            e,
            pid,
            verbleib_repo::VerbleibDaten {
                art: VerbleibArt::Transport.as_str(),
                zeitpunkt_at: Some("2026-11-09 11:00:00"),
                ..Default::default()
            },
            b,
        )
        .await
    })
    .unwrap();
    assert_eq!(transport.belegung_etb_ids.len(), 1);
    assert_eq!(belegung(&w, ost).await, Some(2));

    let pid2 = r.person_ids[1];
    write_retry!(pool, |conn| {
        verbleib_repo::erfassen_tx(
            conn,
            e,
            pid2,
            verbleib_repo::VerbleibDaten {
                art: VerbleibArt::Notunterkunft.as_str(),
                betreuungsstelle_id: Some(west),
                zeitpunkt_at: Some("2026-11-09 11:05:00"),
                ..Default::default()
            },
            b,
        )
        .await
    })
    .unwrap();
    assert_eq!(belegung(&w, ost).await, Some(1));
    assert_eq!(belegung(&w, west).await, Some(1));
}

/// Szenarien „Haushalt abmelden“ und „Eine Person abmelden“; „Namentliche Stelle schließen“.
#[tokio::test]
async fn abmelden_haushalt_und_person() {
    let w = welt().await;
    let sid = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Namentlich).await;
    let r = registrieren(&w, sid, None, familie()).await.unwrap();
    let h = r.haushalt_id.unwrap();

    let einzeln = abmelden(&w, sid, None, vec![r.person_ids[1]])
        .await
        .unwrap();
    assert_eq!(einzeln.person_ids, vec![r.person_ids[1]]);
    assert_eq!(belegung(&w, sid).await, Some(2));
    let p = crate::person::repo::laden(&w.pool, w.e, r.person_ids[1])
        .await
        .unwrap();
    assert_eq!(p.aktuelle_verbleib_art, Some(VerbleibArt::Entlassung));
    assert_eq!(p.aktuelles_verbleib_ziel.as_deref(), Some("zu Verwandten"));

    let fehler = aendern(
        &w,
        sid,
        StelleAenderung {
            status: Some(Status::Geschlossen),
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    assert_eq!(status(fehler), StatusCode::UNPROCESSABLE_ENTITY);

    let haushalt = abmelden(&w, sid, Some(h), Vec::new()).await.unwrap();
    assert_eq!(
        haushalt.person_ids.len(),
        2,
        "die schon abgemeldete wird übersprungen"
    );
    assert_eq!(belegung(&w, sid).await, Some(0));
    assert!(liste(&w.pool, w.e, sid).await.unwrap().haushalte.is_empty());
    let etb = etb_inhalte(&w).await;
    let abmeldung = etb.iter().rev().find(|t| t.contains("abgemeldet")).unwrap();
    assert!(
        abmeldung.contains("Haushalt H-1: 2 Personen abgemeldet"),
        "{abmeldung}"
    );
    assert!(!abmeldung.contains("Verwandten"), "kein Ziel im ETB");

    let leer = abmelden(&w, sid, Some(h), Vec::new()).await.unwrap();
    assert!(
        leer.etb_ids.is_empty(),
        "niemand mehr da: nichts geschrieben"
    );
    aendern(
        &w,
        sid,
        StelleAenderung {
            status: Some(Status::Geschlossen),
            ..Default::default()
        },
    )
    .await
    .expect("leer: schließen erlaubt");
}

/// Szenario „Zählung“ und „ohne Haushalt“ in der Liste.
#[tokio::test]
async fn kostformen_zaehlen() {
    let w = welt().await;
    let ost = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Gezaehlt).await;
    let west = stelle(&w, w.e, "Turnhalle West", Belegungsart::Gezaehlt).await;
    registrieren(&w, ost, None, familie()).await.unwrap();
    registrieren(
        &w,
        west,
        None,
        vec![
            person("Yilmaz", Kostform::Vegan),
            person("Yilmaz", Kostform::Vegetarisch),
        ],
    )
    .await
    .unwrap();
    // Über einen Verbleib aufgenommen: ohne Haushalt und ohne Kostform.
    let (pool, b, e) = (&w.pool, w.b, w.e);
    let ohne = write_retry!(pool, |conn| {
        let (id, _, _) = crate::person::repo::anlegen_tx_mit_optionen(
            conn,
            e,
            b,
            "betroffen",
            None,
            None,
            crate::person::repo::NeueDaten {
                name: Some("Schulz"),
                vorname: None,
                geschlecht: None,
                geburtsdatum: None,
                alter_geschaetzt: None,
                herkunft_adresse: None,
                antreff_ort: None,
                melder_kontakt: None,
                notiz: None,
                zustand: None,
                antreff_lat: None,
                antreff_lon: None,
                vermisst_seit: None,
                versorgende_einheit_id: None,
                meldung_id: None,
            },
        )
        .await?;
        verbleib_repo::erfassen_tx(
            conn,
            e,
            id,
            verbleib_repo::VerbleibDaten {
                art: VerbleibArt::Notunterkunft.as_str(),
                betreuungsstelle_id: Some(west),
                ..Default::default()
            },
            b,
        )
        .await?;
        Ok(id)
    })
    .unwrap();

    let z = kostformen(&w.pool, w.e).await.unwrap();
    assert_eq!(z.registriert, 6);
    assert_eq!(z.sonderkost.vegetarisch, 2);
    assert_eq!(z.sonderkost.vegan, 1);
    assert_eq!(z.sonderkost.saeugling_kleinkind, 1);
    assert_eq!(z.normal, 1);
    assert_eq!(z.ohne_angabe, 1);

    let liste = liste(&w.pool, w.e, west).await.unwrap();
    assert_eq!(liste.ohne_haushalt.len(), 1);
    assert_eq!(liste.ohne_haushalt[0].id, ohne);
    assert_eq!(liste.haushalte.len(), 1);
}

/// Replay (D2/D6): die Schlüssel der Personen und Verbleib-Ereignisse finden den Vorgang.
#[tokio::test]
async fn replay_ueber_den_schluessel() {
    let w = welt().await;
    let sid = stelle(&w, w.e, "Turnhalle Ost", Belegungsart::Gezaehlt).await;
    let eingabe = RegistrierEingabe {
        haushalt_id: None,
        personen: familie(),
        zeitpunkt_at: ZEIT.into(),
        client_id: Some("a_b%c".into()),
    };
    let (pool, b, e) = (&w.pool, w.b, w.e);
    let r = write_retry!(pool, |conn| {
        registrieren_tx(conn, e, sid, b, STARTWERT, &eingabe).await
    })
    .unwrap();
    assert_eq!(
        registrierung_nach_client_id(&w.pool, w.e, "a_b%c")
            .await
            .unwrap(),
        Some((r.haushalt_id, sid))
    );
    assert_eq!(
        registrierung_nach_client_id(&w.pool, w.e, "anders")
            .await
            .unwrap(),
        None
    );
    let ab = AbmeldeEingabe {
        haushalt_id: r.haushalt_id,
        person_ids: Vec::new(),
        ziel: None,
        zeitpunkt_at: "2026-11-09 12:00:00".into(),
        client_id: Some("x_1".into()),
    };
    write_retry!(pool, |conn| {
        abmelden_tx(conn, e, sid, b, STARTWERT, &ab).await
    })
    .unwrap();
    assert_eq!(
        abmeldung_nach_client_id(&w.pool, w.e, "x_1")
            .await
            .unwrap()
            .len(),
        3
    );
    // `_` ist kein Platzhalter: „x_1“ trifft nicht „xa1“.
    assert!(abmeldung_nach_client_id(&w.pool, w.e, "xa1")
        .await
        .unwrap()
        .is_empty());
}
