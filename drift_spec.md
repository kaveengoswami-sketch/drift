# Drift — Full Specification Document

> **Purpose**: This document is a comprehensive spec for building a macOS/iPhone Photos-style photo management app for Windows. It should contain enough context for an AI agent to build the entire application via `/goal`.

---

## 1. Project Overview

Build a **premium, Apple Photos-inspired photo and video viewer/organizer** for Windows. The app should feel as smooth and polished as macOS Photos — with fluid zoom, beautiful transitions, and effortless browsing of large libraries. There is no good equivalent on Windows, and this fills that gap.

**Platform**: Electron desktop app (Windows)
**License**: Free, closed source
**Users**: Single user (no multi-user for v1)
**App Name**: Drift

---

## 2. Core Philosophy

- **Apple Photos UX on Windows** — the gold standard for photo browsing
- **Performance first** — must handle 10,000–50,000 photos without lag
- **Mouse/trackpad-first** interaction model
- **Clean, modern aesthetic** — Apple Photos / Google Photos energy
- **Glassmorphism / translucent panels** — modern macOS-style visual design
- **Spring/physics-based animations** — zoom and transitions should feel alive

---

## 3. Technical Architecture

### 3.1 Platform & Framework
- **Electron** with aggressive performance optimizations
- Use **virtual scrolling** for all grid views (only render visible items)
- **Worker threads** for image processing (thumbnail generation, EXIF parsing)
- **GPU-accelerated rendering** where possible (CSS transforms, WebGL for zoom)
- **SQLite** (via `better-sqlite3` or `sql.js`) for local database (photo index, albums, tags, metadata cache)

### 3.2 Thumbnail Caching
- Generate thumbnails on first scan and cache them in an **app-specific cache folder** (e.g., `%APPDATA%/Drift/cache/thumbnails/`)
- Store multiple thumbnail sizes:
  - **Small**: 200px — for grid view
  - **Medium**: 600px — for hover previews
  - **Large**: 1200px — for quick full-view loading before original loads
- Use **content-hash-based filenames** to detect changes
- Progressive loading: show thumbnail → swap to full-res when loaded

### 3.3 Supported File Formats
**Images**: JPEG, PNG, GIF (animated), WebP, BMP, TIFF, SVG, HEIC/HEIF, ICO
**RAW**: CR2, CR3, NEF, ARW, DNG, ORF, RW2, RAF, PEF, SRW
**Video**: MP4, MOV, AVI, MKV, WebM, WMV

> [!IMPORTANT]
> HEIC and RAW support will likely require native decoders or libraries like `sharp`, `libraw`, or `heic-convert`. Plan for this dependency.

### 3.4 File System Scanning
- **Scan on app launch only** (no background file watching for v1)
- Recursively scan all configured source folders
- Index: file path, filename, size, dimensions, date created, date modified, EXIF data
- Detect new/changed/deleted files by comparing against the SQLite index
- Show a progress indicator during initial scan of large libraries

---

## 4. Application Structure & Navigation

### 4.1 Window Chrome
- **Frameless window** with custom title bar
- Traffic-light-style window controls (close, minimize, maximize) — styled to match the app's theme, not literal macOS dots
- Custom **drag region** in the title bar area
- Title bar integrates with the sidebar header

### 4.2 Navigation Hierarchy (3 Levels)

```
Level 1: Sidebar (Album List / Library sections)
  └── Level 2: Photo Grid (timeline or album contents)
        └── Level 3: Full Photo View (modal overlay)
```

### 4.3 Sidebar (Collapsible)
The sidebar is the primary navigation. It should be collapsible (toggle with a button or keyboard shortcut).

**Sidebar Sections:**

```
📚 LIBRARY
  ├── All Photos (unified timeline of everything)
  ├── Favorites ❤️
  ├── Recently Added
  ├── Recently Viewed
  ├── Videos (filtered view)
  └── 🗑️ Recently Deleted

📂 SOURCE FOLDERS (visually separated)
  ├── C:\Users\kavee\Pictures
  │   ├── Subfolder A (auto-discovered)
  │   └── Subfolder B
  ├── D:\Camera Roll
  └── \\NAS\Photos

📁 ALBUMS
  ├── Summer 2024 (virtual album)
  ├── Family (virtual album)
  └── + Create Album
```

