//! Guards und Scrub-Tests der Personenbezüge (LFH-751, design.md D5).

use super::testdaten::{self, Bestand, NACHBAR_KLARTEXTE, ZIEL_KLARTEXTE};
use super::*;
use sqlx::{Row, SqlitePool};
use std::collections::BTreeSet;

/// FK-Kante `(tabelle, spalte, parent)` einer Registry-Tabelle.
type Kante = (String, String, String);

/// Alle FK-Kanten der Registry-Tabellen. Die Registry-Tabellen SIND die einsatz-scoped Menge S
/// (`entdeckte_tabellen_gleich_registry_tabellen` hält das fest).
async fn kanten(pool: &SqlitePool) -> Vec<Kante> {
    let mut aus = Vec::new();
    for t in TABELLEN {
        let sql = format!("PRAGMA foreign_key_list('{}')", t.tabelle);
        for r in sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(pool)
            .await
            .unwrap()
        {
            aus.push((
                t.tabelle.to_string(),
                r.get::<String, _>("from"),
                r.get::<String, _>("table"),
            ));
        }
    }
    aus
}

/// GUARD 1 (rein): jede Kante auf die Wurzel einer Personenart ist als Bezug deklariert, und
/// jeder deklarierte Spalten-Bezug ist eine echte Kante auf die Wurzel seiner Art (kein toter
/// Eintrag, kein Tippfehler). Dazu je Art genau ein `SelbstId`-Bezug auf der Wurzel.
fn befund_bezuege(kanten: &[Kante], bezuege: &[PersonenBezug]) -> Vec<String> {
    let mut befund = Vec::new();
    for art in PersonenArt::ALLE {
        for (tabelle, spalte, parent) in kanten {
            if parent != art.wurzel() {
                continue;
            }
            let deklariert = bezuege.iter().any(|b| {
                b.art == art
                    && b.tabelle == tabelle
                    && matches!(b.bezug, Bezug::Spalte(s) if s == spalte)
            }) || PERSONENANHAENGE
                .iter()
                .any(|l| l.art == art && l.tabelle == tabelle && l.bezug == spalte);
            if !deklariert {
                befund.push(format!(
                    "{tabelle}.{spalte} verweist auf {} ({}), steht aber weder in PERSONENBEZUEGE \
                     noch in PERSONENANHAENGE",
                    art.wurzel(),
                    art.as_str()
                ));
            }
        }
        let selbst: Vec<_> = bezuege
            .iter()
            .filter(|b| b.art == art && b.bezug == Bezug::SelbstId)
            .collect();
        if selbst.len() != 1 || selbst[0].tabelle != art.wurzel() {
            befund.push(format!(
                "{}: genau ein SelbstId-Bezug auf {} erwartet",
                art.as_str(),
                art.wurzel()
            ));
        }
    }
    for b in bezuege {
        if let Bezug::Spalte(s) = b.bezug {
            let echt = kanten
                .iter()
                .any(|(t, sp, p)| t == b.tabelle && sp == s && p == b.art.wurzel());
            if !echt {
                befund.push(format!(
                    "{}.{s} ist als Bezug von {} deklariert, ist aber keine FK-Kante auf {}",
                    b.tabelle,
                    b.art.as_str(),
                    b.art.wurzel()
                ));
            }
        }
    }
    befund
}

