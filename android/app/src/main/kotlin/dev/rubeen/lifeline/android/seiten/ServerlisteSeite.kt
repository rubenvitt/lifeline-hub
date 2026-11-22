package dev.rubeen.lifeline.android.seiten

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.android.R
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.ServerEintrag
import dev.rubeen.lifeline.kern.Serverentfernung
import dev.rubeen.lifeline.kern.Serverliste
import dev.rubeen.lifeline.kern.Statusseite
import dev.rubeen.lifeline.kern.text
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Serverliste (Entwurf D2, D3; wie `ServerlisteView`): Name, Adresse, zuletzt verbunden und der
 * Zustand des aktiven Servers; wechseln, umbenennen, hinzufügen und entfernen. Entfernen bietet
 * nur `Serverentfernung.isEntfernbar` an, nach einer Rückfrage mit dem Hinweis auf nicht
 * übertragene Einträge. „Zur Oberfläche“ und ein Tipp auf den aktiven Server laden dessen
 * Startadresse neu, der Weg zurück von einer fremden Seite im WebView (`Ablauf.ZurOberflaeche`).
 *
 * @param seite die Seite unter der Liste; aus ihr kommt der Zustand des aktiven Servers und ob
 *   die Liste „Zur Oberfläche“ anbietet (`Ablauf.bietetZurOberflaeche`)
 * @param onZurOberflaeche „Zur Oberfläche“ oder Tipp auf den aktiven Server
 * @param inEntfernung Server, dessen Daten gerade gelöscht werden; seine Zeile ruht
 * @param entfernenFehler Meldung, wenn sich ein Server nicht entfernen ließ
 */
@Composable
fun ServerlisteSeite(
    liste: Serverliste,
    seite: Ablauf.Seite,
    onWechseln: (ServerEintrag) -> Unit,
    onZurOberflaeche: () -> Unit,
    onUmbenennen: (ServerEintrag, String) -> Unit,
    onEntfernen: (ServerEintrag) -> Unit,
    onHinzufuegen: () -> Unit,
    onEinstellungen: () -> Unit,
    onFertig: () -> Unit,
    inEntfernung: String? = null,
    entfernenFehler: String? = null,
    onFehlerGesehen: () -> Unit = {},
) {
    var umbenennen by remember { mutableStateOf<ServerEintrag?>(null) }
    var entfernen by remember { mutableStateOf<ServerEintrag?>(null) }

    Seitenrahmen(
        modifier = Modifier.testTag("serverliste"),
        kopf = {
            Kopfzeile(titel = "Server") {
                IconButton(onClick = onHinzufuegen) {
                    Symbol(
                        R.drawable.symbol_hinzufuegen,
                        beschreibung = "Server hinzufügen",
                        farbe = MaterialTheme.colorScheme.primary,
                    )
                }
                TextButton(onClick = onFertig) { Text("Fertig", fontWeight = FontWeight.SemiBold) }
            }
        },
    ) {
        if (Ablauf.bietetZurOberflaeche(seite)) {
            Abschnitt(fussnote = "Lädt die Startseite von „${liste.aktiv?.name ?: ""}“ neu.") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Button, onClick = onZurOberflaeche)
                        .heightIn(min = 52.dp)
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                        .testTag("zur-oberflaeche"),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Symbol(R.drawable.symbol_zurueck, beschreibung = null, farbe = MaterialTheme.colorScheme.primary)
                    Text("Zur Oberfläche", color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        Abschnitt(fussnote = "Jeder Server hat seine eigene Anmeldung und seine eigenen Offline-Daten.") {
            liste.eintraege.forEachIndexed { index, eintrag ->
                if (index > 0) {
                    Trennlinie(einzug = 52.dp)
                }
                val aktiv = eintrag.id == liste.aktiv?.id
                Zeile(
                    eintrag = eintrag,
                    aktiv = aktiv,
                    zustand = if (aktiv) zustand(seite, eintrag) else null,
                    entfernbar = inEntfernung == null && Serverentfernung.isEntfernbar(eintrag.id, liste),
                    ruht = eintrag.id == inEntfernung,
                    onTipp = { if (aktiv) onZurOberflaeche() else onWechseln(eintrag) },
                    onUmbenennen = { umbenennen = eintrag },
                    onEntfernen = { entfernen = eintrag },
                )
            }
        }
        Abschnitt {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClick = onEinstellungen)
                    .heightIn(min = 52.dp)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("einstellungen-link"),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Symbol(R.drawable.symbol_einstellungen, beschreibung = null)
                Text("Einstellungen")
            }
        }
    }

    umbenennen?.let { eintrag ->
        Umbenennen(
            eintrag = eintrag,
            onSichern = { name ->
                umbenennen = null
                onUmbenennen(eintrag, name)
            },
            onAbbrechen = { umbenennen = null },
        )
    }
    entfernen?.let { eintrag ->
        AlertDialog(
            onDismissRequest = { entfernen = null },
            title = { Text(Serverentfernung.rueckfrageTitel(eintrag)) },
            text = { Text(Serverentfernung.HINWEIS) },
            confirmButton = {
                TextButton(
                    onClick = {
                        entfernen = null
                        onEntfernen(eintrag)
                    },
                    modifier = Modifier.testTag("entfernen-bestaetigen"),
                ) {
                    Text("Server entfernen", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { entfernen = null }) { Text("Abbrechen") } },
        )
    }
    if (entfernenFehler != null) {
        AlertDialog(
            onDismissRequest = onFehlerGesehen,
            title = { Text("Server nicht entfernt") },
            text = { Text(entfernenFehler) },
            confirmButton = { TextButton(onClick = onFehlerGesehen) { Text("OK") } },
        )
    }
}

