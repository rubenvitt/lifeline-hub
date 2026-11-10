//! Übernehmen am Spiegel (design.md D4, D5, D7): eine Lieferung je Einsatz in einem Savepoint,
//! unter dem Merker `spiegel_uebernahme`. Zeilen werden über `spiegel_herkunft` abgebildet,
//! angelegt oder geändert; Löschungen zuerst. Eine Zeile, deren Pflichtverweis noch fehlt,
//! wartet auf die übrigen Zeilen der Lieferung; nullbare Verweise setzt ein zweiter Durchgang.
//! Der Stand rückt höchstens bis `bis` vor und bleibt vor einer Zeile stehen, die nicht
//! übernommen wurde; eine Lieferung ab 0 setzt ihn.

use super::abbildung;
use super::art::Schluessel;
use super::katalog;
use super::liefern::{quali_ersetzen, quali_ids};
use super::paket::{BlobAngabe, EinsatzLieferung, KontoAngabe, Zeile};
use super::schema::{self, Tabelle, Ziel, SKIZZE_ELEMENTE};
use super::{Freigabestufe, SpiegelKategorie};
use crate::error::AppError;
use crate::instanz::stammdaten::StammdatenArt;
use serde_json::{Map, Value};
use sqlx::SqliteConnection;
use std::collections::{BTreeSet, HashMap};

/// Wer übernimmt.
#[derive(Debug, Clone, Copy)]
pub struct Empfaenger {
    pub kopplung_id: i64,
    pub kopplung_org_id: i64,
    /// Lokale Org der Zuordnung.
    pub org_id: i64,
    /// Diese Instanz meldet sich; dann bildet sie Stammdaten fremd → lokal ab (D5).
    pub meldend: bool,
}

/// Ein Inhalt auf Abruf, den der Spiegel noch holen muss (D8).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OffenerInhalt {
    pub art: String,
    pub fremder_schluessel: String,
    pub lokaler_schluessel: String,
    pub angabe: BlobAngabe,
}

/// Ergebnis einer Übernahme.
#[derive(Debug, Default)]
pub struct Ergebnis {
    /// Lokaler Einsatz, wenn es ihn gibt.
    pub einsatz_id: Option<i64>,
    /// Stand, den der Spiegel jetzt nennt.
    pub stand: i64,
    /// Kategorien, die sich geändert haben (Live-Ereignis, D7).
    pub kategorien: BTreeSet<SpiegelKategorie>,
    pub hinweise: Vec<String>,
    pub inhalte: Vec<OffenerInhalt>,
}

/// Ein nullbarer Verweis, der erst nach allen Zeilen gesetzt wird.
struct Offen {
    tabelle: &'static str,
    lokal: String,
    spalte: String,
    ziel: &'static str,
    fremd: String,
}

