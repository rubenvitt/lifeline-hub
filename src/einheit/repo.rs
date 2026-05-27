use super::{mitglied_repo, EinheitAnzeige};
use crate::error::AppError;
use crate::staerke::Staerke;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};

/// Editierbare Felder einer Einheit (Führer wird separat über `setze_fuehrer` gesetzt,
/// da er Mitgliedschaft voraussetzt und eine eigene ETB-Aktion ist).
#[derive(Debug)]
pub struct EinheitDaten<'a> {
    pub name: &'a str,
    pub abschnitt_id: Option<i64>,
    pub ueber_einheit_id: Option<i64>,
    pub typ_id: Option<i64>,
    pub soll_fuehrer: Option<i64>,
    pub soll_unterfuehrer: Option<i64>,
    pub soll_mannschaft: Option<i64>,
    pub bemerkung: Option<&'a str>,
    pub sortier: i64,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    abschnitt_id: Option<i64>,
    abschnitt_name: Option<String>,
    ueber_einheit_id: Option<i64>,
    typ_id: Option<i64>,
    typ_label: Option<String>,
    name: String,
    fuehrer_id: Option<i64>,
    fuehrer_name: Option<String>,
    bemerkung: Option<String>,
    sortier: i64,
    soll_fuehrer: Option<i64>,
    soll_unterfuehrer: Option<i64>,
    soll_mannschaft: Option<i64>,
    typ_soll_fuehrer: Option<i64>,
    typ_soll_unterfuehrer: Option<i64>,
    typ_soll_mannschaft: Option<i64>,
}

const SELECT_AUFGELOEST: &str = "\
    SELECT e.id, e.einsatz_id, e.abschnitt_id, ab.name AS abschnitt_name, \
           e.ueber_einheit_id, e.typ_id, t.label AS typ_label, e.name, \
           e.fuehrer_id, fp.snap_name AS fuehrer_name, e.bemerkung, e.sortier, \
           e.soll_fuehrer, e.soll_unterfuehrer, e.soll_mannschaft, \
           t.soll_fuehrer AS typ_soll_fuehrer, t.soll_unterfuehrer AS typ_soll_unterfuehrer, \
           t.soll_mannschaft AS typ_soll_mannschaft \
    FROM einsatz_einheit e \
    LEFT JOIN einheit_typ t ON t.id = e.typ_id \
    LEFT JOIN einsatzabschnitt ab ON ab.id = e.abschnitt_id \
    LEFT JOIN einsatz_personal fp ON fp.id = e.fuehrer_id";

/// Setzt die abgeleitete Anzeige aus Row + Mitgliedern + Stärke zusammen. `soll` ist
/// Override (falls vollständig) sonst Typ-Soll (falls vorhanden) sonst `None`.
async fn zu_anzeige(pool: &SqlitePool, row: Row) -> Result<EinheitAnzeige, AppError> {
    let override_soll = Staerke::aus_optionen(row.soll_fuehrer, row.soll_unterfuehrer, row.soll_mannschaft).unwrap_or(None);
    let typ_soll = Staerke::aus_optionen(row.typ_soll_fuehrer, row.typ_soll_unterfuehrer, row.typ_soll_mannschaft).unwrap_or(None);
    let soll = override_soll.or(typ_soll);

    let ist = mitglied_repo::ist_staerke(pool, row.id).await?;
    let ist_kumuliert = ist_kumuliert(pool, row.einsatz_id, row.id).await?;
    let personal_mitglieder = mitglied_repo::personal_mitglieder(pool, row.id).await?;
    let fahrzeug_mitglieder = mitglied_repo::fahrzeug_mitglieder(pool, row.id).await?;

    Ok(EinheitAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        abschnitt_id: row.abschnitt_id,
        abschnitt_name: row.abschnitt_name,
        ueber_einheit_id: row.ueber_einheit_id,
        typ_id: row.typ_id,
        typ_label: row.typ_label,
        name: row.name,
        fuehrer_id: row.fuehrer_id,
        fuehrer_name: row.fuehrer_name,
        bemerkung: row.bemerkung,
        sortier: row.sortier,
        soll,
        ist,
        ist_kumuliert,
        personal_mitglieder,
        fahrzeug_mitglieder,
    })
}

