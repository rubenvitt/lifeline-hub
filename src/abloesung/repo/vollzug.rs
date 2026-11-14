//! Vollzug einer Ablösung, auch mit Besatzungswechsel.

use super::*;

/// Was Vollzug und Rücknahme in der Transaktion brauchen.
pub(super) struct Vorgang<'a> {
    pub(super) einsatz_id: i64,
    pub(super) id: i64,
    pub(super) benutzer_id: i64,
    pub(super) jetzt: &'a str,
}

/// Vollzieht eine laufende Schicht (LLH-1132, LLH-1150). Gemeinsam ist beiden Arten: die Schicht
/// wird `abgeloest`, ihre Fristen schließen, und ein ETB-Eintrag nennt, was geschah.
///
/// **Ganze Einheit** ([`AbloesungArt::Einheit`]): die Ablöser kommen als Liste und werden zur Liste
/// der Schicht (`einsatz_abloesung_abloeser`). Je Ablöser, der den Knoten bildet (kein Vorfahr
/// ebenfalls in der Liste), entsteht eine Folgeschicht (Beginn = Vollzug, Rhythmus und
/// Einsatzstelle der abgelösten Schicht; folgt sie der Vorgabe des Einsatzes, rechnet deren Regel
/// neu, etwa bis zum nächsten Wechsel). Hat ein Ablöser schon eine eigene laufende Schicht ohne
/// Vorgänger (ungeplant eingetroffen, Autostart), wird sie als Folgeschicht übernommen; ist seine
/// laufende Schicht selbst schon eine Folgeschicht → 422. Das Ereignis `abloesung` der
/// Zeitachse geht an die abgelöste Einheit und an jede Untereinheit, die ihre Schicht erbt
/// (Knoten-Vererbung beim Lesen, samt Personen). Mit `abschnitt_uebergeben` geht der Abschnitt
/// der abgelösten Einheit an die Knoten-Ablöser, ihr eigener wird geleert; die alten Werte
/// stehen an der Schicht und an der Liste für die Rücknahme.
///
/// **Besatzungswechsel** ([`AbloesungArt::Besatzung`], [`vollziehen_besatzung_tx`]): die
/// Einheit, ihr Fahrzeug und ihr Abschnitt bleiben; nur das Personal wechselt.
pub async fn vollziehen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    eingabe: &VollzugEingabe,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64, VollzugWirkung), AppError> {
    let startwert = etb_startwert(pool, einsatz_id).await?;
    let vollzogen_at = eingabe.vollzogen_at.as_str();
    let vorgang = Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
    };
    let (folge_ids, etb_id, wirkung) = write_retry!(pool, |conn| {
        let roh = roh_tx(conn, einsatz_id, id).await?;
        if roh.status != AbloesungStatus::Laufend {
            return Err(AppError::UnprocessableEntity(nicht_laufend(
                roh.status,
                "lässt sich nicht vollziehen",
            )));
        }
        if vollzogen_at < roh.beginn_at.as_str() {
            return Err(AppError::UnprocessableEntity(
                "Der Vollzug liegt vor dem Beginn der Schicht".into(),
            ));
        }
        // Die Planung für die Rücknahme sichern, bevor der Vollzug die Liste ersetzt (LLH-1319).
        save_planung_tx(conn, id).await?;
        let (folge_ids, inhalt, wirkung) = match eingabe.art {
            AbloesungArt::Einheit => vollziehen_einheit_tx(conn, &vorgang, &roh, eingabe).await?,
            AbloesungArt::Besatzung => {
                vollziehen_besatzung_tx(conn, &vorgang, &roh, eingabe).await?
            }
        };
        let etb_id = crate::etb::repo::anlegen_tx(
            conn,
            einsatz_id,
            benutzer_id,
            startwert,
            EintragDaten {
                typ: TYP_MELDUNG,
                inhalt: &inhalt,
                von: None,
                an: None,
                meldeweg: None,
                veranlassung: None,
                ereigniszeit: Some(vollzogen_at),
                erfasst_lokal_at: None,
                berichtigt_eintrag_id: None,
            },
        )
        .await?;
        sqlx::query("UPDATE einsatz_abloesung SET etb_vollzug_id = ? WHERE id = ?")
            .bind(etb_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        Ok((folge_ids, etb_id, wirkung))
    })?;
    let abgeloest = laden(pool, einsatz_id, id, jetzt).await?;
    let mut folgeschichten = Vec::with_capacity(folge_ids.len());
    for f in folge_ids {
        folgeschichten.push(laden(pool, einsatz_id, f, jetzt).await?);
    }
    Ok((
        AbloesungVollzugAnzeige {
            abgeloest,
            folgeschicht: folgeschichten.first().cloned(),
            folgeschichten,
        },
        etb_id,
        wirkung,
    ))
}

/// Die Untereinheiten, die die laufende Schicht der Einheit `traeger` gerade erben, nach ID —
/// aus einer schon geladenen Gliederung.
pub(super) fn erben_von(g: &Gliederung, traeger: i64) -> Vec<i64> {
    let mut erben: Vec<i64> = vererbung(&g.ueber, &g.mit_schicht)
        .into_iter()
        .filter_map(|(erbe, t)| (t == traeger).then_some(erbe))
        .collect();
    erben.sort_unstable();
    erben
}

