import { create } from 'zustand'
import type { Photo, SourceFolder, Album, Settings, ScanProgress, LibraryQuery } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

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
  return `${q.view}:${q.albumId ?? ''}:${q.folderId ?? ''}:${q.folderPathPrefix ?? ''}:${q.tag ?? ''}`
}

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

  setQuery: (q) => {
    set({ query: q, selection: new Set(), lastSelectedIndex: null, viewerIndex: null })
    get().refresh()
  },

  refresh: async () => {
    const photos = await window.drift.queryPhotos(get().query)
    set({ photos })
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
    if (mode === 'single') {
      next.clear()
      next.add(id)
    } else if (mode === 'toggle') {
      if (next.has(id)) next.delete(id)
      else next.add(id)
    } else if (mode === 'range' && lastSelectedIndex !== null) {
      const [a, b] = [Math.min(lastSelectedIndex, index), Math.max(lastSelectedIndex, index)]
      for (let i = a; i <= b; i++) next.add(photos[i].id)
    } else {
      next.add(id)
    }
    set({ selection: next, lastSelectedIndex: index })
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
    const { selection, photos, viewerIndex } = get()
    let targets = ids
    if (!targets) {
      if (viewerIndex !== null && photos[viewerIndex]) targets = [photos[viewerIndex].id]
      else targets = [...selection]
    }
    if (!targets.length) return
    const first = photos.find((p) => p.id === targets![0])
    const fav = first ? !first.favorite : true
    // optimistic update
    set({
      photos: photos.map((p) => (targets!.includes(p.id) ? { ...p, favorite: (fav ? 1 : 0) as 0 | 1 } : p))
    })
    await window.drift.setFavorite(targets, fav)
  },

  saveScroll: (key, top) => {
    get().scrollPositions.set(key, top)
  }
}))

/** One-time wiring of main-process events into the store */
export function initLibraryEvents(): void {
  window.drift.onScanProgress((p) => useLibrary.setState({ scanProgress: p }))
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  window.drift.onLibraryChanged(() => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      useLibrary.getState().refresh()
      useLibrary.getState().refreshSidebar()
    }, 150)
  })
  window.drift.getSettings().then((settings) => {
    useLibrary.setState({ settings })
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.setProperty('--accent', settings.accentColor)
  })
  useLibrary.getState().refresh()
  useLibrary.getState().refreshSidebar()
}