/// Wie eine Zeile abgebildet wurde.
enum Abgebildet {
    /// Werte je Spalte (lokal), dazu Verweise für den zweiten Durchgang.
    Fertig(Vec<(String, Value)>, Vec<(String, &'static str, String)>),
    /// Ein Pflichtverweis fehlt noch.
    Wartet,
}

/// Übernimmt eine Lieferung. Fehler einzelner Zeilen landen als Hinweis; der Rest der Lieferung
/// gilt (eine Zeile allein hält den Spiegel nicht an).
pub async fn uebernehmen(
    conn: &mut SqliteConnection,
    e: &Empfaenger,
    l: &EinsatzLieferung,
) -> Result<Ergebnis, AppError> {
    let mut ergebnis = Ergebnis::default();
    #[allow(clippy::type_complexity)]
    let gefunden: Option<(i64, i64, Option<i64>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT s.einsatz_id, s.stand, s.kopplung_org_id, o.kopplung_id, s.beendet_at \
         FROM einsatz_spiegel s LEFT JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
         WHERE s.fremde_kennung = ?",
    )
    .bind(&l.kennung)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((_, _, _, Some(k), _)) = gefunden {
        if k != e.kopplung_id {
            // Der Spiegel gehört zu einer anderen Kopplung: nur sein Führer liefert ihn.
            ergebnis.hinweise.push(format!(
                "Einsatz {} wird über eine andere Kopplung gespiegelt; Lieferung verworfen.",
                l.kennung
            ));
            return Ok(ergebnis);
        }
    }
    if let Some((id, _, ko, _, beendet)) = &gefunden {
        if *ko != Some(e.kopplung_org_id) || beendet.is_some() {
            // Neu zugeordnet oder neu gekoppelt (der Absender ist derselbe Führer, das prüft der
            // Aufrufer an der Kennung): der Spiegel hängt sich wieder an.
            sqlx::query(
                "UPDATE einsatz_spiegel SET kopplung_org_id = ?, beendet_at = NULL WHERE einsatz_id = ?",
            )
            .bind(e.kopplung_org_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        }
    }
    let vorhanden = gefunden.map(|(id, stand, ..)| (id, stand));
    if let Some((id, stand)) = vorhanden {
        ergebnis.einsatz_id = Some(id);
        ergebnis.stand = stand;
        if stand < l.seit {
            // Lücke (etwa nach einer Wiederherstellung): nichts übernehmen, den eigenen Stand
            // nennen; die Gegenseite liefert ab dort neu (Spec `einsatz-spiegel`).
            return Ok(ergebnis);
        }
    }
    if Freigabestufe::parse(&l.freigabestufe).is_none() {
        ergebnis
            .hinweise
            .push("Freigabestufe unbekannt, Update nötig.".into());
        return Ok(ergebnis);
    }
    if vorhanden.is_none() {
        let gefuehrt: Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE kennung = ? AND spiegel = 0")
                .bind(&l.kennung)
                .fetch_optional(&mut *conn)
                .await?;
        if gefuehrt.is_some() {
            ergebnis.hinweise.push(format!(
                "Einsatz {} wird hier geführt; Lieferung verworfen.",
                l.kennung
            ));
            return Ok(ergebnis);
        }
        if !l.zeilen.iter().any(|z| z.art == "einsatz" && !z.geloescht) {
            // Ohne Kopf lässt sich kein Spiegel anlegen: die Gegenseite liefert ab 0 neu.
            ergebnis.stand = 0;
            return Ok(ergebnis);
        }
    }
    let schema = schema::schema(conn).await?;
    sqlx::query("SAVEPOINT spiegel_lieferung")
        .execute(&mut *conn)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *conn)
        .await?;
    let lauf = uebernehme_zeilen(conn, schema, e, l, vorhanden.map(|v| v.0), &mut ergebnis).await;
    let schluss = sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *conn)
        .await;
    match (lauf, schluss) {
        (Ok(()), Ok(_)) => {
            sqlx::query("RELEASE spiegel_lieferung")
                .execute(&mut *conn)
                .await?;
            Ok(ergebnis)
        }
        (lauf, schluss) => {
            let f = match (lauf, schluss) {
                (Err(f), _) => f,
                (_, Err(f)) => AppError::from(f),
                _ => unreachable!(),
            };
            sqlx::query("ROLLBACK TO spiegel_lieferung")
                .execute(&mut *conn)
                .await?;
            sqlx::query("RELEASE spiegel_lieferung")
                .execute(&mut *conn)
                .await?;
            Err(f)
        }
    }
}

async fn uebernehme_zeilen(
    conn: &mut SqliteConnection,
    schema: &'static schema::Schema,
    e: &Empfaenger,
    l: &EinsatzLieferung,
    vorhanden: Option<i64>,
    ergebnis: &mut Ergebnis,
) -> Result<(), AppError> {
    let konten: HashMap<i64, &KontoAngabe> = l.konten.iter().map(|k| (k.id, k)).collect();
    let mut einsatz_id = vorhanden;
    // Der Kopf zuerst: an ihm hängen alle anderen Zeilen.
    if let Some(kopf) = l.zeilen.iter().find(|z| z.art == "einsatz" && !z.geloescht) {
        let t = schema.tabelle("einsatz").expect("einsatz ist gespiegelt");
        let id = kopf_uebernehmen(conn, t, e, l, kopf, einsatz_id, &konten).await?;
        einsatz_id = Some(id);
        ergebnis.kategorien.insert(t.kategorie);
    }
    let Some(einsatz_id) = einsatz_id else {
        return Ok(());
    };
    ergebnis.einsatz_id = Some(einsatz_id);
    // Löschungen zuerst: eine neue Zeile kann den Platz einer gelöschten einnehmen (Reihenfolge,
    // eindeutige Paare). Hängt an der Zeile noch ein Verweis, den erst eine geänderte Zeile dieser
    // Lieferung löst (Abschnitt auflösen: Einheiten verlieren ihn vorher), folgt sie danach.
    let mut spaeter_loeschen: Vec<&Zeile> = Vec::new();
    for z in l
        .zeilen
        .iter()
        .filter(|z| z.geloescht && z.art != "einsatz")
    {
        match loeschen(conn, schema, einsatz_id, z, ergebnis).await {
            Ok(()) => {}
            Err(AppError::Database(_)) => spaeter_loeschen.push(z),
            Err(f) => return Err(f),
        }
    }
    // Anlegen und Ändern, in Runden, bis keine wartende Zeile mehr vorankommt.
    let mut wartend: Vec<&Zeile> = l
        .zeilen
        .iter()
        .filter(|z| !z.geloescht && z.art != "einsatz")
        .collect();
    let mut offen: Vec<Offen> = Vec::new();
    let mut fehler: HashMap<(&str, &str), String> = HashMap::new();
    loop {
        let vorher = wartend.len();
        let mut naechste = Vec::new();
        for z in wartend {
            let Some(t) = schema.tabelle(&z.art) else {
                continue;
            };
            let Some(Value::Object(daten)) = &z.daten else {
                continue;
            };
            // Eine Katalogzeile des Führers: Gegenstück oder Kopie (LLH-1629).
            let kopie;
            let daten = if katalog::ist_katalog_daten(t.name, daten) {
                match katalog::uebernehmen(conn, e, einsatz_id, z, daten).await? {
                    katalog::Katalog::Gegenstueck => continue,
                    katalog::Katalog::Kopie(d) => {
                        kopie = d;
                        &kopie
                    }
                }
            } else {
                daten
            };
            match abbilden(conn, t, e, l, einsatz_id, daten, &konten).await? {
                Abgebildet::Wartet => naechste.push(z),
                Abgebildet::Fertig(werte, _)
                    if ist_mitgliedschaft_eines_stellvertreters(conn, t, &werte).await? =>
                {
                    // Ein Stellvertreter wird nie Mitglied (D5): die Zeile entfällt still.
                    let _ = werte;
                }
                Abgebildet::Fertig(werte, spaeter) => {
                    match zeile_schreiben(conn, t, einsatz_id, &z.schluessel, &werte).await {
                        Ok(lokal) => {
                            ergebnis.kategorien.insert(t.kategorie);
                            for (spalte, ziel, fremd) in spaeter {
                                offen.push(Offen {
                                    tabelle: t.name,
                                    lokal: lokal.clone(),
                                    spalte,
                                    ziel,
                                    fremd,
                                });
                            }
                            if let Some(angabe) = &z.blob {
                                ergebnis.inhalte.push(OffenerInhalt {
                                    art: z.art.clone(),
                                    fremder_schluessel: z.schluessel.clone(),
                                    lokaler_schluessel: lokal,
                                    angabe: angabe.clone(),
                                });
                            }
                        }
                        Err(AppError::Database(f)) => {
                            // Etwa ein eindeutiger Index, den eine spätere Zeile der Lieferung
                            // erst freigibt: in der nächsten Runde noch einmal.
                            fehler.insert((z.art.as_str(), z.schluessel.as_str()), f.to_string());
                            naechste.push(z);
                        }
                        Err(f) => return Err(f),
                    }
                }
            }
        }
        wartend = naechste;
        if wartend.is_empty() || wartend.len() == vorher {
            break;
        }
    }
    // Ein Stand vor der ersten Zeile, die nicht übernommen wurde: der Führer liefert sie mit
    // dem nächsten Abgleich wieder, statt dass sie still fehlt (D7).
    let mut nachholen_ab: Option<i64> = None;
    for z in &wartend {
        let grund = fehler
            .get(&(z.art.as_str(), z.schluessel.as_str()))
            .cloned()
            .unwrap_or_else(|| "Bezug fehlt.".into());
        ergebnis.hinweise.push(format!(
            "Zeile {} {} nicht übernommen: {grund}",
            z.art, z.schluessel
        ));
        nachholen_ab = Some(nachholen_ab.map_or(z.stand, |n| n.min(z.stand)));
    }
    for z in spaeter_loeschen {
        if let Err(f) = loeschen(conn, schema, einsatz_id, z, ergebnis).await {
            let AppError::Database(f) = f else {
                return Err(f);
            };
            ergebnis.hinweise.push(format!(
                "Zeile {} {} nicht gelöscht: {f}",
                z.art, z.schluessel
            ));
            nachholen_ab = Some(nachholen_ab.map_or(z.stand, |n| n.min(z.stand)));
        }
    }
    // Zweiter Durchgang: nullbare Verweise auf Zeilen, die erst später kamen.
    for o in offen {
        let Some(lokal_ziel) = ziel_lokal(conn, einsatz_id, o.ziel, &o.fremd).await? else {
            continue;
        };
        let t = schema.tabelle(o.tabelle).expect("Tabelle aus dem Schema");
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {} SET \"{}\" = ? WHERE {}",
            t.name,
            o.spalte,
            t.schluessel.gleich(t.name)
        )))
        .bind(lokal_ziel)
        .bind(&o.lokal)
        .execute(&mut *conn)
        .await?;
    }
    super::anhang::merke_inhalte(conn, einsatz_id, &ergebnis.inhalte).await?;
    // Ab 0 geliefert (neu, wieder angebunden oder der Führer nach einer Wiederherstellung):
    // der Stand gilt, wie er kommt; sonst rückt er nur vor.
    let bis = nachholen_ab.map_or(l.bis, |n| (n - 1).clamp(l.seit, l.bis));
    sqlx::query(
        "UPDATE einsatz_spiegel SET stand = CASE WHEN ? = 0 THEN ? ELSE MAX(stand, ?) END, \
         letzter_abgleich_at = ?, freigabestufe = ? WHERE einsatz_id = ?",
    )
    .bind(l.seit)
    .bind(bis)
    .bind(bis)
    .bind(crate::zeit::jetzt())
    .bind(&l.freigabestufe)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    ergebnis.stand = sqlx::query_scalar("SELECT stand FROM einsatz_spiegel WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    Ok(())
}

