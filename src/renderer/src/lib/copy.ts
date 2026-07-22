import { useUI } from '@/stores/uiStore'

/**
 * Copy a photo to the clipboard and always tell the user what happened.
 * The bare IPC call is silent on both success and failure, which is why the
 * copy button read as broken.
 */
export async function copyPhotoToClipboard(filePath: string): Promise<void> {
  const { showToast } = useUI.getState()
  try {
    const res = await window.drift.copyToClipboard(filePath)
    if (!res || !res.ok) {
      showToast(res?.error ? `Copy failed: ${res.error}` : 'Copy failed', 'error')
    } else if (res.kind === 'path') {
      showToast('Image could not be read — file path copied instead')
    } else {
      showToast('Image copied to clipboard')
    }
  } catch (err) {
    showToast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

/** Copy arbitrary text (file paths) with the same visible confirmation. */
export async function copyTextToClipboard(text: string, label: string): Promise<void> {
  const { showToast } = useUI.getState()
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${label} copied`)
  } catch (err) {
    showToast(`Copy failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}
