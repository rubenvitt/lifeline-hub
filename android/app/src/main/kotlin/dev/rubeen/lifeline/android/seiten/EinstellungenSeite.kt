package dev.rubeen.lifeline.android.seiten

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.kern.Kanal
import dev.rubeen.lifeline.kern.Updatestand

/**
 * Einstellungen der Hülle (Entwurf D6, D9; wie `EinstellungenView`): nur Schalter der Hülle,
 * dazu Version, Kanal, Stand des Updaters und „Jetzt prüfen“. Einstellungen der Oberfläche
 * stehen in der Oberfläche.
 *
 * @param kanal `null`: der Bau hat keinen Kanal und sucht keine Updates
 * @param onInstallieren „Jetzt installieren“, bei fehlender Erlaubnis der Weg in die Systemeinstellung
 */
@Composable
fun EinstellungenSeite(
    haptik: Boolean,
    onHaptik: (Boolean) -> Unit,
    version: String,
    kanal: Kanal?,
    stand: Updatestand,
    onPruefen: () -> Unit,
    onInstallieren: () -> Unit,
    build: String? = null,
    onZurueck: (() -> Unit)? = null,
) {
    Seitenrahmen(
        modifier = Modifier.testTag("einstellungen"),
        kopf = { Kopfzeile(titel = "Einstellungen", onZurueck = onZurueck) },
    ) {
        Abschnitt(
            fussnote = "Kurze Rückmeldung beim Speichern, bei Alarmen und beim Wechsel eines " +
                "Segments. Nur auf Geräten mit Vibrationsmotor spürbar.",
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Haptik", modifier = Modifier.weight(1f))
                Switch(checked = haptik, onCheckedChange = onHaptik, modifier = Modifier.testTag("schalter-haptik"))
            }
        }
        Abschnitt(ueberschrift = "Updates", fussnote = erlaeuterung(kanal, stand)) {
            Wertzeile("Kanal", kanal?.anzeige ?: "Keiner")
            if (kanal != null) {
                Trennlinie()
                Wertzeile(
                    "Stand",
                    stand.anzeige,
                    wertFarbe = with(MaterialTheme.colorScheme) {
                        if (stand == Updatestand.BEREIT) secondary else onSurfaceVariant
                    },
                )
                Column(
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    when (stand) {
                        Updatestand.BEREIT, Updatestand.ERLAUBNIS_FEHLT ->
                            Button(onClick = onInstallieren, modifier = Modifier.fillMaxWidth()) {
                                Text(if (stand == Updatestand.BEREIT) "Jetzt installieren" else "Erlaubnis erteilen")
                            }
                        else -> {}
                    }
                    Zweitknopf(
                        onClick = onPruefen,
                        enabled = stand != Updatestand.LAEDT && stand != Updatestand.INSTALLIERT_GLEICH,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("update-pruefen"),
                    ) {
                        Text("Jetzt prüfen")
                    }
                }
            }
        }
        Abschnitt(ueberschrift = "Über") {
            Wertzeile("Version", version)
            Trennlinie()
            Wertzeile("Build", build ?: "unbekannt")
        }
    }
}

private val Kanal.anzeige: String
    get() = when (this) {
        Kanal.ALPHA -> "Alpha"
        Kanal.BETA -> "Beta"
        Kanal.STABIL -> "Stabil"
    }

private val Updatestand.anzeige: String
    get() = when (this) {
        Updatestand.KEINS -> "Kein Update bereit"
        Updatestand.LAEDT -> "Wird geladen …"
        Updatestand.BEREIT -> "Update bereit"
        Updatestand.INSTALLIERT_GLEICH -> "Wird installiert …"
        Updatestand.BLOCKIERT -> "Installation blockiert"
        Updatestand.ERLAUBNIS_FEHLT -> "Erlaubnis fehlt"
        Updatestand.FEHLER -> "Prüfung fehlgeschlagen"
    }

private fun erlaeuterung(kanal: Kanal?, stand: Updatestand): String =
    if (kanal == null) {
        "Dieser Bau hat keinen Update-Kanal und sucht keine Updates."
    } else {
        when (stand) {
            Updatestand.KEINS, Updatestand.LAEDT ->
                "Lifeline sucht beim Start und bei der Rückkehr in die App nach Updates, höchstens " +
                    "alle vier Stunden, und lädt sie im Hintergrund."
            Updatestand.BEREIT ->
                "Lifeline installiert das Update beim nächsten Start oder wenn die App länger im " +
                    "Hintergrund liegt, nie mitten in der Arbeit. Die App schließt sich dabei kurz."
            Updatestand.INSTALLIERT_GLEICH ->
                "Die App schließt sich gleich und meldet sich nach dem Update wieder."
            Updatestand.BLOCKIERT ->
                "Das Gerät lässt keine Apps außerhalb der Stores zu (etwa Samsungs „Auto Blocker“). " +
                    "Wie es sich abschalten lässt, steht in der Anleitung zur Android-App."
            Updatestand.ERLAUBNIS_FEHLT ->
                "Lifeline darf keine Apps installieren. Erlaube „Unbekannte Apps installieren“ für " +
                    "Lifeline in den Systemeinstellungen."
            Updatestand.FEHLER ->
                "Lifeline versucht es später erneut. Die Oberfläche bleibt davon unberührt."
        }
    }