/// Vollzug als Ablösung der ganzen Einheit (siehe [`vollziehen`]). Liefert die Folgeschichten,
/// den ETB-Text und die Wirkung außerhalb der Ablösung.
pub(super) async fn vollziehen_einheit_tx(
    conn: &mut SqliteConnection,
    v: &Vorgang<'_>,
    roh: &Roh,
    eingabe: &VollzugEingabe,
) -> Result<(Vec<i64>, String, VollzugWirkung), AppError> {
    let Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
    } = *v;
    let vollzogen_at = eingabe.vollzogen_at.as_str();
    let (name, abschnitt_vorher) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
    let abloeser = check_abloeser_tx(conn, einsatz_id, roh.einheit_id, &eingabe.abloeser).await?;

    // Vor jedem Schreiben: Knoten der Ablöser und Erben der abgelösten Schicht.
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let menge: HashSet<i64> = abloeser.iter().map(|a| a.id).collect();
    let knoten: Vec<&Abloeser> = abloeser
        .iter()
        .filter(|a| !has_vorfahr_in(&g.ueber, a.id, &menge))
        .collect();
    let erben = erben_von(&g, roh.einheit_id);
    // Übergeben wird nur, was es gibt: ein Abschnitt und mindestens ein Knoten-Ablöser.
    let uebergabe = abschnitt_vorher.filter(|_| eingabe.abschnitt_uebergeben && !knoten.is_empty());
    // Erst eine wirksame Übergabe schreibt, was sonst das Modul Einheiten schreibt (LLH-1512).
    if uebergabe.is_some() && eingabe.ohne_freigabe_einheiten {
        return Err(AppError::Forbidden);
    }

    let verbleib_br_id = match eingabe.verbleib {
        AbloesungVerbleib::Bereitstellungsraum => eingabe.verbleib_br_id,
        AbloesungVerbleib::Ruhe | AbloesungVerbleib::Entlassen => None,
    };
    // Der Raum des Verbleibs vor jedem Schreiben (LLH-1308, design.md D4).
    let verbleib_br = match verbleib_br_id {
        Some(br_id) => Some(check_verbleib_raum_tx(conn, einsatz_id, br_id, roh.einheit_id).await?),
        None => None,
    };
    // Die Schicht ist `abgeloest`, BEVOR die Zeitachse schreibt: so findet die Kopplung „Ende mit
    // der Entlassung“ (LLH-1128) beim Verbleib „entlassen“ keine laufende Schicht und beendet
    // nichts ein zweites Mal (LLH-1308, design.md D3).
    sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
            vollzogen_von_id = ?, abschnitt_uebergeben = ?, \
            abgeloest_abschnitt_vorher_id = ?, verbleib = ?, verbleib_br_id = ? WHERE id = ?",
    )
    .bind(vollzogen_at)
    .bind(benutzer_id)
    .bind(uebergabe.is_some())
    .bind(uebergabe)
    .bind(eingabe.verbleib.as_str())
    .bind(verbleib_br_id)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    set_abloeser_tx(conn, id, &eingabe.abloeser).await?;
    close_fristen_tx(conn, id, jetzt).await?;

    // LFH-552/LLH-1132: der Vollzug beendet die Einsatzperiode der abgelösten Einheit und
    // jeder erbenden Untereinheit (je samt Fan-out); ohne offene Periode bleibt die jeweilige
    // Zeitachse unberührt. Mit dem Verbleib „entlassen“ endet sie mit der Entlassung statt der
    // Ablösung (LLH-1308, design.md D2).
    let ende = ende_art(eingabe.verbleib);
    let mut wirkung = VollzugWirkung::default();
    for einheit in std::iter::once(roh.einheit_id).chain(erben.iter().copied()) {
        if let Some(w) = crate::zeitachse::repo::vollzug_ende_tx(
            conn,
            einsatz_id,
            benutzer_id,
            einheit,
            ende,
            vollzogen_at,
        )
        .await?
        {
            wirkung.kopplung.append(Wirkung {
                etb: w.1.abloesung.clone(),
                anlaesse: w.1.hinweise.clone(),
            });
            wirkung.zeitachse.push(w);
        }
    }

    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let mut folge_ids = Vec::with_capacity(knoten.len());
    let mut uebernommen: Vec<Abloeser> = Vec::new();
    for a in &knoten {
        let laufend: Option<(i64, Option<i64>)> = sqlx::query_as(
            "SELECT id, vorgaenger_id FROM einsatz_abloesung \
             WHERE einheit_id = ? AND status = 'laufend'",
        )
        .bind(a.id)
        .fetch_optional(&mut *conn)
        .await?;
        match laufend {
            None => {
                let (f, _) = create_schicht_tx(
                    conn,
                    einsatz_id,
                    benutzer_id,
                    a.id,
                    &a.name,
                    roh.abschnitt_id,
                    vollzogen_at,
                    roh.rhythmus_minuten,
                    roh.rhythmus_quelle,
                    &vorgabe,
                    Some(id),
                    BeginnQuelle::Vollzug,
                    None,
                    jetzt,
                )
                .await?;
                folge_ids.push(f);
            }
            Some((f, None)) => {
                sqlx::query(
                    "UPDATE einsatz_abloesung SET vorgaenger_id = ?, \
                        uebernommen_bei_vollzug = 1 WHERE id = ?",
                )
                .bind(id)
                .bind(f)
                .execute(&mut *conn)
                .await?;
                folge_ids.push(f);
                uebernommen.push((*a).clone());
            }
            Some((_, Some(_))) => {
                return Err(AppError::UnprocessableEntity(format!(
                    "Einheit «{}» führt schon eine Folgeschicht aus einer anderen Ablösung",
                    a.name
                )))
            }
        }
    }

    let mut abschnitt_name = None;
    if let Some(abschnitt) = uebergabe {
        // Vorher-Werte aller Listeneinträge, damit die Rücknahme jeden auf seinen Stand legt.
        sqlx::query(
            "UPDATE einsatz_abloesung_abloeser SET abschnitt_vorher_id = \
                (SELECT e.abschnitt_id FROM einsatz_einheit e \
                 WHERE e.id = einsatz_abloesung_abloeser.einheit_id) \
             WHERE abloesung_id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        let knoten_ids: Vec<i64> = knoten.iter().map(|a| a.id).collect();
        sqlx::query(
            "UPDATE einsatz_einheit SET abschnitt_id = ? \
             WHERE id IN (SELECT value FROM json_each(?))",
        )
        .bind(abschnitt)
        .bind(crate::kraefte_disposition::ids_json(&knoten_ids))
        .execute(&mut *conn)
        .await?;
        sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = NULL WHERE id = ?")
            .bind(roh.einheit_id)
            .execute(&mut *conn)
            .await?;
        wirkung.einheiten.push(roh.einheit_id);
        wirkung.einheiten.extend(knoten_ids.iter().copied());
        wirkung.abschnitt_gewechselt.push(roh.einheit_id);
        wirkung.abschnitt_gewechselt.extend(knoten_ids);
        abschnitt_name = abschnitt_tx(conn, abschnitt).await?.map(|(n, _)| n);
    }

    // LLH-1308 (design.md D4/D5): Belegungsbuchungen im Bereitstellungsraum. Alles, was dieser
    // Vollzug dort bucht, hat eine id über `marke`; die Liste der Schicht hält sie für die
    // Rücknahme fest.
    let marke: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id), 0) FROM br_belegung")
        .fetch_one(&mut *conn)
        .await?;
    let br_saetze =
        abloeser_ausruecken_tx(conn, einsatz_id, benutzer_id, &abloeser, &mut wirkung).await?;
    let verbleib_satz = match (eingabe.verbleib, verbleib_br_id.zip(verbleib_br)) {
        (AbloesungVerbleib::Bereitstellungsraum, Some((br_id, bezeichnung))) => {
            verbleib_eintritt_tx(conn, einsatz_id, benutzer_id, br_id, roh.einheit_id).await?;
            wirkung.raeume.push(br_id);
            wirkung.einheiten.push(roh.einheit_id);
            Some(format!(
                " «{name}» danach in Bereitstellungsraum {bezeichnung}."
            ))
        }
        (AbloesungVerbleib::Entlassen, _) => Some(format!(" «{name}» danach entlassen.")),
        _ => None,
    };
    sqlx::query(
        "INSERT INTO einsatz_abloesung_br_buchung (abloesung_id, belegung_id) \
         SELECT ?, id FROM br_belegung \
         WHERE id > ? AND einsatz_id = ? AND art IN ('eintritt', 'austritt') ORDER BY id",
    )
    .bind(id)
    .bind(marke)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;

    let mut inhalt = if abloeser.is_empty() {
        format!("Ablösung vollzogen: «{name}» (ohne ablösende Einheit).")
    } else {
        format!(
            "Ablösung vollzogen: «{name}» durch {}.",
            namen_text(&abloeser)
        )
    };
    if !uebernommen.is_empty() {
        inhalt.push_str(&format!(
            " Laufende Schicht übernommen: {}.",
            namen_text(&uebernommen)
        ));
    }
    if let Some(a) = &abschnitt_name {
        let an: Vec<Abloeser> = knoten.iter().map(|k| (*k).clone()).collect();
        inhalt.push_str(&format!(
            " Abschnitt «{a}» an {} übergeben.",
            namen_text(&an)
        ));
    }
    let inhalt = vollzug_inhalt_gekappt(
        inhalt,
        &br_saetze,
        verbleib_satz.as_deref(),
        crate::etb::INHALT_MAX,
    );
    Ok((folge_ids, inhalt, wirkung))
}

