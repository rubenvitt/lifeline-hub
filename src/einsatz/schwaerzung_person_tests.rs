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
fn befund_bezuege(
    kanten: &[Kante],
    bezuege: &[PersonenBezug],
    anhaenge: &[PersonenAnhaenge],
) -> Vec<String> {
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
            }) || anhaenge
                .iter()
                .any(|a| a.art == art && a.tabelle == tabelle && a.bezug == spalte);
            if !deklariert {
                befund.push(format!(
                    "{tabelle}.{spalte} verweist auf {} ({}), steht aber weder in PERSONENBEZUEGE noch in PERSONEN_ANHAENGE",
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
    for a in anhaenge {
        for (spalte, parent) in [(a.bezug, a.art.wurzel()), (a.anhang, "anhang")] {
            let echt = kanten
                .iter()
                .any(|(t, sp, p)| t == a.tabelle && sp == spalte && p == parent);
            if !echt {
                befund.push(format!(
                    "{}.{spalte} steht in PERSONEN_ANHAENGE, ist aber keine FK-Kante auf {parent}",
                    a.tabelle
                ));
            }
        }
    }
    befund
}

/// GUARD 4 (rein, LFH-757): ein Eintrag in [`PERSONEN_ANHAENGE`] ist ein Linker, den die
/// Registry beim Einsatz ganz löscht (jede Spalte `ZeileLoeschen`), und steht nicht zugleich in
/// [`PERSONENBEZUEGE`] — sonst würde ein Teil der Zeile gescrubbt statt gelöscht.
fn befund_anhaenge(anhaenge: &[PersonenAnhaenge], bezuege: &[PersonenBezug]) -> Vec<String> {
    let mut befund = Vec::new();
    for a in anhaenge {
        let Some(regel) = TABELLEN.iter().find(|t| t.tabelle == a.tabelle) else {
            befund.push(format!("{} steht nicht in der Registry", a.tabelle));
            continue;
        };
        for s in regel.spalten {
            if !matches!(
                s.klassifikation,
                Klassifikation::Scrub(Strategie::ZeileLoeschen, _)
            ) {
                befund.push(format!(
                    "{}.{} ist nicht ZeileLoeschen — ein Personen-Anhang-Linker geht ganz",
                    a.tabelle, s.spalte
                ));
            }
        }
        if bezuege.iter().any(|b| b.tabelle == a.tabelle) {
            befund.push(format!(
                "{} steht in PERSONEN_ANHAENGE und in PERSONENBEZUEGE",
                a.tabelle
            ));
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
    let befund = befund_bezuege(&kanten(&pool).await, PERSONENBEZUEGE, PERSONEN_ANHAENGE);
    assert!(
        befund.is_empty(),
        "Personenbezüge unvollständig (LFH-751, design.md D5):\n{}",
        befund.join("\n")
    );
}

#[tokio::test]
async fn personen_anhaenge_sind_ganze_linker_mit_kaskade() {
    let befund = befund_anhaenge(PERSONEN_ANHAENGE, PERSONENBEZUEGE);
    assert!(
        befund.is_empty(),
        "PERSONEN_ANHAENGE (LFH-757):\n{}",
        befund.join("\n")
    );
    // Die Verknüpfung folgt der gelöschten Datei nur mit ON DELETE CASCADE.
    let pool = crate::db::test_pool().await;
    for a in PERSONEN_ANHAENGE {
        let sql = format!("PRAGMA foreign_key_list('{}')", a.tabelle);
        let kaskade = sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .any(|r| {
                r.get::<String, _>("from") == a.anhang
                    && r.get::<String, _>("table") == "anhang"
                    && r.get::<String, _>("on_delete") == "CASCADE"
            });
        assert!(
            kaskade,
            "{}.{} braucht ON DELETE CASCADE auf anhang",
            a.tabelle, a.anhang
        );
    }
}

/// Selbsttest GUARD 1/4 (LFH-757): ein fehlender, ein toter und ein falsch gebauter Eintrag in
/// PERSONEN_ANHAENGE fallen auf.
#[tokio::test]
async fn guard_anhaenge_erkennt_fehlenden_toten_und_falschen_eintrag() {
    let pool = crate::db::test_pool().await;
    let k = kanten(&pool).await;
    assert!(befund_bezuege(&k, PERSONENBEZUEGE, &[])
        .iter()
        .any(|v| v.contains("einsatz_person_anhang.person_id")));

    let tot = [PersonenAnhaenge {
        anhang: "datei_tippfehler",
        ..PERSONEN_ANHAENGE[0]
    }];
    assert!(befund_bezuege(&k, PERSONENBEZUEGE, &tot)
        .iter()
        .any(|v| v.contains("datei_tippfehler")));

    let kein_linker = [PersonenAnhaenge {
        tabelle: "person_sichtung",
        ..PERSONEN_ANHAENGE[0]
    }];
    let befund = befund_anhaenge(&kein_linker, PERSONENBEZUEGE);
    assert!(befund.iter().any(|v| v.contains("ist nicht ZeileLoeschen")));
    assert!(befund.iter().any(|v| v.contains("und in PERSONENBEZUEGE")));
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

/// Selbsttest GUARD 1: eine neue Tabelle mit FK auf das Personenregister fällt auf, ein
/// entfernter Bezug fällt auf, ein toter Bezug fällt auf.
#[tokio::test]
async fn guard_bezuege_erkennt_sonde_entfernten_und_toten_bezug() {
    let pool = crate::db::test_pool().await;
    let mut k = kanten(&pool).await;
    assert!(befund_bezuege(&k, PERSONENBEZUEGE, PERSONEN_ANHAENGE).is_empty());

    k.push((
        "lfh751_sonde".into(),
        "person_id".into(),
        "einsatz_person".into(),
    ));
    assert!(befund_bezuege(&k, PERSONENBEZUEGE, PERSONEN_ANHAENGE)
        .iter()
        .any(|v| v.contains("lfh751_sonde.person_id")));
    k.pop();

    let ohne_halter: Vec<PersonenBezug> = PERSONENBEZUEGE
        .iter()
        .copied()
        .filter(|b| b.bezug != Bezug::Spalte("halter_person_id"))
        .collect();
    assert!(befund_bezuege(&k, &ohne_halter, PERSONEN_ANHAENGE)
        .iter()
        .any(|v| v.contains("einsatz_tier.halter_person_id")));

    let mut tot = PERSONENBEZUEGE.to_vec();
    tot.push(PersonenBezug {
        art: PersonenArt::Betroffene,
        tabelle: "einsatz_tier",
        bezug: Bezug::Spalte("halter_id_tippfehler"),
        spalten: &[],
    });
    assert!(befund_bezuege(&k, &tot, PERSONEN_ANHAENGE)
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

/// LFH-757: Ein Löschersuchen für eine betroffene Person löscht ihre Dateien samt Verknüpfung,
/// auch eine schon entfernte. Die Dateien der Nachbarin und der Person im anderen Einsatz
/// bleiben, ebenso jede ETB-Zeile.
#[tokio::test]
async fn scrub_betroffene_loescht_ihre_anhaenge_samt_datei() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let zaehle = |sql: &'static str, id: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let etb_vorher = zaehle(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
        b.e1,
    )
    .await;
    let dateien = "SELECT COUNT(*) FROM anhang a JOIN einsatz_person_anhang l \
                   ON l.anhang_id = a.id WHERE l.person_id = ?";
    assert_eq!(zaehle(dateien, b.p1).await, 2);

    scrub(&pool, b.e1, PersonenArt::Betroffene, b.p1).await;

    let linker = "SELECT COUNT(*) FROM einsatz_person_anhang WHERE person_id = ?";
    assert_eq!(zaehle(linker, b.p1).await, 0);
    assert_eq!(zaehle(dateien, b.p2).await, 1);
    assert_eq!(zaehle(dateien, b.p_e2).await, 1);
    let verwaist: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE dateiname LIKE 'Yilmaz-%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        verwaist, 0,
        "die Datei selbst muss weg sein, nicht nur die Verknüpfung"
    );
    assert_eq!(
        zaehle(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
            b.e1
        )
        .await,
        etb_vorher
    );
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
