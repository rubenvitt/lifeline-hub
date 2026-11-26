package dev.rubeen.lifeline.helfer.seiten

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.helfer.HelferModell
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helferkern.Auftraege
import dev.rubeen.lifeline.helferkern.Dienstanzeige
import dev.rubeen.lifeline.helferkern.HelperTask
import dev.rubeen.lifeline.helferkern.HelperTaskRecipient
import dev.rubeen.lifeline.helferkern.Quittungsstand
import java.time.ZoneId

// Aufträge in der Helfer-App (ADR-0107, Entwurf „Oberfläche der App“): der Bereich auf „Angemeldet“
// und das Detail mit „Übernommen“. Gegenstück zu ios/Helfer/App/Seiten/AuftragSeite.swift.

/**
 * Bereich „Aufträge“ unter der Ortungsanzeige: Zahl der offenen, ohne Mitteilungsrecht der Hinweis,
 * die Liste (leer: „Keine Aufträge …“) und darunter der Empfangszustand des Dienstes.
 */
@Composable
fun AuftraegeBereich(modell: HelferModell) {
    val offen = Auftraege.offen(modell.auftraege)
    Column(modifier = Modifier.testTag("auftraege"), verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
        Augenbraue(if (offen > 0) "Aufträge · $offen offen" else "Aufträge")
        if (modell.mitteilungenAus) {
            Hinweis(Auftraege.MITTEILUNGEN_AUS, modifier = Modifier.testTag("mitteilungen-aus"))
        }
        if (modell.auftraege.isEmpty()) {
            Karte { Text(Auftraege.LEER, style = Stil.text, color = farbe.text2) }
        } else {
            modell.auftraege.forEach { a -> Auftragszeile(modell, a) }
        }
        Karte {
            Wertzeile(
                "Empfang",
                if (modell.empfangVerbunden) Dienstanzeige.EMPFAENGT else Dienstanzeige.GETRENNT,
                R.drawable.symbol_netz,
                modifier = Modifier.testTag("empfang"),
                wertFarbe = if (modell.empfangVerbunden) farbe.text else farbe.achtungText,
            )
        }
    }
}

@Composable
private fun Auftragszeile(modell: HelferModell, a: HelperTask) {
    val stand = Auftraege.stand(a, modell.eigeneZeile(a))
    val (kante, flaeche) = when (stand) {
        Quittungsstand.Offen -> farbe.bedien to farbe.flaeche
        is Quittungsstand.Quittiert -> farbe.linieStark to farbe.flaeche
        Quittungsstand.Aufgehoben -> farbe.linie to farbe.flaeche2
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(flaeche, eckig)
            .border(1.dp, kante, eckig)
            .clickable(role = Role.Button) { modell.zeigeAuftrag(a.id) }
            .padding(Abstand.md)
            .semantics(mergeDescendants = true) {}
            .testTag("auftrag-${a.id}"),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(Abstand.sm),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Abstand.xs)) {
            Text(
                a.text,
                style = Stil.kartentitel,
                color = if (stand == Quittungsstand.Aufgehoben) farbe.gedaempft else farbe.text,
                textDecoration = if (stand == Quittungsstand.Aufgehoben) TextDecoration.LineThrough else null,
                maxLines = 3,
            )
            Text(zeilentext(a, stand, modell.anzeigename), style = Stil.klein, color = standfarbe(stand))
        }
    }
}

/**
 * Detail eines Auftrags: Text groß, Ort, Priorität, Frist, erteilt um; je eigener Empfängerzeile
 * (Einheit, Fahrzeug, Person) an wen und der große Knopf „Übernommen“ bzw. danach die Quittung, wie
 * in der iOS-App; aufgehoben durchgestrichen ohne Knopf.
 */