/// Hängt die Sätze der aus einem Raum ausgerückten Ablöser und den Verbleib an den ETB-Text des
/// Vollzugs, so dass er höchstens `max` Zeichen lang bleibt (`src/AGENTS.md`, Eingabegrenzen):
/// passt ein Raum-Satz nicht mehr, fällt er mit allen folgenden weg, ein Zählsatz nennt ihre
/// Anzahl. Der Verbleib bleibt immer stehen; ein Systemtext darf nicht scheitern.
pub(super) fn vollzug_inhalt_gekappt(
    mut inhalt: String,
    br_saetze: &[String],
    verbleib_satz: Option<&str>,
    max: usize,
) -> String {
    let verbleib_len = verbleib_satz.map_or(0, |s| s.chars().count());
    let zaehlsatz = |n: usize| {
        if n == 1 {
            " 1 weitere ablösende Einheit aus einem Bereitstellungsraum ausgerückt.".to_string()
        } else {
            format!(" {n} weitere ablösende Einheiten aus Bereitstellungsräumen ausgerückt.")
        }
    };
    let mut laenge = inhalt.chars().count();
    for (i, satz) in br_saetze.iter().enumerate() {
        let teil = satz.chars().count() + 2;
        let weitere = br_saetze.len() - i - 1;
        let danach = if weitere > 0 {
            zaehlsatz(weitere).chars().count()
        } else {
            0
        };
        if laenge + teil + danach + verbleib_len > max {
            inhalt.push_str(&zaehlsatz(br_saetze.len() - i));
            break;
        }
        inhalt.push(' ');
        inhalt.push_str(satz);
        inhalt.push('.');
        laenge += teil;
    }
    if let Some(satz) = verbleib_satz {
        inhalt.push_str(satz);
    }
    inhalt
}

/// Das Ende-Ereignis der Zeitachse zum Verbleib (LLH-1308, design.md D2): „entlassen“ endet mit
/// der Entlassung, Ruhe und Bereitstellungsraum mit der Ablösung.
pub(super) fn ende_art(verbleib: AbloesungVerbleib) -> crate::zeitachse::ZeitachseArt {
    match verbleib {
        AbloesungVerbleib::Entlassen => crate::zeitachse::ZeitachseArt::Entlassung,
        AbloesungVerbleib::Ruhe | AbloesungVerbleib::Bereitstellungsraum => {
            crate::zeitachse::ZeitachseArt::Abloesung
        }
    }
}

