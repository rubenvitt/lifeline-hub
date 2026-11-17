//! Tests der Rücknahme (LLH-1922, Spec `kraefte-entlassung`, „Entlassung einer Person
//! zurücknehmen“, „Rücknahme lässt Verändertes aus“, „Rücknahme nur direkt nach dem Entlassen“).

use super::*;
use crate::katalog::KATEGORIE_GEBUNDEN;
use crate::personal::disposition_repo::{self, AdhocDaten};
use crate::personal::status_repo::{self, StatusDaten};
use sqlx::SqlitePool;

const DISPONIERT: &str = "2026-11-17 09:00:00";
const ENTLASSEN: &str = "2026-11-17 11:00:00";
const KURZ_DANACH: &str = "2026-11-17 11:02:00";

/// Eine Person mit jeder Bindung, die das Entlassen löst: Mitglied und Führer von „Zug 1“,
/// Besatzung von „83-1“, an der „UHS Nord“, Leiterin von „Süd“, Einsatzleiterin. Ihre Zeitachse
/// beginnt mit der Alarmierung zur Disposition.
struct Szene {
    pool: SqlitePool,
    benutzer: i64,
    einsatz: i64,
    ep: i64,
    zug: i64,
    fahrzeug: i64,
    uhs: i64,
    abschnitt: i64,
}

async fn szene() -> Szene {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();
    let benutzer: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    status_repo::anlegen(
        &pool,
        1,
        StatusDaten {
            label: "alarmiert",
            kategorie: KATEGORIE_GEBUNDEN,
            farbe: None,
            sortier: 20,
            zeitachse_marke: Some("alarmierung"),
            pause: false,
        },
    )
    .await
    .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let ep = disposition_repo::disponieren_adhoc_tx(
        &mut conn,
        einsatz,
        1,
        AdhocDaten {
            name: "Anna Muster",
            funktion: None,
            traegerorganisation: None,
            staerke_position: Some("fuehrer"),
        },
        benutzer,
    )
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz_personal SET disponiert_at = ? WHERE id = ?")
        .bind(DISPONIERT)
        .bind(ep)
        .execute(&mut *conn)
        .await
        .unwrap();
    disposition_repo::start_zeitachse_tx(&mut conn, einsatz, benutzer, ep)
        .await
        .unwrap();
    drop(conn);

    let zug: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name, fuehrer_id) VALUES (?, 'Zug 1', ?) \
         RETURNING id",
    )
    .bind(einsatz)
    .bind(ep)
    .fetch_one(&pool)
    .await
    .unwrap();
    let fahrzeug: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname) VALUES (?, '83-1') \
         RETURNING id",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    let uhs: i64 = sqlx::query_scalar(
        "INSERT INTO uhs (einsatz_id, typ, bezeichnung, status, erfasst_von, geaendert_von) \
         VALUES (?, 'behandlungsplatz', 'UHS Nord', 'aktiv', ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(benutzer)
    .bind(benutzer)
    .fetch_one(&pool)
    .await
    .unwrap();
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name, leiter_id) VALUES (?, 'Süd', ?) \
         RETURNING id",
    )
    .bind(einsatz)
    .bind(ep)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE einsatz_personal SET einheit_id = ?, fahrzeug_id = ?, uhs_id = ? WHERE id = ?",
    )
    .bind(zug)
    .bind(fahrzeug)
    .bind(uhs)
    .bind(ep)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_fuehrungsstelle (einsatz_id, einsatzleiter_art, \
             einsatzleiter_personal_id, einsatzleiter_name, einsatzleiter_seit) \
         VALUES (?, 'personal', ?, 'Anna Muster', '2026-11-17 09:30:00')",
    )
    .bind(einsatz)
    .bind(ep)
    .execute(&pool)
    .await
    .unwrap();
    Szene {
        pool,
        benutzer,
        einsatz,
        ep,
        zug,
        fahrzeug,
        uhs,
        abschnitt,
    }
}