/// Löscht die lokale Zeile einer gelieferten Löschung samt Herkunft.
async fn loeschen(
    conn: &mut SqliteConnection,
    schema: &schema::Schema,
    einsatz_id: i64,
    z: &Zeile,
    ergebnis: &mut Ergebnis,
) -> Result<(), AppError> {
    let Some(t) = schema.tabelle(&z.art) else {
        return Ok(());
    };
    let Some(lokal) = abbildung::einsatz_lokal(conn, einsatz_id, &z.art, &z.schluessel).await?
    else {
        // Ein Gegenstück aus dem eigenen Katalog bleibt; nur die Abbildung fällt weg (LLH-1629).
        sqlx::query(
            "DELETE FROM spiegel_katalog WHERE einsatz_id = ? AND art = ? AND fremder_schluessel = ?",
        )
        .bind(einsatz_id)
        .bind(&z.art)
        .bind(&z.schluessel)
        .execute(&mut *conn)
        .await?;
        return Ok(());
    };
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM {} WHERE {}",
        t.name,
        t.schluessel.gleich(t.name)
    )))
    .bind(&lokal)
    .execute(&mut *conn)
    .await?;
    if t.blob.is_some() {
        super::anhang::vergiss(conn, t.name, &lokal).await?;
    }
    sqlx::query(
        "DELETE FROM spiegel_herkunft WHERE einsatz_id = ? AND art = ? AND fremder_schluessel = ?",
    )
    .bind(einsatz_id)
    .bind(&z.art)
    .bind(&z.schluessel)
    .execute(&mut *conn)
    .await?;
    ergebnis.kategorien.insert(t.kategorie);
    Ok(())
}