/// Kumulierte Ist-Stärke: eigene + alle unterstellten Einheiten (rekursiv). Cycle-sicher
/// über ein Visited-Set (schützt vor korrupten Altdaten). Dünner Wrapper über
/// `mitglied_repo::ist_staerke` — keine neue Stärke-Logik.
async fn ist_kumuliert(pool: &SqlitePool, einsatz_id: i64, wurzel_id: i64) -> Result<Staerke, AppError> {
    let kanten: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT id, ueber_einheit_id FROM einsatz_einheit WHERE einsatz_id = ?",
    ).bind(einsatz_id).fetch_all(pool).await?;
    let mut kinder: HashMap<i64, Vec<i64>> = HashMap::new();
    for (id, parent) in &kanten {
        if let Some(p) = parent {
            kinder.entry(*p).or_default().push(*id);
        }
    }
    let mut summe = Staerke::neu(0, 0, 0);
    let mut stack = vec![wurzel_id];
    let mut besucht: HashSet<i64> = HashSet::new();
    while let Some(id) = stack.pop() {
        if !besucht.insert(id) {
            continue;
        }
        let s = mitglied_repo::ist_staerke(pool, id).await?;
        summe = Staerke::neu(
            summe.fuehrer.saturating_add(s.fuehrer),
            summe.unterfuehrer.saturating_add(s.unterfuehrer),
            summe.mannschaft.saturating_add(s.mannschaft),
        );
        if let Some(cs) = kinder.get(&id) {
            for c in cs {
                stack.push(*c);
            }
        }
    }
    Ok(summe)
}

/// Alle Einheiten eines Einsatzes (flach, aufgelöst inkl. Mitgliedern/Stärke).
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<EinheitAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT_AUFGELOEST} WHERE e.einsatz_id = ? ORDER BY e.sortier, e.id"
    )).bind(einsatz_id).fetch_all(pool).await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(zu_anzeige(pool, row).await?);
    }
    Ok(out)
}

/// Lädt eine Einheit (aufgelöst); `NotFound`, falls nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<EinheitAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!("{SELECT_AUFGELOEST} WHERE e.id = ? AND e.einsatz_id = ?"))
        .bind(id).bind(einsatz_id)
        .fetch_optional(pool).await?
        .ok_or(AppError::NotFound)?;
    zu_anzeige(pool, row).await
}

async fn pruefe_parent(pool: &SqlitePool, einsatz_id: i64, parent_id: i64) -> Result<(), AppError> {
    let t: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(parent_id).bind(einsatz_id).fetch_optional(pool).await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

async fn pruefe_abschnitt(pool: &SqlitePool, einsatz_id: i64, abschnitt_id: i64) -> Result<(), AppError> {
    let t: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?")
        .bind(abschnitt_id).bind(einsatz_id).fetch_optional(pool).await?;
    t.map(|_| ()).ok_or(AppError::NotFound)
}

/// Zyklus, wenn beim Setzen von `ueber_einheit_id = kandidat` für `start_id` der
/// Kandidat (oder ein Vorfahr) gleich `start_id` wäre. Läuft von `kandidat` nach oben.
async fn waere_zyklus(pool: &SqlitePool, start_id: i64, kandidat_parent: i64) -> Result<bool, AppError> {
    let mut aktuell = Some(kandidat_parent);
    let mut schritte = 0;
    while let Some(id) = aktuell {
        if id == start_id {
            return Ok(true);
        }
        schritte += 1;
        if schritte > 10_000 {
            return Ok(true);
        }
        aktuell = sqlx::query_scalar::<_, Option<i64>>("SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ?")
            .bind(id).fetch_optional(pool).await?.flatten();
    }
    Ok(false)
}

/// Validiert typ (eigene Org, aktiv), abschnitt (selber Einsatz), parent (selber Einsatz,
/// zyklenfrei). `self_id = None` beim Anlegen.
async fn validiere(pool: &SqlitePool, einsatz_id: i64, org_id: i64, self_id: Option<i64>, daten: &EinheitDaten<'_>) -> Result<(), AppError> {
    if let Some(typ) = daten.typ_id {
        if !crate::einheit::typ_repo::ist_in_org(pool, org_id, typ).await? {
            return Err(AppError::Validation("Unbekannter Einheitstyp".into()));
        }
    }
    if let Some(abschnitt) = daten.abschnitt_id {
        pruefe_abschnitt(pool, einsatz_id, abschnitt).await?;
    }
    if let Some(parent) = daten.ueber_einheit_id {
        pruefe_parent(pool, einsatz_id, parent).await?;
        if let Some(sid) = self_id {
            if waere_zyklus(pool, sid, parent).await? {
                return Err(AppError::Validation("Einheit darf nicht eigener Vorfahr werden".into()));
            }
        }
    }
    Ok(())
}

/// Legt eine Einheit an (nach Validierung). `org_id` für die Typ-Prüfung.
pub async fn anlegen(pool: &SqlitePool, einsatz_id: i64, org_id: i64, daten: EinheitDaten<'_>, angelegt_von: i64) -> Result<EinheitAnzeige, AppError> {
    validiere(pool, einsatz_id, org_id, None, &daten).await?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatz_einheit \
            (einsatz_id, abschnitt_id, ueber_einheit_id, typ_id, name, \
             soll_fuehrer, soll_unterfuehrer, soll_mannschaft, bemerkung, sortier, angelegt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.abschnitt_id).bind(daten.ueber_einheit_id).bind(daten.typ_id)
    .bind(daten.name).bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.bemerkung).bind(daten.sortier).bind(angelegt_von)
    .fetch_one(pool).await?;
    laden(pool, einsatz_id, id).await
}

