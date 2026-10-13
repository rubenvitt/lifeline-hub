//! Repo-Tests des Informationstelefons (LFH-554), je Spec-Szenario mindestens ein Test.

use super::*;
use crate::write_retry;
use axum::http::StatusCode;

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
         VALUES (1, 'Telefon 1', 'tel1', 'h') RETURNING id",
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

fn anruf(anliegen: InfotelefonAnliegen, rueckruf: Option<&str>, noetig: bool) -> AnrufEingabe {
    AnrufEingabe {
        anliegen,
        notiz: Some("Frage nach Sperrung B 3".into()),
        anrufer_name: Some("A. Anrufer".into()),
        rueckruf: rueckruf.map(str::to_string),
        rueckruf_noetig: noetig,
        eingang_at: "2026-09-30 12:00:00".into(),
    }
}

async fn anlegen(w: &Welt, e: i64, a: AnrufEingabe) -> Result<i64, AppError> {
    write_retry!(&w.pool, |conn| { anlegen_tx(conn, e, w.b, &a).await })
}

async fn setze(w: &Welt, e: i64, id: i64, ziel: InfotelefonStatus) -> Result<(), AppError> {
    write_retry!(&w.pool, |conn| { status_tx(conn, e, id, w.b, ziel).await })
}

/// Blättert die Liste mit `limit` vollständig durch, wie der Client es tut.
async fn all_pages(
    w: &Welt,
    e: i64,
    filter: &AnrufFilter,
    limit: i64,
) -> Vec<InfotelefonAnrufAnzeige> {
    let mut alle: Vec<InfotelefonAnrufAnzeige> = Vec::new();
    let mut vor = None;
    loop {
        let seite = crate::kommunikation::Seite { vor, limit };
        let teil = list_page(&w.pool, e, filter, &seite).await.unwrap();
        let ende = (teil.len() as i64) < limit;
        vor = teil.last().map(|a| crate::kommunikation::ZeitCursor {
            zeit: a.eingang_at.clone(),
            id: a.id,
        });
        alle.extend(teil);
        if ende {
            return alle;
        }
    }
}

async fn ids(w: &Welt, e: i64, filter: &AnrufFilter) -> Vec<i64> {
    all_pages(w, e, filter, 100)
        .await
        .iter()
        .map(|a| a.id)
        .collect()
}

const OHNE: AnrufFilter = AnrufFilter { status: None };
const OFFEN: AnrufFilter = AnrufFilter {
    status: Some(InfotelefonStatus::Offen),
};
const ERLEDIGT: AnrufFilter = AnrufFilter {
    status: Some(InfotelefonStatus::Erledigt),
};

fn code(r: Result<impl std::fmt::Debug, AppError>) -> StatusCode {
    r.unwrap_err().status()
}

#[tokio::test]
async fn auskunft_ohne_rueckruf_ist_erledigt() {
    let w = welt().await;
    let id = anlegen(
        &w,
        w.e,
        anruf(InfotelefonAnliegen::AuskunftLage, None, false),
    )
    .await
    .unwrap();
    let a = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(a.status, InfotelefonStatus::Erledigt);
    assert_eq!(a.eingang_at, "2026-09-30 12:00:00");
    assert_eq!(a.notiz.as_deref(), Some("Frage nach Sperrung B 3"));
}

#[tokio::test]
async fn rueckruf_ohne_nummer_ist_422_und_legt_nichts_an() {
    let w = welt().await;
    for nummer in [None, Some("  ")] {
        let r = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, nummer, true)).await;
        assert_eq!(code(r), StatusCode::UNPROCESSABLE_ENTITY);
    }
    assert!(ids(&w, w.e, &OHNE).await.is_empty());
}