/// GUARD 2+3 (rein): die markierten Spalten eines Bezugs sind genau die Scrub-Spalten seiner
/// Tabelle (keine Retain-Spalte markiert, keine Scrub-Spalte vergessen, nichts doppelt, kein
/// `ZeileLoeschen`); an der Wurzel ist jede Scrub-Spalte `Mit`.
fn befund_markierungen(bezuege: &[PersonenBezug]) -> Vec<String> {
    let mut befund = Vec::new();
    for b in bezuege {
        let Some(regel) = TABELLEN.iter().find(|t| t.tabelle == b.tabelle) else {
            befund.push(format!("{} steht nicht in der Registry", b.tabelle));
            continue;
        };
        let scrub: BTreeSet<&str> = regel
            .spalten
            .iter()
            .filter(|s| matches!(s.klassifikation, Klassifikation::Scrub(..)))
            .map(|s| s.spalte)
            .collect();
        let mut markiert = BTreeSet::new();
        for (spalte, m) in b.spalten {
            if !markiert.insert(*spalte) {
                befund.push(format!("{}.{spalte} doppelt markiert", b.tabelle));
            }
            match klassifikation_von(b.tabelle, spalte) {
                Some(Klassifikation::Scrub(Strategie::ZeileLoeschen, _)) => befund.push(format!(
                    "{}.{spalte}: ZeileLoeschen gehört nicht in einen Personen-Scrub",
                    b.tabelle
                )),
                Some(Klassifikation::Scrub(..)) => {}
                Some(Klassifikation::Retain(_)) => befund.push(format!(
                    "{}.{spalte} ist Retain und darf nicht markiert sein",
                    b.tabelle
                )),
                None => befund.push(format!("{}.{spalte} kennt die Registry nicht", b.tabelle)),
            }
            if b.bezug == Bezug::SelbstId && *m != Mit {
                befund.push(format!(
                    "{}.{spalte}: an der Wurzel ist jede Scrub-Spalte personengebunden",
                    b.tabelle
                ));
            }
        }
        for fehlt in scrub.difference(&markiert) {
            befund.push(format!(
                "{}.{fehlt} ist Scrub, aber für {} ({:?}) nicht markiert",
                b.tabelle,
                b.art.as_str(),
                b.bezug
            ));
        }
    }
    befund
}

#[tokio::test]
async fn jeder_personenverweis_ist_als_bezug_deklariert() {
    let pool = crate::db::test_pool().await;
    let befund = befund_bezuege(&kanten(&pool).await, PERSONENBEZUEGE);
    assert!(
        befund.is_empty(),
        "Personenbezüge unvollständig (LFH-751, design.md D5):\n{}",
        befund.join("\n")
    );
}

#[test]
fn jede_scrub_spalte_eines_bezugs_ist_markiert() {
    let befund = befund_markierungen(PERSONENBEZUEGE);
    assert!(
        befund.is_empty(),
        "Markierungen der Personenbezüge (LFH-751, design.md D5):\n{}",
        befund.join("\n")
    );
}

/// GUARD 4: jeder Eintrag in [`PERSONENANHAENGE`] ist ein echter Datei-Linker. Bezug und
/// Datei-Spalte sind FK-Kanten auf die Wurzel bzw. auf `anhang`, die Registry löscht die ganze
/// Zeile (sonst wiche der Personen-Vollzug von der Einsatz-Schwärzung ab), und die Tabelle steht
/// nicht zusätzlich in [`PERSONENBEZUEGE`].
#[tokio::test]
async fn jeder_personenanhang_ist_ein_datei_linker() {
    let pool = crate::db::test_pool().await;
    let k = kanten(&pool).await;
    let kante = |t: &str, s: &str, p: &str| k.iter().any(|(a, b, c)| a == t && b == s && c == p);
    for l in PERSONENANHAENGE {
        assert!(
            kante(l.tabelle, l.bezug, l.art.wurzel()),
            "{}.{} ist keine FK-Kante auf {}",
            l.tabelle,
            l.bezug,
            l.art.wurzel()
        );
        assert!(
            kante(l.tabelle, l.anhang, "anhang"),
            "{}.{} ist keine FK-Kante auf anhang",
            l.tabelle,
            l.anhang
        );
        let regel = TABELLEN
            .iter()
            .find(|t| t.tabelle == l.tabelle)
            .unwrap_or_else(|| panic!("{} steht nicht in der Registry", l.tabelle));
        for s in regel.spalten {
            assert!(
                matches!(
                    s.klassifikation,
                    Klassifikation::Scrub(Strategie::ZeileLoeschen, _)
                ),
                "{}.{} ist nicht ZeileLoeschen",
                l.tabelle,
                s.spalte
            );
        }
        assert!(
            !PERSONENBEZUEGE.iter().any(|b| b.tabelle == l.tabelle),
            "{} steht in beiden Listen",
            l.tabelle
        );
    }
}

