<?php
/**
 * DevHub - Lokales Entwicklungs-Dashboard
 * 
 * Ein modernes Dashboard zur Übersicht aller lokalen Entwicklungsprojekte.
 * Scannt Ordner und zeigt diese mit Metadaten aus project.ini an.
 */
session_start();
$current_dir = getcwd();

// ============================================
// KONFIGURATION LADEN
// ============================================
$config_file = __DIR__ . '/config.php';

if (!file_exists($config_file)) {
    die('
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b;">
            <h2 style="margin-top: 0;">⚠️ Configuration Missing</h2>
            <p>The file <code>config.php</code> was not found.</p>
            <p><strong>Solution:</strong></p>
            <ol>
                <li>Copy <code>config.sample.php</code> to <code>config.php</code></li>
                <li>Adjust the settings (especially the password)</li>
                <li>Reload the page</li>
            </ol>
        </div>
    ');
}

require_once $config_file;

// ============================================
// FALLBACKS FOR CONFIG VARIABLES
// ============================================
if (!isset($ignore) || !is_array($ignore)) $ignore = ['.', '..', '.git', 'node_modules', 'vendor'];
if (!isset($valid_img) || !is_array($valid_img)) $valid_img = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];
if (!defined('SITE_TITLE')) define('SITE_TITLE', 'DevHub');
if (!defined('SITE_SUBTITLE')) define('SITE_SUBTITLE', 'Local Development');
if (!defined('META_TITLE')) define('META_TITLE', 'DevHub - Overview');
if (!defined('META_DESCRIPTION')) define('META_DESCRIPTION', 'Central overview of all local development projects');

// ============================================
// API ENDPOINT für Metadaten-Bearbeitung
// ============================================
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    header('Content-Type: application/json');
    
    // Login-Check
    if ($_POST['action'] === 'login') {
        if (defined('ADMIN_PASSWORD') && isset($_POST['password']) && $_POST['password'] === ADMIN_PASSWORD) {
            $_SESSION['admin_logged_in'] = true;
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid password']);
        }
        exit;
    }
    
    // Logout
    if ($_POST['action'] === 'logout') {
        unset($_SESSION['admin_logged_in']);
        echo json_encode(['success' => true]);
        exit;
    }
    
    // Auth-Check für andere Aktionen
    if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
        echo json_encode(['success' => false, 'error' => 'Nicht autorisiert']);
        exit;
    }
    
    // Metadaten speichern
    if ($_POST['action'] === 'save_meta') {
        $folder = basename($_POST['folder'] ?? '');
        $folder_path = $current_dir . '/' . $folder;
        
        if (!is_dir($folder_path)) {
            echo json_encode(['success' => false, 'error' => 'Ordner existiert nicht']);
            exit;
        }
        
        $ini_path = $folder_path . '/project.ini';
        $ini_content = "";
        
        $fields = ['title', 'description', 'author', 'category', 'status', 'tags', 'url', 'pinned', 'hidden'];
        foreach ($fields as $field) {
            if (isset($_POST[$field]) && $_POST[$field] !== '') {
                $value = str_replace('"', '\\"', $_POST[$field]);
                $ini_content .= "$field = \"$value\"\n";
            }
        }
        
        if (file_put_contents($ini_path, $ini_content) !== false) {
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Schreibfehler']);
        }
    exit;
}

    // Thumbnail entfernen
    if ($_POST['action'] === 'delete_thumbnail') {
        $folder = basename($_POST['folder'] ?? '');
        $folder_path = $current_dir . '/' . $folder;

        if (!is_dir($folder_path)) {
            echo json_encode(['success' => false, 'error' => 'Ordner existiert nicht']);
            exit;
        }

        // Alle Thumbnail-Dateien löschen
        $deleted = false;
        foreach (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'] as $ext) {
            $file_path = $folder_path . '/thumbnail.' . $ext;
            if (file_exists($file_path)) {
                unlink($file_path);
                $deleted = true;
            }
        }

        echo json_encode(['success' => true]);
        exit;
    }

    // Thumbnail Upload
    if ($_POST['action'] === 'upload_thumbnail') {
        $folder = basename($_POST['folder'] ?? '');
        $folder_path = $current_dir . '/' . $folder;
        
        if (!is_dir($folder_path)) {
            echo json_encode(['success' => false, 'error' => 'Ordner existiert nicht']);
            exit;
        }
        
        if (!isset($_FILES['thumbnail']) || $_FILES['thumbnail']['error'] !== UPLOAD_ERR_OK) {
            echo json_encode(['success' => false, 'error' => 'Kein Bild hochgeladen']);
            exit;
        }
        
        $file = $_FILES['thumbnail'];
        $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        
        if (!in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'])) {
            echo json_encode(['success' => false, 'error' => 'Ungültiges Bildformat']);
            exit;
        }
        
        // Alte Thumbnails löschen
        foreach (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'] as $old_ext) {
            $old_file = $folder_path . '/thumbnail.' . $old_ext;
            if (file_exists($old_file)) unlink($old_file);
        }
        
        $target = $folder_path . '/thumbnail.' . $ext;
        if (move_uploaded_file($file['tmp_name'], $target)) {
            echo json_encode(['success' => true, 'thumb' => $folder . '/thumbnail.' . $ext]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Upload fehlgeschlagen']);
        }
        exit;
    }
    
    exit;
}

// ============================================
// DATEN SAMMELN
// ============================================
$data = [];
$folders = array_diff(scandir($current_dir), $ignore);

