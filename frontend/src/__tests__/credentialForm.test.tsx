import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AxiosError, type AxiosResponse } from 'axios'
import CredentialForm from '@/components/CredentialForm'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { readStoredFile } from '@/lib/credentialFields'
import type { CredentialTemplate } from '@/types/template'

const { encrypt } = vi.hoisted(() => ({ encrypt: vi.fn() }))
vi.mock('@/hooks/useCredentialCrypto', () => ({ useCredentialCrypto: () => ({
  encrypt, generatePassword: vi.fn(), isProcessing: false, error: null, clearError: vi.fn(),
}) }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
const save = vi.fn()
const close = vi.fn()
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

async function render(template?: CredentialTemplate) {
  await act(async () => root.render(<CredentialForm isOpen onClose={close} onSave={save} credentialId={ID}
    template={template} initialData={template ? undefined : { name: 'Synthetic', credentialData: { name: 'Synthetic',
      fields: { Password: 'original', Optional: 'remove-me' } } }} />))
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === label)!
  await act(async () => button.click())
}

async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'pk', {} as never)
  encrypt.mockReset().mockResolvedValue('encrypted-synthetic')
  save.mockReset().mockResolvedValue(undefined)
  close.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useVaultKeyStore.getState().clearKeys()
})

describe('CredentialForm editing', () => {
  it('ignores file defaults in untrusted local/imported templates without crashing', async () => {
    await render({ id: 'custom-file', name: 'File', isBuiltIn: false,
      fields: [{ key: 'JSON', type: 'file', isSecret: true, defaultValue: 'invalid-file-json' }] })
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
    expect(container.textContent).not.toContain('invalid-file-json')
  })

  it('does not allow removing a required template field', async () => {
    await render({ id: 'custom-required', name: 'Required', isBuiltIn: false,
      fields: [{ key: 'Mandatory', isSecret: true, required: true }] })
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Remove Mandatory"]')!.disabled).toBe(true)
    await type(container.querySelector('#name')!, 'Synthetic')
    await submit()
    expect(container.textContent).toContain('required')
    expect(encrypt).not.toHaveBeenCalled()
  })

  it('rejects unknown imported field types before encryption', async () => {
    await render({ id: 'custom-unknown', name: 'Unknown', isBuiltIn: false,
      fields: [{ key: 'Unknown', type: 'unknown' as 'text', isSecret: true, defaultValue: 'synthetic' }] })
    await type(container.querySelector('#name')!, 'Synthetic')
    await submit()
    expect(container.textContent).toContain('Invalid field metadata')
    expect(encrypt).not.toHaveBeenCalled()
  })
  it('edits, removes and adds fields, preserving secret masking and the original ID', async () => {
    await render()
    await type(container.querySelectorAll<HTMLInputElement>('[aria-label="Field name"]')[0], 'Renamed')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Value for Renamed"]')!.type).toBe('password')
    await type(container.querySelector('[aria-label="Value for Renamed"]')!, 'changed')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Optional"]')!.click())
    await click('Add Field')
    await type(container.querySelectorAll<HTMLInputElement>('[aria-label="Field name"]')[1], 'Extra')
    await type(container.querySelector('[aria-label="Value for Extra"]')!, 'new')
    await submit()
    expect(encrypt).toHaveBeenCalledWith(expect.objectContaining({
      fields: { Renamed: 'changed', Extra: 'new' },
      fieldOptions: { Renamed: { type: 'text', isSecret: true, required: false },
        Extra: { type: 'text', isSecret: false, required: false } },
    }), ID)
    expect(save).toHaveBeenCalledWith({ id: ID, encrypted_data: 'encrypted-synthetic' }, undefined, expect.any(Function))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps unsaved values visible on a version conflict', async () => {
    save.mockRejectedValue(new AxiosError('Conflict', undefined, undefined, undefined, { status: 409 } as AxiosResponse))
    await render()
    await type(container.querySelector('[aria-label="Value for Optional"]')!, 'unsaved')
    await submit()
    expect(container.textContent).toContain('changed in another session')
    expect(container.querySelector<HTMLInputElement>('[aria-label="Value for Optional"]')!.value).toBe('unsaved')
    expect(close).not.toHaveBeenCalled()
  })

  it('uploads a file through a custom field and includes it in the encrypted payload', async () => {
    await render()
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Type for Optional"]')!
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await act(async () => { select.value = 'file'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [{ name: 'oauth.json', size: 2,
      arrayBuffer: async () => new Uint8Array([123, 125]).buffer }] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(container.textContent).toContain('oauth.json (2 bytes)')
    await submit()
    const data = encrypt.mock.calls[0][0]
    expect(data.fieldOptions.Optional.type).toBe('file')
    expect(readStoredFile(data.fields.Optional).name).toBe('oauth.json')
    vi.restoreAllMocks()
  })

  it('does not save after the vault locks during encryption', async () => {
    let finish!: (value: string) => void
    encrypt.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
    await render()
    await submit()
    await act(async () => useVaultKeyStore.getState().clearKeys())
    await act(async () => finish('encrypted-synthetic'))
    expect(save).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('does not save after the dialog unmounts during encryption', async () => {
    let finish!: (value: string) => void
    encrypt.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve }))
    await render()
    await submit()
    await act(async () => root.render(null))
    await act(async () => finish('encrypted-synthetic'))
    expect(save).not.toHaveBeenCalled()
  })
})