/// Selbsttest GUARD 1: eine neue Tabelle mit FK auf das Personenregister fällt auf, ein
/// entfernter Bezug fällt auf, ein toter Bezug fällt auf.
#[tokio::test]
async fn guard_bezuege_erkennt_sonde_entfernten_und_toten_bezug() {
    let pool = crate::db::test_pool().await;
    let mut k = kanten(&pool).await;
    assert!(befund_bezuege(&k, PERSONENBEZUEGE).is_empty());

    k.push((
        "lfh751_sonde".into(),
        "person_id".into(),
        "einsatz_person".into(),
    ));
    assert!(befund_bezuege(&k, PERSONENBEZUEGE)
        .iter()
        .any(|v| v.contains("lfh751_sonde.person_id")));
    k.pop();

    let ohne_halter: Vec<PersonenBezug> = PERSONENBEZUEGE
        .iter()
        .copied()
        .filter(|b| b.bezug != Bezug::Spalte("halter_person_id"))
        .collect();
    assert!(befund_bezuege(&k, &ohne_halter)
        .iter()
        .any(|v| v.contains("einsatz_tier.halter_person_id")));

    let mut tot = PERSONENBEZUEGE.to_vec();
    tot.push(PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "einsatz_tier",
        bezug: Bezug::Spalte("halter_id_tippfehler"),
        spalten: &[],
    });
    assert!(befund_bezuege(&k, &tot)
        .iter()
        .any(|v| v.contains("halter_id_tippfehler")));
}

/// Selbsttest GUARD 2+3: unmarkierte Scrub-Spalte, markierte Retain-Spalte und `Ohne` an der
/// Wurzel fallen auf.
#[test]
fn guard_markierungen_erkennt_luecke_retain_und_ohne_an_der_wurzel() {
    let mut v = PERSONENBEZUEGE.to_vec();
    let i = v.iter().position(|b| b.tabelle == "einsatz_tier").unwrap();
    v[i].spalten = &[("halter_kontakt", Mit)];
    assert!(befund_markierungen(&v)
        .iter()
        .any(|x| x.contains("einsatz_tier.kennzeichnung ist Scrub")));

    let mut v = PERSONENBEZUEGE.to_vec();
    v[i].spalten = &[
        ("kennzeichnung", Mit),
        ("halter_kontakt", Mit),
        ("antreff_ort", Ohne("x")),
        ("notiz", Ohne("x")),
        ("abschluss_ziel", Ohne("x")),
        ("rufname", Mit),
    ];
    assert!(befund_markierungen(&v)
        .iter()
        .any(|x| x.contains("rufname ist Retain")));

    let mut v = PERSONENBEZUEGE.to_vec();
    let w = v.iter().position(|b| b.tabelle == "medienkontakt").unwrap();
    v[w].spalten = &[("kontakt_name", Mit), ("kontakt_erreichbarkeit", Ohne("x"))];
    assert!(befund_markierungen(&v)
        .iter()
        .any(|x| x.contains("an der Wurzel")));
}

#[test]
fn kennungen_und_wire() {
    assert_eq!(PersonenArt::Betroffene.kennung(9, Some(42)), "R-042");
    assert_eq!(PersonenArt::ExterneKraft.kennung(17, None), "EK-17");
    assert_eq!(PersonenArt::InfotelefonAnruf.kennung(5, None), "IT-5");
    assert_eq!(PersonenArt::Medienkontakt.kennung(3, None), "MK-3");
    assert_eq!(
        PersonenArt::parse("externe_kraft"),
        Some(PersonenArt::ExterneKraft)
    );
    assert_eq!(PersonenArt::parse("einsatz"), None);
}

