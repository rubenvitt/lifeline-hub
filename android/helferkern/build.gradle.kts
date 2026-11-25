// Testbare Logik der Android-Helfer-App ohne Android-Klassen (ADR-0098). Reines Kotlin/JVM, damit
// `android/gradlew -p android/helferkern test` nur ein JDK braucht; Gegenstück zu `ios/HelferKern`.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

group = "dev.rubeen.lifeline"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // `ServerAdresse` (Adressprüfung, Normalform) aus dem Lifeline-Kern.
    implementation("dev.rubeen.lifeline:kern")
    testImplementation(libs.kotlinx.serialization.json)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // Die gemeinsamen Fälle liegen im Repo (`src-tauri/faelle`); GemeinsameFaelle findet die
    // Wurzel über das Arbeitsverzeichnis.
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