/// Ablöser, die beim Vollzug in einem Bereitstellungsraum stehen, rücken aus (LLH-1308,
/// design.md D5, Entscheidung 31.10.2026): nicht abgerufen → Abruf mit Ausrücken über
/// [`crate::bereitstellungsraum::abruf::abruf_tx`] (ohne Abschnitt, ohne Auftrag, der Verband
/// geht mit), schon abgerufen → nur der Austritt über `belege_tx` (das Ausrücken samt
/// Mitgenommenen). In der Reihenfolge der Liste; wer mit einem Vorgänger ausgerückt ist, steht in
/// keinem Raum mehr und wird übersprungen. Keine eigene Freigabe des Moduls
/// Bereitstellungsräume: der Abruf ist Folge des Vollzugs. Liefert je Abruf einen Teilsatz für den
/// einen ETB-Eintrag des Vollzugs (`abruf_tx` schreibt kein ETB).
pub(super) async fn abloeser_ausruecken_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    abloeser: &[Abloeser],
    wirkung: &mut VollzugWirkung,
) -> Result<Vec<String>, AppError> {
    use crate::bereitstellungsraum::abruf::{abruf_tx, AbrufDaten, Startwerte};
    use crate::bereitstellungsraum::belegung_repo::{self, Buchung};
    use crate::bereitstellungsraum::{BrBelegungsArt, ObjektTyp};
    let mut saetze = Vec::new();
    for a in abloeser {
        let raum: Option<i64> = sqlx::query_scalar(
            "SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
        )
        .bind(a.id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
        let Some(br_id) = raum else {
            continue;
        };
        let bezeichnung: String =
            sqlx::query_scalar("SELECT bezeichnung FROM bereitstellungsraum WHERE id = ?")
                .bind(br_id)
                .fetch_one(&mut *conn)
                .await?;
        let abgerufen = belegung_repo::offener_abruf_tx(
            &mut *conn,
            einsatz_id,
            ObjektTyp::Einheit,
            a.id,
            br_id,
        )
        .await?
        .is_some();
        let mitgenommen = if abgerufen {
            let belegt = belegung_repo::belege_tx(
                &mut *conn,
                einsatz_id,
                br_id,
                ObjektTyp::Einheit,
                a.id,
                &Buchung {
                    art: BrBelegungsArt::Austritt,
                    notiz: None,
                    client_id: None,
                    zeitpunkt_at: None,
                    von_br_id: None,
                },
                benutzer_id,
            )
            .await?;
            let namen: Vec<String> = belegt
                .mitgenommen
                .iter()
                .map(|(_, n)| format!("«{n}»"))
                .collect();
            saetze.push(crate::bereitstellungsraum::etb_text_ausgerueckt(
                &format!("«{}»", a.name),
                &namen,
                &bezeichnung,
                None,
            ));
            belegt.mitgenommen
        } else {
            // Ohne Auftrag braucht der Abruf keine Startwerte (`abruf_tx` legt dann nichts an).
            let startwerte = Startwerte {
                auftrag: 0,
                etb: 0,
                auto_etb: false,
            };
            let ergebnis = abruf_tx(
                &mut *conn,
                einsatz_id,
                br_id,
                &AbrufDaten {
                    objekt_typ: ObjektTyp::Einheit,
                    objekt_id: a.id,
                    abschnitt: None,
                    auftrag: None,
                    ausgerueckt: true,
                },
                startwerte,
                benutzer_id,
            )
            .await?;
            let namen: Vec<String> = ergebnis
                .mitgenommen
                .iter()
                .map(|(_, n)| format!("«{n}»"))
                .collect();
            saetze.push(crate::bereitstellungsraum::etb_text_abruf(
                &crate::bereitstellungsraum::AbrufText {
                    name: &format!("«{}»", a.name),
                    mitgenommen: &namen,
                    br_bezeichnung: &bezeichnung,
                    ziel: None,
                    auftrag_nr: None,
                    ausgerueckt: true,
                },
            ));
            ergebnis.mitgenommen
        };
        wirkung.raeume.push(br_id);
        wirkung.einheiten.push(a.id);
        wirkung
            .einheiten
            .extend(mitgenommen.into_iter().map(|(id, _)| id));
    }
    Ok(saetze)
}

/// Prüft den Raum des Verbleibs vor jedem Schreiben (LLH-1308, design.md D4): fremder oder
/// unbekannter Raum → 404, nicht aktiv oder storniert → 422, die abgelöste Einheit steht schon in
/// einem Raum → 422. Liefert die Bezeichnung des Raums. `belege_tx` prüft beim Buchen noch
/// einmal; so bricht jeder Fehler den ganzen Vollzug, nichts bleibt halb geschrieben.
pub(super) async fn check_verbleib_raum_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    br_id: i64,
    einheit_id: i64,
) -> Result<String, AppError> {
    let br = crate::bereitstellungsraum::belegung_repo::require_belegbar_tx(
        &mut *conn, einsatz_id, br_id,
    )
    .await?;
    let schon: Option<String> = sqlx::query_scalar(
        "SELECT r.bezeichnung FROM einsatz_einheit e \
         JOIN bereitstellungsraum r ON r.id = e.aktueller_br_id \
         WHERE e.id = ? AND e.einsatz_id = ?",
    )
    .bind(einheit_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some(raum) = schon {
        return Err(AppError::UnprocessableEntity(format!(
            "Die abgelöste Einheit steht schon im Bereitstellungsraum {raum}"
        )));
    }
    Ok(br.bezeichnung)
}

/// Eintritt der abgelösten Einheit in den Raum ihres Verbleibs (LLH-1308, design.md D4) über
/// `belege_tx`, nach [`check_verbleib_raum_tx`].
pub(super) async fn verbleib_eintritt_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    br_id: i64,
    einheit_id: i64,
) -> Result<(), AppError> {
    use crate::bereitstellungsraum::belegung_repo::{self, Buchung};
    use crate::bereitstellungsraum::{BrBelegungsArt, ObjektTyp};
    belegung_repo::belege_tx(
        &mut *conn,
        einsatz_id,
        br_id,
        ObjektTyp::Einheit,
        einheit_id,
        &Buchung {
            art: BrBelegungsArt::Eintritt,
            notiz: None,
            client_id: None,
            zeitpunkt_at: None,
            von_br_id: None,
        },
        benutzer_id,
    )
    .await?;
    Ok(())
}

/// Eine Person der neuen Besatzung nach der Prüfung.
#[derive(Debug, Clone)]
pub(super) struct NeuePerson {
    pub(super) id: i64,
    pub(super) name: String,
    /// Ihre bisherige Einheit (keine = `None`).
    pub(super) einheit_id: Option<i64>,
    /// Ihr bisheriges Fahrzeug (keins = `None`).
    pub(super) fahrzeug_id: Option<i64>,
    /// Wohin der Wechsel sie verteilt (LLH-1319): die Einheit der Schicht oder eine erbende
    /// Untereinheit, mit Namen für den ETB-Text.
    pub(super) ziel_einheit: i64,
    pub(super) ziel_einheit_name: String,
    /// Das Ziel-Fahrzeug samt Funkrufnamen; `None` = ihr Fahrzeug bleibt.
    pub(super) ziel_fahrzeug: Option<(i64, String)>,
}

