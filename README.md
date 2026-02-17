# DevHub

DevHub is a lightweight single-file dashboard for your local development environment. It automatically scans your root directory and transforms a list of folders into a modern, searchable project overview with metadata and status tracking.

![PHP](https://img.shields.io/badge/PHP-8.0+-777BB4?style=flat-square&logo=php&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.x-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)
![Alpine.js](https://img.shields.io/badge/Alpine.js-3.x-8BC0D0?style=flat-square&logo=alpine.js&logoColor=white)

## ✨ Features

- **Automatic Project Detection** - Scans all subfolders and displays them as project cards
- **Metadata via `project.ini`** - Title, description, author, category, tags, and more
- **Smart Status Detection** - Automatic classification based on last modification
- **Admin Area** - Protected area for editing project metadata
- **Thumbnail Upload** - Upload images via drag & drop
- **Dark Mode** - Automatic detection + manual toggle
- **Filter & Search** - By category, tags, and free text
- **Sorting** - By date, name, category, or status
- **Responsive Design** - Optimized for all devices and resolutions
- **Pinned Projects** - Pin important projects to the top
- **Hidden Projects** - Make projects visible only to admins
- **Multi-Language** - Automatic language detection (English/German) based on browser settings

## 📦 Installation

### Requirements

- PHP 8.0 or higher
- Web server (Apache, Nginx, XAMPP, etc.)

### Setup

1. **Download Repository**
   ```bash
   # Option 1: Git clone (if Git is installed)
   git clone https://github.com/YourUsername/DevHub.git

   # Option 2: Download and extract ZIP from GitHub
   ```

2. **Move to Web Directory**

   **For XAMPP (Windows):**
   - Copy the `DevHub` folder to `C:\xampp\htdocs\dev\`
   - Or use Windows Explorer to move it

   **For other web servers:**
   ```bash
   # Linux/Mac example
   mv DevHub /var/www/html/dev/
   ```

3. **Create Configuration**

   **Windows:**
   - Copy `config.sample.php` to `config.php`
   - Or use the command prompt:
   ```cmd
   copy config.sample.php config.php
   ```

   **Linux/Mac:**
   ```bash
   cp config.sample.php config.php
   ```

4. **Customize Configuration**

   Open `config.php` in a text editor and change at least the admin password:
   ```php
   define('ADMIN_PASSWORD', 'YourSecurePassword!');
   ```

5. **Open in Browser**
   ```
   http://localhost/dev/DevHub/
   ```

## ⚙️ Configuration

All settings are located in `config.php`:

| Setting | Description | Default |
|---------|-------------|---------|
| `ADMIN_PASSWORD` | Password for the admin area | - |
| `SITE_TITLE` | Title in the sidebar | DevHub |
| `SITE_SUBTITLE` | Subtitle | Local Development |
| `META_TITLE` | Browser tab title | DevHub - Overview |
| `META_DESCRIPTION` | Meta description | - |
| `$ignore` | Ignored folders | `.git`, `node_modules`, `vendor` |
| `$valid_img` | Valid thumbnail formats | jpg, png, webp, gif, svg |
| `STATUS_STABLE_DAYS` | Days until status "stable" | 7 |
| `STATUS_IDLE_DAYS` | Days until status "idle" | 30 |
| `STATUS_ARCHIVE_DAYS` | Days until status "archive" | 90 |

## 📁 Project Metadata

Each project can have a `project.ini` file in its root directory:

```ini
title = "My Project"
description = "A short description of the project"
author = "John Doe"
category = "Web App"
status = "active"
tags = "php, mysql, api"
url = "https://example.com"
pinned = "true"
hidden = "false"
```

### Available Fields

| Field | Description |
|-------|-------------|
| `title` | Display name (default: folder name) |
| `description` | Short description |
| `author` | Author/Developer |
| `category` | Category for filtering |
| `status` | Manual status (overrides auto-detection) |
| `tags` | Comma-separated tags |
| `url` | External URL (instead of folder content) |
| `pinned` | `true` = Project is displayed at the top |
| `hidden` | `true` = Only visible to admins |

### Status Values

- **active** - Currently being worked on (< 7 days inactive)
- **stable** - Working, few changes (7-30 days)
- **idle** - Not worked on for a while (30-90 days)
- **archive** - Very old, possibly outdated (> 90 days)
- **completed** - Finished
- **in development** - In active development

## 🖼️ Thumbnails

Place an image named `thumbnail.jpg` (or .png, .webp, .gif, .svg) in the project folder to display a preview.

Alternatively, as a logged-in admin, you can upload thumbnails directly through the edit function.

## 🔐 Admin Area

1. Click the lock icon in the top right corner
2. Enter the password defined in `config.php`
3. As admin you can:
   - Edit project metadata
   - Upload/remove thumbnails
   - See hidden projects

## 🌐 Language Support

DevHub automatically detects your browser language and displays the interface in:
- **German** - For browsers with German language settings
- **Spanish** - For browsers with Spanish language settings
- **French** - For browsers with French language settings
- **English** - For all other languages

## 🎨 Customization

### Hide Folders

Folders starting with `_` (underscore) are automatically ignored.

Additionally, you can add more folders to the `$ignore` list in `config.php`.

### Theme

The dashboard supports Light and Dark mode. The mode is saved in the browser.

## 📝 License

MIT License - Free to use for personal and commercial projects.
