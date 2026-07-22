import { create } from 'zustand'

export interface ContextMenuItem {
  label: string
  danger?: boolean
  separator?: boolean
  action?: () => void
  submenu?: ContextMenuItem[]
}

interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  onConfirm: () => void
}

/** Target tile edge in CSS px, selected by the toolbar zoom slider. */
export const ZOOM_LEVELS = [80, 110, 150, 200, 260] as const

interface UIState {
  sidebarCollapsed: boolean
  infoPanelOpen: boolean
  settingsOpen: boolean
  filmstripVisible: boolean
  editMode: boolean
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null
  confirm: ConfirmState | null

  /** Index into ZOOM_LEVELS; default 3 (=200px) */
  zoom: number
  /** Square (default) or aspect-ratio preserving layout */
  aspectMode: 'square' | 'aspect'
  /** Date grouping granularity */
  groupBy: 'years' | 'months' | 'days' | 'all'

  toggleSidebar: () => void
  toggleInfoPanel: () => void
  setSettingsOpen: (open: boolean) => void
  toggleFilmstrip: () => void
  setEditMode: (on: boolean) => void
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  closeContextMenu: () => void
  askConfirm: (c: ConfirmState) => void
  closeConfirm: () => void

  setZoom: (i: number) => void
  setAspectMode: (m: 'square' | 'aspect') => void
  setGroupBy: (g: 'years' | 'months' | 'days' | 'all') => void
}

export const useUI = create<UIState>((set) => ({
  sidebarCollapsed: false,
  infoPanelOpen: false,
  settingsOpen: false,
  filmstripVisible: true,
  editMode: false,
  contextMenu: null,
  confirm: null,

  zoom: 3,
  aspectMode: 'square',
  groupBy: 'months',

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleInfoPanel: () => set((s) => ({ infoPanelOpen: !s.infoPanelOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleFilmstrip: () => set((s) => ({ filmstripVisible: !s.filmstripVisible })),
  setEditMode: (on) => set({ editMode: on }),
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),
  askConfirm: (c) => set({ confirm: c }),
  closeConfirm: () => set({ confirm: null }),

  setZoom: (i) => set({ zoom: i }),
  setAspectMode: (m) => set({ aspectMode: m }),
  setGroupBy: (g) => set({ groupBy: g })
}))
