import { AnimatePresence, motion } from 'framer-motion'
import { useUI } from '@/stores/uiStore'
import './Toasts.css'

/**
 * Transient confirmations for actions that otherwise give no visible feedback
 * (copy to clipboard, face-scan failures). Mounted once at the app root.
 */
export default function Toasts(): JSX.Element {
  const toasts = useUI((s) => s.toasts)
  const dismissToast = useUI((s) => s.dismissToast)

  return (
    <div className="toast-stack">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            className={`toast toast-${t.tone}`}
            onClick={() => dismissToast(t.id)}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