#[tokio::test]
async fn rueckruf_erledigen_und_wieder_oeffnen() {
    let w = welt().await;
    let id = anlegen(
        &w,
        w.e,
        anruf(
            InfotelefonAnliegen::Vermisstensuche,
            Some("0171 000000"),
            true,
        ),
    )
    .await
    .unwrap();
    assert_eq!(
        laden(&w.pool, w.e, id).await.unwrap().status,
        InfotelefonStatus::Offen
    );
    setze(&w, w.e, id, InfotelefonStatus::Erledigt)
        .await
        .unwrap();
    let a = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(a.status, InfotelefonStatus::Erledigt);
    assert_eq!(a.erledigt_von_name.as_deref(), Some("Telefon 1"));
    assert!(a.erledigt_at.is_some());
    assert_eq!(
        code(setze(&w, w.e, id, InfotelefonStatus::Erledigt).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    setze(&w, w.e, id, InfotelefonStatus::Offen).await.unwrap();
    let a = laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(a.status, InfotelefonStatus::Offen);
    assert_eq!(a.erledigt_at, None);
}

#[tokio::test]
async fn oeffnen_ohne_nummer_ist_422() {
    let w = welt().await;
    let id = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Sonstiges, None, false))
        .await
        .unwrap();
    assert_eq!(
        code(setze(&w, w.e, id, InfotelefonStatus::Offen).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn fremder_anruf_ist_404() {
    let w = welt().await;
    let id = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Presse, Some("1"), true))
        .await
        .unwrap();
    assert_eq!(code(laden(&w.pool, w.e2, id).await), StatusCode::NOT_FOUND);
    assert_eq!(
        code(setze(&w, w.e2, id, InfotelefonStatus::Erledigt).await),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn liste_juengste_zuerst_und_nur_eigener_einsatz() {
    let w = welt().await;
    let mut frueh = anruf(InfotelefonAnliegen::Hinweis, None, false);
    frueh.eingang_at = "2026-09-30 08:00:00".into();
    let frueh = anlegen(&w, w.e, frueh).await.unwrap();
    let spaet = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    anlegen(&w, w.e2, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    assert_eq!(ids(&w, w.e, &OHNE).await, vec![spaet, frueh]);
}

#[tokio::test]
async fn gleicher_eingang_ordnet_hoehere_kennung_zuerst() {
    let w = welt().await;
    let a = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    let b = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    assert_eq!(ids(&w, w.e, &OHNE).await, vec![b, a]);
}

#[tokio::test]
async fn blaettern_liefert_jeden_anruf_genau_einmal() {
    let w = welt().await;
    // Gleichstände über Seitengrenzen: je drei Anrufe teilen einen Eingang, dazu ein
    // nachgetragener Anruf mit frühem Eingang und hoher Kennung.
    for i in 0..9 {
        let mut a = anruf(InfotelefonAnliegen::AuskunftLage, None, false);
        a.eingang_at = format!("2026-09-30 1{}:00:00", i / 3);
        anlegen(&w, w.e, a).await.unwrap();
    }
    let mut nachtrag = anruf(InfotelefonAnliegen::Hinweis, None, false);
    nachtrag.eingang_at = "2026-09-30 07:00:00".into();
    let nachtrag = anlegen(&w, w.e, nachtrag).await.unwrap();

    let ganz = ids(&w, w.e, &OHNE).await;
    assert_eq!(ganz.len(), 10);
    assert_eq!(*ganz.last().unwrap(), nachtrag, "frühester Eingang zuletzt");
    for limit in [1, 2, 3, 4, 7] {
        let geblaettert: Vec<i64> = all_pages(&w, w.e, &OHNE, limit)
            .await
            .iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(geblaettert, ganz, "limit {limit}");
    }
}

#[tokio::test]
async fn seite_haelt_das_limit() {
    let w = welt().await;
    for _ in 0..5 {
        anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, None, false))
            .await
            .unwrap();
    }
    let seite = crate::kommunikation::Seite {
        vor: None,
        limit: 2,
    };
    assert_eq!(
        list_page(&w.pool, w.e, &OHNE, &seite).await.unwrap().len(),
        2
    );
}

#[tokio::test]
async fn filter_nach_status() {
    let w = welt().await;
    let offen = anlegen(
        &w,
        w.e,
        anruf(InfotelefonAnliegen::Hinweis, Some("1"), true),
    )
    .await
    .unwrap();
    let erledigt = anlegen(&w, w.e, anruf(InfotelefonAnliegen::Hinweis, None, false))
        .await
        .unwrap();
    anlegen(
        &w,
        w.e2,
        anruf(InfotelefonAnliegen::Hinweis, Some("2"), true),
    )
    .await
    .unwrap();
    assert_eq!(ids(&w, w.e, &OFFEN).await, vec![offen]);
    assert_eq!(ids(&w, w.e, &ERLEDIGT).await, vec![erledigt]);
    assert_eq!(ids(&w, w.e, &OHNE).await, vec![erledigt, offen]);
}

#[tokio::test]
async fn zaehlung_gleicht_der_liste_je_filter() {
    let w = welt().await;
    for (anliegen, nummer, noetig) in [
        (InfotelefonAnliegen::AuskunftLage, None, false),
        (InfotelefonAnliegen::AuskunftLage, None, false),
        (InfotelefonAnliegen::AuskunftLage, Some("1"), true),
        (InfotelefonAnliegen::Hinweis, None, false),
        (InfotelefonAnliegen::Vermisstensuche, Some("2"), true),
    ] {
        anlegen(&w, w.e, anruf(anliegen, nummer, noetig))
            .await
            .unwrap();
    }
    anlegen(
        &w,
        w.e2,
        anruf(InfotelefonAnliegen::Presse, Some("3"), true),
    )
    .await
    .unwrap();

    let z = count(&w.pool, w.e, &OHNE).await.unwrap();
    assert_eq!((z.gesamt, z.offen), (5, 2));
    assert_eq!(z.je_anliegen.auskunft_lage, 3);
    assert_eq!(z.je_anliegen.presse, 0, "anderer Einsatz zählt nicht mit");

    let z = count(&w.pool, w.e, &OFFEN).await.unwrap();
    assert_eq!((z.gesamt, z.offen), (2, 2));
    assert_eq!(z.je_anliegen.auskunft_lage, 1);
    assert_eq!(z.je_anliegen.vermisstensuche, 1);

    for filter in [OHNE, OFFEN, ERLEDIGT] {
        let z = count(&w.pool, w.e, &filter).await.unwrap();
        let liste = all_pages(&w, w.e, &filter, 2).await;
        assert_eq!(z.gesamt, liste.len() as i64, "{filter:?}");
        let offen = liste
            .iter()
            .filter(|a| a.status == InfotelefonStatus::Offen)
            .count();
        assert_eq!(z.offen, offen as i64, "{filter:?}");
    }
}