/// Legt den Kopf eines neuen Spiegels an oder ändert ihn.
#[allow(clippy::too_many_arguments)]
async fn kopf_uebernehmen(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    e: &Empfaenger,
    l: &EinsatzLieferung,
    kopf: &Zeile,
    vorhanden: Option<i64>,
    konten: &HashMap<i64, &KontoAngabe>,
) -> Result<i64, AppError> {
    let Some(Value::Object(daten)) = &kopf.daten else {
        return Err(AppError::Internal("Kopf ohne Daten".into()));
    };
    let Abgebildet::Fertig(mut werte, _) =
        abbilden(conn, t, e, l, vorhanden.unwrap_or(0), daten, konten).await?
    else {
        return Err(AppError::Internal("Kopf nicht abbildbar".into()));
    };
    werte.retain(|(s, _)| s != "id" && s != "kennung");
    werte.push(("kennung".into(), Value::from(l.kennung.clone())));
    if let Some(id) = vorhanden {
        update(conn, t.name, &werte, "id", &id.to_string()).await?;
        return Ok(id);
    }
    werte.push(("spiegel".into(), Value::from(1)));
    let id = insert(conn, t.name, &werte).await?;
    sqlx::query(
        "INSERT INTO einsatz_spiegel (einsatz_id, kopplung_org_id, fremde_kennung, freigabestufe) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(e.kopplung_org_id)
    .bind(&l.kennung)
    .bind(&l.freigabestufe)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO spiegel_herkunft (einsatz_id, art, fremder_schluessel, lokaler_schluessel) \
         VALUES (?, 'einsatz', ?, ?)",
    )
    .bind(id)
    .bind(&kopf.schluessel)
    .bind(id.to_string())
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

async fn ist_mitgliedschaft_eines_stellvertreters(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    werte: &[(String, Value)],
) -> Result<bool, AppError> {
    if t.name != "einsatz_mitgliedschaft" {
        return Ok(false);
    }
    let Some(id) = werte
        .iter()
        .find(|(s, _)| s == "benutzer_id")
        .and_then(|(_, w)| w.as_i64())
    else {
        return Ok(false);
    };
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM spiegel_konto WHERE benutzer_id = ?)")
            .bind(id)
            .fetch_one(&mut *conn)
            .await?,
    )
}

