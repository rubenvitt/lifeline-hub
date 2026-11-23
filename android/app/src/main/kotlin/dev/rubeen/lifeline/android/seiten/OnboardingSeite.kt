package dev.rubeen.lifeline.android.seiten

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.android.R
import dev.rubeen.lifeline.kern.Onboarding
import dev.rubeen.lifeline.kern.ServerAdresse
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.Vertragsergebnis
import dev.rubeen.lifeline.kern.text

/**
 * Onboarding (Entwurf D2, wie `OnboardingView`): Adresse eingeben, QR-Code scannen oder per
 * Deeplink vorbelegt; gespeichert wird erst ein verträglicher Server (entscheidet `Onboarding`).
 * Ohne gespeicherten Server ist es die Seite „kein Server“.
 *
 * @param alsBlatt weiterer Server aus der Serverliste statt der ganzen Seite
 * @param onAbbrechen Zurück aus dem Blatt; ohne ihn keine Schaltfläche
 * @param appVersion volle Version der App für Fuß und Statustexte
 * @param healthVersion Version aus `/api/health`, wenn der Server keinen Vertrag kennt
 * @param scanHinweis Meldung des letzten Scans (keine Adresse, keine Kamera)
 */
@Composable
fun OnboardingSeite(
    state: Onboarding.State,
    onEvent: (Onboarding.Event) -> Unit,
    onScan: () -> Unit,
    alsBlatt: Boolean = false,
    onAbbrechen: (() -> Unit)? = null,
    appVersion: String? = null,
    healthVersion: String? = null,
    scanHinweis: String? = null,
) {
    Seitenrahmen(
        modifier = Modifier.testTag("onboarding"),
        kopf = {
            Kopfzeile(
                titel = if (alsBlatt) "Server hinzufügen" else "Lifeline",
                onZurueck = onAbbrechen,
                zurueckText = "Abbrechen",
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (alsBlatt) "Server hinzufügen" else "Kein Server eingerichtet",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "Lifeline zeigt die Oberfläche deines Einsatzservers. Gib seine Adresse ein oder " +
                    "scanne einen QR-Code mit der Adresse.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when (state) {
            is Onboarding.State.Eingabe -> Eingabe(state, onEvent, onScan, scanHinweis)
            is Onboarding.State.Pruefung -> Pruefung(state.adresse, onEvent)
            is Onboarding.State.Abgelehnt ->
                Abgelehnt(state.adresse, state.ergebnis, healthVersion, appVersion, onEvent)
            is Onboarding.State.Verbunden ->
                Fortschritt(modifier = Modifier.align(Alignment.CenterHorizontally))
        }
        Text(
            appVersion ?: "Version unbekannt",
            modifier = Modifier.testTag("version"),
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Eingabe(
    state: Onboarding.State.Eingabe,
    onEvent: (Onboarding.Event) -> Unit,
    onScan: () -> Unit,
    scanHinweis: String?,
) {
    val leer = state.text.isBlank()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = state.text,
            onValueChange = { onEvent(Onboarding.Event.TextChanged(it)) },
            modifier = Modifier
                .fillMaxWidth()
                .testTag("adresse"),
            label = { Text("Adresse des Servers") },
            placeholder = { Text("https://elw.local:8443") },
            singleLine = true,
            isError = state.meldung != null,
            supportingText = state.meldung?.let { meldung -> { Text(meldung) } },
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Uri,
                imeAction = ImeAction.Go,
            ),
            keyboardActions = KeyboardActions(onGo = { if (!leer) onEvent(Onboarding.Event.Verbinden) }),
        )
        Button(
            onClick = { onEvent(Onboarding.Event.Verbinden) },
            enabled = !leer,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("verbinden"),
        ) {
            Text("Verbinden")
        }
        Zweitknopf(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
            Symbol(
                R.drawable.symbol_qr,
                beschreibung = null,
                modifier = Modifier.size(18.dp),
                farbe = MaterialTheme.colorScheme.primary,
            )
            Text("QR-Code scannen", modifier = Modifier.padding(start = 8.dp))
        }
        if (scanHinweis != null) {
            Text(
                scanHinweis,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Pruefung(adresse: ServerAdresse, onEvent: (Onboarding.Event) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Fortschritt(modifier = Modifier.size(20.dp), strichstaerke = 2.dp)
            Text("Prüfe ${adresse.text} …")
        }
        TextButton(onClick = { onEvent(Onboarding.Event.Zurueck) }) { Text("Abbrechen") }
    }
}

@Composable
private fun Abgelehnt(
    adresse: ServerAdresse,
    ergebnis: Vertragsergebnis,
    healthVersion: String?,
    appVersion: String?,
    onEvent: (Onboarding.Event) -> Unit,
) {
    val status = Statusseite.from(ergebnis, healthVersion) ?: return
    val text = status.text(servername = adresse.host, appVersion = appVersion)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Symbol(status.symbol, beschreibung = null, farbe = status.farbe)
            Text(text.titel, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Text(text.text)
        Schritte(text.schritte)
        Text("Der Server wurde nicht gespeichert.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = { onEvent(Onboarding.Event.Verbinden) }, modifier = Modifier.fillMaxWidth()) {
            Text("Erneut prüfen")
        }
        Zweitknopf(onClick = { onEvent(Onboarding.Event.Zurueck) }, modifier = Modifier.fillMaxWidth()) {
            Text("Adresse ändern")
        }
    }
}
