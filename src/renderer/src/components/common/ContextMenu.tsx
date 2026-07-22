import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useUI, type ContextMenuItem } from '@/stores/uiStore'
import './common.css'

function MenuList({ items, close }: { items: ContextMenuItem[]; close: () => void }): JSX.Element {
  const [openSub, setOpenSub] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Arrow-key navigation and Tab-to-close
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    // focus first focusable item
    const focusable = (): HTMLButtonElement[] =>
      Array.from(el.querySelectorAll<HTMLButtonElement>(':scope > .ctx-item-wrap > .ctx-item:not([disabled])'))
    focusable()[0]?.focus()

    const onKey = (e: KeyboardEvent): void => {
      const items = focusable()
      const idx = items.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[(idx + 1) % items.length]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        items[(idx - 1 + items.length) % items.length]?.focus()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        close()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div ref={listRef} className="ctx-list" role="menu">
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <div
            key={i}
            className="ctx-item-wrap"
            onMouseEnter={() => setOpenSub(item.submenu ? i : null)}
          >
            <button
              role="menuitem"
              aria-haspopup={item.submenu ? true : undefined}
              aria-expanded={item.submenu ? openSub === i : undefined}
              className={`ctx-item ${item.danger ? 'danger' : ''}`}
              onClick={() => {
                if (item.submenu) return
                item.action?.()
                close()
              }}
            >
              {item.label}
              {item.submenu && <span className="ctx-arrow">▸</span>}
            </button>
            {item.submenu && openSub === i && (
              <div className="ctx-submenu glass" role="menu">
                {item.submenu.length ? (
                  item.submenu.map((sub, j) => (
                    <button
                      key={j}
                      role="menuitem"
                      className="ctx-item"
                      onClick={() => {
                        sub.action?.()
                        close()
                      }}
                    >
                      {sub.label}
                    </button>
                  ))
                ) : (
                  <div className="ctx-empty">No albums</div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

export default function ContextMenu(): JSX.Element {
  const { contextMenu, closeContextMenu } = useUI()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: contextMenu!.x, y: contextMenu!.y })

  useEffect(() => {
    // keep on screen
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(contextMenu!.x, window.innerWidth - r.width - 8),
      y: Math.min(contextMenu!.y, window.innerHeight - r.height - 8)
    })
  }, [contextMenu])

  return (
    <div className="ctx-backdrop" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }}>
      <motion.div
        ref={ref}
        className="ctx-menu glass"
        style={{ left: pos.x, top: pos.y }}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuList items={contextMenu!.items} close={closeContextMenu} />
      </motion.div>
    </div>
  )
}
