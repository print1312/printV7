# Niimbot Druckstudio V6 – identische Gesten für Bild und Textfeld

Diese Version korrigiert gezielt die Text-Bedienung von V5. Die Original-Niimbot-Web-Demo, die Bluetooth-Funktionen, Rollen/RFID, PDF/Bildimport, Ebenen, Schwarz-Weiß-Bildkorrekturen und Font-Upload bleiben bestehen.

## Neuer Texteditor: dasselbe Verhalten wie beim Bild

1. Datei auswählen oder über **Leeres Etikett** ein leeres Label öffnen.
2. Auf **+ Textfeld** tippen und Text eingeben.
3. Textfeld in der Vorschau antippen, um es auszuwählen. Der Hinweis *Aktiv: Textfeld* erscheint. **Nur der Text** zeigt jetzt blaue Bearbeitungsgriffe.
4. **Ein Finger:** Textfeld verschieben.
5. **Zwei Finger:** Text samt Rahmen skalieren, drehen und verschieben.
6. **Blauer Griff oben links (↻):** Textfeld stufenlos drehen.
7. **Blauer Griff rechts (↔):** Textfeldbreite ändern.
8. **Blauer Griff unten (↕):** Textfeldhöhe ändern.
9. **Blauer Griff unten rechts (⤡):** Text und Rahmen gemeinsam proportional skalieren.
10. **Rotation, Grad-Eingabe, 90°-Taste, Zoom-Prozent und Pfeile über der Vorschau** wirken beim ausgewählten Textfeld auf den Text, bei ausgewähltem Bild auf das Bild.
11. **Ausrichten** (links, mittig, rechts, oben, vertikal mittig, unten) berücksichtigt auch gedrehte Textfelder. **Einpassen** und **Füllen** wirken ebenfalls auf die aktive Auswahl.
12. Unter *Schrift / Text hinzufügen* gibt es weiterhin die direkte Eingabe der Textfeldbreite und -höhe sowie neu die **Textfeld-Zoom-%-Eingabe**.
13. Über **Bild auswählen** das Bild wieder aktivieren; alternativ außerhalb des Textfelds tippen. Die blauen Bild-Griffe erscheinen wieder.

Der **rote gestrichelte Rahmen** markiert den tatsächlichen Druckbereich, unabhängig davon, welches Element bearbeitet wird. Das erzeugte Druckbild übernimmt Texttransformation, Bildkorrekturen und die gewählte Ebenenreihenfolge.

## Veröffentlichung – neues Repository

1. ZIP entpacken und die Dateien `index.html`, `addon.js`, `.nojekyll`, `README.md` direkt in ein öffentliches GitHub-Repository hochladen.
2. GitHub: **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
3. Die HTTPS-Webadresse auf dem iPhone in Bluefy öffnen.

## Vorhandenes Repository aktualisieren

Nur `index.html` und `addon.js` müssen ersetzt werden. Die Adresse und normalerweise gespeicherte Browser-Rollen/Fonts bleiben unverändert, sofern dasselbe Browserprofil und dieselbe Internetadresse weiterverwendet werden.

## Grenzen

- Die App lädt die originale Demo von GitHub/CDN zur Laufzeit und benötigt deshalb Internet.
- Web Bluetooth muss vom Browser unterstützt werden; auf dem iPhone mit Bluefy über HTTPS testen.
- Die Gesten und die Druckbild-Erzeugung wurden in einem simulierten Chromium-Test geprüft. Ein echter Niimbot-/Bluefy-Hardwaredruck ist noch nicht verifiziert.
- Die gespeicherten Fonts werden pro Browserprofil und HTTPS-Domain in IndexedDB gespeichert. Beim Löschen von Website-Daten gehen sie verloren.


## Neu in V7

- linker Ansichts-Schieberegler für die komplette Druckvorschau
- größere Vorschaufläche mit mehr Reserve um den roten Druckrahmen
- die Vorschauhöhe passt sich zusätzlich an das gewählte Etikettenformat an


## Neu in V8

- gebogener / runder Text für Sticker
- Textfluss wählbar: gerade, vertikal oder Rundung
- Bogenwinkel von -360° bis 360° per Schieber und Zahleneingabe


## Neu in V9

- Rundtext mit Position **oben / unten / voller Kreis**
- Umschalter **Innen / Außen**
- **freier Radius** für Rundtext (0 = Auto)
- Button **Gegenbogen duplizieren** für obere/untere getrennte Kreisbeschriftung
- kompaktere Niimbot-ähnliche Rundungs-Bedienung


## Neu in V10 – Bildwerte präzise bearbeiten

Jeder Bildregler (Belichtung, Kontrast, Schwarzwert, Weißwert, Helligkeit, Sättigung, Gamma, Kontrast-Schwelle) besitzt jetzt:

- einen Schieberegler,
- ein eigenes Zahlenfeld für genaue Werte,
- Minus- und Plus-Tasten für Schritte gemäß der bisherigen Reglerauflösung (bei Gamma jeweils 0,05, sonst 1).

Slider, Zahlenfeld und Plus-/Minus-Tasten bleiben synchron. Die Werte sind je importierter Datei/Seite getrennt; Änderungen sind sofort in der Vorschau und im Druckbild sichtbar. Ein Tipp auf „Bildkorrekturen zurücksetzen“ setzt alle drei Eingabearten zusammen zurück.

Die V9-Funktionen wie Kreistext oben/unten, voller Kreis, Innen-/Außenseite, freier Radius und Gegenbogen sind weiter enthalten.


## V12 – Vorschau, Ebenen und Bearbeitungsverlauf

- Kompakter Ansichtszoom links skaliert das komplette Etikett samt allen Objekten, ohne die Druckgröße zu ändern.
- Mehrere Bilder auf demselben Etikett (auch mehrere PDF-Seiten als Ebenen); Verschieben, Rotieren, Skalieren und Ebenenreihenfolge.
- Beschneiden beim Hochladen oder danach: frei, 1:1, 4:6, 3:5, 5:8, 2:3, 4:7, 5:7 und kreisrund. Touch-Griff und Drag.
- Schloss je Bild- oder Textebene: gesperrte Ebenen werden gedruckt, sind aber nicht bearbeitbar.
- Rückgängig (↶) und Wiederholen (↷), jeweils bis zu 55 Bearbeitungsschritte. Eine Touch-Geste zählt als ein Schritt; keine Bilddateien-Kopien pro Schritt.
- Historie gilt für die laufende Bearbeitung. Sie wird nicht zwischen Sitzungen gespeichert.
- Alte Rollen und Schriftarten bleiben bei derselben veröffentlichten HTTPS-Adresse weiterhin im bisherigen Browserspeicher.

**Wichtig:** Die Bluetooth-Verbindung kann erst mit einem realen Niimbot und Bluefy geprüft werden. Teste zunächst ein Etikett.
