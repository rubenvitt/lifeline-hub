package dev.rubeen.lifeline.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.rubeen.lifeline.android.seiten.ServerlisteSeite
import dev.rubeen.lifeline.android.ui.LifelineThema
import dev.rubeen.lifeline.kern.Ablauf
import dev.rubeen.lifeline.kern.ServerEintrag
import dev.rubeen.lifeline.kern.Serverentfernung
import dev.rubeen.lifeline.kern.Serverliste
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Entfernen in der Serverliste (Entwurf D2, D3): Rückfrage mit Hinweis, nie den aktiven Server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ServerlisteSeiteTest {
    @get:Rule
    val compose = createComposeRule()

    // Beispielliste der Bilder: „ELW 1“ aktiv, „Lager“ nicht.
    private val liste: Serverliste = AppModell.beispielliste()
    private val elw: ServerEintrag = liste.eintraege.first { it.name == "ELW 1" }
    private val lager: ServerEintrag = liste.eintraege.first { it.name == "Lager" }

    private val entfernt = mutableListOf<ServerEintrag>()

    private fun zeige() {
        compose.setContent {
            LifelineThema {
                ServerlisteSeite(
                    liste = liste,
                    seite = Ablauf.Seite.Web(elw, vertrag = 1),
                    onWechseln = {},
                    onZurOberflaeche = {},
                    onUmbenennen = { _, _ -> },
                    onEntfernen = { entfernt += it },
                    onHinzufuegen = {},
                    onEinstellungen = {},
                    onFertig = {},
                )
            }
        }
    }

    @Test
    fun `Entfernen fragt mit dem Hinweis auf verlorene Einträge`() {
        zeige()
        compose.onNodeWithTag("menue-${lager.id}").performClick()
        compose.onNodeWithText("Entfernen").performClick()

        compose.onNodeWithText(Serverentfernung.rueckfrageTitel(lager)).assertIsDisplayed()
        compose.onNodeWithText(Serverentfernung.HINWEIS).assertIsDisplayed()
        assertEquals("erst nach der Bestätigung entfernt", emptyList<ServerEintrag>(), entfernt)

        compose.onNodeWithText("Server entfernen").performClick()
        assertEquals(listOf(lager), entfernt)
    }

    @Test
    fun `aktiver Server bietet kein Entfernen`() {
        zeige()
        compose.onNodeWithTag("menue-${elw.id}").performClick()

        compose.onNodeWithText("Umbenennen").assertIsDisplayed()
        compose.onNodeWithText("Entfernen").assertDoesNotExist()
    }
}