impl Szene {
    async fn entlasse(&self) -> PersonalEntlassungVorzustand {
        let mut conn = self.pool.acquire().await.unwrap();
        disposition_repo::entlassen_tx(&mut conn, self.einsatz, self.ep, self.benutzer, ENTLASSEN)
            .await
            .unwrap()
            .vorzustand(ENTLASSEN)
    }

    /// Rücknahme in eigener Transaktion wie die Route: ein Fehler rollt alles zurück.
    async fn nimm_zurueck_als(
        &self,
        benutzer: i64,
        jetzt: &str,
        vorzustand: &PersonalEntlassungVorzustand,
        rechte: RuecknahmeRechte,
    ) -> Result<Ruecknahme, AppError> {
        let mut tx = self.pool.begin().await.unwrap();
        let r = zuruecknehmen_tx(
            &mut tx,
            self.einsatz,
            self.ep,
            benutzer,
            jetzt,
            vorzustand,
            rechte,
        )
        .await;
        if r.is_ok() {
            tx.commit().await.unwrap();
        }
        r
    }

    async fn nimm_zurueck(&self, vorzustand: &PersonalEntlassungVorzustand) -> Ruecknahme {
        self.nimm_zurueck_als(
            self.benutzer,
            KURZ_DANACH,
            vorzustand,
            RuecknahmeRechte::ALLE,
        )
        .await
        .unwrap()
    }

    /// Alles, was die Rücknahme herstellen soll, außer der Zeitachse.
    async fn zustand(&self) -> Zustand {
        let (status_id, disponiert_at, staerke_position, einheit, fahrzeug, uhs, beendet): (
            Option<i64>,
            String,
            Option<String>,
            Option<i64>,
            Option<i64>,
            Option<i64>,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT status_id, disponiert_at, staerke_position, einheit_id, fahrzeug_id, uhs_id, \
                    beendet_at FROM einsatz_personal WHERE id = ?",
        )
        .bind(self.ep)
        .fetch_one(&self.pool)
        .await
        .unwrap();
        let fuehrer: Option<i64> =
            sqlx::query_scalar("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?")
                .bind(self.zug)
                .fetch_one(&self.pool)
                .await
                .unwrap();
        let leiter: Option<i64> =
            sqlx::query_scalar("SELECT leiter_id FROM einsatzabschnitt WHERE id = ?")
                .bind(self.abschnitt)
                .fetch_optional(&self.pool)
                .await
                .unwrap()
                .flatten();
        let einsatzleiter: Option<(Option<String>, Option<i64>, Option<String>, Option<String>)> =
            sqlx::query_as(
                "SELECT einsatzleiter_art, einsatzleiter_personal_id, einsatzleiter_name, \
                        einsatzleiter_seit FROM einsatz_fuehrungsstelle WHERE einsatz_id = ?",
            )
            .bind(self.einsatz)
            .fetch_optional(&self.pool)
            .await
            .unwrap();
        Zustand {
            status_id,
            disponiert_at,
            staerke_position,
            einheit,
            fahrzeug,
            uhs,
            aktiv: beendet.is_none(),
            fuehrer,
            leiter,
            einsatzleiter,
        }
    }

    /// (art, zeitpunkt, gestrichen, streichgrund) je Ereignis der Person, nach ID.
    async fn zeitachse(&self) -> Vec<(String, String, bool, Option<String>)> {
        sqlx::query_as(
            "SELECT art, zeitpunkt_at, gestrichen_at IS NOT NULL, streichgrund \
             FROM einsatz_kraft_zeitachse WHERE personal_id = ? ORDER BY id",
        )
        .bind(self.ep)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn ist_entlassen(&self) -> bool {
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT beendet_at FROM einsatz_personal WHERE id = ?",
        )
        .bind(self.ep)
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .is_some()
    }

    async fn sql(&self, sql: &'static str) {
        sqlx::query(sql).execute(&self.pool).await.unwrap();
    }
}

