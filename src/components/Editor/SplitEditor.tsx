import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react'
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { EditorArea } from './EditorArea'
import type { EditorTab } from './useEditorTabs'
import { cn } from '../../lib/utils'

// ── Public types ──────────────────────────────────────────────────────────────

export type SplitDirection = 'none' | 'horizontal' | 'vertical'

export interface EditorGroup {
  id: string
  activeTabPath: string | null
}

export interface SplitEditorHandle {
  getActiveSelection: () => string
}

interface SplitEditorProps {
  tabs: EditorTab[]
  groups: EditorGroup[]
  splitDirection: SplitDirection
  focusedGroupId: string
  onTabClick:   (groupId: string, path: string) => void
  onTabClose:   (path: string) => void
  onDirtyChange:(path: string, isDirty: boolean) => void
  onSave:       (path: string, content: string) => Promise<void>
  onGroupFocus: (groupId: string) => void
  onCloseGroup: (groupId: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export const SplitEditor = forwardRef<SplitEditorHandle, SplitEditorProps>(
  function SplitEditor(
    { tabs, groups, splitDirection, focusedGroupId,
      onTabClick, onTabClose, onDirtyChange, onSave,
      onGroupFocus, onCloseGroup },
    ref,
  ) {
    // Each group gets its own stable getter entry
    const getterMap = useRef<Map<string, () => string>>(new Map())

    useImperativeHandle(ref, () => ({
      getActiveSelection: () => getterMap.current.get(focusedGroupId)?.() ?? '',
    }), [focusedGroupId])

    const isSplit = splitDirection !== 'none' && groups.length >= 2

    if (!isSplit) {
      const group = groups[0]
      return (
        <GroupPane
          key={group.id}
          group={group}
          tabs={tabs}
          isFocused
          showCloseGroup={false}
          onTabClick={(p) => onTabClick(group.id, p)}
          onTabClose={onTabClose}
          onDirtyChange={onDirtyChange}
          onSave={onSave}
          onFocus={() => onGroupFocus(group.id)}
          onClose={() => onCloseGroup(group.id)}
          onGetterReady={(fn) => getterMap.current.set(group.id, fn)}
        />
      )
    }

    return (
      <PanelGroup
        orientation={splitDirection === 'horizontal' ? 'horizontal' : 'vertical'}
        className="flex-1 min-h-0"
      >
        {groups.map((group, idx) => (
          <>
            {idx > 0 && (
              <PanelResizeHandle
                className={cn(
                  'transition-colors bg-white/[0.04]',
                  splitDirection === 'horizontal'
                    ? 'w-[3px] hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60'
                    : 'h-[3px] hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60',
                )}
              />
            )}
            <Panel key={group.id} minSize={15}>
              <GroupPane
                group={group}
                tabs={tabs}
                isFocused={group.id === focusedGroupId}
                showCloseGroup
                onTabClick={(p) => onTabClick(group.id, p)}
                onTabClose={onTabClose}
                onDirtyChange={onDirtyChange}
                onSave={onSave}
                onFocus={() => onGroupFocus(group.id)}
                onClose={() => onCloseGroup(group.id)}
                onGetterReady={(fn) => getterMap.current.set(group.id, fn)}
              />
            </Panel>
          </>
        ))}
      </PanelGroup>
    )
  },
)

// ── GroupPane ─────────────────────────────────────────────────────────────────
// Wraps EditorArea for a single group, managing its own selectionGetterRef.

interface GroupPaneProps {
  group: EditorGroup
  tabs: EditorTab[]
  isFocused: boolean
  showCloseGroup: boolean
  onTabClick:    (path: string) => void
  onTabClose:    (path: string) => void
  onDirtyChange: (path: string, isDirty: boolean) => void
  onSave:        (path: string, content: string) => Promise<void>
  onFocus:       () => void
  onClose:       () => void
  onGetterReady: (getter: () => string) => void
}

function GroupPane({
  group, tabs, isFocused, showCloseGroup,
  onTabClick, onTabClose, onDirtyChange, onSave,
  onFocus, onClose, onGetterReady,
}: GroupPaneProps) {
  const selectionGetterRef = useRef<() => string>(() => '')

  // Register the getter with the parent the first time (and after group id changes)
  useEffect(() => {
    onGetterReady(() => selectionGetterRef.current())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id])

  return (
    <div
      className={cn(
        'flex flex-col h-full min-h-0',
        isFocused && showCloseGroup && 'ring-1 ring-inset ring-primary/20',
      )}
      onMouseDown={onFocus}
    >
      <EditorArea
        tabs={tabs}
        activeTabPath={group.activeTabPath}
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onDirtyChange={onDirtyChange}
        onSave={onSave}
        selectionGetterRef={selectionGetterRef}
        showCloseGroup={showCloseGroup}
        onCloseGroup={onClose}
      />
    </div>
  )
}
