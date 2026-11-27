package dev.rubeen.lifeline.helfer.seiten

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helferkern.Auftraege

/**
 * Vollbild des Pagers über dem Sperrbildschirm (LLH-2157, `PagerActivity`): nur „Neuer Auftrag“
 * bzw. die Erinnerung und „Ansehen“, kein Inhalt (wie die öffentliche Fassung der Mitteilung).
 */
@Composable
fun PagerSeite(erinnerung: Boolean, onAnsehen: () -> Unit) {
    Seite {
        Seitenkopf()
        Spacer(Modifier.height(48.dp))
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.md)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstand.sm)) {
                Statuspunkt(farbe.alarm, pulsiert = true, groesse = 20.dp)
                Augenbraue(Auftraege.KANAL, farbe = farbe.alarmText)
            }
            Text(
                if (erinnerung) Auftraege.ERINNERUNG_OEFFENTLICH else Auftraege.MITTEILUNG_OEFFENTLICH,
                modifier = Modifier.testTag("pager-titel"),
                style = Stil.zustand,
                color = farbe.text,
            )
        }
        Spacer(Modifier.height(24.dp))
        Hauptknopf(
            Auftraege.ANSEHEN,
            onClick = onAnsehen,
            modifier = Modifier.testTag("pager-ansehen"),
            rolle = Knopfrolle.ALARM,
            symbol = R.drawable.symbol_auftrag,
        )
    }
}
