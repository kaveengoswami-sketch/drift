import { motion } from 'framer-motion'
import { useUI } from '@/stores/uiStore'
import './common.css'

export default function ConfirmDialog(): JSX.Element {
  const { confirm, closeConfirm } = useUI()
  const c = confirm!
  return (
    <div className="dlg-backdrop" onClick={closeConfirm}>
      <motion.div
        className="dlg glass"
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="dlg-title">{c.title}</h3>
        <p className="dlg-message">{c.message}</p>
        <div className="dlg-actions">
          <button className="editor-btn" onClick={closeConfirm}>
            Cancel
          </button>
          <button
            className={`editor-btn primary ${c.danger ? 'danger' : ''}`}
            onClick={() => {
              c.onConfirm()
              closeConfirm()
            }}
          >
            {c.confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