/// Vollersatz der editierbaren Felder (ohne Führer). Parent-Wechsel zyklenfrei. `NotFound`,
/// falls die Einheit nicht zum Einsatz gehört.
pub async fn aktualisiere(pool: &SqlitePool, einsatz_id: i64, org_id: i64, id: i64, daten: EinheitDaten<'_>) -> Result<EinheitAnzeige, AppError> {
    laden(pool, einsatz_id, id).await?; // Existenz im Einsatz sichern
    validiere(pool, einsatz_id, org_id, Some(id), &daten).await?;
    let resultat = sqlx::query(
        "UPDATE einsatz_einheit SET abschnitt_id = ?, ueber_einheit_id = ?, typ_id = ?, name = ?, \
                soll_fuehrer = ?, soll_unterfuehrer = ?, soll_mannschaft = ?, bemerkung = ?, sortier = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.abschnitt_id).bind(daten.ueber_einheit_id).bind(daten.typ_id).bind(daten.name)
    .bind(daten.soll_fuehrer).bind(daten.soll_unterfuehrer).bind(daten.soll_mannschaft)
    .bind(daten.bemerkung).bind(daten.sortier).bind(id).bind(einsatz_id)
    .execute(pool).await?;
    if resultat.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

/// Reine Validierung (kein Write): Einheit gehört zum Einsatz, und bei `Some(ep)` ist die
/// Person Mitglied *dieser* Einheit. `NotFound`/`Validation`. Wird im Route-Handler **vor**
/// jeglichem Write aufgerufen, damit ein ungültiger Führer kein Teil-Update hinterlässt.
pub async fn pruefe_fuehrer(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, fuehrer_ep_id: Option<i64>) -> Result<(), AppError> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?")
        .bind(einheit_id).bind(einsatz_id).fetch_optional(pool).await?;
    exists.ok_or(AppError::NotFound)?;
    if let Some(ep) = fuehrer_ep_id {
        let mitglied: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM einsatz_personal WHERE id = ? AND einheit_id = ? AND einsatz_id = ?",
        ).bind(ep).bind(einheit_id).bind(einsatz_id).fetch_optional(pool).await?;
        if mitglied.is_none() {
            return Err(AppError::Validation("Führer muss Mitglied dieser Einheit sein".into()));
        }
    }
    Ok(())
}

/// Setzt (oder leert mit `None`) den Führer einer Einheit. Validiert vorab über
/// `pruefe_fuehrer`. `NotFound`/`Validation` wie dort.
pub async fn setze_fuehrer(pool: &SqlitePool, einsatz_id: i64, einheit_id: i64, fuehrer_ep_id: Option<i64>) -> Result<(), AppError> {
    pruefe_fuehrer(pool, einsatz_id, einheit_id, fuehrer_ep_id).await?;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ? AND einsatz_id = ?")
        .bind(fuehrer_ep_id).bind(einheit_id).bind(einsatz_id).execute(pool).await?;
    Ok(())
}

