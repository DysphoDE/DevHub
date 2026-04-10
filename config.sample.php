<?php
/**
 * DevHub Configuration - SAMPLE FILE
 * 
 * Copy this file to "config.php" and adjust the values.
 * The config.php should NOT be committed to Git!
 * 
 * Instructions:
 * 1. Copy: config.sample.php -> config.php
 * 2. Change password
 * 3. Adjust settings as needed
 */

// ============================================
// SECURITY
// ============================================

// Admin password for the protected area
// IMPORTANT: Please change this password!
define('ADMIN_PASSWORD', 'YourSecurePassword123!');

// ============================================
// PAGE SETTINGS
// ============================================

// Application title (displayed in the sidebar)
define('SITE_TITLE', 'DevHub');

// Subtitle (displayed below the title)
define('SITE_SUBTITLE', 'Local Development');

// Meta title for the browser tab
define('META_TITLE', 'DevHub - Overview');

// Meta description for SEO
define('META_DESCRIPTION', 'Central overview of all local development projects');

// ============================================
// FOLDER SETTINGS
// ============================================

// Folders and files to ignore
$ignore = ['.', '..', '.git', 'node_modules', 'vendor', '$RECYCLE.BIN', 'System Volume Information', '$WinREAgent'];

// Valid image formats for thumbnails
$valid_img = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];

// ============================================
// STATUS SETTINGS (for automatic detection)
// ============================================

// Days until a project is considered "stable" (after last modification)
define('STATUS_STABLE_DAYS', 7);

// Days until a project is considered "idle"
define('STATUS_IDLE_DAYS', 30);

// Days until a project is considered "archive"
define('STATUS_ARCHIVE_DAYS', 90);
