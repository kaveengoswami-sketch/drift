import { AnimatePresence, motion } from 'framer-motion'
import { useLibrary } from '@/stores/libraryStore'
import './common.css'

export default function ScanBanner(): JSX.Element {
  const progress = useLibrary((s) => s.scanProgress)
  const visible = progress && progress.phase !== 'done' && progress.total > 0

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="scan-banner glass"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          <div className="scan-spinner" />
          {progress!.phase === 'scanning' ? (
            <span>
              Scanning… {progress!.scanned.toLocaleString()} / {progress!.total.toLocaleString()}
              {progress!.currentFile ? ` · ${progress!.currentFile}` : ''}
            </span>
          ) : (
            <span>Generating thumbnails… {progress!.total.toLocaleString()} remaining</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
