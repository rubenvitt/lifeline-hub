package dev.rubeen.lifeline.helfer.seiten

import android.view.HapticFeedbackConstants
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import dev.rubeen.lifeline.helfer.HelferModell
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helferkern.Grund

/** Bildschirm 5 „Beendet“ (Spec „Bildschirme“): Grund und „Neu anmelden“. Die Ortung ist aus. */
@Composable
fun BeendetSeite(modell: HelferModell, grund: Grund) {
    val ansicht = LocalView.current
    LaunchedEffect(grund) { ansicht.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) }
    Seite {
        Seitenkopf()
        Zustandsbuehne(
            augenbraue = "Ortung aus",
            zustand = grund.titel,
            erklaerung = grund.text,
            farbe = farbe.gedaempft,
            flaeche = farbe.flaeche,
            pulsiert = false,
        )
        modell.zustand?.incident?.name?.let { einsatz ->
            Karte { Wertzeile("Einsatz", einsatz, R.drawable.symbol_ziel) }
        }
        Hauptknopf(
            "Neu anmelden",
            onClick = { modell.neuAnmelden() },
            modifier = Modifier.testTag("neu-anmelden"),
            symbol = R.drawable.symbol_qr,
        )
    }
}