foreach ($folders as $folder) {
    if (!is_dir($current_dir . '/' . $folder) || str_starts_with($folder, '_')) continue;

    $folder_path = $current_dir . '/' . $folder;
    $ini_path = $folder_path . '/project.ini';
    $meta = file_exists($ini_path) ? parse_ini_file($ini_path) : [];

    // Thumbnail suchen
    $thumb = null;
    foreach ($valid_img as $ext) {
        if (file_exists("$folder_path/thumbnail.$ext")) {
            $thumb = "$folder/thumbnail.$ext";
            break;
        }
    }

    // Zeitstempel für intelligente Status-Erkennung
    $modified = filemtime($folder_path);
    $created = filectime($folder_path);
    $days_since_modified = (time() - $modified) / 86400;
    $days_since_created = (time() - $created) / 86400;
    
    // Intelligente Status-Ermittlung wenn nicht gesetzt
    $status = strtolower($meta['status'] ?? '');
    
    // Map German status values to English for consistency
    $statusMap = [
        'aktiv' => 'active',
        'stabil' => 'stable',
        'ruht' => 'idle',
        'archiv' => 'archive',
        'abgeschlossen' => 'completed',
        'in entwicklung' => 'in development'
    ];
    if (isset($statusMap[$status])) {
        $status = $statusMap[$status];
    }
    
    if (empty($status)) {
        // Automatische Status-Erkennung (Schwellwerte aus config.php)
        $stableDays = defined('STATUS_STABLE_DAYS') ? STATUS_STABLE_DAYS : 7;
        $idleDays = defined('STATUS_IDLE_DAYS') ? STATUS_IDLE_DAYS : 30;
        $archiveDays = defined('STATUS_ARCHIVE_DAYS') ? STATUS_ARCHIVE_DAYS : 90;
        
        if ($days_since_modified < $stableDays) {
            $status = 'active';
        } elseif ($days_since_modified < $idleDays) {
            $status = 'stable';
        } elseif ($days_since_modified < $archiveDays) {
            $status = 'idle';
        } else {
            $status = 'archive';
        }
    }

    // Pinned-Status auslesen
    $pinned = isset($meta['pinned']) && (strtolower($meta['pinned']) === 'true' || $meta['pinned'] === '1');
    
    // Hidden-Status auslesen
    $hidden = isset($meta['hidden']) && (strtolower($meta['hidden']) === 'true' || $meta['hidden'] === '1');

    $data[] = [
        'id'          => md5($folder),
        'folder'      => $folder,
        'title'       => $meta['title'] ?? $folder,
        'desc'        => $meta['description'] ?? '',
        'author'      => $meta['author'] ?? 'System',
        'category'    => $meta['category'] ?? null,
        'status'      => $status,
        'statusManual'=> !empty($meta['status']),
        'tags'        => isset($meta['tags']) ? array_map('trim', explode(',', $meta['tags'])) : [],
        'url'         => $meta['url'] ?? "$folder/",
        'thumb'       => $thumb,
        'pinned'      => $pinned,
        'hidden'      => $hidden,
        'modified'    => $modified,
        'created'     => $created,
        'modified_fmt'=> date('d.m.Y', $modified),
        'created_fmt' => date('d.m.Y', $created),
        'days_inactive'=> round($days_since_modified)
    ];
}

// Kategorien und Tags für Filter extrahieren
$categories = array_values(array_unique(array_column($data, 'category')));
$all_tags = [];
foreach ($data as $p) { foreach ($p['tags'] as $t) if($t) $all_tags[] = $t; }
$all_tags = array_values(array_unique(array_filter($all_tags)));
sort($categories);
sort($all_tags);