#[derive(Debug, PartialEq)]
struct Zustand {
    status_id: Option<i64>,
    disponiert_at: String,
    staerke_position: Option<String>,
    einheit: Option<i64>,
    fahrzeug: Option<i64>,
    uhs: Option<i64>,
    aktiv: bool,
    fuehrer: Option<i64>,
    leiter: Option<i64>,
    einsatzleiter: Option<(Option<String>, Option<i64>, Option<String>, Option<String>)>,
}

fn bezeichnungen(r: &Ruecknahme) -> Vec<(String, String)> {
    r.ausgelassen
        .iter()
        .map(|a| (a.bezeichnung.clone(), a.grund.clone()))
        .collect()
}

/// Spec „Entlassen und Rückgängig“ und „Zeitachse ohne neue Periode“.
#[tokio::test]
async fn entlassen_und_zuruecknehmen_ergibt_denselben_zustand() {
    let s = szene().await;
    let vorher = s.zustand().await;
    let v = s.entlasse().await;
    assert_ne!(s.zustand().await, vorher, "das Entlassen hat gelöst");

    let r = s.nimm_zurueck(&v).await;

    assert_eq!(s.zustand().await, vorher);
    assert_eq!(
        r,
        Ruecknahme {
            einheiten: vec![s.zug],
            fahrzeug_id: Some(s.fahrzeug),
            uhs_id: Some(s.uhs),
            abschnitte: vec![s.abschnitt],
            einsatzleiter: true,
            ausgelassen: vec![],
        }
    );
    assert_eq!(
        s.zeitachse().await,
        vec![
            ("alarmierung".into(), DISPONIERT.into(), false, None),
            (
                "entlassung".into(),
                ENTLASSEN.into(),
                true,
                Some("Entlassung zurückgenommen".into())
            ),
        ],
        "die Periode ab der Alarmierung ist wieder offen, keine neue"
    );
}

/// Spec „Entlassen ohne offene Periode“.
#[tokio::test]
async fn ohne_offene_periode_bleibt_die_zeitachse_unveraendert() {
    let s = szene().await;
    s.sql("DELETE FROM einsatz_kraft_zeitachse").await;
    let v = s.entlasse().await;
    assert!(s.zeitachse().await.is_empty());
    s.nimm_zurueck(&v).await;
    assert!(!s.ist_entlassen().await);
    assert!(s.zeitachse().await.is_empty());
}

/// Spec „Rücknahme nur direkt nach dem Entlassen“: jede Abweichung ist 409 und ändert nichts.
#[tokio::test]
async fn riegel_lehnt_ab_und_aendert_nichts() {
    let s = szene().await;
    let v = s.entlasse().await;
    let andere: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Andere', 'andere', 'h') RETURNING id",
    )
    .fetch_one(&s.pool)
    .await
    .unwrap();
    let fremdes_entlassen = PersonalEntlassungVorzustand {
        entlassen_at: "2026-11-17 10:59:00".into(),
        ..v.clone()
    };
    for (fall, benutzer, jetzt, vorzustand) in [
        ("andere Person", andere, KURZ_DANACH, &v),
        (
            "anderes Entlassen",
            s.benutzer,
            KURZ_DANACH,
            &fremdes_entlassen,
        ),
        ("nach elf Minuten", s.benutzer, "2026-11-17 11:11:00", &v),
    ] {
        let e = s
            .nimm_zurueck_als(benutzer, jetzt, vorzustand, RuecknahmeRechte::ALLE)
            .await
            .unwrap_err();
        assert!(matches!(e, AppError::Conflict(_)), "{fall}: {e:?}");
        assert!(s.ist_entlassen().await, "{fall}");
    }
    // Zehn Minuten danach gelingt es noch.
    s.nimm_zurueck_als(
        s.benutzer,
        "2026-11-17 11:10:00",
        &v,
        RuecknahmeRechte::ALLE,
    )
    .await
    .unwrap();
    // Ein zweites Mal: nicht mehr entlassen → 409.
    assert!(matches!(
        s.nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
            .await
            .unwrap_err(),
        AppError::Conflict(_)
    ));
}

