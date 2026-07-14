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

interface UIState {
  sidebarCollapsed: boolean
  infoPanelOpen: boolean
  settingsOpen: boolean
  filmstripVisible: boolean
  editMode: boolean
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null
  confirm: ConfirmState | null

  toggleSidebar: () => void
  toggleInfoPanel: () => void
  setSettingsOpen: (open: boolean) => void
  toggleFilmstrip: () => void
  setEditMode: (on: boolean) => void
  openContextMenu: (x: number, y: number, items: ContextMenuItem[]) => void
  closeContextMenu: () => void
  askConfirm: (c: ConfirmState) => void
  closeConfirm: () => void
}

export const useUI = create<UIState>((set) => ({
  sidebarCollapsed: false,
  infoPanelOpen: false,
  settingsOpen: false,
  filmstripVisible: true,
  editMode: false,
  contextMenu: null,
  confirm: null,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleInfoPanel: () => set((s) => ({ infoPanelOpen: !s.infoPanelOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleFilmstrip: () => set((s) => ({ filmstripVisible: !s.filmstripVisible })),
  setEditMode: (on) => set({ editMode: on }),
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),
  askConfirm: (c) => set({ confirm: c }),
  closeConfirm: () => set({ confirm: null })
}))
