import { describe, expect, it, vi } from 'vitest'
import {
  editableFields, serializeFields, encodeFieldFile, readStoredFile, fileByteLength,
  safeFileName, downloadFieldFile, MAX_FIELD_FILE_BYTES, type EditableField,
} from '@/lib/credentialFields'
import { assertCredentialData, encryptCredential, decryptCredential, type CredentialData } from '@/lib/crypto'
import { encryptBackup, decryptBackup } from '@/lib/credentialBackup'

function file(bytes = new Uint8Array([0, 255, 13, 10, 0, 128]), name = 'client.json'): File {
  return { name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } as File
}

function textField(key: string, value = 'synthetic', required = false): EditableField {
  return { id: crypto.randomUUID(), key, value, type: 'text', isSecret: true, required }
}

describe('editable credential fields', () => {
  it('preserves exact values and secret/required flags through rename, addition and deletion', () => {
    const before: CredentialData = { name: 'test', fields: { Password: '  line1\nline2\n ', Unused: '' } }
    const fields = editableFields(before)
    fields[0].key = 'Renamed'
    fields.splice(1, 1)
    fields.push(textField('Added', 'value', true))
    const saved = serializeFields(fields)
    expect(saved.fields).toEqual({ Renamed: '  line1\nline2\n ', Added: 'value' })
    expect(editableFields({ name: 'test', ...saved })[0].isSecret).toBe(true)
    expect(saved.fieldOptions.Added.required).toBe(true)
  })

  it('rejects duplicate and blank names and empty required fields', () => {
    expect(() => serializeFields([textField('A'), textField(' A ')])).toThrow('Duplicate')
    expect(() => serializeFields([textField('')])).toThrow('name')
    expect(() => serializeFields([textField('Required', '', true)])).toThrow('required')
    expect(serializeFields([textField('Whitespace secret', '   ', true)]).fields['Whitespace secret']).toBe('   ')
  })

  it('safely preserves field names that match object properties', () => {
    const saved = serializeFields([textField('__proto__'), textField('constructor')])
    const data = JSON.parse(JSON.stringify({ name: 'test', ...saved }))
    assertCredentialData(data)
    expect(editableFields(data)).toHaveLength(2)
    expect(data.fields.__proto__).toBe('synthetic')
    expect({}.constructor).toBe(Object)
  })

  it('rejects unsupported versions, inconsistent metadata, and malformed files', () => {
    for (const extra of [
      { fieldOptionsVersion: 2, fieldOptions: {} },
      { schemaVersion: 2 },
      { fieldOptionsVersion: 1, fieldOptions: {} },
      { fieldOptionsVersion: 1, fieldOptions: { A: { type: ['file'], isSecret: true, required: false } } },
      { fieldOptionsVersion: 1, fieldOptions: { A: { type: 'file', isSecret: false, required: false } } },
      { fieldOptionsVersion: 1, fieldOptions: { A: { type: 'file', isSecret: true, required: false } } },
    ]) {
      expect(() => assertCredentialData({ name: 'test', fields: { A: 'invalid' }, ...extra })).toThrow()
    }
  })
})

describe('small encrypted file fields', () => {
  it('does not put malformed decrypted file content into parse errors or logs', () => {
    const syntheticSecret = 'synthetic-secret-must-not-appear-in-logs'
    try {
      readStoredFile(syntheticSecret)
      throw new Error('Expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Invalid file field.')
      expect(String(error)).not.toContain(syntheticSecret)
      expect((error as Error).cause).toBeUndefined()
    }
  })
  it.each([0, 1, 4096, MAX_FIELD_FILE_BYTES])('preserves %i bytes and pads to 4 KiB buckets', async (size) => {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 256)
    const encoded = await encodeFieldFile(file(bytes))
    const stored = readStoredFile(encoded)
    expect(fileByteLength(stored)).toBe(size)
    const decoded = Uint8Array.from(atob(stored.data), (c) => c.charCodeAt(0))
    expect(decoded.subarray(0, size)).toEqual(bytes)
    expect(decoded.length).toBe(Math.max(4096, Math.ceil(size / 4096) * 4096))
  }, 30000)

  it('rejects oversized files before reading their bytes', async () => {
    const read = vi.fn()
    await expect(encodeFieldFile({ size: MAX_FIELD_FILE_BYTES + 1, arrayBuffer: read } as unknown as File)).rejects.toThrow('128 KiB')
    expect(read).not.toHaveBeenCalled()
  })

  it('enforces aggregate byte and count limits', async () => {
    const value = await encodeFieldFile(file(new Uint8Array(MAX_FIELD_FILE_BYTES)))
    const fields = Array.from({ length: 3 }, (_, index) => ({ ...textField(`File ${index}`, value), type: 'file' as const }))
    expect(() => serializeFields(fields)).toThrow('256 KiB')
    const empty = await encodeFieldFile(file(new Uint8Array()))
    expect(() => serializeFields(Array.from({ length: 6 }, (_, index) => ({
      ...textField(`File ${index}`, empty), type: 'file' as const,
    })))).toThrow('5 files')
  })

  it('downloads only original bytes with an inert MIME type and sanitized filename', async () => {
    const bytes = new Uint8Array([0, 255, 10, 13, 128])
    const value = await encodeFieldFile(file(bytes, '../a\u202eb.json'))
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    let downloadName = ''
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download
    })
    try {
      downloadFieldFile(value)
      const blob = create.mock.calls[0][0] as Blob
      expect(blob.type).toBe('application/octet-stream')
      expect(blob.size).toBe(bytes.length)
      expect(downloadName).toBe('.._ab.json')
      expect(document.querySelector('a')).toBeNull()
    } finally { create.mockRestore(); click.mockRestore() }
  })

  it('removes path separators, controls and bidi characters from displayed filenames', () => {
    expect(safeFileName('a/\u0000\u202e\u2066b\\c.json')).toBe('a_b_c.json')
  })

  it('round-trips files and flags through encryption, backup and restore under new account keys', async () => {
    const value = await encodeFieldFile(file())
    const data: CredentialData = { name: 'Synthetic OAuth', ...serializeFields([
      { ...textField('JSON', value), type: 'file' }, textField('Secret', 'synthetic-only', true),
    ]) }
    const keyPair = () => crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt'])
    const source = await keyPair()
    const sourceId = crypto.randomUUID()
    const encrypted = await encryptCredential(data, source.publicKey, sourceId)
    const decrypted = await decryptCredential(encrypted, source.privateKey, sourceId)
    const entry = { data: decrypted, expires_at: null, created_at: '2026-11-16T00:00:00Z',
      is_active: false, revoked_at: '2026-11-16T00:00:00Z', source_origin: 'authored' as const }
    const backup = await encryptBackup([entry], 'synthetic-backup-password')
    const restored = (await decryptBackup(backup, 'synthetic-backup-password')).credentials[0]
    const destination = await keyPair()
    const destinationId = crypto.randomUUID()
    const reencrypted = await encryptCredential(restored.data, destination.publicKey, destinationId)
    expect(await decryptCredential(reencrypted, destination.privateKey, destinationId)).toEqual(data)
    expect(restored.is_active).toBe(false)
    expect(reencrypted).not.toBe(encrypted)
  }, 30000)
})
