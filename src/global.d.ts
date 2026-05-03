// Type declarations for Web File System Access API features not yet in all
// TypeScript DOM lib versions.

interface Window {
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }): Promise<FileSystemDirectoryHandle>

  showOpenFilePicker(options?: {
    multiple?: boolean
    excludeAcceptAllOption?: boolean
    types?: Array<{ description?: string; accept: Record<string, string[]> }>
  }): Promise<FileSystemFileHandle[]>

  showSaveFilePicker(options?: {
    excludeAcceptAllOption?: boolean
    suggestedName?: string
    types?: Array<{ description?: string; accept: Record<string, string[]> }>
  }): Promise<FileSystemFileHandle>
}