/// Lokaler Schlüssel der Zeile `fremd` in `ziel` (der Einsatz selbst ist immer bekannt).
async fn ziel_lokal(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ziel: &str,
    fremd: &str,
) -> Result<Option<i64>, AppError> {
    if ziel == "einsatz" {
        return Ok(Some(einsatz_id));
    }
    let lokal = match abbildung::einsatz_lokal(conn, einsatz_id, ziel, fremd).await? {
        Some(l) => Some(l),
        // Eine mitbenutzte Katalogzeile (LLH-1629).
        None => katalog::lokal(conn, einsatz_id, ziel, fremd).await?,
    };
    Ok(lokal.and_then(|l| l.parse().ok()))
}

/// Bildet die Werte einer Zeile ab (D5).
#[allow(clippy::too_many_arguments)]
async fn abbilden(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    e: &Empfaenger,
    l: &EinsatzLieferung,
    einsatz_id: i64,
    daten: &Map<String, Value>,
    konten: &HashMap<i64, &KontoAngabe>,
) -> Result<Abgebildet, AppError> {
    let mut werte = Vec::new();
    let mut spaeter = Vec::new();
    for s in &t.spalten {
        // Unbekannte Spalten einer neueren Gegenseite fallen weg, fehlende behalten ihren Wert
        // oder die Vorgabe (D7).
        let Some(wert) = daten.get(&s.name) else {
            continue;
        };
        let wert = match (&s.verweis, wert) {
            (_, Value::Null) | (None, _) => wert.clone(),
            (Some(ziel), _) => {
                match ziel_abbilden(conn, ziel, e, l, einsatz_id, daten, wert, konten).await? {
                    Ziel1::Wert(w) => w,
                    Ziel1::Fehlt(ziel_t, fremd) => {
                        if s.pflicht {
                            return Ok(Abgebildet::Wartet);
                        }
                        spaeter.push((s.name.clone(), ziel_t, fremd));
                        Value::Null
                    }
                    Ziel1::Leer if s.pflicht => {
                        return Ok(Abgebildet::Wartet);
                    }
                    Ziel1::Leer => Value::Null,
                }
            }
        };
        werte.push((s.name.clone(), wert));
    }
    Ok(Abgebildet::Fertig(werte, spaeter))
}