@Composable
fun AuftragSeite(modell: HelferModell, a: HelperTask) {
    BackHandler { modell.zeigeAuftrag(null) }
    val zone = ZoneId.systemDefault()
    val aufgehoben = a.isAufgehoben
    Seite {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Augenbraue(a.number?.let { "Auftrag $it" } ?: "Auftrag", modifier = Modifier.weight(1f))
            Schliessknopf(onClick = { modell.zeigeAuftrag(null) }, beschreibung = "Zurück zu den Aufträgen")
        }
        Text(
            a.text,
            modifier = Modifier.testTag("auftragstext"),
            style = Stil.titel,
            color = if (aufgehoben) farbe.gedaempft else farbe.text,
            textDecoration = if (aufgehoben) TextDecoration.LineThrough else null,
        )
        if (aufgehoben) {
            Text(Auftraege.AUFGEHOBEN, modifier = Modifier.testTag("aufgehoben"), style = Stil.kartentitel, color = farbe.alarmText)
        }
        Karte {
            a.location?.let { Wertzeile("Ort", it, R.drawable.symbol_ziel) }
            Wertzeile("Priorität", Auftraege.prioritaet(a.priority))
            a.deadlineAt?.let { frist ->
                Wertzeile("Frist", Auftraege.uhrzeit(frist, zone) ?: frist, R.drawable.symbol_sanduhr, wertStil = Stil.wert)
            }
            Wertzeile("Erteilt um", Auftraege.uhrzeit(a.issuedAt, zone) ?: a.issuedAt, R.drawable.symbol_uhr, wertStil = Stil.wert)
        }
        a.recipients.forEach { zeile -> Quittungszeile(modell, a, zeile, zone) }
        Nebenknopf("Zurück zu den Aufträgen", onClick = { modell.zeigeAuftrag(null) }, modifier = Modifier.testTag("zurueck"))
    }
}

/** Eine eigene Empfängerzeile: an wen, dann Knopf „Übernommen“ oder der Stand. */
@Composable
private fun Quittungszeile(modell: HelferModell, a: HelperTask, zeile: HelperTaskRecipient, zone: ZoneId) {
    val stand = Auftraege.stand(a, zeile)
    Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
        Karte { Wertzeile("An", Auftraege.empfaengertext(zeile), R.drawable.symbol_einheit) }
        when (stand) {
            Quittungsstand.Offen -> {
                Hauptknopf(
                    Auftraege.UEBERNEHMEN,
                    onClick = { modell.uebernehmen(a, zeile) },
                    modifier = Modifier.testTag("uebernehmen-${zeile.id}"),
                    rolle = Knopfrolle.NORMAL,
                    symbol = R.drawable.symbol_auftrag,
                    beschaeftigt = modell.quittiertGerade == zeile.id,
                )
                if (zeile.id in modell.quittungFehlgeschlagen) {
                    Hinweis(
                        Auftraege.QUITTUNG_FEHLGESCHLAGEN,
                        modifier = Modifier.testTag("quittung-fehler"),
                        farbe = farbe.alarmText,
                        flaeche = farbe.alarmFlaeche,
                    )
                }
            }
            is Quittungsstand.Quittiert -> Zustandsbuehne(
                augenbraue = a.number?.let { "Auftrag $it" } ?: "Auftrag",
                zustand = Auftraege.UEBERNEHMEN,
                erklaerung = Auftraege.quittungstext(stand, modell.anzeigename, zone).orEmpty(),
                farbe = farbe.normal,
                flaeche = farbe.normalFlaeche,
                pulsiert = false,
            )
            Quittungsstand.Aufgehoben -> Unit
        }
    }
}

/** Unterzeile in der Liste: Stand und erteilt um. */
private fun zeilentext(a: HelperTask, stand: Quittungsstand, eigenerName: String): String {
    val zone = ZoneId.systemDefault()
    val erteilt = Auftraege.uhrzeit(a.issuedAt, zone)?.let { "erteilt $it" }
    val zustand = when (stand) {
        Quittungsstand.Offen -> if (a.priority == "normal") "offen" else "offen · ${Auftraege.prioritaet(a.priority)}"
        is Quittungsstand.Quittiert -> Auftraege.quittungstext(stand, eigenerName, zone)
        Quittungsstand.Aufgehoben -> Auftraege.AUFGEHOBEN
    }
    return listOfNotNull(zustand, erteilt).joinToString(" · ")
}

@Composable
private fun standfarbe(stand: Quittungsstand) = when (stand) {
    Quittungsstand.Offen -> farbe.bedienText
    is Quittungsstand.Quittiert -> farbe.normalText
    Quittungsstand.Aufgehoben -> farbe.alarmText
}
