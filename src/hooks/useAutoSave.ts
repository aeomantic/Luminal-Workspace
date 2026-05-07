import { useEffect, useRef, useCallback } from 'react'

/**
 * Schedules a debounced auto-save whenever `schedule()` is called.
 * The save only fires if the tab is dirty AND has a real file path
 * (untitled buffers are never auto-saved).
 */
export function useAutoSave(
  isDirty: boolean,
  absPath: string | null,
  onSave: () => Promise<void>,
  delay = 1500,
): { schedule: () => void } {
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep refs so the timer closure always reads the latest values without
  // needing to re-register the effect.
  const isDirtyRef = useRef(isDirty)
  const absPathRef = useRef(absPath)
  const onSaveRef  = useRef(onSave)
  isDirtyRef.current = isDirty
  absPathRef.current = absPath
  onSaveRef.current  = onSave

  // Reset the timer every time schedule() is called (i.e. on each keystroke).
  const schedule = useCallback(() => {
    if (!isDirtyRef.current || !absPathRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (isDirtyRef.current && absPathRef.current) {
        onSaveRef.current().catch(console.error)
      }
    }, delay)
  }, [delay])

  // Clear any pending timer when the component unmounts.
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return { schedule }
}