/// Ergebnis der Abbildung eines Verweises.
enum Ziel1 {
    Wert(Value),
    /// Eine Einsatzzeile, die (noch) nicht da ist.
    Fehlt(&'static str, String),
    /// Kein Gegenstück.
    Leer,
}

#[allow(clippy::too_many_arguments)]
async fn ziel_abbilden(
    conn: &mut SqliteConnection,
    ziel: &Ziel,
    e: &Empfaenger,
    l: &EinsatzLieferung,
    einsatz_id: i64,
    daten: &Map<String, Value>,
    wert: &Value,
    konten: &HashMap<i64, &KontoAngabe>,
) -> Result<Ziel1, AppError> {
    let einsatzzeile = |t: &'static str| (t, wert.as_i64().map(|i| i.to_string()));
    let (ziel_t, fremd) = match ziel {
        Ziel::Einsatz(t) => einsatzzeile(t),
        Ziel::Polymorph { typ_spalte, ziele } => {
            let typ = daten.get(*typ_spalte).and_then(Value::as_str);
            match ziele.iter().find(|(w, _)| Some(*w) == typ) {
                Some((_, t)) => einsatzzeile(t),
                // Kein Zeilenverweis (etwa ein Zeitpunkt): bleibt, wie er ist.
                None => return Ok(Ziel1::Wert(wert.clone())),
            }
        }
        Ziel::Konto => {
            let Some(id) = wert.as_i64() else {
                return Ok(Ziel1::Leer);
            };
            let ersatz;
            let angabe = match konten.get(&id) {
                Some(a) => *a,
                None => {
                    ersatz = KontoAngabe {
                        id,
                        anzeigename: format!("Konto {id}"),
                        gegen_id: None,
                    };
                    &ersatz
                }
            };
            let lokal = abbildung::konto_lokal(
                conn,
                e.kopplung_id,
                e.kopplung_org_id,
                e.org_id,
                e.meldend,
                angabe,
            )
            .await?;
            return Ok(Ziel1::Wert(Value::from(lokal)));
        }
        Ziel::Stammdaten(art) => {
            if !e.meldend {
                // Die meldende Seite hat schon übersetzt (D5).
                return Ok(Ziel1::Wert(wert.clone()));
            }
            let Some(id) = wert.as_i64() else {
                return Ok(Ziel1::Leer);
            };
            return Ok(
                match abbildung::stammdaten_lokal(conn, e.kopplung_org_id, *art, id).await? {
                    Some(l) => Ziel1::Wert(Value::from(l)),
                    None => Ziel1::Leer,
                },
            );
        }
        Ziel::Org => {
            return Ok(if wert.as_i64() == Some(l.org_id) {
                Ziel1::Wert(Value::from(e.org_id))
            } else {
                Ziel1::Leer
            });
        }
        Ziel::QualiSoll | Ziel::QualiListe => {
            if !e.meldend {
                return Ok(Ziel1::Wert(wert.clone()));
            }
            let mut abb = HashMap::new();
            for q in quali_ids(wert) {
                let lokal = abbildung::stammdaten_lokal(
                    conn,
                    e.kopplung_org_id,
                    StammdatenArt::Qualifikation,
                    q,
                )
                .await?;
                abb.insert(q, lokal);
            }
            return Ok(Ziel1::Wert(quali_ersetzen(wert, &abb)));
        }
        Ziel::SkizzenElement => {
            let Some(text) = wert.as_str() else {
                return Ok(Ziel1::Wert(wert.clone()));
            };
            let Some((praefix, t)) = SKIZZE_ELEMENTE.iter().find(|(p, _)| text.starts_with(p))
            else {
                return Ok(Ziel1::Wert(wert.clone()));
            };
            let fremd = &text[praefix.len()..];
            return Ok(match ziel_lokal(conn, einsatz_id, t, fremd).await? {
                Some(lokal) => Ziel1::Wert(Value::from(format!("{praefix}{lokal}"))),
                None => Ziel1::Leer,
            });
        }
        Ziel::SnapshotBilder => {
            return Ok(Ziel1::Wert(snapshot_bilder(conn, einsatz_id, wert).await?));
        }
    };
    let Some(fremd) = fremd else {
        return Ok(Ziel1::Wert(wert.clone()));
    };
    Ok(match ziel_lokal(conn, einsatz_id, ziel_t, &fremd).await? {
        Some(lokal) => Ziel1::Wert(Value::from(lokal)),
        None => Ziel1::Fehlt(ziel_t, fremd),
    })
}

/// Bildet im eingefrorenen Lagestand nur `bilder[].id` ab (Nachtrag D3); der Client lädt das
/// Kartenbild live über diese Kennung.
async fn snapshot_bilder(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    wert: &Value,
) -> Result<Value, AppError> {
    let Some(text) = wert.as_str() else {
        return Ok(wert.clone());
    };
    let Ok(mut doc) = serde_json::from_str::<Value>(text) else {
        return Ok(wert.clone());
    };
    if let Some(Value::Array(bilder)) = doc.get_mut("bilder") {
        for b in bilder.iter_mut() {
            let Some(id) = b.get("id").and_then(Value::as_i64) else {
                continue;
            };
            let lokal =
                ziel_lokal(conn, einsatz_id, "karte_hintergrundbild", &id.to_string()).await?;
            b["id"] = lokal.map_or(Value::Null, Value::from);
        }
    }
    Ok(Value::from(doc.to_string()))
}

/// Schreibt eine abgebildete Zeile und hält ihre Herkunft fest; liefert den lokalen Schlüssel.
async fn zeile_schreiben(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    einsatz_id: i64,
    fremd: &str,
    werte: &[(String, Value)],
) -> Result<String, AppError> {
    sqlx::query("SAVEPOINT spiegel_zeile")
        .execute(&mut *conn)
        .await?;
    let lauf = zeile_schreiben_innen(conn, t, einsatz_id, fremd, werte).await;
    if lauf.is_err() {
        sqlx::query("ROLLBACK TO spiegel_zeile")
            .execute(&mut *conn)
            .await?;
    }
    sqlx::query("RELEASE spiegel_zeile")
        .execute(&mut *conn)
        .await?;
    lauf
}

async fn zeile_schreiben_innen(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    einsatz_id: i64,
    fremd: &str,
    werte: &[(String, Value)],
) -> Result<String, AppError> {
    let bekannt = abbildung::einsatz_lokal(conn, einsatz_id, t.name, fremd).await?;
    let lokal = match &t.schluessel {
        Schluessel::Spalte(pk) if pk == "id" => {
            let ohne_id: Vec<(String, Value)> =
                werte.iter().filter(|(s, _)| s != "id").cloned().collect();
            match bekannt {
                Some(l) if update(conn, t.name, &ohne_id, "id", &l).await? > 0 => l,
                _ => insert_mit_blob(conn, t, &ohne_id).await?.to_string(),
            }
        }
        Schluessel::Rowid => match bekannt {
            Some(l) if update(conn, t.name, werte, "rowid", &l).await? > 0 => l,
            _ => insert_mit_blob(conn, t, werte).await?.to_string(),
        },
        Schluessel::Spalte(pk) => upsert(conn, t, werte, std::slice::from_ref(pk)).await?,
        Schluessel::Spalten(pk) => upsert(conn, t, werte, pk).await?,
    };
    sqlx::query(
        "INSERT OR REPLACE INTO spiegel_herkunft (einsatz_id, art, fremder_schluessel, lokaler_schluessel) \
         VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz_id)
    .bind(t.name)
    .bind(fremd)
    .bind(&lokal)
    .execute(&mut *conn)
    .await?;
    Ok(lokal)
}

fn binde<'q>(
    mut q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>,
    w: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
    q = match w {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => q.bind(i),
            None => q.bind(n.as_f64()),
        },
        Value::String(s) => q.bind(s.clone()),
        w => q.bind(w.to_string()),
    };
    q
}