/// Spec „Schon erneut disponiert“, an der Person.
#[tokio::test]
async fn nach_erneutem_disponieren_ist_409() {
    let s = szene().await;
    let v = s.entlasse().await;
    let mut conn = s.pool.acquire().await.unwrap();
    disposition_repo::reaktivieren_tx(&mut conn, s.einsatz, 1, s.ep, None, s.benutzer)
        .await
        .unwrap();
    drop(conn);
    let vorher = s.zustand().await;
    assert!(matches!(
        s.nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
            .await
            .unwrap_err(),
        AppError::Conflict(_)
    ));
    assert_eq!(s.zustand().await, vorher);
}

/// Spec „Zeitachse inzwischen berichtigt“: Entlassung gestrichen oder ein Nachtrag danach.
#[tokio::test]
async fn berichtigte_zeitachse_ist_409_und_nichts_kommt_zurueck() {
    // Die Entlassung ist gestrichen.
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql(
        "UPDATE einsatz_kraft_zeitachse SET gestrichen_at = '2026-11-17 11:01:00', \
             gestrichen_von = 1, streichgrund = 'falsch' WHERE art = 'entlassung'",
    )
    .await;
    let vorher = s.zustand().await;
    let e = s
        .nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
        .await
        .unwrap_err();
    assert!(
        matches!(&e, AppError::Conflict(m) if m.contains("Zeitachse")),
        "{e:?}"
    );
    assert_eq!(s.zustand().await, vorher);
    assert!(s.ist_entlassen().await);

    // Nach der Entlassung steht ein Nachtrag (Berichtigung der Entlassungszeit).
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql(
        "INSERT INTO einsatz_kraft_zeitachse \
           (einsatz_id, personal_id, art, zeitpunkt_at, quelle, erfasst_von) \
         SELECT einsatz_id, personal_id, 'entlassung', '2026-11-17 11:30:00', 'nachtrag', 1 \
         FROM einsatz_kraft_zeitachse WHERE art = 'entlassung'",
    )
    .await;
    let e = s
        .nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
        .await
        .unwrap_err();
    assert!(matches!(e, AppError::Conflict(_)), "{e:?}");
    assert!(s.ist_entlassen().await);
}

/// Spec „Rücknahme lässt Verändertes aus“: was inzwischen anders gebunden ist, bleibt aus und
/// steht mit Grund in Worten in der Antwort; der Rest kommt zurück.
#[tokio::test]
async fn veraendertes_bleibt_aus_und_wird_genannt() {
    let s = szene().await;
    let v = s.entlasse().await;
    let berta: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_personal (einsatz_id, snap_name) VALUES (?, 'Berta Busch') \
         RETURNING id",
    )
    .bind(s.einsatz)
    .fetch_one(&s.pool)
    .await
    .unwrap();
    // Zug 1 hat einen anderen Führer, „Süd“ eine andere Leiterin, das Fahrzeug ist entlassen,
    // die UHS aufgelöst, und ein externer Einsatzleiter ist eingetragen.
    for (sql, id) in [
        (
            "UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?",
            s.zug,
        ),
        (
            "UPDATE einsatzabschnitt SET leiter_id = ? WHERE id = ?",
            s.abschnitt,
        ),
    ] {
        sqlx::query(sql)
            .bind(berta)
            .bind(id)
            .execute(&s.pool)
            .await
            .unwrap();
    }
    s.sql(
        "UPDATE einsatz_fahrzeug SET beendet_at = '2026-11-17 11:01:00', beendet_von = 1, \
             beendet_als = 'entlassen'",
    )
    .await;
    s.sql("UPDATE uhs SET status = 'aufgeloest'").await;
    s.sql(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_art = 'extern', \
             einsatzleiter_name = 'Kreisbrandmeister'",
    )
    .await;

    let r = s.nimm_zurueck(&v).await;

    assert_eq!(r.einheiten, vec![s.zug], "Mitglied ja, Führer nein");
    assert_eq!(
        bezeichnungen(&r),
        vec![
            (
                "Führung von «Zug 1»".into(),
                "inzwischen anders besetzt".into()
            ),
            ("Fahrzeug «83-1»".into(), "nicht mehr im Einsatz".into()),
            ("UHS «UHS Nord»".into(), "inzwischen aufgelöst".into()),
            (
                "Leitung von «Süd»".into(),
                "inzwischen anders besetzt".into()
            ),
            ("Einsatzleitung".into(), "inzwischen anders besetzt".into()),
        ]
    );
    let z = s.zustand().await;
    assert!(z.aktiv);
    assert_eq!(z.einheit, Some(s.zug));
    assert_eq!((z.fuehrer, z.leiter), (Some(berta), Some(berta)));
    assert_eq!((z.fahrzeug, z.uhs), (None, None));
    assert_eq!(
        z.einsatzleiter.unwrap().2.as_deref(),
        Some("Kreisbrandmeister")
    );
}

