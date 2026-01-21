# DevHub

DevHub ist ein leichtgewichtiges Single-File-Dashboard für deine lokale Entwicklungsumgebung. Es scannt dein Root-Verzeichnis automatisch und verwandelt eine Liste von Ordnern in eine moderne, durchsuchbare Projektübersicht mit Metadaten und Status-Tracking.

![PHP](https://img.shields.io/badge/PHP-8.0+-777BB4?style=flat-square&logo=php&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.x-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)
![Alpine.js](https://img.shields.io/badge/Alpine.js-3.x-8BC0D0?style=flat-square&logo=alpine.js&logoColor=white)

## ✨ Features

- **Automatische Projekt-Erkennung** - Scannt alle Unterordner und zeigt sie als Projekt-Karten an
- **Metadaten via `project.ini`** - Titel, Beschreibung, Autor, Kategorie, Tags und mehr
- **Intelligente Status-Erkennung** - Automatische Klassifizierung basierend auf letzter Änderung
- **Admin-Bereich** - Geschützter Bereich zum Bearbeiten von Projekt-Metadaten
- **Thumbnail-Upload** - Bilder per Drag & Drop hochladen
- **Dark Mode** - Automatische Erkennung + manueller Toggle
- **Filter & Suche** - Nach Kategorie, Tags und Freitext
- **Sortierung** - Nach Datum, Name, Kategorie oder Status
- **Responsive Design** - Optimiert für Desktop und Tablet
- **Pinned Projects** - Wichtige Projekte oben anpinnen
- **Versteckte Projekte** - Projekte nur für Admins sichtbar machen

## 📦 Installation

### Voraussetzungen

- PHP 8.0 oder höher
- Webserver (Apache, Nginx, XAMPP, etc.)

### Einrichtung

1. **Repository herunterladen**
   ```bash
   # Option 1: Git klonen (falls Git installiert ist)
   git clone https://github.com/IhrUsername/DevHub.git

   # Option 2: ZIP herunterladen und entpacken von GitHub
   ```

2. **In das Web-Verzeichnis verschieben**

   **Für XAMPP (Windows):**
   - Kopieren Sie den `DevHub`-Ordner nach `C:\xampp\htdocs\dev\`
   - Oder verwenden Sie den Windows Explorer zum Verschieben

   **Für andere Webserver:**
   ```bash
   # Linux/Mac Beispiel
   mv DevHub /var/www/html/dev/
   ```

3. **Konfiguration erstellen**

   **Windows:**
   - Kopieren Sie `config.sample.php` zu `config.php`
   - Oder verwenden Sie die Eingabeaufforderung:
   ```cmd
   copy config.sample.php config.php
   ```

   **Linux/Mac:**
   ```bash
   cp config.sample.php config.php
   ```

4. **Konfiguration anpassen**

   Öffnen Sie `config.php` in einem Texteditor und ändern Sie mindestens das Admin-Passwort:
   ```php
   define('ADMIN_PASSWORD', 'IhrSicheresPasswort!');
   ```

5. **Im Browser öffnen**
   ```
   http://localhost/dev/DevHub/
   ```

## ⚙️ Konfiguration

Alle Einstellungen befinden sich in der `config.php`:

| Einstellung | Beschreibung | Standard |
|-------------|--------------|----------|
| `ADMIN_PASSWORD` | Passwort für den Admin-Bereich | - |
| `SITE_TITLE` | Titel in der Sidebar | DevHub |
| `SITE_SUBTITLE` | Untertitel | Local Development Environment |
| `META_TITLE` | Browser-Tab Titel | DevHub - Übersicht |
| `META_DESCRIPTION` | Meta-Beschreibung | - |
| `$ignore` | Ignorierte Ordner | `.git`, `node_modules`, `vendor` |
| `$valid_img` | Gültige Thumbnail-Formate | jpg, png, webp, gif, svg |
| `STATUS_STABLE_DAYS` | Tage bis Status "stabil" | 7 |
| `STATUS_IDLE_DAYS` | Tage bis Status "ruht" | 30 |
| `STATUS_ARCHIVE_DAYS` | Tage bis Status "archiv" | 90 |

## 📁 Projekt-Metadaten

Jedes Projekt kann eine `project.ini` Datei im Wurzelverzeichnis haben:

```ini
title = "Mein Projekt"
description = "Eine kurze Beschreibung des Projekts"
author = "Max Mustermann"
category = "Web App"
status = "aktiv"
tags = "php, mysql, api"
url = "https://example.com"
pinned = "true"
hidden = "false"
```

### Verfügbare Felder

| Feld | Beschreibung |
|------|--------------|
| `title` | Anzeigename (Standard: Ordnername) |
| `description` | Kurze Beschreibung |
| `author` | Autor/Entwickler |
| `category` | Kategorie für Filter |
| `status` | Manueller Status (überschreibt Auto-Erkennung) |
| `tags` | Komma-getrennte Tags |
| `url` | Externe URL (statt Inhalt des Ordners) |
| `pinned` | `true` = Projekt wird oben angezeigt |
| `hidden` | `true` = Nur für Admins sichtbar |

### Status-Werte

- **aktiv** - Wird gerade bearbeitet (< 7 Tage inaktiv)
- **stabil** - Funktioniert, wenig Änderungen (7-30 Tage)
- **ruht** - Längere Zeit nicht bearbeitet (30-90 Tage)
- **archiv** - Sehr alt, möglicherweise veraltet (> 90 Tage)
- **abgeschlossen** - Fertiggestellt
- **in entwicklung** - In aktiver Entwicklung

## 🖼️ Thumbnails

Legen Sie ein Bild mit dem Namen `thumbnail.jpg` (oder .png, .webp, .gif, .svg) im Projektordner ab, um eine Vorschau anzuzeigen.

Alternativ können Sie als eingeloggter Admin Thumbnails direkt über die Bearbeitungsfunktion hochladen.

## 🔐 Admin-Bereich

1. Klicken Sie auf das Schloss-Symbol oben rechts
2. Geben Sie das in `config.php` definierte Passwort ein
3. Als Admin können Sie:
   - Projekt-Metadaten bearbeiten
   - Thumbnails hochladen/entfernen
   - Versteckte Projekte sehen

## 🎨 Anpassung

### Ordner ausblenden

Ordner, die mit `_` (Unterstrich) beginnen, werden automatisch ignoriert.

Zusätzlich können Sie in der `config.php` weitere Ordner zur `$ignore`-Liste hinzufügen.

### Theme

Das Dashboard unterstützt Light und Dark Mode. Der Modus wird im Browser gespeichert.

## 📝 Lizenz

MIT License - Frei verwendbar für private und kommerzielle Projekte.