async fn insert(
    conn: &mut SqliteConnection,
    tabelle: &str,
    werte: &[(String, Value)],
) -> Result<i64, AppError> {
    let spalten: Vec<String> = werte.iter().map(|(s, _)| format!("\"{s}\"")).collect();
    let platz = vec!["?"; werte.len()].join(", ");
    let sql = if werte.is_empty() {
        format!("INSERT INTO {tabelle} DEFAULT VALUES")
    } else {
        format!(
            "INSERT INTO {tabelle} ({}) VALUES ({platz})",
            spalten.join(", ")
        )
    };
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (_, w) in werte {
        q = binde(q, w);
    }
    Ok(q.execute(&mut *conn).await?.last_insert_rowid())
}

/// Neue Zeile; eine Spalte mit Inhalt auf Abruf bekommt bis dahin einen leeren Inhalt (D8).
async fn insert_mit_blob(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    werte: &[(String, Value)],
) -> Result<i64, AppError> {
    match &t.blob {
        None => insert(conn, t.name, werte).await,
        Some(blob) => {
            let id = insert_leer_blob(conn, t.name, werte, blob).await?;
            Ok(id)
        }
    }
}

async fn insert_leer_blob(
    conn: &mut SqliteConnection,
    tabelle: &str,
    werte: &[(String, Value)],
    blob: &str,
) -> Result<i64, AppError> {
    let mut spalten: Vec<String> = werte.iter().map(|(s, _)| format!("\"{s}\"")).collect();
    spalten.push(format!("\"{blob}\""));
    let mut platz = vec!["?"; werte.len()];
    platz.push("X''");
    let sql = format!(
        "INSERT INTO {tabelle} ({}) VALUES ({})",
        spalten.join(", "),
        platz.join(", ")
    );
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (_, w) in werte {
        q = binde(q, w);
    }
    Ok(q.execute(&mut *conn).await?.last_insert_rowid())
}