@Composable
private fun Zeile(
    eintrag: ServerEintrag,
    aktiv: Boolean,
    zustand: Pair<String, Color?>?,
    entfernbar: Boolean,
    ruht: Boolean,
    onTipp: () -> Unit,
    onUmbenennen: () -> Unit,
    onEntfernen: () -> Unit,
) {
    var menue by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { selected = aktiv }
            .clickable(enabled = !ruht, role = Role.Button, onClick = onTipp)
            .padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp)
            .testTag("zeile-${eintrag.id}"),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Symbol(
            if (aktiv) R.drawable.symbol_aktiv else R.drawable.symbol_inaktiv,
            beschreibung = null,
            farbe = if (aktiv) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(eintrag.name, fontWeight = if (aktiv) FontWeight.SemiBold else FontWeight.Normal)
            val gedaempft = MaterialTheme.colorScheme.onSurfaceVariant
            Text(eintrag.adresse.text, style = MaterialTheme.typography.bodySmall, color = gedaempft)
            Text(zuletzt(eintrag), style = MaterialTheme.typography.labelSmall, color = gedaempft)
            if (zustand != null) {
                Text(
                    zustand.first,
                    style = MaterialTheme.typography.labelSmall,
                    color = zustand.second ?: MaterialTheme.colorScheme.secondary,
                )
            }
        }
        if (aktiv) {
            Text(
                "Aktiv",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box {
            IconButton(
                onClick = { menue = true },
                enabled = !ruht,
                modifier = Modifier.testTag("menue-${eintrag.id}"),
            ) {
                Symbol(R.drawable.symbol_mehr, beschreibung = "Aktionen für „${eintrag.name}“")
            }
            DropdownMenu(expanded = menue, onDismissRequest = { menue = false }) {
                DropdownMenuItem(
                    text = { Text("Umbenennen") },
                    onClick = {
                        menue = false
                        onUmbenennen()
                    },
                )
                // Der aktive Server lässt sich erst nach einem Wechsel entfernen.
                if (entfernbar) {
                    DropdownMenuItem(
                        text = { Text("Entfernen", color = MaterialTheme.colorScheme.error) },
                        onClick = {
                            menue = false
                            onEntfernen()
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun Umbenennen(eintrag: ServerEintrag, onSichern: (String) -> Unit, onAbbrechen: () -> Unit) {
    var name by remember(eintrag.id) { mutableStateOf(eintrag.name) }
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text("Server umbenennen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = { Text(eintrag.adresse.host) },
                    singleLine = true,
                )
                Text("Ein leerer Name zeigt den Hostnamen.", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = { onSichern(name) }) { Text("Sichern") } },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text("Abbrechen") } },
    )
}

private val ZEITFORMAT: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.GERMANY)

private fun zuletzt(eintrag: ServerEintrag): String {
    val zeit = eintrag.zuletztVerbunden ?: return "Noch nie verbunden"
    return "Zuletzt verbunden " + ZEITFORMAT.format(Instant.ofEpochMilli(zeit).atZone(ZoneId.systemDefault()))
}

/** Was die Seite unter der Liste über den aktiven Server sagt, mit der Farbe ihrer Status-Seite. */
private fun zustand(seite: Ablauf.Seite, eintrag: ServerEintrag): Pair<String, Color?>? {
    if (seite == Ablauf.Seite.WebviewVeraltet) {
        return Statusseite.WebviewVeraltet.text(null, null).titel to Statusseite.WebviewVeraltet.farbe
    }
    if (seite.eintrag?.id != eintrag.id) return null
    return when (seite) {
        is Ablauf.Seite.Pruefung -> "Wird geprüft …" to null
        is Ablauf.Seite.Web -> (if (seite.offline) "Ohne Verbindung, zeigt die Offline-Daten" else "Verbunden") to null
        // Ohne Version: die Zeile nennt nur den Titel der Status-Seite.
        is Ablauf.Seite.Status -> seite.status.text(eintrag.name, null).titel to seite.status.farbe
        else -> null
    }
}
