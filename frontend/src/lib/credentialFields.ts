import type { CredentialData } from './crypto'

export const MAX_FIELD_FILE_BYTES = 128 * 1024
export const MAX_RECORD_FILE_BYTES = 256 * 1024
export const MAX_RECORD_FILES = 5
// Leave room for signatures and restore-batch JSON below its 900,000-byte budget.
export const MAX_ENCRYPTED_RECORD_CHARS = 880_000

export function assertEncryptedRecordSize(encryptedData: string): void {
  if (!encryptedData || encryptedData.length > MAX_ENCRYPTED_RECORD_CHARS) {
    throw new Error('Credential is too large. Reduce the text or file data and try again.')
  }
}

export interface CredentialFieldOptions {
  type: 'text' | 'file'
  isSecret: boolean
  required: boolean
}

export interface StoredFieldFile {
  version: 1
  name: string
  byteLength: number
  data: string
}

export interface EditableField extends CredentialFieldOptions {
  id: string
  key: string
  value: string
}

export function isSecretField(key: string): boolean {
  return /password|secret|key|token|passphrase|pin|recovery/i.test(key)
}

export function safeFileName(name: string): string {
  return Array.from(name.replace(/[\\/]/g, '_')).filter((character) => {
    const code = character.codePointAt(0)!
    return code >= 32 && !(code >= 127 && code <= 159) && code !== 0x61c &&
      code !== 0x200e && code !== 0x200f && !(code >= 0x202a && code <= 0x202e) &&
      !(code >= 0x2066 && code <= 0x2069)
  }).join('').slice(0, 255).trim() || 'download'
}

export function readStoredFile(value: string): StoredFieldFile {
  if (value.length > Math.ceil(MAX_FIELD_FILE_BYTES / 3) * 4 + 4096) {
    throw new Error('File exceeds the 128 KiB limit.')
  }
  let file: unknown
  try { file = JSON.parse(value) } catch { throw new Error('Invalid file field.') }
  if (!file || typeof file !== 'object' || !('version' in file) || file.version !== 1 ||
      !('name' in file) || typeof file.name !== 'string' || file.name.length > 255 ||
      !('byteLength' in file) || typeof file.byteLength !== 'number' ||
      !Number.isInteger(file.byteLength) || file.byteLength < 0 || file.byteLength > MAX_FIELD_FILE_BYTES ||
      !('data' in file) || typeof file.data !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)) {
    throw new Error('Invalid file field.')
  }
  const decoded = atob(file.data)
  const paddedLength = Math.max(4096, Math.ceil(file.byteLength / 4096) * 4096)
  if (decoded.length !== paddedLength || btoa(decoded) !== file.data) {
    throw new Error('Invalid file size or encoding.')
  }
  return file as StoredFieldFile
}

export function fileByteLength(file: StoredFieldFile): number {
  return file.byteLength
}

export async function encodeFieldFile(file: File): Promise<string> {
  if (file.size > MAX_FIELD_FILE_BYTES) throw new Error('Each file must be 128 KiB or smaller.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const padded = new Uint8Array(Math.max(4096, Math.ceil(bytes.length / 4096) * 4096))
  try {
    if (bytes.length !== file.size || bytes.length > MAX_FIELD_FILE_BYTES) {
      throw new Error('Invalid file size.')
    }
    let binary = ''
    for (let offset = 0; offset < padded.length; offset += 65536) {
      crypto.getRandomValues(padded.subarray(offset, offset + 65536))
    }
    padded.set(bytes)
    for (let offset = 0; offset < padded.length; offset += 0x8000) {
      binary += String.fromCharCode(...padded.subarray(offset, offset + 0x8000))
    }
    return JSON.stringify({ version: 1, name: safeFileName(file.name), byteLength: bytes.length, data: btoa(binary) })
  } finally {
    bytes.fill(0)
    padded.fill(0)
  }
}

/** Only called after explicit confirmation; never preview or execute the file. */
export function downloadFieldFile(value: string): void {
  const file = readStoredFile(value)
  const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0))
  const blob = new Blob([bytes.subarray(0, file.byteLength)], { type: 'application/octet-stream' })
  bytes.fill(0)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = safeFileName(file.name)
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function fieldOptions(data: CredentialData, key: string): CredentialFieldOptions {
  return data.fieldOptions && Object.hasOwn(data.fieldOptions, key)
    ? data.fieldOptions[key]
    : { type: 'text', isSecret: isSecretField(key), required: false }
}

/** Validate metadata before displaying, editing or restoring file bytes. */
export function assertFieldOptions(data: Record<string, unknown>): void {
  if (data.fieldOptionsVersion === undefined && data.fieldOptions === undefined) return
  if (data.fieldOptionsVersion !== 1 || !data.fieldOptions ||
      typeof data.fieldOptions !== 'object' || Array.isArray(data.fieldOptions) ||
      !data.fields || typeof data.fields !== 'object') {
    throw new Error('Unsupported or invalid credential field format.')
  }
  const fields = data.fields as Record<string, string>
  const options = data.fieldOptions as Record<string, unknown>
  if (Object.keys(fields).length !== Object.keys(options).length) throw new Error('Invalid field metadata.')
  let total = 0
  let count = 0
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(fields, key) || !value || typeof value !== 'object' ||
        !('type' in value) || (value.type !== 'text' && value.type !== 'file') ||
        !('isSecret' in value) || typeof value.isSecret !== 'boolean' ||
        !('required' in value) || typeof value.required !== 'boolean') {
      throw new Error('Invalid field metadata.')
    }
    if (value.type === 'file') {
      if (!value.isSecret) throw new Error('Files must be marked secret.')
      if (fields[key]) {
        total += fileByteLength(readStoredFile(fields[key]))
        count++
      }
    }
  }
  if (count > MAX_RECORD_FILES || total > MAX_RECORD_FILE_BYTES) {
    throw new Error('A credential supports up to 5 files and 256 KiB of file data.')
  }
}

export function editableFields(data: CredentialData): EditableField[] {
  return Object.entries(data.fields ?? {}).map(([key, value]) => ({
    ...fieldOptions(data, key), id: crypto.randomUUID(), key, value,
  }))
}

export function serializeFields(fields: EditableField[]) {
  const names = new Set<string>()
  if (fields.length > 50) throw new Error('A credential supports up to 50 fields.')
  for (const field of fields) {
    const key = field.key.trim()
    if (!key) throw new Error('Every field needs a name.')
    if (names.has(key)) throw new Error(`Duplicate field name: ${key}`)
    names.add(key)
    if (field.required && field.value.length === 0) throw new Error(`${key} is required.`)
  }
  const result = {
    fields: Object.fromEntries(fields.map((field) => [field.key.trim(), field.value])),
    fieldOptionsVersion: 1 as const,
    fieldOptions: Object.fromEntries(fields.map((field) => [field.key.trim(), {
      type: field.type, isSecret: field.type === 'file' || field.isSecret, required: field.required,
    }])),
  }
  assertFieldOptions(result)
  return result
}
