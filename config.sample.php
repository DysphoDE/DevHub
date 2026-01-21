<?php
/**
 * DevHub Konfiguration - BEISPIELDATEI
 * 
 * Kopieren Sie diese Datei nach "config.php" und passen Sie die Werte an.
 * Die config.php sollte NICHT in Git eingecheckt werden!
 * 
 * Anleitung:
 * 1. Kopieren: config.sample.php -> config.php
 * 2. Passwort ändern
 * 3. Einstellungen nach Bedarf anpassen
 */

// ============================================
// SICHERHEIT
// ============================================

// Admin-Passwort für den geschützten Bereich
// WICHTIG: Bitte ändern Sie dieses Passwort!
define('ADMIN_PASSWORD', 'IhrSicheresPasswort123!');

// ============================================
// SEITEN-EINSTELLUNGEN
// ============================================

// Titel der Anwendung (wird in der Sidebar angezeigt)
define('SITE_TITLE', 'DevHub');

// Untertitel (wird unter dem Titel angezeigt)
define('SITE_SUBTITLE', 'Local Development');

// Meta-Titel für den Browser-Tab
define('META_TITLE', 'DevHub - Übersicht');

// Meta-Beschreibung für SEO
define('META_DESCRIPTION', 'Zentrale Übersicht aller lokalen Entwicklungsprojekte');

// ============================================
// ORDNER-EINSTELLUNGEN
// ============================================

// Ordner und Dateien, die ignoriert werden sollen
$ignore = ['.', '..', '.git', 'node_modules', 'vendor'];

// Gültige Bildformate für Thumbnails
$valid_img = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];

// ============================================
// STATUS-EINSTELLUNGEN (für automatische Erkennung)
// ============================================

// Tage bis ein Projekt als "stabil" gilt (nach letzter Änderung)
define('STATUS_STABLE_DAYS', 7);

// Tage bis ein Projekt als "ruht" gilt
define('STATUS_IDLE_DAYS', 30);

// Tage bis ein Projekt als "archiv" gilt
define('STATUS_ARCHIVE_DAYS', 90);