/// Prüft die neue Besatzung samt Verteilung (LLH-1150, LLH-1319) mit EINER Abfrage über
/// `json_each` (`src/AGENTS.md`, „Eingabegrenzen“), in dieser Reihenfolge je Person: fremd oder
/// unbekannt → 404, entlassen oder storniert → 409 (wie
/// `personal::disposition_repo::require_nicht_beendet`), schon in der bisherigen Besatzung
/// (`einheiten`: die Einheit und ihre Erben) → 422, Führung einer anderen aktiven Einheit → 422
/// (die neue Besatzung nimmt niemandem die Führung); Ziel-Einheit außerhalb von `einheiten` → 422;
/// Ziel-Fahrzeug fremd oder unbekannt → 404, entlassen oder storniert → 409, keiner dieser
/// Einheiten zugeordnet → 422. Ohne Ziel-Einheit gilt `einheiten[0]` (die Einheit der Schicht).
/// Liefert die Personen in der Reihenfolge der Liste.
pub(super) async fn check_neue_besatzung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheiten: &[i64],
    ziele: &[BesatzungZiel],
) -> Result<Vec<NeuePerson>, AppError> {
    #[derive(sqlx::FromRow)]
    struct Pruefung {
        id: i64,
        name: Option<String>,
        einheit_id: Option<i64>,
        fahrzeug_id: Option<i64>,
        beendet_als: Option<String>,
        beendet: bool,
        in_besatzung: bool,
        fuehrt: Option<String>,
        ziel_einheit: i64,
        ziel_einheit_name: Option<String>,
        ziel_einheit_passt: bool,
        ziel_fahrzeug: Option<i64>,
        fahrzeug_bekannt: bool,
        fahrzeug_beendet_als: Option<String>,
        fahrzeug_passt: bool,
        funkrufname: String,
    }
    let Some(&selbst) = einheiten.first() else {
        return Ok(Vec::new());
    };
    let json = ziele_json(ziele)?;
    let zeilen: Vec<Pruefung> = sqlx::query_as(
        "SELECT json_extract(j.value, '$.p') AS id, p.snap_name AS name, p.einheit_id, \
                p.fahrzeug_id, p.beendet_als, p.beendet_at IS NOT NULL AS beendet, \
                COALESCE(p.einheit_id IN (SELECT value FROM json_each(?3)), 0) AS in_besatzung, \
                (SELECT e.name FROM einsatz_einheit e \
                 WHERE e.fuehrer_id = p.id AND e.aufgeloest_at IS NULL \
                   AND e.id NOT IN (SELECT value FROM json_each(?3)) \
                 ORDER BY e.id LIMIT 1) AS fuehrt, \
                COALESCE(json_extract(j.value, '$.e'), ?4) AS ziel_einheit, \
                ze.name AS ziel_einheit_name, \
                COALESCE(json_extract(j.value, '$.e'), ?4) IN (SELECT value FROM json_each(?3)) \
                   AS ziel_einheit_passt, \
                json_extract(j.value, '$.f') AS ziel_fahrzeug, \
                zf.id IS NOT NULL AS fahrzeug_bekannt, zf.beendet_als AS fahrzeug_beendet_als, \
                COALESCE(zf.einheit_id IN (SELECT value FROM json_each(?3)), 0) AS fahrzeug_passt, \
                coalesce(fz.funkrufname, zf.snap_funkrufname, '') AS funkrufname \
         FROM json_each(?1) j \
         LEFT JOIN einsatz_personal p ON p.id = json_extract(j.value, '$.p') AND p.einsatz_id = ?2 \
         LEFT JOIN einsatz_einheit ze \
                ON ze.id = COALESCE(json_extract(j.value, '$.e'), ?4) AND ze.einsatz_id = ?2 \
         LEFT JOIN einsatz_fahrzeug zf \
                ON zf.id = json_extract(j.value, '$.f') AND zf.einsatz_id = ?2 \
         LEFT JOIN fahrzeug fz ON fz.id = zf.fahrzeug_id \
         ORDER BY j.key",
    )
    .bind(json)
    .bind(einsatz_id)
    .bind(crate::kraefte_disposition::ids_json(einheiten))
    .bind(selbst)
    .fetch_all(&mut *conn)
    .await?;
    let einheit_name: String = sqlx::query_scalar("SELECT name FROM einsatz_einheit WHERE id = ?")
        .bind(selbst)
        .fetch_one(&mut *conn)
        .await?;
    zeilen
        .into_iter()
        .map(|z| {
            let Some(name) = z.name else {
                return Err(AppError::NotFound);
            };
            if z.beendet {
                return Err(crate::personal::disposition_repo::beendet_conflict(
                    z.beendet_als.as_deref().unwrap_or_default(),
                ));
            }
            if z.in_besatzung {
                return Err(AppError::UnprocessableEntity(format!(
                    "«{name}» gehört schon zur bisherigen Besatzung"
                )));
            }
            if let Some(einheit) = z.fuehrt {
                return Err(AppError::UnprocessableEntity(format!(
                    "«{name}» führt die Einheit «{einheit}»"
                )));
            }
            let ziel_einheit_name = match (z.ziel_einheit_passt, z.ziel_einheit_name) {
                (true, Some(n)) => n,
                _ => {
                    return Err(AppError::UnprocessableEntity(format!(
                        "«{name}»: die Ziel-Einheit gehört nicht zu «{einheit_name}» oder ihren \
                         Untereinheiten"
                    )))
                }
            };
            let ziel_fahrzeug = match z.ziel_fahrzeug {
                None => None,
                Some(_) if !z.fahrzeug_bekannt => return Err(AppError::NotFound),
                Some(_) if z.fahrzeug_beendet_als.is_some() => {
                    return Err(crate::fahrzeug::disposition_repo::beendet_conflict(
                        z.fahrzeug_beendet_als.as_deref().unwrap_or_default(),
                    ))
                }
                Some(_) if !z.fahrzeug_passt => {
                    return Err(AppError::UnprocessableEntity(format!(
                        "«{name}»: das Fahrzeug «{}» gehört nicht zu «{einheit_name}» oder ihren \
                         Untereinheiten",
                        z.funkrufname
                    )))
                }
                Some(f) => Some((f, z.funkrufname)),
            };
            Ok(NeuePerson {
                id: z.id,
                name,
                einheit_id: z.einheit_id,
                fahrzeug_id: z.fahrzeug_id,
                ziel_einheit: z.ziel_einheit,
                ziel_einheit_name,
                ziel_fahrzeug,
            })
        })
        .collect()
}

