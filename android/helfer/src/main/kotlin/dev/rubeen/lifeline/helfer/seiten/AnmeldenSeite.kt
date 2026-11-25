package dev.rubeen.lifeline.helfer.seiten

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.helfer.HelferModell
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helferkern.ZielOption

/**
 * Bildschirm 2 „Anmelden“ (Spec „Bildschirme“): Server, Anzeigename, Ziel aus der Liste
 * (Einheiten und Fahrzeuge mit Rufname und taktischem Zeichen), „Mich als Person orten“ nur, wenn
 * die Organisation es erlaubt, Einwilligungssatz, „Anmelden und Ortung erlauben“. [onAnmelden]
 * fragt erst nach dem Standort und meldet dann an.
 */
@Composable
fun AnmeldenSeite(modell: HelferModell, onAnmelden: () -> Unit) {
    // Zurück (auch die vorausschauende Geste) bricht ab und führt zum Start.
    BackHandler { modell.abmelden() }
    Seite {
        Seitenkopf(untertitel = modell.servername)
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Augenbraue("Anmelden")
            Text("Wer bist du, und mit wem bist du unterwegs?", style = Stil.titel, color = farbe.text)
        }
        Eingabefeld(
            titel = "Anzeigename",
            wert = modell.anzeigename,
            onWert = { modell.anzeigename = it },
            kennung = "anzeigename",
            beispiel = "Max M., San-Trupp 2",
            tastatur = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
        )
        Zielwahl(modell)
        if (modell.zielliste?.personTrackingAllowed == true) {
            PersonOrten(modell.personOrten) { modell.personOrten = it }
        }
        Text(
            "Mit dem Anmelden sendet Lifeline Helfer deine Position an die Einsatzleitung, auch bei gesperrtem Bildschirm, bis du dich abmeldest, pausierst oder der Einsatz endet. Gespeichert wird nur die letzte Position.",
            modifier = Modifier.testTag("einwilligung"),
            style = Stil.klein,
            color = farbe.text2,
        )
        modell.meldung?.let { Hinweis(it) }
        Column(verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Hauptknopf(
                "Anmelden und Ortung erlauben",
                onClick = onAnmelden,
                modifier = Modifier.testTag("anmelden"),
                symbol = R.drawable.symbol_ortung,
                enabled = modell.kannAnmelden,
                beschaeftigt = modell.beschaeftigt,
            )
            Nebenknopf("Abbrechen", onClick = { modell.abmelden() }, modifier = Modifier.testTag("abbrechen"), farbe = farbe.gedaempft)
        }
    }
}

@Composable
private fun Zielwahl(modell: HelferModell) {
    Column(verticalArrangement = Arrangement.spacedBy(Abstand.xs)) {
        Augenbraue("Ziel")
        val liste = modell.zielliste
        when {
            liste != null -> {
                if (liste.targets.isEmpty()) {
                    Hinweis(
                        "Der Einsatz hat noch keine Einheiten oder Fahrzeuge. Bitte die Einsatzleitung fragen.",
                        farbe = farbe.bedienText,
                        flaeche = farbe.bedienFlaeche,
                    )
                }
                Zielauswahl(liste.targets, modell.gewaehltesZiel) { modell.gewaehltesZiel = it }
            }
            modell.zieleLaden -> Karte {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstand.sm)) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text("Ziele werden geladen …", style = Stil.klein, color = farbe.gedaempft)
                }
            }
            else -> Nebenknopf("Ziele erneut laden", onClick = { modell.ladeZiele() })
        }
    }
}

/** Auswählbare Liste der Ziele, eine Zeile je Einheit oder Fahrzeug (Auswahl wie Optionsfelder). */
@Composable
fun Zielauswahl(optionen: List<ZielOption>, gewaehlt: ZielOption?, waehle: (ZielOption) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(farbe.flaeche, eckig)
            .border(1.dp, farbe.linie, eckig)
            .selectableGroup(),
    ) {
        optionen.forEachIndexed { index, option ->
            if (index > 0) HorizontalDivider(color = farbe.linie)
            Zielzeile(option, option == gewaehlt) { waehle(option) }
        }
    }
}

/** Eine Zeile der Zielliste: Symbol der Art, Name, Rufname und taktisches Zeichen. */
@Composable
private fun Zielzeile(option: ZielOption, gewaehlt: Boolean, onClick: () -> Unit) {
    val f = farbe
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .heightIn(min = Abstand.steuer + 16.dp)
            .background(if (gewaehlt) f.bedienFlaeche else Color.Transparent)
            .selectable(selected = gewaehlt, role = Role.RadioButton, onClick = onClick)
            .testTag("ziel-${option.kennung}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (gewaehlt) f.bedien else Color.Transparent))
        Row(
            modifier = Modifier.weight(1f).padding(Abstand.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstand.sm),
        ) {
            Icon(
                painterResource(if (option.isFahrzeug) R.drawable.symbol_fahrzeug else R.drawable.symbol_einheit),
                contentDescription = if (option.isFahrzeug) "Fahrzeug" else "Einheit",
                tint = if (gewaehlt) f.bedien else f.gedaempft,
                modifier = Modifier.size(28.dp),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(option.name, style = Stil.text, color = f.text)
                option.callSign?.let { Text(it, style = Stil.klein, color = f.text2) }
                option.zeichen?.let { Text(it.uppercase(), style = Stil.augenbraue, color = f.gedaempft) }
            }
            // Die Zeile trägt die Auswahl; das Optionsfeld zeigt sie nur.
            RadioButton(
                selected = gewaehlt,
                onClick = null,
                colors = RadioButtonDefaults.colors(selectedColor = f.bedien, unselectedColor = f.linieStark),
            )
        }
    }
}

/** Schalter „Mich als Person orten“ mit Erklärung. */
@Composable
private fun PersonOrten(an: Boolean, aendern: (Boolean) -> Unit) {
    Karte(
        modifier = Modifier
            .toggleable(value = an, role = Role.Switch, onValueChange = aendern)
            .testTag("person-orten")
            .semantics { contentDescription = "Mich als Person orten" },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Mich als Person orten", style = Stil.text, color = farbe.text)
                Text("Die Einsatzleitung ordnet dich beim Bestätigen einer Kraft zu.", style = Stil.klein, color = farbe.gedaempft)
            }
            Switch(
                checked = an,
                onCheckedChange = null,
                colors = SwitchDefaults.colors(checkedTrackColor = farbe.normal, checkedThumbColor = farbe.aufBedien),
            )
        }
    }
}