/// Löst eine Einheit auf (Transaktion): alle Mitglieder freigeben (`einheit_id = NULL` an
/// Personal + Fahrzeug), Unter-Einheiten auf den Parent hochziehen, dann löschen.
/// `NotFound`, falls nicht zum Einsatz.
pub async fn loese_auf(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let parent: Option<i64> = sqlx::query_scalar(
        "SELECT ueber_einheit_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
    ).bind(id).bind(einsatz_id).fetch_optional(pool).await?.ok_or(AppError::NotFound)?;

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE einsatz_personal SET einheit_id = NULL WHERE einheit_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_fahrzeug SET einheit_id = NULL WHERE einheit_id = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("UPDATE einsatz_einheit SET ueber_einheit_id = ? WHERE ueber_einheit_id = ? AND einsatz_id = ?")
        .bind(parent).bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?").bind(id).bind(einsatz_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org(1) + Einsatz + ein Benutzer (angelegt_von); liefert (einsatz, benutzer).
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')").execute(pool).await.unwrap();
        let benutzer: i64 = sqlx::query_scalar("INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1, 'U', 'u', 'h') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let einsatz: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id")
            .fetch_one(pool).await.unwrap();
        (einsatz, benutzer)
    }

    fn daten<'a>(name: &'a str, typ: Option<i64>, abschnitt: Option<i64>, parent: Option<i64>, soll: Option<(i64, i64, i64)>) -> EinheitDaten<'a> {
        let (f, u, m) = match soll { Some((f, u, m)) => (Some(f), Some(u), Some(m)), None => (None, None, None) };
        EinheitDaten {
            name, abschnitt_id: abschnitt, ueber_einheit_id: parent, typ_id: typ,
            soll_fuehrer: f, soll_unterfuehrer: u, soll_mannschaft: m, bemerkung: None, sortier: 0,
        }
    }

    async fn ad_hoc_person(pool: &SqlitePool, einsatz: i64, name: &str, pos: &str) -> i64 {
        sqlx::query_scalar("INSERT INTO einsatz_personal (einsatz_id, snap_name, staerke_position) VALUES (?, ?, ?) RETURNING id")
            .bind(einsatz).bind(name).bind(pos).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn anlegen_loest_typ_und_abschnitt_auf() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18) RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let abschnitt: i64 = sqlx::query_scalar("INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id")
            .bind(einsatz).fetch_one(&pool).await.unwrap();

        let e = anlegen(&pool, einsatz, 1, daten("1. Zug", Some(typ), Some(abschnitt), None, None), b).await.unwrap();
        assert_eq!(e.typ_label.as_deref(), Some("Zug"));
        assert_eq!(e.abschnitt_name.as_deref(), Some("Nord"));
        // Kein Override → Soll kommt aus dem Typ.
        assert_eq!(e.soll, Some(Staerke::neu(1, 3, 18)));
        assert_eq!(e.ist, Staerke::neu(0, 0, 0));
    }

    #[tokio::test]
    async fn soll_override_schlaegt_typ_default_und_ohne_typ_ist_none() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) VALUES (1, 'Zug', 1, 3, 18) RETURNING id")
            .fetch_one(&pool).await.unwrap();
        // Override 0/2/10 schlägt Typ-Default.
        let mit_override = anlegen(&pool, einsatz, 1, daten("Sonderzug", Some(typ), None, None, Some((0, 2, 10))), b).await.unwrap();
        assert_eq!(mit_override.soll, Some(Staerke::neu(0, 2, 10)));
        // Kein Typ, kein Override → None.
        let ohne = anlegen(&pool, einsatz, 1, daten("Freie Einheit", None, None, None, None), b).await.unwrap();
        assert_eq!(ohne.soll, None);
    }

    #[tokio::test]
    async fn typ_aus_fremder_org_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Fremd')").execute(&pool).await.unwrap();
        let fremd_typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label) VALUES (2, 'Zug') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, 1, daten("X", Some(fremd_typ), None, None, None), b).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn deaktivierter_typ_bleibt_beim_aktualisieren_gueltig() {
        // Entscheidung 4: ein deaktivierter Typ bleibt für bestehende Einheiten gültig.
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let typ: i64 = sqlx::query_scalar("INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Zug') RETURNING id")
            .fetch_one(&pool).await.unwrap();
        let e = anlegen(&pool, einsatz, 1, daten("1. Zug", Some(typ), None, None, None), b).await.unwrap();
        // Typ deaktivieren.
        crate::einheit::typ_repo::deaktivieren(&pool, 1, typ).await.unwrap();
        // PATCH (nur Name) muss trotzdem gelingen, Typ bleibt referenziert.
        let nachher = aktualisiere(&pool, einsatz, 1, e.id, daten("1. Zug umbenannt", Some(typ), None, None, None)).await.unwrap();
        assert_eq!(nachher.name, "1. Zug umbenannt");
        assert_eq!(nachher.typ_id, Some(typ));
    }

    #[tokio::test]
    async fn parent_in_fremdem_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let fremd: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id").fetch_one(&pool).await.unwrap();
        let fremd_einheit = anlegen(&pool, fremd, 1, daten("F", None, None, None, None), b).await.unwrap();
        assert!(matches!(
            anlegen(&pool, einsatz, 1, daten("X", None, None, Some(fremd_einheit.id), None), b).await.unwrap_err(),
            AppError::NotFound
        ));
    }

    #[tokio::test]
    async fn zyklus_transitiv_ist_validation() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let a = anlegen(&pool, einsatz, 1, daten("A", None, None, None, None), b).await.unwrap();
        let c = anlegen(&pool, einsatz, 1, daten("B", None, None, Some(a.id), None), b).await.unwrap();
        let d = anlegen(&pool, einsatz, 1, daten("C", None, None, Some(c.id), None), b).await.unwrap();
        // A unter C (Nachfahre) → transitiver Zyklus.
        assert!(matches!(
            aktualisiere(&pool, einsatz, 1, a.id, daten("A", None, None, Some(d.id), None)).await.unwrap_err(),
            AppError::Validation(_)
        ));
    }

    #[tokio::test]
    async fn fuehrer_muss_mitglied_dieser_einheit_sein() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let e = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, None, None), b).await.unwrap();
        let chef = ad_hoc_person(&pool, einsatz, "Chef", "fuehrer").await;
        // Noch nicht Mitglied → Validation.
        assert!(matches!(setze_fuehrer(&pool, einsatz, e.id, Some(chef)).await.unwrap_err(), AppError::Validation(_)));
        // Nach Zuordnung erlaubt.
        mitglied_repo::ordne_personal_zu(&pool, einsatz, e.id, chef).await.unwrap();
        setze_fuehrer(&pool, einsatz, e.id, Some(chef)).await.unwrap();
        assert_eq!(laden(&pool, einsatz, e.id).await.unwrap().fuehrer_id, Some(chef));
        // fuehrer_name aufgelöst.
        assert_eq!(laden(&pool, einsatz, e.id).await.unwrap().fuehrer_name.as_deref(), Some("Chef"));
    }

    #[tokio::test]
    async fn ist_kumuliert_summiert_unterstellte_rekursiv() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        // Zug → Gruppe → Trupp (3 Ebenen).
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b).await.unwrap();
        let gruppe = anlegen(&pool, einsatz, 1, daten("Gruppe", None, None, Some(zug.id), None), b).await.unwrap();
        let trupp = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, Some(gruppe.id), None), b).await.unwrap();
        // je Ebene ein Mannschafter.
        for (einheit, name) in [(zug.id, "Z"), (gruppe.id, "G"), (trupp.id, "T")] {
            let ep = ad_hoc_person(&pool, einsatz, name, "mannschaft").await;
            mitglied_repo::ordne_personal_zu(&pool, einsatz, einheit, ep).await.unwrap();
        }
        let zug_geladen = laden(&pool, einsatz, zug.id).await.unwrap();
        assert_eq!(zug_geladen.ist, Staerke::neu(0, 0, 1), "eigene Ist");
        assert_eq!(zug_geladen.ist_kumuliert, Staerke::neu(0, 0, 3), "eigene + Gruppe + Trupp");
        let gruppe_geladen = laden(&pool, einsatz, gruppe.id).await.unwrap();
        assert_eq!(gruppe_geladen.ist_kumuliert, Staerke::neu(0, 0, 2));
    }

    #[tokio::test]
    async fn aufloesen_gibt_mitglieder_frei_und_zieht_unter_einheiten_hoch() {
        let pool = crate::db::test_pool().await;
        let (einsatz, b) = setup(&pool).await;
        let zug = anlegen(&pool, einsatz, 1, daten("Zug", None, None, None, None), b).await.unwrap();
        let gruppe = anlegen(&pool, einsatz, 1, daten("Gruppe", None, None, Some(zug.id), None), b).await.unwrap();
        let trupp = anlegen(&pool, einsatz, 1, daten("Trupp", None, None, Some(gruppe.id), None), b).await.unwrap();
        let ep = ad_hoc_person(&pool, einsatz, "Mann", "mannschaft").await;
        mitglied_repo::ordne_personal_zu(&pool, einsatz, gruppe.id, ep).await.unwrap();

        loese_auf(&pool, einsatz, gruppe.id).await.unwrap();

        // Mitglied frei.
        let einheit_id: Option<i64> = sqlx::query_scalar("SELECT einheit_id FROM einsatz_personal WHERE id = ?").bind(ep).fetch_one(&pool).await.unwrap();
        assert_eq!(einheit_id, None);
        // Trupp hängt jetzt direkt unter Zug.
        assert_eq!(laden(&pool, einsatz, trupp.id).await.unwrap().ueber_einheit_id, Some(zug.id));
        // Gruppe ist weg.
        assert!(matches!(laden(&pool, einsatz, gruppe.id).await.unwrap_err(), AppError::NotFound));
    }
}
