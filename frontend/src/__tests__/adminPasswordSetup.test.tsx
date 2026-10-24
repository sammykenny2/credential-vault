/**
 * AdminPasswordSetup: disabled while the vault is locked, and saves the
 * password with the vault proof.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authService', () => ({ authService: { setPassword: vi.fn() } }))
vi.mock('@/lib/vaultProof', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vaultProof')>()),
  vaultProofHeaders: vi.fn(),
}))

import AdminPasswordSetup from '@/components/AdminPasswordSetup'
import { authService } from '@/services/authService'
import { vaultProofHeaders } from '@/lib/vaultProof'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import type { User } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PASSWORD = 'a-long-sign-in-password'

let container: HTMLDivElement
let root: Root

async function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<AdminPasswordSetup />))
}

async function typeInto(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => container.querySelector('form')!.requestSubmit())
}

describe('AdminPasswordSetup', () => {
  beforeEach(() => {
    vi.mocked(authService.setPassword).mockReset()
    vi.mocked(vaultProofHeaders).mockReset().mockResolvedValue({ 'X-Vault-Proof': 'proof' })
    useVaultKeyStore.getState().setKeys({} as CryptoKey, {} as CryptoKey, 'pk')
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useVaultKeyStore.getState().clearKeys()
  })

  it('keeps the fields and buttons disabled while the vault is locked', async () => {
    useVaultKeyStore.getState().clearKeys()
    await render()

    expect(container.textContent).toContain('The vault is locked')
    const controls = container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')
    expect(controls.length).toBe(4)
    for (const control of controls) expect(control.disabled).toBe(true)
  })

  it('saves the password with the vault proof', async () => {
    vi.mocked(authService.setPassword).mockResolvedValue({ has_password: true } as User)
    await render()

    await typeInto('#admin-password', PASSWORD)
    await typeInto('#admin-password-confirm', PASSWORD)
    await submit()

    expect(authService.setPassword).toHaveBeenCalledWith(PASSWORD, { 'X-Vault-Proof': 'proof' })
  })
})
