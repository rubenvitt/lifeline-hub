package dev.rubeen.lifeline.helfer.seiten

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import dev.rubeen.lifeline.helfer.HelferModell
import dev.rubeen.lifeline.helferkern.empfaengt
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe

/**
 * Bildschirm 3 „Wartet“ (Spec „Bildschirme“): Name des Einsatzes, „Die Einsatzleitung bestätigt
 * dich gleich“, Ortung schon an (sichtbar), „Abbrechen“. Das Ziel lässt sich hier noch ändern.
 */
@Composable
fun WartetSeite(modell: HelferModell, onOrtungStarten: () -> Unit, onEinstellungen: () -> Unit) {
    var zielWaehlen by rememberSaveable { mutableStateOf(false) }
    Seite {
        Seitenkopf(untertitel = modell.servername)
        Zustandsbuehne(
            augenbraue = "Wartet auf Bestätigung",
            zustand = modell.einsatzname,
            erklaerung = "Die Einsatzleitung bestätigt dich gleich. Du kannst das Handy schon einstecken.",
            farbe = farbe.achtung,
            flaeche = farbe.achtungFlaeche,
        )
        Karte {
            Wertzeile("Ziel", modell.zielname, R.drawable.symbol_ziel)
            Wertzeile("Name", modell.anzeigename, R.drawable.symbol_person)
            Wertzeile("Ortung", if (modell.ortungLaeuft) "an" else "aus", R.drawable.symbol_ortung)
        }
        OrtungsHinweise(modell, onOrtungStarten, onEinstellungen)
        modell.meldung?.let { Hinweis(it) }
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            if (modell.kannZielAendern) {
                Nebenknopf("Ziel ändern", onClick = { zielWaehlen = true }, modifier = Modifier.testTag("ziel-aendern"))
            }
            Nebenknopf(
                "Abbrechen",
                onClick = { modell.abmelden() },
                modifier = Modifier.testTag("abbrechen"),
                farbe = farbe.alarmText,
                enabled = !modell.beschaeftigt,
            )
        }
    }
    if (zielWaehlen) {
        ZielAendern(modell, fertig = { zielWaehlen = false })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ZielAendern(modell: HelferModell, fertig: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = fertig,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = eckig,
        containerColor = farbe.grund,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Abstand.rinne)
                .padding(bottom = Abstand.lg)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(Abstand.md),
        ) {
            Augenbraue("Ziel ändern")
            val liste = modell.zielliste
            if (liste != null) {
                Zielauswahl(liste.targets, modell.gewaehltesZiel) { option ->
                    modell.zielAendern(option)
                    fertig()
                }
            } else {
                LaunchedEffect(Unit) { modell.ladeZiele() }
                CircularProgressIndicator()
            }
            Nebenknopf("Abbrechen", onClick = fertig, farbe = farbe.gedaempft)
        }
    }
}

/** Hinweise zur Ortung: nicht erlaubt, oder nach einem Neustart der App noch nicht wieder an. */
@Composable
fun OrtungsHinweise(modell: HelferModell, onOrtungStarten: () -> Unit, onEinstellungen: () -> Unit) {
    if (modell.ortungVerweigert) {
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Hinweis(
                "Die Ortung ist nicht erlaubt. Erlaube sie unter Einstellungen → Apps → Lifeline Helfer → Berechtigungen → Standort → „Nur während der Nutzung der App zulassen“.",
                farbe = farbe.alarmText,
                flaeche = farbe.alarmFlaeche,
            )
            Nebenknopf("Einstellungen öffnen", onClick = onEinstellungen)
        }
    } else if (modell.isEcht && modell.phase.empfaengt && !modell.phase.ortet && !modell.dienstLaeuft) {
        // Nach einem Neustart der App läuft auch der Empfang erst wieder, wenn die Kraft ihn startet.
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Hinweis("Die App wurde neu gestartet. Aufträge kommen erst wieder als Mitteilung, wenn du den Empfang startest.")
            Hauptknopf(
                "Empfang starten",
                onClick = onOrtungStarten,
                modifier = Modifier.testTag("empfang-starten"),
                rolle = Knopfrolle.NORMAL,
                symbol = R.drawable.symbol_auftrag,
            )
        }
    } else if (modell.phase.ortet && !modell.ortungLaeuft) {
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Hinweis("Die App wurde neu gestartet. Die Ortung läuft erst wieder, wenn du sie startest.")
            Hauptknopf(
                "Ortung wieder starten",
                onClick = onOrtungStarten,
                modifier = Modifier.testTag("ortung-starten"),
                rolle = Knopfrolle.NORMAL,
                symbol = R.drawable.symbol_ortung,
            )
        }
    }
}