/// Schreibt ein Ereignis der Person aus dem Besatzungswechsel (Quelle `abloesung`) über den
/// einzigen Schreibpfad. Liefert seine ID; `None`, wenn die Perioden-Regeln es auslassen (ohne
/// offene Periode keine Ablösung, mit offener kein zweites Eintreffen) — der Vollzug gelingt
/// trotzdem.
pub(crate) async fn besatzung_ereignis_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    person: i64,
    art: crate::zeitachse::ZeitachseArt,
    zeitpunkt_at: &str,
) -> Result<Option<i64>, AppError> {
    use crate::zeitachse::repo::{schreibe_tx, Kraft, Neu, Schreibergebnis};
    let (r, _) = schreibe_tx(
        conn,
        einsatz_id,
        benutzer_id,
        Kraft::Person(person),
        Neu {
            art,
            zeitpunkt_at,
            quelle: crate::zeitachse::ZeitachseQuelle::Abloesung,
            notiz: None,
        },
    )
    .await?;
    Ok(match r {
        Schreibergebnis::Geschrieben(z) => Some(z),
        Schreibergebnis::Ausgelassen(_) => None,
    })
}

/// Die neue Besatzung für den ETB-Text (LLH-1319): „«A» (Gruppe 1, Florian 1-44), «B»“; die
/// Klammer nennt nur, was von der Vorgabe abweicht (eine andere Einheit als `selbst`, ein
/// Fahrzeug). Ohne Person „keine“.
pub(super) fn verteilung_text(neu: &[NeuePerson], selbst: i64) -> String {
    if neu.is_empty() {
        return "keine".into();
    }
    neu.iter()
        .map(|p| {
            let mut wohin: Vec<&str> = Vec::new();
            if p.ziel_einheit != selbst {
                wohin.push(&p.ziel_einheit_name);
            }
            if let Some((_, f)) = &p.ziel_fahrzeug {
                wohin.push(f);
            }
            if wohin.is_empty() {
                format!("«{}»", p.name)
            } else {
                format!("«{}» ({})", p.name, wohin.join(", "))
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Namen für ETB-Texte: „«A», «B»“, ohne einen „keine“.
pub(crate) fn personen_text<'a>(namen: impl Iterator<Item = &'a str>) -> String {
    let text = namen
        .map(|n| format!("«{n}»"))
        .collect::<Vec<_>>()
        .join(", ");
    if text.is_empty() {
        "keine".into()
    } else {
        text
    }
}

/// Bringt Personen aus dem Schichtplan in den Einsatz (LLH-1555, design.md D5), in der
/// Transaktion des Vollzugs. Stamm-Personal: schon disponiert → diese Kraft, entlassen oder
/// storniert → wieder aufgenommen, sonst disponiert (fremd 404, außer Dienst 422 wie die
/// Disposition). Helfer: die Kraft, als die er schon übernommen wurde, sonst eine Ad-hoc-Kraft
/// mit seinem Namen, seiner Organisation und seinen Qualifikationen als Funktion; der Helfer bleibt
/// im Plan und verweist auf sie. Jede neue Kraft bekommt die Zeitachse ihres Initialstatus wie bei
/// der Disposition. Liefert je Eintrag das Ziel und ob die Kraft erst jetzt in den Einsatz kam.
pub(super) async fn uebernehmen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    liste: &[PlanUebernahme],
) -> Result<Vec<(BesatzungZiel, bool)>, AppError> {
    if liste.is_empty() {
        return Ok(Vec::new());
    }
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    let mut aus = Vec::new();
    for u in liste {
        let (kraft, neu) = uebernehme_tx(conn, einsatz_id, org_id, benutzer_id, u.quelle).await?;
        aus.push((
            BesatzungZiel {
                personal_id: kraft,
                einheit_id: u.einheit_id,
                fahrzeug_id: u.fahrzeug_id,
            },
            neu,
        ));
    }
    Ok(aus)
}

/// Eine Person aus dem Schichtplan als Kraft des Einsatzes (Regeln wie [`uebernehmen_tx`]), auch
/// für den Wechsel an einer UHS (LLH-1555, design.md D6). Liefert die Kraft und ob sie erst jetzt
/// in den Einsatz kam.
pub(crate) async fn uebernehme_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    benutzer_id: i64,
    quelle: UebernahmeQuelle,
) -> Result<(i64, bool), AppError> {
    use crate::personal::disposition_repo::{
        disponieren_adhoc_tx, disponieren_stamm_tx, reaktivieren_tx, start_zeitachse_tx, AdhocDaten,
    };
    Ok(match quelle {
        UebernahmeQuelle::Stamm(pid) => {
            let bestehend: Option<(i64, bool)> = sqlx::query_as(
                "SELECT id, beendet_at IS NOT NULL FROM einsatz_personal \
                 WHERE einsatz_id = ? AND personal_id = ?",
            )
            .bind(einsatz_id)
            .bind(pid)
            .fetch_optional(&mut *conn)
            .await?;
            match bestehend {
                Some((ep, false)) => (ep, false),
                _ => {
                    let d = disponieren_stamm_tx(conn, einsatz_id, org_id, pid, None, benutzer_id)
                        .await?;
                    start_zeitachse_tx(conn, einsatz_id, benutzer_id, d.id).await?;
                    (d.id, true)
                }
            }
        }
        UebernahmeQuelle::Helfer(hid) => {
            type Helfer = (
                String,
                Option<String>,
                Option<String>,
                Option<i64>,
                Option<bool>,
            );
            let h: Option<Helfer> = sqlx::query_as(
                "SELECT h.name, h.organisation, \
                        (SELECT group_concat(q.label, ', ') FROM json_each(h.qualifikationen) j \
                         JOIN qualifikation q ON q.id = j.value), \
                        ep.id, ep.beendet_at IS NOT NULL \
                 FROM einsatz_plan_helfer h \
                 LEFT JOIN einsatz_personal ep \
                        ON ep.id = h.einsatz_personal_id AND ep.einsatz_id = h.einsatz_id \
                 WHERE h.id = ? AND h.einsatz_id = ?",
            )
            .bind(hid)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            let (name, organisation, funktion, ep, beendet) = h.ok_or(AppError::NotFound)?;
            match (ep, beendet) {
                (Some(ep), Some(false)) => (ep, false),
                (Some(ep), _) => {
                    reaktivieren_tx(conn, einsatz_id, org_id, ep, None, benutzer_id).await?;
                    start_zeitachse_tx(conn, einsatz_id, benutzer_id, ep).await?;
                    (ep, true)
                }
                (None, _) => {
                    let ep = disponieren_adhoc_tx(
                        conn,
                        einsatz_id,
                        org_id,
                        AdhocDaten {
                            name: &name,
                            funktion: funktion.as_deref(),
                            traegerorganisation: organisation.as_deref(),
                            staerke_position: None,
                        },
                        benutzer_id,
                    )
                    .await?;
                    start_zeitachse_tx(conn, einsatz_id, benutzer_id, ep).await?;
                    sqlx::query(
                        "UPDATE einsatz_plan_helfer SET einsatz_personal_id = ? WHERE id = ?",
                    )
                    .bind(ep)
                    .bind(hid)
                    .execute(&mut *conn)
                    .await?;
                    (ep, true)
                }
            }
        }
    })
}

/// Vollzug als Besatzungswechsel (LLH-1150, Entscheidung LLH-1118 Punkt 4): die Einheit, ihr
/// Fahrzeug und ihr Abschnitt bleiben, die Folgeschicht hängt an derselben Einheit (Beginn =
/// Vollzug, Rhythmus und Einsatzstelle der abgelösten Schicht). Die alte Besatzung ist die
/// Personalzuordnung der Einheit und jeder Untereinheit, die ihre Schicht erbt (Knoten-Modell,
/// dieselbe Menge wie der Fan-out der ganzen Einheit); jede Person geht aus ihrer Einheit, von
/// einem Fahrzeug dieser Einheiten und aus deren Führung und bekommt das Ereignis `abloesung`.
/// Die neue Besatzung kommt in die Einheit selbst und bekommt `eintreffen`; die Einheiten selbst
/// bekommen kein Ereignis, ihre Periode läuft weiter. Keine Grenzwerte, keine Ruhezeitrechnung
/// (LFH-860). Was die Rücknahme braucht, steht in `einsatz_abloesung_besatzung`.
///
/// LLH-1319: die neue Besatzung kommt je Person in ihre Ziel-Einheit (die Einheit oder eine
/// erbende Untereinheit) und, mit Ziel-Fahrzeug, auf dieses; die Zeile hält Ziel und vorheriges
/// Fahrzeug für die Rücknahme.
///
/// LLH-1555 (design.md D5): `bleiben` nimmt Personen aus der alten Besatzung heraus (sie behalten
/// Einheit, Fahrzeug und Führung, ohne Ereignis); `uebernahme` bringt Personen aus dem Plan erst
/// in den Einsatz ([`uebernehmen_tx`]); `plan_block_id` muss der Folgeblock der Schicht sein und
/// wird der Anker der Folgeschicht.
pub(super) async fn vollziehen_besatzung_tx(
    conn: &mut SqliteConnection,
    v: &Vorgang<'_>,
    roh: &Roh,
    eingabe: &VollzugEingabe,
) -> Result<(Vec<i64>, String, VollzugWirkung), AppError> {
    use crate::zeitachse::ZeitachseArt;
    let Vorgang {
        einsatz_id,
        id,
        benutzer_id,
        jetzt,
    } = *v;
    let vollzogen_at = eingabe.vollzogen_at.as_str();
    let (name, _) = einheit_tx(conn, einsatz_id, roh.einheit_id).await?;
    let g = load_gliederung(&mut *conn, einsatz_id).await?;
    let einheiten: Vec<i64> = std::iter::once(roh.einheit_id)
        .chain(erben_von(&g, roh.einheit_id))
        .collect();
    let einheiten_json = crate::kraefte_disposition::ids_json(&einheiten);
    let bleiben_json = crate::kraefte_disposition::ids_json(&eingabe.bleiben);

    // Wer bleibt, gehört zur bisherigen Besatzung (LLH-1555).
    let bleibende: Vec<(i64, Option<String>)> = sqlx::query_as(
        "SELECT j.value AS id, p.snap_name FROM json_each(?1) j \
         LEFT JOIN einsatz_personal p ON p.id = j.value AND p.einsatz_id = ?2 \
              AND p.beendet_at IS NULL AND p.einheit_id IN (SELECT value FROM json_each(?3)) \
         ORDER BY j.key",
    )
    .bind(&bleiben_json)
    .bind(einsatz_id)
    .bind(&einheiten_json)
    .fetch_all(&mut *conn)
    .await?;
    let Some(bleibende) = bleibende
        .into_iter()
        .map(|(_, n)| n)
        .collect::<Option<Vec<String>>>()
    else {
        return Err(AppError::UnprocessableEntity(format!(
            "Wer bleibt, gehört zur bisherigen Besatzung von «{name}»"
        )));
    };
    if let Some(block) = eingabe.plan_block_id {
        let folgeblock: Option<i64> = sqlx::query_scalar(concat!(
            "SELECT ",
            kopplung::folgeblock_sql!(),
            " FROM einsatz_abloesung a WHERE a.id = ? AND a.faellig_laut_plan = 1"
        ))
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?
        .flatten();
        if folgeblock != Some(block) {
            return Err(AppError::UnprocessableEntity(
                "Der Block ist nicht der Folgeblock dieser Schicht im Schichtplan".into(),
            ));
        }
    }
    // Erst übernehmen, dann prüfen: die Prüfung läuft auf den Kräften des Einsatzes.
    let uebernommen = uebernehmen_tx(conn, einsatz_id, benutzer_id, &eingabe.uebernahme).await?;
    let mut ziele = eingabe.besatzung.clone();
    for (z, _) in &uebernommen {
        if !ziele.iter().any(|b| b.personal_id == z.personal_id) {
            ziele.push(*z);
        }
    }
    let neu_dazu: HashSet<i64> = uebernommen
        .iter()
        .filter_map(|(z, neu)| neu.then_some(z.personal_id))
        .collect();
    let neu = check_neue_besatzung_tx(conn, einsatz_id, &einheiten, &ziele).await?;

    // Die alte Besatzung, wie der Vollzug sie vorfindet: das Fahrzeug nur, wenn es einer dieser
    // Einheiten gehört, die Führung nur die der eigenen Einheit.
    let alt: Vec<(i64, String, i64, Option<i64>, bool)> = sqlx::query_as(
        "SELECT p.id, p.snap_name, p.einheit_id, \
                (SELECT f.id FROM einsatz_fahrzeug f WHERE f.id = p.fahrzeug_id \
                   AND f.einheit_id IN (SELECT value FROM json_each(?2))), \
                EXISTS (SELECT 1 FROM einsatz_einheit e \
                        WHERE e.id = p.einheit_id AND e.fuehrer_id = p.id) \
         FROM einsatz_personal p \
         WHERE p.einsatz_id = ?1 AND p.beendet_at IS NULL \
           AND p.einheit_id IN (SELECT value FROM json_each(?2)) \
           AND p.id NOT IN (SELECT value FROM json_each(?3)) \
         ORDER BY p.id",
    )
    .bind(einsatz_id)
    .bind(&einheiten_json)
    .bind(&bleiben_json)
    .fetch_all(&mut *conn)
    .await?;

    sqlx::query(
        "UPDATE einsatz_abloesung SET status = 'abgeloest', vollzogen_at = ?, \
            vollzogen_von_id = ?, art = ?, abschnitt_uebergeben = 0, \
            abgeloest_abschnitt_vorher_id = NULL WHERE id = ?",
    )
    .bind(vollzogen_at)
    .bind(benutzer_id)
    .bind(AbloesungArt::Besatzung.as_str())
    .bind(id)
    .execute(&mut *conn)
    .await?;
    // Beim Vollzug genannt wird keine ablösende Einheit (die Liste nennt die beim Vollzug
    // genannten, LLH-1132).
    set_abloeser_tx(conn, id, &[]).await?;
    close_fristen_tx(conn, id, jetzt).await?;

    let zeile = "INSERT INTO einsatz_abloesung_besatzung \
            (abloesung_id, personal_id, rolle, einheit_vorher_id, fahrzeug_vorher_id, \
             war_fuehrer, zeitachse_id, einheit_nachher_id, fahrzeug_nachher_id, uebernommen) \
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    for (person, _, einheit, fahrzeug, fuehrer) in &alt {
        let z = besatzung_ereignis_tx(
            conn,
            einsatz_id,
            benutzer_id,
            *person,
            ZeitachseArt::Abloesung,
            vollzogen_at,
        )
        .await?;
        sqlx::query(zeile)
            .bind(id)
            .bind(person)
            .bind(BesatzungRolle::Alt.as_str())
            .bind(einheit)
            .bind(fahrzeug)
            .bind(fuehrer)
            .bind(z)
            .bind(None::<i64>)
            .bind(None::<i64>)
            .bind(false)
            .execute(&mut *conn)
            .await?;
    }
    for p in &neu {
        let z = besatzung_ereignis_tx(
            conn,
            einsatz_id,
            benutzer_id,
            p.id,
            ZeitachseArt::Eintreffen,
            vollzogen_at,
        )
        .await?;
        // Das vorherige Fahrzeug zählt nur, wenn der Wechsel ihr eines gibt (LLH-1319).
        let ziel_fahrzeug = p.ziel_fahrzeug.as_ref().map(|(f, _)| *f);
        sqlx::query(zeile)
            .bind(id)
            .bind(p.id)
            .bind(BesatzungRolle::Neu.as_str())
            .bind(p.einheit_id)
            .bind(ziel_fahrzeug.and(p.fahrzeug_id))
            .bind(false)
            .bind(z)
            .bind(p.ziel_einheit)
            .bind(ziel_fahrzeug)
            .bind(neu_dazu.contains(&p.id))
            .execute(&mut *conn)
            .await?;
    }

    // Zugehörigkeit in je einer Anweisung: die alte Besatzung verlässt Führung, Fahrzeug und
    // Einheit, die neue kommt in ihre Ziel-Einheit und, wo eines genannt ist, auf ihr Fahrzeug.
    sqlx::query(
        "UPDATE einsatz_einheit SET fuehrer_id = NULL WHERE id IN \
            (SELECT einheit_vorher_id FROM einsatz_abloesung_besatzung \
             WHERE abloesung_id = ? AND rolle = 'alt' AND war_fuehrer = 1)",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_personal SET einheit_id = NULL, \
            fahrzeug_id = CASE WHEN EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung b \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id \
                  AND b.fahrzeug_vorher_id IS NOT NULL) THEN NULL ELSE fahrzeug_id END \
         WHERE id IN (SELECT personal_id FROM einsatz_abloesung_besatzung \
                      WHERE abloesung_id = ?1 AND rolle = 'alt')",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_personal SET \
            einheit_id = (SELECT b.einheit_nachher_id FROM einsatz_abloesung_besatzung b \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id), \
            fahrzeug_id = COALESCE((SELECT b.fahrzeug_nachher_id FROM einsatz_abloesung_besatzung b \
                WHERE b.abloesung_id = ?1 AND b.personal_id = einsatz_personal.id), fahrzeug_id) \
         WHERE id IN (SELECT personal_id FROM einsatz_abloesung_besatzung \
                      WHERE abloesung_id = ?1 AND rolle = 'neu')",
    )
    .bind(id)
    .execute(&mut *conn)
    .await?;

    let vorgabe = load_einsatz_vorgabe_tx(conn, einsatz_id).await?;
    let (folge, _) = create_schicht_tx(
        conn,
        einsatz_id,
        benutzer_id,
        roh.einheit_id,
        &name,
        roh.abschnitt_id,
        vollzogen_at,
        roh.rhythmus_minuten,
        roh.rhythmus_quelle,
        &vorgabe,
        Some(id),
        BeginnQuelle::Vollzug,
        eingabe.plan_block_id,
        jetzt,
    )
    .await?;

    let mut wirkung = VollzugWirkung::default();
    wirkung.einheiten.extend(einheiten.iter().copied());
    wirkung
        .einheiten
        .extend(neu.iter().filter_map(|p| p.einheit_id));
    wirkung.personen.extend(alt.iter().map(|(p, ..)| *p));
    wirkung.personen.extend(neu.iter().map(|p| p.id));
    let mut inhalt = format!(
        "Ablösung vollzogen: Besatzungswechsel «{name}», Einheit und Fahrzeug bleiben. \
         Alte Besatzung: {}. Neue Besatzung: {}.",
        personen_text(alt.iter().map(|(_, n, ..)| n.as_str())),
        verteilung_text(&neu, roh.einheit_id),
    );
    if !bleibende.is_empty() {
        inhalt.push_str(&format!(
            " Bleibt: {}.",
            personen_text(bleibende.iter().map(String::as_str))
        ));
    }
    if !neu_dazu.is_empty() {
        inhalt.push_str(&format!(
            " Aus dem Schichtplan in den Einsatz übernommen: {}.",
            personen_text(
                neu.iter()
                    .filter(|p| neu_dazu.contains(&p.id))
                    .map(|p| p.name.as_str())
            )
        ));
    }
    Ok((vec![folge], inhalt, wirkung))
}
