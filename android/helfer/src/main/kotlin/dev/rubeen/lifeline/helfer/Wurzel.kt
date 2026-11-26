package dev.rubeen.lifeline.helfer

import android.Manifest
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import dev.rubeen.lifeline.helfer.seiten.AngemeldetSeite
import dev.rubeen.lifeline.helfer.seiten.AuftragSeite
import dev.rubeen.lifeline.helfer.seiten.AnmeldenSeite
import dev.rubeen.lifeline.helfer.seiten.BeendetSeite
import dev.rubeen.lifeline.helfer.seiten.ScannerSeite
import dev.rubeen.lifeline.helfer.seiten.StartSeite
import dev.rubeen.lifeline.helfer.seiten.WartetSeite
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helferkern.Phase

/** Grobe Art der Seite, damit ein Wechsel innerhalb einer Seite (aktiv ⇄ pausiert ⇄ ruht) nicht überblendet. */
private fun seitenart(phase: Phase): Int = when (phase) {
    Phase.Start -> 0
    is Phase.Anmelden -> 1
    Phase.Unbestaetigt -> 2
    Phase.Aktiv, Phase.Pausiert, is Phase.Ruht -> 3
    is Phase.Beendet -> 4
}

/**
 * Wählt die Seite nach der Phase der `Anmeldung` im Kern; Wechsel sind sanft animiert. Fragt vor dem
 * Anmelden und vor dem Start der Ortung nach dem Standort (fein oder grob, nur im Vordergrund) und
 * nach Benachrichtigungen; nie nach dem Standort im Hintergrund (ADR-0101).
 */
@Composable
fun Wurzel(modell: HelferModell, onEinstellungen: () -> Unit) {
    var scannt by rememberSaveable { mutableStateOf(false) }
    // Was nach der Antwort auf die Rechte-Abfrage geschieht (Anmelden oder Ortung starten).
    var danach by rememberSaveable { mutableStateOf<String?>(null) }
    val rechte = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        when (danach) {
            NACH_ANMELDEN -> modell.anmelden()
            NACH_FORTSETZEN -> modell.fortsetzen()
            NACH_STARTEN -> modell.starteOrtung()
        }
        danach = null
    }
    val mitRechten: (String) -> Unit = { schritt ->
        if (!modell.isEcht) {
            when (schritt) {
                NACH_ANMELDEN -> modell.anmelden()
                NACH_FORTSETZEN -> modell.fortsetzen()
                NACH_STARTEN -> modell.starteOrtung()
            }
        } else {
            danach = schritt
            rechte.launch(RECHTE)
        }
    }

    val ansicht = LocalView.current
    val bestaetigungen by rememberUpdatedState(modell.bestaetigungen)
    LaunchedEffect(bestaetigungen) {
        if (bestaetigungen > 0) {
            ansicht.performHapticFeedback(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS,
            )
        }
    }

    if (scannt) {
        ScannerSeite(
            onGefunden = { text ->
                scannt = false
                modell.gescannt(text)
            },
            onAbbrechen = { scannt = false },
        )
    } else {
        AnimatedContent(
            targetState = modell.phase,
            contentKey = ::seitenart,
            transitionSpec = {
                if (targetState is Phase.Anmelden) {
                    (slideInHorizontally { it / 3 } + fadeIn()) togetherWith fadeOut()
                } else {
                    fadeIn() togetherWith fadeOut()
                }
            },
            label = "seite",
        ) { phase ->
            when (phase) {
                Phase.Start -> StartSeite(modell, onScannen = { scannt = true })
                is Phase.Anmelden -> AnmeldenSeite(modell, onAnmelden = { mitRechten(NACH_ANMELDEN) })
                Phase.Unbestaetigt -> WartetSeite(modell, onOrtungStarten = { mitRechten(NACH_STARTEN) }, onEinstellungen = onEinstellungen)
                Phase.Aktiv, Phase.Pausiert, is Phase.Ruht -> {
                    // Detail eines Auftrags (aus der Liste oder einer Mitteilung, ADR-0107).
                    val auftrag = modell.offenerAuftrag?.let { id -> modell.auftraege.firstOrNull { it.id == id } }
                    if (auftrag != null) {
                        AuftragSeite(modell, auftrag)
                    } else {
                        AngemeldetSeite(
                            modell,
                            onFortsetzen = { mitRechten(NACH_FORTSETZEN) },
                            onOrtungStarten = { mitRechten(NACH_STARTEN) },
                            onEinstellungen = onEinstellungen,
                        )
                    }
                }
                is Phase.Beendet -> BeendetSeite(modell, phase.grund)
            }
        }
    }

    // Ein neuer Scan während einer Anmeldung: erst fragen, ob die alte enden soll.
    if (modell.ausstehenderScan != null) {
        BackHandler { modell.bestaetigeNeuenScan(false) }
        AlertDialog(
            onDismissRequest = { modell.bestaetigeNeuenScan(false) },
            shape = eckig,
            title = { Text("Neue Einladung") },
            text = { Text("Du bist schon an „${modell.einsatzname}“ angemeldet. Je Gerät gibt es eine Anmeldung.") },
            confirmButton = {
                TextButton(onClick = { modell.bestaetigeNeuenScan(true) }) {
                    Text("Alte Anmeldung beenden und neu anmelden", color = farbe.alarmText)
                }
            },
            dismissButton = { TextButton(onClick = { modell.bestaetigeNeuenScan(false) }) { Text("Abbrechen") } },
        )
    }
}

private const val NACH_ANMELDEN = "anmelden"
private const val NACH_FORTSETZEN = "fortsetzen"
private const val NACH_STARTEN = "starten"

/** Standort fein oder grob (die Person darf „ungefähr“ wählen) und ab Android 13 Benachrichtigungen. */
private val RECHTE: Array<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
}.toTypedArray()
