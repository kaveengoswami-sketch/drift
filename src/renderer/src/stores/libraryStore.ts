import { create } from 'zustand'
import type { Photo, SourceFolder, Album, Settings, ScanProgress, LibraryQuery } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { applyThemeAccent } from '@/lib/accent'

interface SubfolderInfo {
  folderId: number
  path: string
  name: string
  depth: number
}

interface LibraryState {
  photos: Photo[]
  folders: SourceFolder[]
  subfolders: SubfolderInfo[]
  albums: Album[]
  tags: string[]
  query: LibraryQuery
  selection: Set<number>
  lastSelectedIndex: number | null
  viewerIndex: number | null // index into photos, null = grid
  slideshow: boolean
  settings: Settings
  scanProgress: ScanProgress | null
  scrollPositions: Map<string, number>
  initialized: boolean

  setQuery: (q: LibraryQuery) => void
  refresh: () => Promise<void>
  refreshSidebar: () => Promise<void>
  select: (id: number, index: number, mode: 'single' | 'toggle' | 'range') => void
  clearSelection: () => void
  selectAll: () => void
  setViewerIndex: (i: number | null) => void
  setSlideshow: (on: boolean) => void
  setSettings: (s: Partial<Settings>) => void
  toggleFavorite: (ids?: number[]) => Promise<void>
  saveScroll: (key: string, top: number) => void
}

export function queryKey(q: LibraryQuery): string {
  return `${q.view}:${q.albumId ?? ''}:${q.folderId ?? ''}:${q.folderPathPrefix ?? ''}:${q.tag ?? ''}:${q.search ?? ''}:${q.personId ?? ''}`
}

let currentRefreshId = 0

export const useLibrary = create<LibraryState>((set, get) => ({
  photos: [],
  folders: [],
  subfolders: [],
  albums: [],
  tags: [],
  query: { view: 'all' },
  selection: new Set(),
  lastSelectedIndex: null,
  viewerIndex: null,
  slideshow: false,
  settings: DEFAULT_SETTINGS,
  scanProgress: null,
  scrollPositions: new Map(),
  initialized: false,

  setQuery: (q) => {
    set({ query: q, selection: new Set(), lastSelectedIndex: null, viewerIndex: null })
    get().refresh()
  },

  refresh: async () => {
    const refreshId = ++currentRefreshId
    const query = get().query
    let photos: Photo[] = []
    if (query.view === 'person' && query.personId) {
      photos = await window.drift.photosForPerson(query.personId)
    } else if (query.view === 'people') {
      photos = []
    } else {
      photos = await window.drift.queryPhotos(query)
    }
    if (refreshId !== currentRefreshId) return
    // `viewerIndex` and `lastSelectedIndex` are raw indices into `photos`, and a
    // background scan replaces this array underneath them — newly discovered
    // photos get inserted mid-list, so an index silently starts pointing at a
    // different photo or past the end. That's why clicking a photo could open
    // nothing: the viewer dereferenced a stale index and rendered empty.
    // Re-resolve both by photo id; null means it's no longer in this view.
    const { viewerIndex, lastSelectedIndex, selection, photos: prev } = get()
    const remap = (i: number | null): number | null => {
      if (i === null) return null
      const id = prev[i]?.id
      if (id === undefined) return null
      const found = photos.findIndex((p) => p.id === id)
      return found >= 0 ? found : null
    }
    // `selection` holds photo ids, not indices, so it doesn't go stale the
    // same way viewerIndex/lastSelectedIndex do — but an id can still
    // outlive its photo (trashed or removed by a background scan), and left
    // in place it inflates the "N selected" count for a photo that's no
    // longer there to act on.
    const stillPresent = new Set(photos.map((p) => p.id))
    const nextSelection =
      selection.size && [...selection].some((id) => !stillPresent.has(id))
        ? new Set([...selection].filter((id) => stillPresent.has(id)))
        : selection
    set({ photos, viewerIndex: remap(viewerIndex), lastSelectedIndex: remap(lastSelectedIndex), selection: nextSelection })
  },

  refreshSidebar: async () => {
    const [folders, subfolders, albums, tags] = await Promise.all([
      window.drift.listFolders(),
      window.drift.listSubfolders(),
      window.drift.listAlbums(),
      window.drift.listTags()
    ])
    set({ folders, subfolders, albums, tags })
  },

  select: (id, index, mode) => {
    const { selection, lastSelectedIndex, photos } = get()
    const next = new Set(selection)
    let newAnchor = index

    if (mode === 'single') {
      next.clear()
      next.add(id)
    } else if (mode === 'toggle') {
      if (next.has(id)) next.delete(id)
      else next.add(id)
    } else if (mode === 'range' && lastSelectedIndex !== null) {
      next.clear()
      const anchor = lastSelectedIndex
      const [a, b] = [Math.min(anchor, index), Math.max(anchor, index)]
      for (let i = a; i <= b; i++) if (photos[i]) next.add(photos[i].id)
      newAnchor = anchor
    } else {
      next.clear()
      next.add(id)
    }
    set({ selection: next, lastSelectedIndex: newAnchor })
  },

  clearSelection: () => set({ selection: new Set(), lastSelectedIndex: null }),

  selectAll: () => set({ selection: new Set(get().photos.map((p) => p.id)) }),

  setViewerIndex: (i) => {
    set({ viewerIndex: i })
    if (i !== null) {
      const p = get().photos[i]
      if (p) window.drift.markViewed(p.id)
    }
  },

  setSlideshow: (on) => set({ slideshow: on }),

  setSettings: (partial) => {
    const settings = { ...get().settings, ...partial }
    set({ settings })
    for (const [k, v] of Object.entries(partial)) window.drift.setSetting(k, v)
  },

  toggleFavorite: async (ids) => {
    const { selection, photos, viewerIndex, query } = get()
    let targets = ids
    if (!targets) {
      if (viewerIndex !== null && photos[viewerIndex]) targets = [photos[viewerIndex].id]
      else targets = [...selection]
    }
    if (!targets.length) return
    const first = photos.find((p) => p.id === targets![0])
    const fav = first ? !first.favorite : true
    const favVal = (fav ? 1 : 0) as 0 | 1
    // optimistic update
    set({
      photos: photos.map((p) => (targets!.includes(p.id) ? { ...p, favorite: favVal } : p))
    })
    await window.drift.setFavorite(targets, fav)
    if (query.view === 'favorites') {
      await get().refresh()
    }
  },

  saveScroll: (key, top) => {
    const m = get().scrollPositions
    m.set(key, top)
    // cap to 200 entries (LRU-ish: delete the oldest inserted key)
    if (m.size > 200) m.delete(m.keys().next().value as string)
  }
}))

let eventsInitialised = false

/** One-time wiring of main-process events into the store */
export function initLibraryEvents(): void {
  if (eventsInitialised) return
  eventsInitialised = true
  window.drift.onScanProgress((p) => useLibrary.setState({ scanProgress: p }))
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  window.drift.onLibraryChanged(() => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      useLibrary.getState().refresh()
      useLibrary.getState().refreshSidebar()
    }, 150)
  })
  Promise.all([
    window.drift.getSettings(),
    useLibrary.getState().refresh(),
    useLibrary.getState().refreshSidebar()
  ]).then(([settings]) => {
    useLibrary.setState({ settings, initialized: true })
    document.documentElement.dataset.theme = settings.theme
    applyThemeAccent(settings.theme, settings.accentColor)
  }).catch(() => {
    useLibrary.setState({ initialized: true })
  })
}
