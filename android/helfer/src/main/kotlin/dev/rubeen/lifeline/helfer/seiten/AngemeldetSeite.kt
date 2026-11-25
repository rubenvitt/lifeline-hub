package dev.rubeen.lifeline.helfer.seiten

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import android.view.HapticFeedbackConstants
import dev.rubeen.lifeline.helfer.HelferModell
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.Verbindungsstand
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helferkern.Anzeige
import dev.rubeen.lifeline.helferkern.Phase
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Bildschirm 4 „Angemeldet“ (Spec „Bildschirme“): große Anzeige „Ortung an“ mit Ziel, Alter der
 * letzten Sendung und Verbindungszustand, „Pausieren“/„Fortsetzen“, „Abmelden“.
 */
@Composable
fun AngemeldetSeite(modell: HelferModell, onFortsetzen: () -> Unit, onOrtungStarten: () -> Unit, onEinstellungen: () -> Unit) {
    var abmeldenFragen by rememberSaveable { mutableStateOf(false) }
    val pausiert = modell.phase == Phase.Pausiert
    val jetzt = modell.jetzt
    val ansicht = LocalView.current
    // Haptik beim Wechsel zwischen „an“ und „pausiert“, nicht beim ersten Zeigen.
    var vorher by remember { mutableStateOf(pausiert) }
    LaunchedEffect(pausiert) {
        if (pausiert != vorher) ansicht.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
        vorher = pausiert
    }

    Seite {
        Seitenkopf(untertitel = modell.servername)
        if (pausiert) {
            Zustandsbuehne(
                augenbraue = modell.einsatzname,
                zustand = "Ortung pausiert",
                erklaerung = "Die Einsatzleitung sieht „pausiert“. Deine Position geht erst nach „Fortsetzen“ wieder raus.",
                farbe = farbe.achtung,
                flaeche = farbe.achtungFlaeche,
                pulsiert = false,
            )
        } else {
            Zustandsbuehne(
                augenbraue = modell.einsatzname,
                zustand = "Ortung an",
                erklaerung = "Deine Position geht an die Einsatzleitung, auch bei gesperrtem Bildschirm.",
                farbe = farbe.normal,
                flaeche = farbe.normalFlaeche,
                pulsiert = modell.ortungLaeuft,
            )
        }
        Karte {
            Wertzeile("Ziel", modell.zielname, R.drawable.symbol_ziel)
            modell.zustand?.person?.let { Wertzeile("Als Person", it.name, R.drawable.symbol_person) }
            Wertzeile(
                "Letzte Sendung",
                modell.letzteSendung?.let { Anzeige.alter(Duration.between(it, jetzt).seconds) } ?: "noch keine",
                R.drawable.symbol_uhr,
                modifier = Modifier.testTag("letzte-sendung"),
                wertStil = Stil.wert,
            )
            when (modell.verbindungsstand) {
                Verbindungsstand.UNBEKANNT -> Wertzeile("Verbindung", "wird geprüft", R.drawable.symbol_netz)
                Verbindungsstand.VERBUNDEN -> Wertzeile("Verbindung", "verbunden", R.drawable.symbol_netz)
                Verbindungsstand.WIEDERHOLT -> {
                    val sekunden = modell.naechsterVersuch?.let { Duration.between(jetzt, it).seconds.coerceAtLeast(0) }
                    Wertzeile(
                        "Verbindung",
                        if (sekunden == null) "ohne Netz" else "ohne Netz, neuer Versuch in $sekunden s",
                        R.drawable.symbol_kein_netz,
                        wertFarbe = farbe.achtungText,
                    )
                }
            }
            modell.zustand?.ablauf(Instant.now())?.let { ablauf ->
                Wertzeile("Angemeldet bis", UHRZEIT.format(ablauf.atZone(ZoneId.systemDefault())), R.drawable.symbol_sanduhr)
            }
        }
        OrtungsHinweise(modell, onOrtungStarten, onEinstellungen)
        modell.meldung?.let { Hinweis(it) }
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            if (pausiert) {
                Hauptknopf(
                    "Fortsetzen",
                    onClick = onFortsetzen,
                    modifier = Modifier.testTag("fortsetzen"),
                    rolle = Knopfrolle.NORMAL,
                    symbol = R.drawable.symbol_weiter,
                    beschaeftigt = modell.beschaeftigt,
                )
            } else {
                Hauptknopf(
                    "Pausieren",
                    onClick = { modell.pausieren() },
                    modifier = Modifier.testTag("pausieren"),
                    rolle = Knopfrolle.NEUTRAL,
                    symbol = R.drawable.symbol_pause,
                    beschaeftigt = modell.beschaeftigt,
                )
            }
            Nebenknopf("Abmelden", onClick = { abmeldenFragen = true }, modifier = Modifier.testTag("abmelden"), farbe = farbe.alarmText)
        }
    }
    if (abmeldenFragen) {
        AlertDialog(
            onDismissRequest = { abmeldenFragen = false },
            shape = eckig,
            title = { Text("Abmelden?") },
            text = { Text("Die Ortung endet. Für eine neue Anmeldung brauchst du wieder den QR-Code.") },
            confirmButton = {
                TextButton(onClick = {
                    abmeldenFragen = false
                    modell.abmelden()
                }) { Text("Abmelden", color = farbe.alarmText) }
            },
            dismissButton = { TextButton(onClick = { abmeldenFragen = false }) { Text("Weiter orten") } },
        )
    }
}

private val UHRZEIT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