// ---------- scrubbe_person ----------

async fn scrub(pool: &SqlitePool, einsatz_id: i64, art: PersonenArt, id: i64) {
    let mut tx = pool.begin().await.unwrap();
    scrubbe_person(&mut tx, einsatz_id, art, id).await.unwrap();
    tx.commit().await.unwrap();
}

fn enthaelt_keinen(texte: &str, werte: &[&str]) -> Vec<String> {
    werte
        .iter()
        .filter(|w| texte.contains(*w))
        .map(|w| w.to_string())
        .collect()
}

async fn fk_check_leer(pool: &SqlitePool) {
    let n = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .unwrap()
        .len();
    assert_eq!(n, 0, "Fremdschlüsselprüfung meldet Verstöße");
}

/// Alle vier Zielpersonen nacheinander: danach steht kein Ziel-Klartext mehr, jeder
/// Nachbar-Klartext steht noch, die Skelettspalten sind unverändert.
#[tokio::test]
async fn scrub_je_art_trifft_nur_die_zielperson() {
    let pool = crate::db::test_pool().await;
    let b: Bestand = testdaten::anlegen(&pool).await;
    scrub(&pool, b.e1, PersonenArt::Betroffene, b.p1).await;
    scrub(&pool, b.e1, PersonenArt::ExterneKraft, b.k1).await;
    scrub(&pool, b.e1, PersonenArt::InfotelefonAnruf, b.anruf1).await;
    scrub(&pool, b.e1, PersonenArt::Medienkontakt, b.medien1).await;

    let texte = testdaten::alle_texte(&pool).await;
    assert_eq!(
        enthaelt_keinen(&texte, ZIEL_KLARTEXTE),
        Vec::<String>::new()
    );
    for n in NACHBAR_KLARTEXTE {
        assert!(
            texte.contains(n),
            "Nachbarwert {n} fehlt nach dem Personen-Scrub"
        );
    }

    // Skelett der Zielperson bleibt.
    let (nr, status, sichtung): (i64, String, Option<String>) = sqlx::query_as(
        "SELECT registrier_nr, status, (SELECT kategorie FROM person_sichtung WHERE person_id = p.id) \
         FROM einsatz_person p WHERE id = ?",
    )
    .bind(b.p1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (nr, status.as_str(), sichtung.as_deref()),
        (1, "betroffen", Some("sk2"))
    );
    // Nicht personengebundene Werte bleiben: Übergabe-Empfänger, Tier-Fund, Abschnittsbemerkung.
    for bleibt in [
        "Polizei Revier Süd",
        "Waldrand",
        "Deich halten",
        "Sandsäcke",
    ] {
        assert!(
            texte.contains(bleibt),
            "{bleibt} darf der Personen-Scrub nicht entfernen"
        );
    }
    fk_check_leer(&pool).await;
}

/// Die Einsatzgrenze hält: ein Scrub mit der ID einer Person, aber dem falschen Einsatz,
/// ändert nichts — auch nicht an Zeilen, die per FK auf sie zeigen.
#[tokio::test]
async fn scrub_im_falschen_einsatz_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let vorher = testdaten::alle_texte(&pool).await;
    scrub(&pool, b.e2, PersonenArt::Betroffene, b.p1).await;
    scrub(&pool, b.e2, PersonenArt::ExterneKraft, b.k1).await;
    scrub(&pool, b.e2, PersonenArt::InfotelefonAnruf, b.anruf1).await;
    scrub(&pool, b.e2, PersonenArt::Medienkontakt, b.medien1).await;
    assert_eq!(testdaten::alle_texte(&pool).await, vorher);
    let _ = (b.p_e2, b.p2, b.k2, b.anruf2, b.medien2);
}