/// Einheit aufgelöst, Abschnitt gelöscht (ohne Namen genannt), Einsatzleiter ausgetragen.
#[tokio::test]
async fn aufgeloestes_und_ausgetragenes_bleibt_aus() {
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql("UPDATE einsatz_einheit SET aufgeloest_at = '2026-11-17 11:01:00'")
        .await;
    s.sql("DELETE FROM einsatzabschnitt").await;
    s.sql(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_art = NULL, einsatzleiter_name = NULL, \
             einsatzleiter_seit = NULL",
    )
    .await;
    let r = s.nimm_zurueck(&v).await;
    assert_eq!(
        bezeichnungen(&r),
        vec![
            ("Einheit «Zug 1»".into(), "inzwischen aufgelöst".into()),
            ("Führung von «Zug 1»".into(), "inzwischen aufgelöst".into()),
            (
                "Leitung eines Abschnitts".into(),
                "nicht mehr vorhanden".into()
            ),
            ("Einsatzleitung".into(), "inzwischen ausgetragen".into()),
        ]
    );
    assert_eq!(r.fahrzeug_id, Some(s.fahrzeug));
    assert_eq!(r.uhs_id, Some(s.uhs));
}

/// Ein Einsatzleiter-Vermerk einer ANDEREN, ebenfalls entlassenen Person bleibt ihrer.
#[tokio::test]
async fn vermerk_einer_anderen_person_bleibt() {
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql("UPDATE einsatz_fuehrungsstelle SET einsatzleiter_name = 'Berta Busch'")
        .await;
    let r = s.nimm_zurueck(&v).await;
    assert!(!r.einsatzleiter);
    assert_eq!(
        bezeichnungen(&r),
        vec![("Einsatzleitung".into(), "inzwischen anders besetzt".into())]
    );
}