**Key behaviors:**
- Multiple source folders supported — each displayed separately in sidebar
- Subfolders within source folders appear as nested items
- Virtual albums (user-created) are separate from filesystem folders
- Drag photos into virtual albums without moving files on disk
- Each section is collapsible

### 4.4 Adding Source Folders
- Settings/Preferences dialog with a "Source Folders" section
- Click "Add Folder" → native Windows folder picker dialog
- Can remove folders (doesn't delete files, just removes from index)
- First-run experience should prompt to add at least one folder

---

## 5. Views & Layouts

### 5.1 Timeline Grid (Main View — "All Photos")
- **Date-grouped timeline** like Apple Photos
- Section headers showing date (e.g., "July 2024", "June 15, 2024")
- Uniform grid within each section
- Photos and videos mixed together (videos show a small play icon overlay and duration badge)
- **Virtual scrolling** — only render ~50-100 items beyond the viewport
- Scroll position memory (return to where you left off)
- Smooth scrolling with momentum

### 5.2 Album Grid View
- Same grid layout as timeline but without date grouping (or optional date grouping)
- Album header with album name, photo count, date range
- Optional cover photo for each album

### 5.3 Full Photo View (Level 3)
- Opens as a **modal overlay** with backdrop blur over the grid
- Clicking a photo triggers a smooth **expand animation** from the grid thumbnail position to full view
- Closing reverses the animation (shrink back to grid position)

**Full Photo View Controls:**
- Left/right arrow navigation (previous/next photo)
- Swipe gestures on trackpad for previous/next
- **Zoom**: Mouse wheel zoom + pinch-to-zoom on trackpad
- **Pan**: Click and drag when zoomed in
- **Double-click**: Toggle between fit-to-screen and 100% zoom
- Zoom should use **spring/physics-based animation** (slight overshoot, smooth settle)
- Bottom toolbar: favorite, rotate, delete, info, share, edit
- Photo counter ("23 of 456")
- ESC or click backdrop to close
- Filmstrip / thumbnail strip at the bottom (optional, toggleable) for quick navigation

### 5.4 Slideshow Mode
- Accessible from any view or selection
- Configurable auto-advance timing (3s, 5s, 10s, 15s, 30s)
- Smooth crossfade transitions between photos
- Full-screen immersive (hide all UI)
- Pause/play, previous/next controls (show on mouse move, auto-hide)
- ESC to exit

---

## 6. Interaction & Gestures

### 6.1 Primary Input: Mouse / Trackpad
- **Grid**: Click to open, right-click for context menu
- **Selection**: Click to select, Ctrl+Click for multi-select, Shift+Click for range select, drag to rubber-band select
- **Zoom in full view**: Mouse wheel or trackpad pinch
- **Pan when zoomed**: Click and drag
- **Navigate photos**: Trackpad swipe left/right, or mouse button back/forward

### 6.2 Keyboard Shortcuts
Even though mouse/trackpad is primary, support essential keyboard shortcuts:
- `Space`: Open/close full photo view
- `←` / `→`: Previous / next photo
- `+` / `-`: Zoom in / out
- `0`: Fit to screen
- `1`: Zoom to 100%
- `F`: Toggle favorite
- `Delete`: Move to trash
- `I`: Toggle info panel
- `E`: Enter edit mode
- `F11` or `F`: Toggle fullscreen slideshow
- `Ctrl+A`: Select all
- `Ctrl+C`: Copy to clipboard
- `Escape`: Close overlay / exit mode

---

## 7. Organization Features

### 7.1 Favorites
- Heart icon on each photo (toggle with click or `F` key)
- Favorites section in sidebar shows all favorited photos
- Heart overlay visible in grid view on hover and in full view

### 7.2 Custom Tags / Keywords
- Add custom text tags to any photo
- Tags visible and editable in the info panel
- Tag suggestions based on existing tags (autocomplete)
- Filter grid by tag

### 7.3 Virtual Albums
- Create album → name it → drag photos in
- Photos can belong to multiple albums
- Albums don't move files — they're just references
- Reorder photos within albums via drag and drop
- Set album cover photo
- Rename, delete albums (doesn't delete photos)

### 7.4 Trash / Recently Deleted
- Deleting moves to trash (doesn't permanently delete immediately)
- Trash shows photos with "days remaining" (auto-purge after 30 days)
- Option to restore or permanently delete
- Trash is stored in app database, original files moved to a hidden trash folder

---

## 8. File Management

The app CAN modify the filesystem (user opted in):
- **Rename**: Right-click → Rename (or F2)
- **Move**: Right-click → Move to → folder picker or drag between sidebar folders
- **Copy**: Right-click → Copy to → folder picker
- **Delete**: Move to app trash (and move file to hidden trash folder)
- All destructive operations should have **confirmation dialogs**
- **Undo** support for the last operation (Ctrl+Z)

---

## 9. Sharing & Export

- **Copy to clipboard**: Copy the image/photo to system clipboard for pasting into other apps
- **Windows Share dialog**: Right-click → Share → opens native Windows share UI
- No format conversion needed for v1 (nice-to-have for later)

---

## 10. Basic Editing (v1 — Keep Simple)

- **Crop**: Free-form and preset aspect ratios (1:1, 4:3, 16:9, 3:2)
- **Rotate**: 90° clockwise/counterclockwise
- **Flip**: Horizontal and vertical
- Non-destructive if possible (save edits as a sidecar or new file, preserve original)
- Edit mode accessed from the full photo view toolbar

---

## 11. Metadata / Info Panel

- Toggle-able **info panel** (slide in from right side)
- Displays:
  - Filename
  - File size
  - Dimensions (width × height)
  - Date taken / date created
  - Date modified
  - File path (clickable to open in Explorer)
  - Tags (editable)
  - Album memberships
- Clean, minimal design — not overwhelming

---

## 12. Visual Design System

### 12.1 Theme
- **Glassmorphism aesthetic** with translucent panels
- Background blur effects on sidebar and overlays
- Dark mode as default (option for light mode in settings)
- **Color palette**: Deep charcoals, subtle grays, with accent color (user-configurable or a tasteful blue/purple default)
- Frosted glass sidebar over a subtle gradient background

### 12.2 Typography
- Clean sans-serif font (Inter, SF Pro Display, or Segoe UI as fallback)
- Clear hierarchy: section headers, dates, filenames, metadata

### 12.3 Animations (Spring/Physics-Based)
- **Photo open**: Thumbnail expands to full view with spring animation
- **Photo close**: Reverse spring animation back to grid position
- **Zoom**: Spring physics (slight overshoot on zoom in/out, smooth settle)
- **Sidebar collapse/expand**: Smooth slide with spring easing
- **Grid layout**: Items animate smoothly when grid reflows (filter, sort, resize)
- **Hover effects**: Subtle scale-up on grid thumbnails (1.02x–1.05x)
- Use `framer-motion` or a similar spring animation library
- **Performance**: All animations should be GPU-accelerated (transform/opacity only, no layout thrashing)

### 12.4 Grid Design
- Rounded corners on thumbnails (6-8px radius)
- Subtle shadow or border on thumbnails
- Selection state: Blue border + checkmark overlay
- Hover state: Slight scale + shadow increase
- Favorite indicator: Small heart icon in corner
- Video indicator: Play icon + duration badge

---

## 13. First-Run Experience

1. Welcome screen with app branding
2. "Add your first photo folder" — folder picker
3. Scanning progress screen (with estimated time for large libraries)
4. Drop into the main timeline view once complete
5. Quick tips overlay (dismissible) highlighting key gestures

---

## 14. Settings / Preferences

Accessible via gear icon or `Ctrl+,`:
- **Source Folders**: Add/remove watched folders
- **Appearance**: Dark/light mode toggle, accent color
- **Thumbnails**: Cache location, clear cache button
- **Trash**: Auto-delete period (7/14/30/60/90 days or never)
- **Performance**: Thumbnail quality setting, animation toggle
- **Slideshow**: Default interval, transition style
- **About**: Version, credits

---

## 15. Performance Requirements

> [!CAUTION]
> This app MUST handle 10,000–50,000 photos without perceivable lag. Performance is non-negotiable.

- **Grid scrolling**: 60fps at all times (virtual scrolling is mandatory)
- **Photo open**: < 200ms to show thumbnail, < 1s to load full resolution
- **Zoom**: Real-time, no stutter (use CSS transforms, not re-rendering)
- **Initial scan**: Show progress, scan in background thread
- **Thumbnail generation**: Background worker thread, don't block UI
- **Memory**: Should not exceed ~500MB RAM for a 50K photo library
- **Startup**: < 3 seconds to show UI (load index from SQLite, defer scanning)

---

## 16. Video Playback

- Inline video player in the full view (HTML5 `<video>` element)
- Play/pause, seek bar, volume, full-screen toggle
- Mute/unmute
- Thumbnail in grid = first frame or middle frame of video
- Video duration badge on grid thumbnail

---

## 17. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | Electron |
| Frontend | React + TypeScript |
| State Management | Zustand or Jotai (lightweight) |
| Styling | CSS Modules + CSS Variables (glassmorphism) |
| Animations | Framer Motion (spring physics) |
| Database | better-sqlite3 (SQLite) |
| Image Processing | sharp (thumbnails, HEIC, RAW) |
| EXIF Parsing | exifr or exif-reader |
| Virtual Scrolling | react-virtuoso or custom virtualized grid |
| Video | HTML5 video element |
| File Watching | N/A for v1 (scan on launch) |
| Build/Bundle | electron-builder |

---

## 18. Project Structure (Suggested)

```
drift/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Main entry, window creation
│   │   ├── ipc/                 # IPC handlers
│   │   ├── scanner/             # File system scanner
│   │   ├── thumbnails/          # Thumbnail generation worker
│   │   ├── database/            # SQLite operations
│   │   └── file-ops/            # File rename, move, copy, delete
│   ├── renderer/                # Electron renderer process (React)
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Sidebar/
│   │   │   ├── Grid/
│   │   │   ├── PhotoView/
│   │   │   ├── Slideshow/
│   │   │   ├── InfoPanel/
│   │   │   ├── Editor/
│   │   │   ├── Settings/
│   │   │   └── TitleBar/
│   │   ├── hooks/
│   │   ├── stores/              # Zustand stores
│   │   ├── styles/              # CSS modules + variables
│   │   └── utils/
│   ├── shared/                  # Shared types, constants
│   └── preload/                 # Electron preload scripts
├── assets/                      # App icons, etc.
├── electron-builder.yml
├── package.json
├── tsconfig.json
└── README.md
```

---

## 19. Out of Scope for v1

These are explicitly **not** in v1 but may come later:
- Cloud sync (iCloud/Google Photos/OneDrive sync)
- AI-powered search (content-based search like "find all sunset photos")
- Face detection / People albums
- Map view (GPS-based photo locations)
- Duplicate detection
- Advanced editing (adjustments, filters, layers)
- Real-time folder watching (auto-import)
- Multi-user support
- Star ratings / color labels
- Before/after comparison view
- Side-by-side photo comparison
- Batch operations (bulk rename, bulk move)
- Export with format conversion
- Drag-and-drop to external apps
- Touch/tablet optimization

---

## 20. Success Criteria

The app is successful if:
1. ✅ Opening the app and browsing 10K+ photos feels as smooth as Apple Photos
2. ✅ Zooming in/out on a photo feels fluid with spring physics
3. ✅ The glassmorphism UI looks premium and polished
4. ✅ Adding folders and browsing albums is intuitive
5. ✅ The app doesn't feel like an Electron app — it feels native
6. ✅ First-time setup is effortless (pick a folder, start browsing)
7. ✅ Photos load fast with progressive thumbnail → full-res loading

---

> [!TIP]
> **For the AI agent building this**: Start with the Electron scaffold, then build the thumbnail pipeline and SQLite index first (the performance backbone). Then build the grid view with virtual scrolling. Then the full photo view with zoom. Then the sidebar and albums. Polish animations last. Performance testing should happen throughout, not at the end.