async fn update(
    conn: &mut SqliteConnection,
    tabelle: &str,
    werte: &[(String, Value)],
    schluessel_spalte: &str,
    lokal: &str,
) -> Result<u64, AppError> {
    if werte.is_empty() {
        return Ok(1);
    }
    let setzen: Vec<String> = werte.iter().map(|(s, _)| format!("\"{s}\" = ?")).collect();
    let sql = format!(
        "UPDATE {tabelle} SET {} WHERE {schluessel_spalte} = ?",
        setzen.join(", ")
    );
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (_, w) in werte {
        q = binde(q, w);
    }
    Ok(q.bind(lokal.to_string())
        .execute(&mut *conn)
        .await?
        .rows_affected())
}

/// Zeile mit Primärschlüssel aus abgebildeten Spalten: anlegen oder ändern.
async fn upsert(
    conn: &mut SqliteConnection,
    t: &Tabelle,
    werte: &[(String, Value)],
    pk: &[String],
) -> Result<String, AppError> {
    let spalten: Vec<String> = werte.iter().map(|(s, _)| format!("\"{s}\"")).collect();
    let mut platz: Vec<&str> = vec!["?"; werte.len()];
    let mut alle = spalten.clone();
    if let Some(blob) = &t.blob {
        alle.push(format!("\"{blob}\""));
        platz.push("X''");
    }
    let andere: Vec<String> = werte
        .iter()
        .filter(|(s, _)| !pk.contains(s))
        .map(|(s, _)| format!("\"{s}\" = excluded.\"{s}\""))
        .collect();
    let konflikt = pk
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let tun = if andere.is_empty() {
        "DO NOTHING".to_string()
    } else {
        format!("DO UPDATE SET {}", andere.join(", "))
    };
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT ({konflikt}) {tun}",
        t.name,
        alle.join(", "),
        platz.join(", ")
    );
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (_, w) in werte {
        q = binde(q, w);
    }
    q.execute(&mut *conn).await?;
    // Lokaler Schlüssel im Format des Änderungslogs.
    let schluessel_sql = format!(
        "SELECT {} FROM (SELECT {}) AS z",
        t.schluessel.ausdruck("z"),
        pk.iter()
            .map(|s| format!("? AS \"{s}\""))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let mut q = sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(schluessel_sql));
    for s in pk {
        let w = werte
            .iter()
            .find(|(n, _)| n == s)
            .map(|(_, w)| w.clone())
            .unwrap_or(Value::Null);
        q = match w {
            Value::Number(n) if n.as_i64().is_some() => q.bind(n.as_i64()),
            Value::String(s) => q.bind(s),
            Value::Null => q.bind(None::<String>),
            w => q.bind(w.to_string()),
        };
    }
    Ok(q.fetch_one(&mut *conn).await?)
}