// JSON für das Frontend vorbereiten
$isAdmin = isset($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true;
$jsonData = json_encode([
    'projects' => $data,
    'categories' => $categories,
    'tags' => $all_tags,
    'isAdmin' => $isAdmin
]);
?>
<!DOCTYPE html>
<html lang="de" class="antialiased">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars(META_TITLE) ?></title>
    <meta name="description" content="<?= htmlspecialchars(META_DESCRIPTION) ?>">
    <script src="https://cdn.tailwindcss.com"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: { 
                fontFamily: { sans: ['Inter', 'sans-serif'] },
                extend: { 
                    colors: { 
                        brand: { 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5' }
                    } 
                } 
            }
        }

        // Language detection and translations
        const translations = {
            en: {
                // Sidebar
                search: 'Search',
                searchPlaceholder: 'Find project...',
                categories: 'Categories',
                reset: 'Reset',
                tags: 'Tags',
                projects: 'Projects',
                
                // Header
                sortNewest: 'Newest first',
                sortOldest: 'Oldest first',
                sortAZ: 'A-Z',
                sortZA: 'Z-A',
                sortCategory: 'Category',
                sortStatus: 'Status',
                
                // Status
                statusActive: 'Active',
                statusStable: 'Stable',
                statusIdle: 'Idle',
                statusArchive: 'Archive',
                statusCompleted: 'Completed',
                statusInDev: 'In Development',
                statusAuto: 'Automatic',
                
                // Cards
                noDescription: 'No description available.',
                noProjects: 'No projects found',
                resetFilters: 'Reset filters',
                
                // List view
                project: 'Project',
                lastModified: 'Last Modified',
                action: 'Action',
                
                // Login Modal
                adminLogin: 'Admin Login',
                enterPassword: 'Enter password...',
                wrongPassword: 'Wrong password',
                cancel: 'Cancel',
                login: 'Login',
                
                // Editor Modal
                editProject: 'Edit Project',
                thumbnail: 'Thumbnail',
                dragOrClick: 'Drag image here or click',
                uploading: 'Uploading...',
                removeThumbnail: 'Really remove thumbnail?',
                
                title: 'Title',
                description: 'Description',
                descriptionPlaceholder: 'Short project description...',
                author: 'Author',
                authorPlaceholder: 'Name',
                category: 'Category',
                categoryPlaceholder: 'General',
                status: 'Status',
                tagsLabel: 'Tags',
                tagsPlaceholder: 'tag1, tag2, tag3',
                urlLabel: 'URL (optional, for external links)',
                urlPlaceholder: 'https://...',
                
                pinProject: 'Pin project',
                hideProject: 'Hidden (admin only)',
                
                savedSuccess: 'Saved successfully!',
                save: 'Save',
                
                // Tooltips
                pinned: 'Pinned',
                hiddenAdmin: 'Hidden (admin only visible)',
                manualStatus: 'Manually set',
                autoStatus: 'Automatic ({days} days inactive)',
                
                // Errors
                connectionError: 'Connection error',
                loginFailed: 'Login failed',
                saveFailed: 'Save failed',
                uploadFailed: 'Upload failed',
                removeFailed: 'Remove failed'
            },
            de: {
                // Sidebar
                search: 'Suche',
                searchPlaceholder: 'Projekt finden...',
                categories: 'Kategorien',
                reset: 'Reset',
                tags: 'Tags',
                projects: 'Projekte',
                
                // Header
                sortNewest: 'Neueste zuerst',
                sortOldest: 'Älteste zuerst',
                sortAZ: 'A-Z',
                sortZA: 'Z-A',
                sortCategory: 'Kategorie',
                sortStatus: 'Status',
                
                // Status
                statusActive: 'Aktiv',
                statusStable: 'Stabil',
                statusIdle: 'Ruht',
                statusArchive: 'Archiv',
                statusCompleted: 'Fertig',
                statusInDev: 'In Entwicklung',
                statusAuto: 'Automatisch',
                
                // Cards
                noDescription: 'Keine Beschreibung vorhanden.',
                noProjects: 'Keine Projekte gefunden',
                resetFilters: 'Filter zurücksetzen',
                
                // List view
                project: 'Projekt',
                lastModified: 'Letzte Änderung',
                action: 'Aktion',
                
                // Login Modal
                adminLogin: 'Admin Login',
                enterPassword: 'Passwort eingeben...',
                wrongPassword: 'Falsches Passwort',
                cancel: 'Abbrechen',
                login: 'Einloggen',
                
                // Editor Modal
                editProject: 'Projekt bearbeiten',
                thumbnail: 'Thumbnail',
                dragOrClick: 'Bild hierher ziehen oder klicken',
                uploading: 'Wird hochgeladen...',
                removeThumbnail: 'Thumbnail wirklich entfernen?',
                
                title: 'Titel',
                description: 'Beschreibung',
                descriptionPlaceholder: 'Kurze Beschreibung des Projekts...',
                author: 'Autor',
                authorPlaceholder: 'Name',
                category: 'Kategorie',
                categoryPlaceholder: 'Allgemein',
                status: 'Status',
                tagsLabel: 'Tags',
                tagsPlaceholder: 'tag1, tag2, tag3',
                urlLabel: 'URL (optional, für externe Links)',
                urlPlaceholder: 'https://...',
                
                pinProject: 'Projekt anpinnen',
                hideProject: 'Versteckt (nur für Admin)',
                
                savedSuccess: 'Erfolgreich gespeichert!',
                save: 'Speichern',
                
                // Tooltips
                pinned: 'Angepinnt',
                hiddenAdmin: 'Versteckt (nur für Admin sichtbar)',
                manualStatus: 'Manuell gesetzt',
                autoStatus: 'Automatisch ({days} Tage inaktiv)',
                
                // Errors
                connectionError: 'Verbindungsfehler',
                loginFailed: 'Login fehlgeschlagen',
                saveFailed: 'Speichern fehlgeschlagen',
                uploadFailed: 'Upload fehlgeschlagen',
                removeFailed: 'Entfernen fehlgeschlagen'
            }
        };

        // Detect browser language (automatic only)
        function detectLanguage() {
            const browserLang = navigator.language || navigator.userLanguage;
            return browserLang.startsWith('de') ? 'de' : 'en';
        }

        const currentLang = detectLanguage();
    </script>
    <style>
        [x-cloak] { display: none !important; }
        /* Custom Scrollbar */
        .scroller::-webkit-scrollbar { width: 6px; height: 6px; }
        .scroller::-webkit-scrollbar-track { background: transparent; }
        .scroller::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .dark .scroller::-webkit-scrollbar-thumb { background: #52525b; }
        /* Modal Backdrop */
        .modal-backdrop { backdrop-filter: blur(4px); }
        /* Status Pills */
        .status-auto { border-style: dashed; }
        /* Thumbnail Upload */
        .thumb-upload-zone { transition: all 0.2s; }
        .thumb-upload-zone:hover { border-color: #6366f1; background: rgba(99, 102, 241, 0.05); }
        .thumb-upload-zone.dragover { border-color: #6366f1; background: rgba(99, 102, 241, 0.1); transform: scale(1.02); }
    </style>
</head>
<body class="bg-slate-50 text-slate-800 dark:bg-zinc-950 dark:text-zinc-100 h-screen overflow-hidden flex transition-colors duration-300"
      x-data="dashboard(<?= htmlspecialchars($jsonData, ENT_QUOTES, 'UTF-8') ?>)"
      :class="{ 'dark': isDark }">

    <!-- Mobile Sidebar Overlay -->
    <div x-show="sidebarOpen" x-cloak @click="sidebarOpen = false" class="fixed inset-0 bg-black/50 z-30 md:hidden" x-transition:enter="transition-opacity duration-200" x-transition:leave="transition-opacity duration-200"></div>

    <aside :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'" class="w-72 bg-white dark:bg-zinc-900 border-r border-slate-200 dark:border-zinc-800 flex flex-col z-40 shadow-lg fixed md:relative h-full transition-transform duration-200 ease-out">
        <div class="p-6 border-b border-slate-100 dark:border-zinc-800 flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
                <i class="fas fa-cube text-lg"></i>
            </div>
            <div class="flex-1">
                <h1 class="font-bold text-lg tracking-tight text-slate-800 dark:text-zinc-100"><?= htmlspecialchars(SITE_TITLE) ?></h1>
                <p class="text-xs text-slate-400 dark:text-zinc-400 font-medium"><?= htmlspecialchars(SITE_SUBTITLE) ?></p>
            </div>
            <button @click="sidebarOpen = false" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 md:hidden">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto p-6 scroller flex flex-col">
            
            <div class="mb-6">
                <label class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block" x-text="t('search')"></label>
                <div class="relative group">
                    <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-brand-500 transition-colors"></i>
                    <input type="search" x-model="search" :placeholder="t('searchPlaceholder')" autocomplete="off" data-1p-ignore data-lpignore="true" data-form-type="other"
                           class="w-full bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700 rounded-lg py-2 pl-10 pr-3 text-sm focus:ring-2 focus:ring-brand-500/50 outline-none transition-all">
                </div>
            </div>

            <div class="mb-6">
                <div class="flex justify-between items-center mb-2">
                    <label class="text-xs font-bold text-slate-400 uppercase tracking-wider" x-text="t('categories')"></label>
                    <button @click="filterCat = ''" x-show="filterCat" class="text-[10px] text-brand-500 hover:underline" x-text="t('reset')"></button>
                </div>
                <div class="space-y-1">
                    <!-- Default category (Allgemein/General) wenn Projekte ohne Kategorie existieren -->
                    <template x-if="_hasDefaultCategory">
                        <button @click="filterCat = filterCat === '__default__' ? '' : '__default__'; sidebarOpen = false"
                                :class="filterCat === '__default__' ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'"
                                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex justify-between items-center group">
                            <span x-text="t('categoryPlaceholder')"></span>
                            <span class="text-[10px] opacity-60 bg-white/20 px-1.5 rounded-md" x-text="countByCat(null)"></span>
                        </button>
                    </template>
                    <template x-for="cat in categories" :key="cat">
                        <button @click="filterCat = filterCat === cat ? '' : cat; sidebarOpen = false"
                                :class="filterCat === cat ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'"
                                class="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex justify-between items-center group">
                            <span x-text="cat"></span>
                            <span class="text-[10px] opacity-60 bg-white/20 px-1.5 rounded-md" x-text="countByCat(cat)"></span>
                        </button>
                    </template>
                </div>
            </div>

            <!-- Spacer um Tags nach unten zu schieben -->
            <div class="flex-1"></div>

            <div>
                <label class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block" x-text="t('tags')"></label>
                <div class="flex flex-wrap gap-1 content-end">
                    <template x-for="tag in tags" :key="tag">
                        <button @click="filterTag = filterTag === tag ? '' : tag; sidebarOpen = false"
                                :class="filterTag === tag ? 'bg-brand-500 text-white border-brand-500' : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-300 hover:border-brand-500 dark:hover:border-brand-400'"
                                class="px-1.5 py-0.5 rounded text-[10px] border transition-colors" x-text="'#' + tag"></button>
                    </template>
                </div>
            </div>
        </div>

        <div class="p-6 border-t border-slate-100 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50">
            <div class="flex justify-between items-center text-xs font-medium text-slate-500 dark:text-zinc-400">
                <span x-text="t('projects')"></span>
                <span x-text="filteredProjects.length + ' / ' + projects.length"></span>
            </div>
            <div class="w-full bg-gray-200 dark:bg-zinc-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div class="bg-brand-500 h-full rounded-full transition-all duration-500" 
                     :style="'width: ' + (filteredProjects.length / projects.length * 100) + '%'"></div>
            </div>
        </div>
    </aside>

    <main class="flex-1 flex flex-col h-full overflow-hidden relative">
        
        <header class="h-16 border-b border-slate-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/90 backdrop-blur-md flex items-center justify-between px-4 md:px-6 z-10">
            <!-- Mobile Burger Menu -->
            <button @click="sidebarOpen = true" class="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 md:hidden">
                <i class="fas fa-bars text-lg"></i>
            </button>
            
            <div class="flex items-center gap-2 ml-auto">
                <!-- Sortierung (Custom Dropdown) -->
                <div class="relative" x-data="{ open: false }">
                    <button @click="open = !open" class="h-8 flex items-center gap-2 px-3 border border-slate-200 dark:border-zinc-700 rounded-full bg-white dark:bg-zinc-800 text-xs text-slate-600 dark:text-zinc-300 hover:border-slate-300 dark:hover:border-zinc-600 transition-colors">
                        <i class="fas fa-sort text-slate-400 dark:text-zinc-500"></i>
                        <span x-text="getSortLabel(sortBy)" class="hidden sm:inline"></span>
                        <i class="fas fa-chevron-down text-[10px] text-slate-400 transition-transform" :class="{ 'rotate-180': open }"></i>
                    </button>
                    <div x-show="open" @click.away="open = false" x-transition:enter="transition ease-out duration-100" x-transition:enter-start="opacity-0 scale-95" x-transition:enter-end="opacity-100 scale-100" x-transition:leave="transition ease-in duration-75" x-transition:leave-start="opacity-100 scale-100" x-transition:leave-end="opacity-0 scale-95" class="absolute right-0 mt-2 w-40 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-lg py-1 z-50">
                        <template x-for="opt in [{v:'modified_desc',k:'sortNewest'},{v:'modified_asc',k:'sortOldest'},{v:'title_asc',k:'sortAZ'},{v:'title_desc',k:'sortZA'},{v:'category',k:'sortCategory'},{v:'status',k:'sortStatus'}]">
                            <button @click="sortBy = opt.v; saveSort(); open = false" class="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors" :class="sortBy === opt.v ? 'text-brand-500 font-medium' : 'text-slate-600 dark:text-zinc-300'" x-text="t(opt.k)"></button>
                        </template>
                    </div>
                </div>

                <!-- View Toggle -->
                <div class="h-8 flex border border-slate-200 dark:border-zinc-700 rounded-full overflow-hidden bg-white dark:bg-zinc-800">
                    <button @click="view = 'grid'" :class="view === 'grid' ? 'bg-slate-100 dark:bg-zinc-700 text-brand-500 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700'" class="w-8 h-full flex items-center justify-center transition-all"><i class="fas fa-th-large text-xs"></i></button>
                    <button @click="view = 'list'" :class="view === 'list' ? 'bg-slate-100 dark:bg-zinc-700 text-brand-500 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700'" class="w-8 h-full flex items-center justify-center transition-all border-l border-slate-200 dark:border-zinc-700"><i class="fas fa-list text-xs"></i></button>
                </div>

                <!-- Theme Toggle -->
                <button @click="toggleTheme()" class="w-8 h-8 rounded-full border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors">
                    <i class="fas text-xs" :class="isDark ? 'fa-sun text-amber-400' : 'fa-moon text-brand-500'"></i>
                </button>

                <!-- Admin Login/Logout -->
                <button x-show="!isAdmin" @click="showLoginModal = true" class="w-8 h-8 rounded-full border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 flex items-center justify-center text-slate-400 hover:text-brand-500 dark:hover:text-brand-400 hover:border-brand-500 dark:hover:border-brand-400 transition-colors" title="Admin Login">
                    <i class="fas fa-lock text-xs"></i>
                </button>
                <button x-show="isAdmin" @click="logout()" class="w-8 h-8 rounded-full border border-green-500 bg-green-50 dark:bg-green-500/20 flex items-center justify-center text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/30 transition-colors" title="Logout">
                    <i class="fas fa-unlock text-xs"></i>
                </button>
            </div>
        </header>

        <div class="flex-1 overflow-y-auto p-6 scroller bg-slate-50 dark:bg-zinc-950">
            
            <div x-show="filteredProjects.length === 0" x-cloak class="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse">
                <i class="fas fa-folder-open text-5xl mb-4 opacity-50"></i>
                <p x-text="t('noProjects')"></p>
                <button @click="resetFilters()" class="mt-4 text-brand-500 text-sm hover:underline" x-text="t('resetFilters')"></button>
            </div>

            <div x-show="view === 'grid'" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
                <template x-for="p in sortedProjects" :key="p.id">
                    <div class="group bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden hover:shadow-xl hover:shadow-brand-500/10 dark:hover:shadow-brand-500/5 hover:-translate-y-1 transition-all duration-300 flex flex-col h-full relative"
                         :class="p.pinned ? 'border-amber-300 dark:border-amber-500/50' : 'border-slate-200 dark:border-zinc-800'"
                         x-show="!p.hidden || isAdmin"
                        
                        <!-- Pinned Badge -->
                        <div x-show="p.pinned" class="absolute top-3 left-3 z-10 w-6 h-6 bg-amber-400/90 backdrop-blur rounded-full flex items-center justify-center shadow-md" :title="t('pinned')">
                            <i class="fas fa-thumbtack text-[10px] text-amber-900"></i>
                        </div>
                        
                        <!-- Hidden Badge -->
                        <div x-show="p.hidden && isAdmin" class="absolute top-3 left-3 z-10 w-6 h-6 bg-slate-500/90 backdrop-blur rounded-full flex items-center justify-center shadow-md" :class="{ 'left-11': p.pinned }" :title="t('hiddenAdmin')">
                            <i class="fas fa-eye-slash text-[10px] text-white"></i>
                        </div>
                        
                        <!-- Edit Button (nur für Admin) -->
                        <button x-show="isAdmin" @click.prevent.stop="openEditor(p)" class="absolute top-3 right-3 z-20 w-8 h-8 bg-white/90 dark:bg-zinc-800/90 backdrop-blur rounded-lg flex items-center justify-center text-slate-500 hover:text-brand-500 hover:bg-white dark:hover:bg-zinc-700 transition-all shadow-lg opacity-0 group-hover:opacity-100">
                            <i class="fas fa-pen text-xs"></i>
                        </button>

                        <a :href="p.url" target="_blank" class="flex flex-col flex-1">
                            <div class="h-40 w-full relative bg-gradient-to-br from-slate-100 to-slate-200 dark:from-zinc-800 dark:to-zinc-900 overflow-hidden">
                                <template x-if="p.thumb">
                                    <img :src="p.thumb" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                                </template>
                                <template x-if="!p.thumb">
                                    <div class="absolute inset-0 flex items-center justify-center text-slate-300 dark:text-zinc-600 text-4xl">
                                        <i class="fas fa-code"></i>
                                    </div>
                                </template>
                                <div class="absolute bottom-3 right-3 px-2 py-1 bg-white/90 dark:bg-zinc-900/90 backdrop-blur rounded-md text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-200 shadow-sm" x-text="p.category || t('categoryPlaceholder')"></div>
                            </div>

                            <div class="p-5 flex flex-col flex-1">
                                <div class="flex justify-between items-start mb-2">
                                    <h3 class="font-bold text-slate-800 dark:text-zinc-100 group-hover:text-brand-500 dark:group-hover:text-brand-400 transition-colors" x-text="p.title"></h3>
                                    <div class="flex items-center gap-2">
                                        <span class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                              :class="[getStatusColor(p.status), p.statusManual ? '' : 'status-auto border']"
                                              :title="p.statusManual ? t('manualStatus') : t('autoStatus', {days: p.days_inactive})"
                                              x-text="getStatusLabel(p.status)"></span>
                                    </div>
                                </div>
                                
                                <p class="text-sm text-slate-500 dark:text-zinc-400 line-clamp-2 mb-4 flex-1" x-text="p.desc || t('noDescription')"></p>

                                <div class="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-zinc-800 text-xs text-slate-400 dark:text-zinc-500">
                                    <span class="flex items-center gap-1.5">
                                        <i class="far fa-user"></i> <span x-text="p.author"></span>
                                    </span>
                                    <span x-text="p.modified_fmt"></span>
                                </div>
                            </div>
                        </a>
                    </div>
                </template>
            </div>

            <div x-show="view === 'list'" x-cloak class="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden shadow-sm">
                <table class="w-full text-left border-collapse">
                    <thead class="bg-slate-50 dark:bg-zinc-950/50 text-xs uppercase text-slate-400 dark:text-zinc-500 font-semibold">
                        <tr>
                            <th class="p-4 w-16"></th>
                            <th class="p-4" x-text="t('project')"></th>
                            <th class="p-4 hidden md:table-cell" x-text="t('status')"></th>
                            <th class="p-4 hidden md:table-cell" x-text="t('category')"></th>
                            <th class="p-4 hidden sm:table-cell" x-text="t('lastModified')"></th>
                            <th class="p-4 text-right" x-text="t('action')"></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-zinc-800">
                        <template x-for="p in sortedProjects" :key="p.id">
                            <tr x-show="!p.hidden || isAdmin" class="hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors group" :class="{ 'bg-amber-50/50 dark:bg-amber-500/10': p.pinned, 'opacity-60': p.hidden && isAdmin }">
                                <td class="p-3 pl-4">
                                    <div class="w-10 h-10 rounded-lg bg-slate-200 dark:bg-zinc-800 overflow-hidden relative">
                                        <img x-show="p.thumb" :src="p.thumb" class="w-full h-full object-cover">
                                        <div x-show="!p.thumb" class="w-full h-full flex items-center justify-center text-slate-400 dark:text-zinc-500"><i class="fas fa-folder"></i></div>
                                        <div x-show="p.pinned" class="absolute -top-1 -left-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center">
                                            <i class="fas fa-thumbtack text-[8px] text-amber-900"></i>
                                        </div>
                                        <div x-show="p.hidden && isAdmin" class="absolute -top-1 -right-1 w-4 h-4 bg-slate-500 rounded-full flex items-center justify-center">
                                            <i class="fas fa-eye-slash text-[8px] text-white"></i>
                                        </div>
                                    </div>
                                </td>
                                <td class="p-3">
                                    <div class="font-bold text-slate-800 dark:text-zinc-100 flex items-center gap-2">
                                        <span x-text="p.title"></span>
                                    </div>
                                    <div class="text-xs text-slate-500 dark:text-zinc-500 font-mono" x-text="p.folder"></div>
                                </td>
                                <td class="p-3 hidden md:table-cell">
                                    <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
                                          :class="[getStatusColor(p.status), p.statusManual ? '' : 'status-auto border']">
                                        <span x-text="getStatusLabel(p.status)"></span>
                                    </span>
                                </td>
                                <td class="p-3 hidden md:table-cell">
                                    <span class="text-xs font-medium text-slate-500 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700 px-2 py-1 rounded-md" x-text="p.category || t('categoryPlaceholder')"></span>
                                </td>
                                <td class="p-3 text-sm text-slate-500 dark:text-zinc-400 hidden sm:table-cell" x-text="p.modified_fmt"></td>
                                <td class="p-3 text-right pr-4">
                                    <div class="flex items-center justify-end gap-2">
                                        <button x-show="isAdmin" @click="openEditor(p)" class="w-8 h-8 inline-flex items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 hover:text-brand-600 dark:hover:text-brand-400 transition-all opacity-0 group-hover:opacity-100">
                                            <i class="fas fa-pen text-xs"></i>
                                        </button>
                                        <a :href="p.url" target="_blank" class="w-8 h-8 inline-flex items-center justify-center rounded-full bg-brand-50 dark:bg-brand-500/20 text-brand-600 dark:text-brand-400 hover:bg-brand-500 hover:text-white transition-all">
                                            <i class="fas fa-arrow-right text-xs"></i>
                                        </a>
                                    </div>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>

        </div>

        <!-- Login Modal -->
        <div x-show="showLoginModal" x-cloak class="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop bg-black/60" @click.self="showLoginModal = false">
            <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 dark:border dark:border-zinc-800" @click.stop>
                <h3 class="text-lg font-bold text-slate-800 dark:text-zinc-100 mb-4">
                    <i class="fas fa-lock mr-2 text-brand-500"></i> <span x-text="t('adminLogin')"></span>
                </h3>
                <form @submit.prevent="login()">
                    <input type="password" x-model="loginPassword" :placeholder="t('enterPassword')" 
                           class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent mb-4">
                    <p x-show="loginError" class="text-red-500 text-sm mb-4" x-text="loginError"></p>
                    <div class="flex gap-3">
                        <button type="button" @click="showLoginModal = false" class="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors" x-text="t('cancel')">
                        </button>
                        <button type="submit" class="flex-1 px-4 py-2 rounded-xl bg-brand-500 text-white hover:bg-brand-600 transition-colors" x-text="t('login')">
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Editor Modal -->
        <div x-show="showEditorModal" x-cloak class="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop bg-black/60" @click.self="showEditorModal = false">
            <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto dark:border dark:border-zinc-800" @click.stop>
                <div class="flex items-center justify-between mb-6">
                    <h3 class="text-lg font-bold text-slate-800 dark:text-zinc-100">
                        <i class="fas fa-edit mr-2 text-brand-500"></i> <span x-text="t('editProject')"></span>
                    </h3>
                    <button @click="showEditorModal = false" class="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center text-slate-400 dark:text-zinc-500">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="text-xs font-mono text-slate-400 dark:text-zinc-500 mb-4 px-3 py-2 bg-slate-100 dark:bg-zinc-800 rounded-lg">
                    <i class="fas fa-folder mr-1"></i> <span x-text="editProject?.folder"></span>/project.ini
                </div>

                <!-- Thumbnail Upload -->
                <div class="mb-6">
                    <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-2" x-text="t('thumbnail')"></label>
                    <div class="flex gap-4 items-start">
                        <!-- Preview -->
                        <div class="w-24 h-16 rounded-lg overflow-hidden bg-slate-100 dark:bg-zinc-800 flex-shrink-0 relative">
                            <img x-show="editProject?.thumb || uploadedThumb" :src="uploadedThumb || editProject?.thumb" class="w-full h-full object-cover">
                            <div x-show="!editProject?.thumb && !uploadedThumb" class="w-full h-full flex items-center justify-center text-slate-400">
                                <i class="fas fa-image text-xl"></i>
                            </div>
                            <!-- Remove Button -->
                            <button x-show="editProject?.thumb || uploadedThumb"
                                    @click="deleteThumbnail()"
                                    class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs shadow-lg transition-colors"
                                    :title="t('removeThumbnail')">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <!-- Upload Zone -->
                        <label class="flex-1 thumb-upload-zone border-2 border-dashed border-slate-300 dark:border-zinc-700 rounded-xl p-4 text-center cursor-pointer"
                               :class="{ 'dragover': isDragging }"
                               @dragover.prevent="isDragging = true"
                               @dragleave.prevent="isDragging = false"
                               @drop.prevent="handleThumbDrop($event)">
                            <input type="file" accept="image/*" class="hidden" @change="handleThumbSelect($event)">
                            <div class="text-slate-500 dark:text-zinc-400 text-sm">
                                <i class="fas fa-cloud-upload-alt text-lg mb-1 block text-slate-400"></i>
                                <span x-show="!isUploading" x-text="t('dragOrClick')"></span>
                                <span x-show="isUploading" class="text-brand-500"><i class="fas fa-spinner fa-spin mr-1"></i> <span x-text="t('uploading')"></span></span>
                            </div>
                        </label>
                    </div>
                    <p x-show="uploadError" class="text-red-500 text-xs mt-2" x-text="uploadError"></p>
                </div>

                <form @submit.prevent="saveProject()">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('title')"></label>
                            <input type="text" x-model="editForm.title" :placeholder="editProject?.folder" autocomplete="off"
                                   class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('description')"></label>
                            <textarea x-model="editForm.description" rows="3" :placeholder="t('descriptionPlaceholder')"
                                      class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"></textarea>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('author')"></label>
                                <input type="text" x-model="editForm.author" :placeholder="t('authorPlaceholder')"
                                       class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('category')"></label>
                                <input type="text" x-model="editForm.category" :placeholder="t('categoryPlaceholder')" list="categories-list"
                                       class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                                <datalist id="categories-list">
                                    <template x-for="cat in categories" :key="cat">
                                        <option :value="cat"></option>
                                    </template>
                                </datalist>
                            </div>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('status')"></label>
                                <select x-model="editForm.status"
                                        class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                                    <option value="" x-text="t('statusAuto')"></option>
                                    <option value="active" x-text="t('statusActive')"></option>
                                    <option value="stable" x-text="t('statusStable')"></option>
                                    <option value="idle" x-text="t('statusIdle')"></option>
                                    <option value="archive" x-text="t('statusArchive')"></option>
                                    <option value="completed" x-text="t('statusCompleted')"></option>
                                    <option value="in development" x-text="t('statusInDev')"></option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('tagsLabel')"></label>
                                <input type="text" x-model="editForm.tags" :placeholder="t('tagsPlaceholder')"
                                       class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-slate-600 dark:text-zinc-300 mb-1" x-text="t('urlLabel')"></label>
                            <input type="text" x-model="editForm.url" :placeholder="t('urlPlaceholder')"
                                   class="w-full px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-800 dark:text-zinc-100 focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                        </div>
                        
                        <!-- Options: Pinned and Hidden -->
                        <div class="flex flex-col gap-3 pt-2">
                            <div class="flex items-center gap-3">
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" x-model="editForm.pinned" class="sr-only peer">
                                    <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-500/20 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-400"></div>
                                </label>
                                <span class="text-sm font-medium text-slate-600 dark:text-zinc-300">
                                    <i class="fas fa-thumbtack mr-1 text-amber-500"></i> <span x-text="t('pinProject')"></span>
                                </span>
                            </div>
                            <div class="flex items-center gap-3">
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" x-model="editForm.hidden" class="sr-only peer">
                                    <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-500/20 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-zinc-500"></div>
                                </label>
                                <span class="text-sm font-medium text-slate-600 dark:text-zinc-300">
                                    <i class="fas fa-eye-slash mr-1 text-zinc-500"></i> <span x-text="t('hideProject')"></span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <p x-show="saveError" class="text-red-500 text-sm mt-4" x-text="saveError"></p>
                    <p x-show="saveSuccess" class="text-green-500 text-sm mt-4" x-text="t('savedSuccess')"></p>

                    <div class="flex gap-3 mt-6">
                        <button type="button" @click="showEditorModal = false" class="flex-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors" x-text="t('cancel')">
                        </button>
                        <button type="submit" class="flex-1 px-4 py-2 rounded-xl bg-brand-500 text-white hover:bg-brand-600 transition-colors">
                            <i class="fas fa-save mr-2"></i> <span x-text="t('save')"></span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </main>

    <script>
        function dashboard(initialData) {
            return {
                projects: initialData.projects,
                // Kategorien: null-Werte durch spezielle Markierung ersetzen für Filter
                _hasDefaultCategory: initialData.categories.includes(null),
                categories: initialData.categories.filter(c => c !== null),
                tags: initialData.tags,
                isAdmin: initialData.isAdmin || false,
                
                // Language
                lang: currentLang,
                translations: translations,
                
                // Translation function
                t(key, params = {}) {
                    let text = this.translations[this.lang]?.[key] || this.translations['en']?.[key] || key;
                    // Replace placeholders like {days}
                    Object.keys(params).forEach(param => {
                        text = text.replace(`{${param}}`, params[param]);
                    });
                    return text;
                },
                
                // State
                search: '',
                filterCat: '',
                filterTag: '',
                view: localStorage.getItem('devhub_view') || 'grid',
                isDark: localStorage.getItem('devhub_theme') === 'dark',
                sortBy: localStorage.getItem('devhub_sort') || 'modified_desc',
                sidebarOpen: false,
                
                // Modals
                showLoginModal: false,
                showEditorModal: false,
                loginPassword: '',
                loginError: '',
                
                // Editor
                editProject: null,
                editForm: {
                    title: '',
                    description: '',
                    author: '',
                    category: '',
                    status: '',
                    tags: '',
                    url: '',
                    pinned: false,
                    hidden: false
                },
                saveError: '',
                saveSuccess: false,
                
                // Thumbnail Upload
                isDragging: false,
                isUploading: false,
                uploadError: '',
                uploadedThumb: null,
                
                init() {
                    // Watchers für Persistenz
                    this.$watch('view', val => localStorage.setItem('devhub_view', val));
                    this.$watch('isDark', val => localStorage.setItem('devhub_theme', val ? 'dark' : 'light'));
                    
                        // Escape schließt Modals und Sidebar
                    document.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            this.showLoginModal = false;
                            this.showEditorModal = false;
                            this.sidebarOpen = false;
                        }
                    });
                },

                get filteredProjects() {
                    return this.projects.filter(p => {
                        const s = this.search.toLowerCase();
                        const matchesSearch = !s || p.title.toLowerCase().includes(s) || p.desc.toLowerCase().includes(s) || p.folder.toLowerCase().includes(s) || p.tags.some(t => t.toLowerCase().includes(s));
                        const matchesCat = !this.filterCat || 
                            (this.filterCat === '__default__' ? p.category === null : p.category === this.filterCat);
                        const matchesTag = !this.filterTag || p.tags.includes(this.filterTag);
                        return matchesSearch && matchesCat && matchesTag;
                    });
                },

                get sortedProjects() {
                    let filtered = [...this.filteredProjects];
                    
                    // Sortieren
                    filtered.sort((a, b) => {
                        switch(this.sortBy) {
                            case 'modified_desc':
                                return b.modified - a.modified;
                            case 'modified_asc':
                                return a.modified - b.modified;
                            case 'title_asc':
                                return a.title.localeCompare(b.title, 'de');
                            case 'title_desc':
                                return b.title.localeCompare(a.title, 'de');
                            case 'category':
                                return (a.category || '').localeCompare(b.category || '', 'de') || b.modified - a.modified;
                            case 'status':
                                const statusOrder = { 'active': 0, 'stable': 1, 'in development': 2, 'idle': 3, 'archive': 4, 'completed': 5 };
                                return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99) || b.modified - a.modified;
                            default:
                                return b.modified - a.modified;
                        }
                    });
                    
                    // Pinned immer nach oben
                    const pinned = filtered.filter(p => p.pinned);
                    const notPinned = filtered.filter(p => !p.pinned);
                    return [...pinned, ...notPinned];
                },

                saveSort() {
                    localStorage.setItem('devhub_sort', this.sortBy);
                },

                getSortLabel(val) {
                    const map = { modified_desc: 'sortNewest', modified_asc: 'sortOldest', title_asc: 'sortAZ', title_desc: 'sortZA', category: 'sortCategory', status: 'sortStatus' };
                    return this.t(map[val] || 'sortNewest');
                },

                countByCat(cat) {
                    return this.projects.filter(p => p.category === cat).length;
                },

                // Kategorie-Anzeige mit Übersetzung für Default
                getCategoryDisplay(category) {
                    return category || this.t('categoryPlaceholder');
                },

                resetFilters() {
                    this.search = '';
                    this.filterCat = '';
                    this.filterTag = '';
                },

                toggleTheme() {
                    this.isDark = !this.isDark;
                },

                getStatusColor(status) {
                    const s = status.toLowerCase();
                    if (s === 'active' || s === 'in development') return 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border-blue-200 dark:border-blue-500/30';
                    if (s === 'stable') return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300 border-green-200 dark:border-green-500/30';
                    if (s === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30';
                    if (s === 'idle') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border-amber-200 dark:border-amber-500/30';
                    if (s === 'archive') return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600';
                    if (s.includes('rejected') || s.includes('verworfen')) return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 border-red-200 dark:border-red-500/30';
                    return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400 border-zinc-200 dark:border-zinc-600';
                },

                getStatusLabel(status) {
                    const statusMap = {
                        'active': 'statusActive',
                        'aktiv': 'statusActive',
                        'stable': 'statusStable',
                        'stabil': 'statusStable',
                        'idle': 'statusIdle',
                        'ruht': 'statusIdle',
                        'archive': 'statusArchive',
                        'archiv': 'statusArchive',
                        'completed': 'statusCompleted',
                        'abgeschlossen': 'statusCompleted',
                        'in development': 'statusInDev',
                        'in entwicklung': 'statusInDev'
                    };
                    const key = statusMap[status.toLowerCase()];
                    return key ? this.t(key) : status;
                },

                // Auth
                async login() {
                    this.loginError = '';
                    const formData = new FormData();
                    formData.append('action', 'login');
                    formData.append('password', this.loginPassword);
                    
                    try {
                        const res = await fetch('', { method: 'POST', body: formData });
                        const data = await res.json();
                        if (data.success) {
                            this.isAdmin = true;
                            this.showLoginModal = false;
                            this.loginPassword = '';
                        } else {
                            this.loginError = data.error || this.t('loginFailed');
                        }
                    } catch (e) {
                        this.loginError = this.t('connectionError');
                    }
                },

                async logout() {
                    const formData = new FormData();
                    formData.append('action', 'logout');
                    await fetch('', { method: 'POST', body: formData });
                    this.isAdmin = false;
                },

                // Editor
                openEditor(project) {
                    this.editProject = project;
                    this.editForm = {
                        title: project.title === project.folder ? '' : project.title,
                        description: project.desc || '',
                        author: project.author === 'System' ? '' : project.author,
                        category: project.category || '',
                        status: project.statusManual ? project.status : '',
                        tags: project.tags.join(', '),
                        url: project.url.endsWith('/') && project.url === project.folder + '/' ? '' : project.url,
                        pinned: project.pinned || false,
                        hidden: project.hidden || false
                    };
                    this.saveError = '';
                    this.saveSuccess = false;
                    this.uploadError = '';
                    this.uploadedThumb = null;
                    this.showEditorModal = true;
                },

                // Thumbnail Upload
                handleThumbSelect(event) {
                    const file = event.target.files[0];
                    if (file) this.uploadThumbnail(file);
                },

                handleThumbDrop(event) {
                    this.isDragging = false;
                    const file = event.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                        this.uploadThumbnail(file);
                    }
                },

                async uploadThumbnail(file) {
                    this.uploadError = '';
                    this.isUploading = true;
                    
                    const formData = new FormData();
                    formData.append('action', 'upload_thumbnail');
                    formData.append('folder', this.editProject.folder);
                    formData.append('thumbnail', file);
                    
                    try {
                        const res = await fetch('', { method: 'POST', body: formData });
                        const data = await res.json();
                        if (data.success) {
                            this.uploadedThumb = data.thumb + '?t=' + Date.now();
                            // Update in projects array
                            const idx = this.projects.findIndex(p => p.id === this.editProject.id);
                            if (idx !== -1) {
                                this.projects[idx].thumb = data.thumb;
                            }
                        } else {
                            this.uploadError = data.error || this.t('uploadFailed');
                        }
                    } catch (e) {
                        this.uploadError = this.t('connectionError');
                    }
                    this.isUploading = false;
                },

                async deleteThumbnail() {
                    if (!confirm(this.t('removeThumbnail'))) return;

                    this.uploadError = '';
                    this.isUploading = true;

                    const formData = new FormData();
                    formData.append('action', 'delete_thumbnail');
                    formData.append('folder', this.editProject.folder);

                    try {
                        const res = await fetch('', { method: 'POST', body: formData });
                        const data = await res.json();
                        if (data.success) {
                            this.uploadedThumb = null;
                            // Update in projects array
                            const idx = this.projects.findIndex(p => p.id === this.editProject.id);
                            if (idx !== -1) {
                                this.projects[idx].thumb = null;
                            }
                        } else {
                            this.uploadError = data.error || this.t('removeFailed');
                        }
                    } catch (e) {
                        this.uploadError = this.t('connectionError');
                    }
                    this.isUploading = false;
                },

                async saveProject() {
                    this.saveError = '';
                    this.saveSuccess = false;
                    
                    const formData = new FormData();
                    formData.append('action', 'save_meta');
                    formData.append('folder', this.editProject.folder);
                    formData.append('title', this.editForm.title);
                    formData.append('description', this.editForm.description);
                    formData.append('author', this.editForm.author);
                    formData.append('category', this.editForm.category);
                    formData.append('status', this.editForm.status);
                    formData.append('tags', this.editForm.tags);
                    formData.append('url', this.editForm.url);
                    formData.append('pinned', this.editForm.pinned ? 'true' : '');
                    formData.append('hidden', this.editForm.hidden ? 'true' : '');
                    
                    try {
                        const res = await fetch('', { method: 'POST', body: formData });
                        const data = await res.json();
                        if (data.success) {
                            this.saveSuccess = true;
                            // Update local data
                            const idx = this.projects.findIndex(p => p.id === this.editProject.id);
                            if (idx !== -1) {
                                this.projects[idx].title = this.editForm.title || this.editProject.folder;
                                this.projects[idx].desc = this.editForm.description;
                                this.projects[idx].author = this.editForm.author || 'System';
                                this.projects[idx].category = this.editForm.category || null;
                                this.projects[idx].status = this.editForm.status || this.editProject.status;
                                this.projects[idx].statusManual = !!this.editForm.status;
                                this.projects[idx].tags = this.editForm.tags ? this.editForm.tags.split(',').map(t => t.trim()) : [];
                                this.projects[idx].url = this.editForm.url || this.editProject.folder + '/';
                                this.projects[idx].pinned = this.editForm.pinned;
                                this.projects[idx].hidden = this.editForm.hidden;
                            }
                            setTimeout(() => {
                                this.showEditorModal = false;
                            }, 1000);
                        } else {
                            this.saveError = data.error || this.t('saveFailed');
                        }
                    } catch (e) {
                        this.saveError = this.t('connectionError');
                    }
                },

            }
        }
    </script>
</body>
</html>