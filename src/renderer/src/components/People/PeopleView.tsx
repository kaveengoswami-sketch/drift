import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Person, FaceScanProgress } from '@shared/types'
import { useLibrary } from '@/stores/libraryStore'
import { useUI } from '@/stores/uiStore'
import PersonCard from './PersonCard'
import './PeopleView.css'

export default function PeopleView(): JSX.Element {
  const setQuery = useLibrary((s) => s.setQuery)
  const askConfirm = useUI((s) => s.askConfirm)
  const openContextMenu = useUI((s) => s.openContextMenu)

  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [scanProgress, setScanProgress] = useState<FaceScanProgress | null>(null)
  const [renderLimit, setRenderLimit] = useState(60)

  const fetchPeople = useCallback(async () => {
    try {
      const list = await window.drift.listPeople()
      setPeople(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPeople()
    window.drift.getFaceScanProgress().then(setScanProgress)

    const unsubProgress = window.drift.onFaceScanProgress((p) => {
      const progress = p as FaceScanProgress
      setScanProgress(progress)
      if (progress.phase === 'done') {
        fetchPeople()
      }
    })

    const unsubLib = window.drift.onLibraryChanged(() => {
      fetchPeople()
    })

    return () => {
      unsubProgress()
      unsubLib()
    }
  }, [fetchPeople])

  // Sorting: Named people sort before unnamed suggestions
  const { namedPeople, unnamedPeople } = useMemo(() => {
    const named: Person[] = []
    const unnamed: Person[] = []

    for (const p of people) {
      if (p.name && p.name.trim().length > 0) {
        named.push(p)
      } else {
        unnamed.push(p)
      }
    }

    named.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    unnamed.sort((a, b) => b.faceCount - a.faceCount)

    return { namedPeople: named, unnamedPeople: unnamed }
  }, [people])

  const allSortedPeople = useMemo(() => {
    return [...namedPeople, ...unnamedPeople]
  }, [namedPeople, unnamedPeople])

  // Infinite/progressive loading slice for smooth rendering
  useEffect(() => {
    if (renderLimit < allSortedPeople.length) {
      const timer = setTimeout(() => {
        setRenderLimit((prev) => Math.min(prev + 60, allSortedPeople.length))
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [renderLimit, allSortedPeople.length])

  const visiblePeople = useMemo(() => {
    return allSortedPeople.slice(0, renderLimit)
  }, [allSortedPeople, renderLimit])

  const handleSelect = (id: number, mode: 'single' | 'toggle'): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (mode === 'single') {
        next.clear()
        next.add(id)
      } else {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const handleOpen = (person: Person): void => {
    setQuery({
      view: 'person',
      personId: person.id,
      personName: person.name || 'Unnamed Person'
    })
  }

  const handleNameChange = async (id: number, name: string): Promise<void> => {
    await window.drift.namePerson(id, name)
    fetchPeople()
  }

  const handleMerge = (targetId: number, sourceId: number): void => {
    const target = people.find((p) => p.id === targetId)
    const source = people.find((p) => p.id === sourceId)
    if (!target || !source) return

    const targetName = target.name || `Unnamed Person #${target.id}`
    const sourceName = source.name || `Unnamed Person #${source.id}`

    askConfirm({
      title: 'Merge People?',
      message: `Combine all photos of "${sourceName}" into "${targetName}"? This action cannot be undone.`,
      confirmLabel: 'Merge',
      danger: true,
      onConfirm: async () => {
        await window.drift.mergePeople(targetId, sourceId)
        setSelectedIds(new Set())
        fetchPeople()
      }
    })
  }

  const handleMergeSelected = (): void => {
    const arr = Array.from(selectedIds)
    if (arr.length < 2) return
    const targetId = arr[0]
    const sourceId = arr[1]
    handleMerge(targetId, sourceId)
  }

  const handleContextMenu = (e: React.MouseEvent, person: Person): void => {
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY, [
      {
        label: 'View Photos',
        action: () => handleOpen(person)
      },
      {
        label: person.name ? 'Rename Person' : 'Add Name',
        action: () => {
          const newName = prompt('Enter name for person', person.name || '')
          if (newName !== null) {
            handleNameChange(person.id, newName.trim())
          }
        }
      },
      ...(selectedIds.size >= 2
        ? [
            {
              label: `Merge ${selectedIds.size} Selected People`,
              danger: true,
              action: handleMergeSelected
            }
          ]
        : [])
    ])
  }

  const handleStartScan = async (): Promise<void> => {
    await window.drift.startFaceScan()
  }

  const handleCancelScan = async (): Promise<void> => {
    await window.drift.cancelFaceScan()
  }

  const isScanning =
    scanProgress &&
    (scanProgress.phase === 'downloading_models' ||
      scanProgress.phase === 'scanning' ||
      scanProgress.phase === 'clustering')

  return (
    <div className="people-container">
      {/* Top Banner for active scanning */}
      {isScanning && (
        <div className="people-scan-banner glass">
          <div className="people-scan-info">
            <div className="people-scan-spinner" />
            <div className="people-scan-text">
              {scanProgress.phase === 'downloading_models' && (
                <div>
                  <strong>Downloading face recognition models (~15MB)...</strong>
                  <div className="people-scan-sub">Setting up local machine learning pipeline</div>
                </div>
              )}
              {scanProgress.phase === 'scanning' && (
                <div>
                  <strong>Scanning photos for faces...</strong>
                  <div className="people-scan-sub">
                    {scanProgress.scanned} of {scanProgress.total} photos processed &bull; {scanProgress.facesFound}{' '}
                    faces found
                  </div>
                </div>
              )}
              {scanProgress.phase === 'clustering' && (
                <div>
                  <strong>Grouping faces into people...</strong>
                  <div className="people-scan-sub">Clustering identities using face embeddings</div>
                </div>
              )}
            </div>
          </div>

          {scanProgress.phase === 'scanning' && scanProgress.total > 0 && (
            <div className="people-scan-progress-bar">
              <div
                className="people-scan-progress-fill"
                style={{ width: `${Math.min(100, (scanProgress.scanned / scanProgress.total) * 100)}%` }}
              />
            </div>
          )}

          <button className="people-cancel-btn" onClick={handleCancelScan}>
            Cancel
          </button>
        </div>
      )}

      {/* Header bar when people exist */}
      {!loading && people.length > 0 && (
        <div className="people-header">
          <div className="people-header-stats">
            <h2>People</h2>
            <span className="people-count-badge">
              {namedPeople.length} named &bull; {people.length} total
            </span>
          </div>

          <div className="people-header-actions">
            {selectedIds.size >= 2 && (
              <button className="people-action-btn merge" onClick={handleMergeSelected}>
                Merge {selectedIds.size} Selected
              </button>
            )}
            {!isScanning && (
              <button className="people-action-btn scan" onClick={handleStartScan}>
                Scan for People
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="people-loading">
          <div className="people-scan-spinner" />
          <span>Loading People...</span>
        </div>
      ) : people.length === 0 && !isScanning ? (
        <div className="people-empty-hero glass">
          <div className="people-hero-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <circle cx="9" cy="7" r="4" />
              <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
            </svg>
          </div>
          <h2>Find People in Your Photos</h2>
          <p>
            Drift scans your photos to recognize faces and automatically group them by person.
            All processing is performed 100% locally on your computer — your photos are never sent to any cloud server.
          </p>

          <button className="people-hero-scan-btn" onClick={handleStartScan}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 4.5v4l2.5 1.5" />
            </svg>
            Scan for People
          </button>
          <span className="people-privacy-note">Fully offline &bull; Private &bull; On-device AI</span>
        </div>
      ) : (
        <div className="people-grid-scroll">
          {namedPeople.length > 0 && (
            <div className="people-section">
              <h3 className="people-section-title">Named People</h3>
              <div className="people-grid">
                {namedPeople.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    selected={selectedIds.has(person.id)}
                    onSelect={handleSelect}
                    onOpen={handleOpen}
                    onNameChange={handleNameChange}
                    onMergeDrop={handleMerge}
                    onContextMenu={handleContextMenu}
                  />
                ))}
              </div>
            </div>
          )}

          {unnamedPeople.length > 0 && (
            <div className="people-section">
              <h3 className="people-section-title">
                {namedPeople.length > 0 ? 'Suggested People' : 'Detected People'}
              </h3>
              <div className="people-grid">
                {unnamedPeople
                  .filter((p) => visiblePeople.some((vp) => vp.id === p.id))
                  .map((person) => (
                    <PersonCard
                      key={person.id}
                      person={person}
                      selected={selectedIds.has(person.id)}
                      onSelect={handleSelect}
                      onOpen={handleOpen}
                      onNameChange={handleNameChange}
                      onMergeDrop={handleMerge}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
