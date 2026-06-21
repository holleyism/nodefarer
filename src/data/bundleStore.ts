import { validateAtlas, type Atlas } from './atlas'

// ─────────────────────────────────────────────────────────────────────────────
// A bundled demo is a *directory* holding an Atlas (`manifest.json` + the
// `bundle.json` its source points at + the `tours/` it lists). A BundleStore
// abstracts WHERE those files live so the rest of the app reads them the same
// way (Plan G4+):
//   - urlBundleStore   — a hosted directory (web root, /demos/<id>/, or any URL)
//   - dirHandleBundleStore / fileMapBundleStore — a folder picked off local disk
// This lets us ship several demos and let a user load their own.
// ─────────────────────────────────────────────────────────────────────────────

export interface BundleStore {
  label: string
  readJSON(relPath: string): Promise<unknown>
  exists(relPath: string): Promise<boolean>
}

const strip = (p: string) => p.replace(/^\//, '')

// ── Hosted directory over HTTP ───────────────────────────────────────────────
// `base` is a directory URL/path ('' = web root). An absolute ('/x') or fully
// qualified ('http://…') relPath is used as-is; otherwise it's joined to base.
export function urlBundleStore(base: string): BundleStore {
  const root = base.replace(/\/$/, '')
  const url = (rel: string) =>
    /^https?:\/\//.test(rel) || rel.startsWith('/') ? rel : `${root}/${rel}`
  return {
    label: root || '/',
    async readJSON(rel) {
      const res = await fetch(url(rel))
      if (!res.ok) throw new Error(`${rel}: ${res.status}`)
      return res.json()
    },
    async exists(rel) {
      // Prefer a cheap HEAD; fall back to GET for servers that don't allow HEAD
      // (405/501) so a valid file isn't reported missing.
      try {
        const head = await fetch(url(rel), { method: 'HEAD' })
        if (head.ok) return true
        if (head.status !== 405 && head.status !== 501) return false
      } catch {
        /* fall through to GET */
      }
      try {
        return (await fetch(url(rel))).ok
      } catch {
        return false
      }
    },
  }
}

// ── Local folder via the File System Access API ──────────────────────────────
interface FSFileHandle {
  getFile(): Promise<File>
}
interface FSDirHandle {
  name: string
  getDirectoryHandle(name: string): Promise<FSDirHandle>
  getFileHandle(name: string): Promise<FSFileHandle>
}

async function fileHandleAt(root: FSDirHandle, rel: string): Promise<FSFileHandle> {
  const parts = strip(rel).split('/').filter(Boolean)
  let dir = root
  for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i])
  return dir.getFileHandle(parts[parts.length - 1])
}

function dirHandleBundleStore(handle: FSDirHandle): BundleStore {
  return {
    label: handle.name,
    async readJSON(rel) {
      const file = await (await fileHandleAt(handle, rel)).getFile()
      return JSON.parse(await file.text())
    },
    async exists(rel) {
      try {
        await fileHandleAt(handle, rel)
        return true
      } catch {
        return false
      }
    },
  }
}

// ── Local folder via <input webkitdirectory> (flat FileList fallback) ─────────
function fileMapBundleStore(files: FileList): BundleStore {
  const map = new Map<string, File>()
  let top = ''
  for (const f of Array.from(files)) {
    const segs = f.webkitRelativePath.split('/')
    top ||= segs[0]
    map.set(segs.slice(1).join('/'), f) // drop the chosen folder's own name
  }
  return {
    label: top || 'local folder',
    async readJSON(rel) {
      const f = map.get(strip(rel))
      if (!f) throw new Error(`${rel}: not found`)
      return JSON.parse(await f.text())
    },
    async exists(rel) {
      return map.has(strip(rel))
    },
  }
}

// Open a local-folder picker and return a store for it (null if the user
// cancels). Prefers the File System Access API; falls back to a hidden
// webkitdirectory input for browsers without it.
export async function pickLocalBundle(): Promise<BundleStore | null> {
  const w = window as unknown as { showDirectoryPicker?: () => Promise<FSDirHandle> }
  if (w.showDirectoryPicker) {
    try {
      return dirHandleBundleStore(await w.showDirectoryPicker())
    } catch {
      return null // user dismissed the picker
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.setAttribute('webkitdirectory', '')
    input.onchange = () => resolve(input.files && input.files.length ? fileMapBundleStore(input.files) : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

// ── Catalog of shipped demos ─────────────────────────────────────────────────
export interface DemoEntry {
  id: string
  name: string
  description?: string
  dir: string // directory base ('' = web root)
}

const DEFAULT_CATALOG: DemoEntry[] = [{ id: 'default', name: 'Bundled demo', dir: '' }]

export async function loadDemoCatalog(): Promise<DemoEntry[]> {
  try {
    const res = await fetch('/demos.json')
    if (!res.ok) throw new Error(`demos ${res.status}`)
    const list = (await res.json()) as DemoEntry[]
    if (Array.isArray(list) && list.length) return list
  } catch (err) {
    console.warn('No demos.json catalog; using the default bundle:', err)
  }
  return DEFAULT_CATALOG
}

// ── Validation ───────────────────────────────────────────────────────────────
// Confirm a directory holds a usable bundle: a valid Atlas manifest, a reachable
// data file, and (soft) its listed tours. Errors block the switch; warnings (a
// missing tour) don't — the universe still loads.
export interface BundleValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  atlas?: Atlas
}

export async function validateBundle(store: BundleStore): Promise<BundleValidation> {
  const errors: string[] = []
  const warnings: string[] = []
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  let atlas: Atlas
  try {
    atlas = validateAtlas(await store.readJSON('manifest.json'))
  } catch (e) {
    return { ok: false, errors: [`manifest.json: ${msg(e)}`], warnings }
  }

  const dataPath = (atlas.source.kind === 'bundle' && atlas.source.url) || 'bundle.json'
  if (!(await store.exists(dataPath))) errors.push(`data file missing: ${dataPath}`)

  for (const t of atlas.tours ?? []) {
    if (!(await store.exists(t.file))) warnings.push(`tour file missing: ${t.file}`)
  }

  return { ok: errors.length === 0, errors, warnings, atlas }
}