/// Spec „Ohne Recht im Modul Einheiten“ und die übrigen Modulrechte.
/// Spec „Ohne Recht im Modul Einheiten“ und die übrigen Modulrechte: der Teil bleibt aus, ohne den
/// Namen aus einem Modul zu nennen, das die Person nicht beschreiben darf.
#[tokio::test]
async fn ohne_modulrecht_bleibt_der_teil_aus() {
    let s = szene().await;
    let v = s.entlasse().await;
    let r = s
        .nimm_zurueck_als(
            s.benutzer,
            KURZ_DANACH,
            &v,
            RuecknahmeRechte {
                einsatzdaten: false,
                einheiten: false,
                fahrzeuge: false,
                unfallhilfsstellen: false,
                einsatzabschnitte: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        bezeichnungen(&r),
        vec![
            (
                "Einheit".into(),
                "kein Schreibrecht im Modul Einheiten".into()
            ),
            (
                "Führung einer Einheit".into(),
                "kein Schreibrecht im Modul Einheiten".into()
            ),
            (
                "Fahrzeug".into(),
                "kein Schreibrecht im Modul Fahrzeuge".into()
            ),
            (
                "UHS".into(),
                "kein Schreibrecht im Modul Unfallhilfsstellen".into()
            ),
            (
                "Leitung eines Abschnitts".into(),
                "kein Schreibrecht im Modul Einsatzabschnitte".into()
            ),
            (
                "Einsatzleitung".into(),
                "kein Schreibrecht für die Einsatzdaten".into()
            ),
        ]
    );
    assert!(!r.einsatzleiter);
    assert!(!s.ist_entlassen().await);
}

/// Spec „Storno nach der Rücknahme“: wer einmal entlassen war, war im Einsatz.
#[tokio::test]
async fn storno_bleibt_nach_der_ruecknahme_gesperrt() {
    let s = szene().await;
    let v = s.entlasse().await;
    s.nimm_zurueck(&v).await;
    // Bindungen lösen, damit nur die Sperre selbst den Storno verbietet.
    s.sql("UPDATE einsatz_personal SET einheit_id = NULL, fahrzeug_id = NULL, uhs_id = NULL")
        .await;
    let mut conn = s.pool.acquire().await.unwrap();
    let e = disposition_repo::stornieren_tx(&mut conn, s.einsatz, s.ep, s.benutzer, KURZ_DANACH)
        .await
        .unwrap_err();
    assert!(
        matches!(&e, AppError::UnprocessableEntity(m) if m.contains("schon einmal aus dem Einsatz entlassen")),
        "{e:?}"
    );
}

/// Review vor dem PR: eine Führung fremder Einheiten nennt ein echter Vorzustand nie, sie bleibt
/// still aus; Abschnitte, die es nicht gibt, nennt eine Zeile mit ihrer Zahl, ohne Namen.
#[tokio::test]
async fn fremde_und_unbekannte_kennungen_stehen_ohne_namen_da() {
    let s = szene().await;
    let v = s.entlasse().await;
    let erfunden = PersonalEntlassungVorzustand {
        gefuehrte_einheiten: vec![s.zug, 9_001, 9_002],
        geleitete_abschnitte: vec![s.abschnitt, 9_003, 9_004],
        ..v
    };
    let r = s.nimm_zurueck(&erfunden).await;
    assert_eq!(
        bezeichnungen(&r),
        vec![(
            "Leitung von 2 Abschnitten".into(),
            "nicht mehr vorhanden".into()
        )]
    );
    assert_eq!(r.einheiten, vec![s.zug]);
    assert_eq!(r.abschnitte, vec![s.abschnitt]);
}

/// Review vor dem PR: der Führer ist Mitglied (`einheit::repo::check_fuehrer`); ohne Mitgliedschaft
/// kommt die Führung nicht zurück.
#[tokio::test]
async fn fuehrung_nur_mit_mitgliedschaft() {
    let s = szene().await;
    let v = s.entlasse().await;
    let ohne_einheit = PersonalEntlassungVorzustand {
        einheit_id: None,
        ..v
    };
    let r = s.nimm_zurueck(&ohne_einheit).await;
    assert!(r.einheiten.is_empty());
    assert_eq!(bezeichnungen(&r), Vec::<(String, String)>::new());
    assert_eq!(s.zustand().await.fuehrer, None);
}

/// Review vor dem PR: jede Berichtigung nach dem Entlassen sperrt die Rücknahme, auch eine an einem
/// früheren Ereignis (Streichen oder Nachtrag vor der Entlassung).
#[tokio::test]
async fn berichtigung_vor_der_entlassung_ist_409() {
    // Die Alarmierung wird nach dem Entlassen gestrichen.
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql(
        "UPDATE einsatz_kraft_zeitachse SET gestrichen_at = '2026-11-17 11:01:00', \
             gestrichen_von = 1, streichgrund = 'falsch' WHERE art = 'alarmierung'",
    )
    .await;
    let e = s
        .nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
        .await
        .unwrap_err();
    assert!(matches!(e, AppError::Conflict(_)), "{e:?}");

    // Ein Eintreffen vor der Entlassung wird nachgetragen.
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql(
        "INSERT INTO einsatz_kraft_zeitachse \
           (einsatz_id, personal_id, art, zeitpunkt_at, quelle, erfasst_von) \
         SELECT einsatz_id, personal_id, 'eintreffen', '2026-11-17 09:30:00', 'nachtrag', 1 \
         FROM einsatz_kraft_zeitachse WHERE art = 'entlassung'",
    )
    .await;
    let e = s
        .nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
        .await
        .unwrap_err();
    assert!(matches!(e, AppError::Conflict(_)), "{e:?}");
    assert!(s.ist_entlassen().await);
}

/// Review vor dem PR: der Name einer Ad-hoc-Person wurde berichtigt, während sie Einsatzleiterin
/// war; die Führungsstelle hat den alten eingefroren. Die Rücknahme erkennt den Vermerk trotzdem.
#[tokio::test]
async fn einsatzleitung_kommt_nach_namensberichtigung_zurueck() {
    let s = szene().await;
    s.sql("UPDATE einsatz_personal SET snap_name = 'Anna Muster-Berg'")
        .await;
    let v = s.entlasse().await;
    assert_eq!(v.einsatzleiter_name.as_deref(), Some("Anna Muster"));
    let r = s.nimm_zurueck(&v).await;
    assert!(r.einsatzleiter);
    assert_eq!(s.zustand().await.einsatzleiter.unwrap().1, Some(s.ep));
}

/// Nach-Review: auch ohne Entlassung in der Zeitachse sperrt ein Nachtrag nach dem Entlassen; was
/// davor erfasst wurde, nicht.
#[tokio::test]
async fn ohne_entlassung_sperrt_nur_ein_spaeterer_nachtrag() {
    let s = szene().await;
    s.sql("DELETE FROM einsatz_kraft_zeitachse").await;
    let v = s.entlasse().await;
    s.sql(
        "INSERT INTO einsatz_kraft_zeitachse \
           (einsatz_id, personal_id, art, zeitpunkt_at, quelle, erfasst_von, erfasst_at) \
         SELECT einsatz_id, id, 'eintreffen', '2026-11-17 09:30:00', 'nachtrag', 1, \
                '2026-11-17 11:05:00' FROM einsatz_personal",
    )
    .await;
    let e = s
        .nimm_zurueck_als(s.benutzer, KURZ_DANACH, &v, RuecknahmeRechte::ALLE)
        .await
        .unwrap_err();
    assert!(matches!(e, AppError::Conflict(_)), "{e:?}");

    s.sql("UPDATE einsatz_kraft_zeitachse SET erfasst_at = '2026-11-17 10:30:00'")
        .await;
    s.nimm_zurueck(&v).await;
    assert!(!s.ist_entlassen().await);
}

/// Nach-Review: eine Streichung in derselben Sekunde wie das Entlassen (etwa die Rücknahme eines
/// vorigen Entlassens) zählt nicht als Berichtigung.
#[tokio::test]
async fn streichung_in_der_sekunde_des_entlassens_sperrt_nicht() {
    let s = szene().await;
    let v = s.entlasse().await;
    s.sql(
        "UPDATE einsatz_kraft_zeitachse SET gestrichen_at = '2026-11-17 11:00:00', \
             gestrichen_von = 1, streichgrund = 'Entlassung zurückgenommen' \
         WHERE art = 'alarmierung'",
    )
    .await;
    s.nimm_zurueck(&v).await;
    assert!(!s.ist_entlassen().await);
}