/// Eine Stammkraft ist keine externe Kraft: der Zeilenfilter der Registry
/// (`personal_id IS NULL`) gilt auch für den Personen-Scrub.
#[tokio::test]
async fn scrub_externe_kraft_laesst_stammkraft_stehen() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    scrub(&pool, b.e1, PersonenArt::ExterneKraft, b.k_stamm).await;
    let name: String = sqlx::query_scalar("SELECT snap_name FROM einsatz_personal WHERE id = ?")
        .bind(b.k_stamm)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name, "Stamm-Dora");
}

// ---------- Anhänge einer Person (LFH-757 × LFH-751) ----------

/// Legt eine Datei samt Linker an die Person `person_id` und liefert die `anhang.id`.
/// `entfernt` setzt den Linker auf entfernt (Soft-Delete), die Datei bleibt dabei liegen.
async fn person_anhang(
    pool: &SqlitePool,
    b: &Bestand,
    einsatz_id: i64,
    person_id: i64,
    entfernt: bool,
) -> i64 {
    let anhang: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'Foto_Yilmaz.jpg', 'image/jpeg', 3, 'abc', X'414243', ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(b.leitung)
    .fetch_one(pool)
    .await
    .unwrap();
    let (geloescht_at, geloescht_von) = if entfernt {
        (Some("2026-01-01 00:00:00"), Some(b.leitung))
    } else {
        (None, None)
    };
    sqlx::query(
        "INSERT INTO einsatz_person_anhang \
           (einsatz_id, person_id, anhang_id, abgelegt_von_id, geloescht_at, geloescht_von_id) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(anhang)
    .bind(b.leitung)
    .bind(geloescht_at)
    .bind(geloescht_von)
    .execute(pool)
    .await
    .unwrap();
    anhang
}

async fn anhang_da(pool: &SqlitePool, anhang_id: i64) -> bool {
    let datei: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE id = ?")
        .bind(anhang_id)
        .fetch_one(pool)
        .await
        .unwrap();
    let linker: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_person_anhang WHERE anhang_id = ?")
            .bind(anhang_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(datei, linker, "Datei und Linker gehen nur zusammen");
    datei == 1
}

/// Spec `aufbewahrung-loeschersuchen`, „Vollzug für eine Person“: die Dateien an der Person
/// sind personengebunden (Registry: `ZeileLoeschen`) und gehören über `person_id` zu ihr. Der
/// Vollzug löscht sie samt Linker, auch eine schon entfernte; die Dateien der Nachbarperson und
/// eines anderen Einsatzes bleiben, und ein Scrub im falschen Einsatz löscht nichts.
#[tokio::test]
async fn scrub_betroffene_loescht_ihre_anhaenge_und_nur_ihre() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let ziel = person_anhang(&pool, &b, b.e1, b.p1, false).await;
    let ziel_entfernt = person_anhang(&pool, &b, b.e1, b.p1, true).await;
    let nachbar = person_anhang(&pool, &b, b.e1, b.p2, false).await;
    let anderer_einsatz = person_anhang(&pool, &b, b.e2, b.p_e2, false).await;

    scrub(&pool, b.e2, PersonenArt::Betroffene, b.p1).await;
    assert!(
        anhang_da(&pool, ziel).await,
        "falscher Einsatz löscht nichts"
    );

    scrub(&pool, b.e1, PersonenArt::Betroffene, b.p1).await;
    assert!(
        !anhang_da(&pool, ziel).await,
        "Datei der Zielperson muss weg sein"
    );
    assert!(
        !anhang_da(&pool, ziel_entfernt).await,
        "auch die entfernte Datei geht"
    );
    assert!(
        anhang_da(&pool, nachbar).await,
        "Datei der Nachbarperson bleibt"
    );
    assert!(
        anhang_da(&pool, anderer_einsatz).await,
        "Datei des anderen Einsatzes bleibt"
    );
    fk_check_leer(&pool).await;
}
