/**
 * What the user sees when the server misbehaves: a key mismatch is not a wrong
 * password, an unsigned record is reported rather than hidden, and an RSA-only
 * vault must finish the upgrade before it unlocks. Keys and data are synthetic.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('@/services/credentialService', () => ({
  credentialService: {
    list: vi.fn(),
    listAll: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    revoke: vi.fn(),
    confirmOrigin: vi.fn(),
  },
}))

import api from '@/services/api'
import { credentialService } from '@/services/credentialService'
import MasterPasswordModal from '@/components/MasterPasswordModal'
import CredentialDetail from '@/components/CredentialDetail'
import CredentialsPage from '@/pages/CredentialsPage'
import { useVaultKeyStore } from '@/hooks/useVaultKey'
import { useAuthStore } from '@/stores/authStore'
import {
  arrayBufferToBase64,
  deriveKEK,
  encryptCredential,
  exportEncryptedPrivateKey,
  exportPublicKey,
  generateKeyPair,
  generateSalt,
  setupVault,
  type VaultKeys,
} from '@/lib/crypto'
import { RecordVerificationError, signRecord, type SignedRecordState } from '@/lib/recordSigning'
import { VAULT_PROOF_OAEP_LABEL } from '@/lib/vaultProof'
import { rememberSignedVault } from '@/lib/vaultUpgrade'
import type { Credential, User } from '@/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const PASSWORD = 'synthetic-vault-password'
const USER = { id: 'user-1', has_vault_keys: true } as User
const ID_GOOD = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
const ID_LEGACY = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002'
const ID_FORGED = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003'

let vault: VaultKeys
let container: HTMLDivElement
let root: Root

async function render(ui: React.ReactNode) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    )
  )
}

async function waitFor(check: () => boolean, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out. Page text: ${container.textContent}`)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

async function submitPassword(password: string) {
  const input = container.querySelector<HTMLInputElement>('#vault-password')!
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, password)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => container.querySelector('form')!.requestSubmit())
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text)
  )
  if (!button) throw new Error(`No button "${text}" in: ${container.textContent}`)
  return button
}

async function signedRow(id: string, name: string, origin: SignedRecordState['origin']): Promise<Credential> {
  const state: SignedRecordState = {
    id,
    revision: 1,
    encrypted_data: await encryptCredential({ name, fields: {} }, vault.publicKey, id),
    is_active: true,
    expires_at: null,
    revoked_at: null,
    origin,
  }
  const { signature } = await signRecord(state, vault.signer)
  return {
    ...state,
    signature,
    signature_version: 1,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  }
}

beforeAll(async () => {
  vault = await setupVault(PASSWORD)
}, 30000)

beforeEach(() => {
  localStorage.clear()
  mockedApi.get.mockReset()
  mockedApi.post.mockReset()
  vi.mocked(credentialService.list).mockReset()
  vi.mocked(credentialService.listAll).mockReset()
  vi.mocked(credentialService.confirmOrigin).mockReset()
  useVaultKeyStore.getState().clearKeys()
  useAuthStore.setState({ user: USER })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useVaultKeyStore.getState().clearKeys()
})

describe('unlocking', () => {
  function serveKeys(keys: Record<string, unknown>) {
    mockedApi.get.mockResolvedValue({ data: keys })
  }

  it('tells the user a substituted public key is not a wrong password', async () => {
    const attacker = await generateKeyPair()
    serveKeys({
      public_key: await exportPublicKey(attacker.publicKey),
      encrypted_private_key: vault.encryptedPrivateKeyBase64,
      key_salt: vault.saltBase64,
      kdf_version: 2,
    })
    const onUnlock = vi.fn()
    await render(<MasterPasswordModal isOpen onUnlock={onUnlock} />)

    await submitPassword(PASSWORD)
    await waitFor(() => container.textContent!.includes('do not match'))

    expect(container.textContent).toContain('Your password is not the problem')
    expect(container.textContent).not.toContain('Incorrect vault password')
    expect(onUnlock).not.toHaveBeenCalled()
    expect(useVaultKeyStore.getState().privateKey).toBeNull()
  }, 30000)

  it('still reports a wrong password as a wrong password', async () => {
    serveKeys({
      public_key: vault.publicKeyBase64,
      encrypted_private_key: vault.encryptedPrivateKeyBase64,
      key_salt: vault.saltBase64,
      kdf_version: 2,
    })
    await render(<MasterPasswordModal isOpen onUnlock={vi.fn()} />)

    await submitPassword('wrong-synthetic-password')
    await waitFor(() => container.textContent!.includes('Incorrect vault password'))
  }, 30000)

  it('stores the signer when a signed vault unlocks', async () => {
    serveKeys({
      public_key: vault.publicKeyBase64,
      encrypted_private_key: vault.encryptedPrivateKeyBase64,
      key_salt: vault.saltBase64,
      kdf_version: 2,
    })
    const onUnlock = vi.fn()
    await render(<MasterPasswordModal isOpen onUnlock={onUnlock} />)

    await submitPassword(PASSWORD)
    await waitFor(() => onUnlock.mock.calls.length > 0)

    expect(useVaultKeyStore.getState().signer?.signerId).toBe(vault.signer.signerId)
  }, 30000)

  describe('an RSA-only vault', () => {
    async function serveLegacyVault() {
      const pair = await generateKeyPair()
      const salt = generateSalt()
      const kek = await deriveKEK(PASSWORD, salt)
      serveKeys({
        public_key: await exportPublicKey(pair.publicKey),
        encrypted_private_key: await exportEncryptedPrivateKey(pair.privateKey, kek),
        key_salt: arrayBufferToBase64(salt),
        kdf_version: 2,
      })
      return pair
    }

    it('stays locked until the user accepts the upgrade', async () => {
      await serveLegacyVault()
      vi.mocked(credentialService.listAll).mockResolvedValue([])
      const onUnlock = vi.fn()
      await render(<MasterPasswordModal isOpen onUnlock={onUnlock} />)

      await submitPassword(PASSWORD)
      await waitFor(() => container.textContent!.includes('Upgrade Your Vault'))

      expect(useVaultKeyStore.getState().privateKey).toBeNull()
      expect(onUnlock).not.toHaveBeenCalled()
      expect(mockedApi.post).not.toHaveBeenCalled()

      await act(async () => buttonNamed('Cancel and Stay Locked').click())
      expect(useVaultKeyStore.getState().privateKey).toBeNull()
      expect(mockedApi.post).not.toHaveBeenCalled()
      expect(container.querySelector('#vault-password')).not.toBeNull()
    }, 30000)

    it('unlocks with a signer after the upgrade succeeds', async () => {
      const pair = await serveLegacyVault()
      vi.mocked(credentialService.listAll).mockResolvedValue([])
      const label = new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL)
      const challenge = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP', label }, pair.publicKey, crypto.getRandomValues(new Uint8Array(32))
      )
      mockedApi.post.mockImplementation(async (url: string) =>
        url === '/auth/vault/challenge'
          ? { data: { version: 1, challenge: arrayBufferToBase64(challenge), ticket: 'B'.repeat(32), expires_in: 300 } }
          : { data: {} }
      )
      const onUnlock = vi.fn()
      await render(<MasterPasswordModal isOpen onUnlock={onUnlock} />)

      await submitPassword(PASSWORD)
      await waitFor(() => container.textContent!.includes('Upgrade Your Vault'))
      await act(async () => buttonNamed('Upgrade and Unlock').click())
      await waitFor(() => onUnlock.mock.calls.length > 0)

      expect(useVaultKeyStore.getState().signer).not.toBeNull()
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/auth/vault/upgrade', expect.anything(), expect.anything()
      )
    }, 30000)

    it('stays locked and says so when the upgrade fails', async () => {
      const pair = await serveLegacyVault()
      vi.mocked(credentialService.listAll).mockResolvedValue([])
      const label = new TextEncoder().encode(VAULT_PROOF_OAEP_LABEL)
      const challenge = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP', label }, pair.publicKey, crypto.getRandomValues(new Uint8Array(32))
      )
      mockedApi.post.mockImplementation(async (url: string) => {
        if (url === '/auth/vault/challenge') {
          return { data: { version: 1, challenge: arrayBufferToBase64(challenge), ticket: 'B'.repeat(32), expires_in: 300 } }
        }
        throw new Error('409')
      })
      const onUnlock = vi.fn()
      await render(<MasterPasswordModal isOpen onUnlock={onUnlock} />)

      await submitPassword(PASSWORD)
      await waitFor(() => container.textContent!.includes('Upgrade Your Vault'))
      await act(async () => buttonNamed('Upgrade and Unlock').click())
      await waitFor(() => container.textContent!.includes('did not complete'))

      expect(onUnlock).not.toHaveBeenCalled()
      expect(useVaultKeyStore.getState().privateKey).toBeNull()
    }, 30000)

    it('refuses to upgrade when this browser has seen the vault signed', async () => {
      const pair = await serveLegacyVault()
      await rememberSignedVault(await exportPublicKey(pair.publicKey))
      // The server changing the account id must not make the marker miss.
      useAuthStore.setState({ user: { ...USER, id: 'a-different-id' } })
      const onUnlock = vi.fn()
      await render(<MasterPasswordModal isOpen onUnlock={onUnlock} />)

      await submitPassword(PASSWORD)
      await waitFor(() => container.textContent!.includes('older vault keys'))

      expect(container.textContent).not.toContain('Upgrade Your Vault')
      expect(credentialService.listAll).not.toHaveBeenCalled()
      expect(onUnlock).not.toHaveBeenCalled()
      expect(useVaultKeyStore.getState().privateKey).toBeNull()
    }, 30000)
  })
})

describe('setting up a vault', () => {
  it('warns when this browser has already unlocked a vault', async () => {
    await rememberSignedVault('some-public-key')
    useAuthStore.setState({ user: { ...USER, has_vault_keys: false } })

    await render(<MasterPasswordModal isOpen onUnlock={vi.fn()} />)

    expect(container.textContent).toContain('This browser has unlocked a vault before')
  })

  it('shows no warning on a browser that has not', async () => {
    useAuthStore.setState({ user: { ...USER, has_vault_keys: false } })

    await render(<MasterPasswordModal isOpen onUnlock={vi.fn()} />)

    expect(container.textContent).not.toContain('This browser has unlocked a vault before')
  })
})

describe('the credentials page', () => {
  beforeEach(() => {
    useVaultKeyStore.getState().setKeys(
      vault.privateKey, vault.publicKey, vault.publicKeyBase64, vault.signer
    )
  })

  it('reports forged records instead of hiding them, and never shows their contents', async () => {
    const good = await signedRow(ID_GOOD, 'Genuine record', 'authored')
    // Encrypted to the public key, so it decrypts cleanly, but nobody could sign it.
    const forged: Credential = {
      ...good,
      id: ID_FORGED,
      encrypted_data: await encryptCredential(
        { name: 'Planted by the server', fields: {} }, vault.publicKey, ID_FORGED
      ),
      signature: null,
      signature_version: null,
      origin: null,
    }
    vi.mocked(credentialService.list).mockResolvedValue([good, forged])

    await render(<CredentialsPage />)
    await waitFor(() => container.textContent!.includes('Genuine record'))

    expect(container.textContent).toContain('1 record(s) were not opened')
    expect(container.textContent).toContain(ID_FORGED)
    expect(container.textContent).not.toContain('Planted by the server')
  }, 30000)

  it('reports a record whose status was changed on the server', async () => {
    const good = await signedRow(ID_GOOD, 'Genuine record', 'authored')
    const revokedByServer = await signedRow(ID_FORGED, 'Altered status', 'authored')
    vi.mocked(credentialService.list).mockResolvedValue([
      good,
      { ...revokedByServer, is_active: false },
    ])

    await render(<CredentialsPage />)
    await waitFor(() => container.textContent!.includes('Genuine record'))

    expect(container.textContent).toContain('1 record(s) were not opened')
    expect(container.textContent).not.toContain('Altered status')
  }, 30000)

  it('reports a signed record with malformed content instead of crashing the page', async () => {
    const good = await signedRow(ID_GOOD, 'Genuine record', 'authored')
    const malformed = await signedRow(
      ID_FORGED, { oops: 1 } as unknown as string, 'legacy-unverified'
    )
    vi.mocked(credentialService.list).mockResolvedValue([good, malformed])

    await render(<CredentialsPage />)
    await waitFor(() => container.textContent!.includes('Genuine record'))

    expect(container.textContent).toContain('1 record(s) were not opened')
    expect(container.textContent).toContain(ID_FORGED)
  }, 30000)

  describe('revoking from the list', () => {
    beforeEach(() => {
      vi.stubGlobal('confirm', () => true)
      vi.mocked(credentialService.revoke).mockReset()
      vi.mocked(credentialService.get).mockReset()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    async function openRevokeFor(name: string) {
      await waitFor(() => container.textContent!.includes(name))
      const card = Array.from(container.querySelectorAll('.card')).find((candidate) =>
        candidate.textContent?.includes(name)
      )!
      const buttons = card.querySelectorAll('button')
      await act(async () => buttons[buttons.length - 1].click())
      await act(async () => buttonNamed('Revoke').click())
    }

    it('signs from the row on screen for the chosen record, with no fresh read', async () => {
      const first = await signedRow(ID_GOOD, 'First record', 'authored')
      const second = await signedRow(ID_LEGACY, 'Second record', 'authored')
      vi.mocked(credentialService.list).mockResolvedValue([first, second])
      vi.mocked(credentialService.revoke).mockResolvedValue({ ...second, is_active: false })

      await render(<CredentialsPage />)
      await openRevokeFor('Second record')
      await waitFor(() => vi.mocked(credentialService.revoke).mock.calls.length > 0)

      expect(vi.mocked(credentialService.revoke).mock.calls[0][0]).toEqual(second)
      expect(credentialService.get).not.toHaveBeenCalled()
    }, 30000)

    it('reloads the list after a failed revoke, so a stale row does not keep failing', async () => {
      const row = await signedRow(ID_GOOD, 'Stale record', 'authored')
      vi.mocked(credentialService.list).mockResolvedValue([row])
      vi.mocked(credentialService.revoke).mockRejectedValue(new Error('409'))

      await render(<CredentialsPage />)
      await openRevokeFor('Stale record')
      await waitFor(() => container.textContent!.includes('could not be confirmed'))
      await waitFor(() => vi.mocked(credentialService.list).mock.calls.length >= 2)
    }, 30000)
  })

  it('says so when the server answers an open request with another record', async () => {
    const row = await signedRow(ID_GOOD, 'Genuine record', 'authored')
    vi.mocked(credentialService.list).mockResolvedValue([row])
    vi.mocked(credentialService.get).mockRejectedValue(new RecordVerificationError())

    await render(<CredentialsPage />)
    await waitFor(() => container.textContent!.includes('Genuine record'))
    const name = Array.from(container.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('Genuine record')
    )!
    await act(async () => name.click())

    await waitFor(() => container.textContent!.includes('failed signature verification'))
  }, 30000)

  it('labels records of unverified origin', async () => {
    vi.mocked(credentialService.list).mockResolvedValue([
      await signedRow(ID_LEGACY, 'Old record', 'legacy-unverified'),
    ])

    await render(<CredentialsPage />)
    await waitFor(() => container.textContent!.includes('Old record'))

    expect(container.textContent).toContain('Origin unverified')
    expect(container.textContent).not.toContain('were not opened')
  }, 30000)
})

describe('the credential detail view', () => {
  beforeEach(() => {
    useVaultKeyStore.getState().setKeys(
      vault.privateKey, vault.publicKey, vault.publicKeyBase64, vault.signer
    )
  })

  it('lets the user confirm a record of unverified origin', async () => {
    const row = await signedRow(ID_LEGACY, 'Old record', 'legacy-unverified')
    const confirmed = { ...row, origin: 'authored', revision: 2 }
    vi.mocked(credentialService.confirmOrigin).mockResolvedValue(confirmed)
    const onOriginConfirmed = vi.fn()

    await render(
      <CredentialDetail credential={row} isOpen onClose={vi.fn()} onOriginConfirmed={onOriginConfirmed} />
    )
    await waitFor(() => container.textContent!.includes('Origin unverified'))
    await act(async () => buttonNamed('I checked this record').click())
    await waitFor(() => onOriginConfirmed.mock.calls.length > 0)

    // The record the user read is what gets signed, so it is passed whole.
    expect(credentialService.confirmOrigin).toHaveBeenCalledWith(row)
    expect(onOriginConfirmed).toHaveBeenCalledWith(confirmed)
  }, 30000)

  it('shows no such prompt for a record the vault wrote itself', async () => {
    const row = await signedRow(ID_GOOD, 'Genuine record', 'authored')

    await render(<CredentialDetail credential={row} isOpen onClose={vi.fn()} />)
    await waitFor(() => container.textContent!.includes('Genuine record'))

    expect(container.textContent).not.toContain('Origin unverified')
  }, 30000)

  it('shows the verification failure and no plaintext for a forged record', async () => {
    const good = await signedRow(ID_GOOD, 'Genuine record', 'authored')
    const forged: Credential = {
      ...good,
      encrypted_data: await encryptCredential(
        { name: 'Planted by the server', fields: {} }, vault.publicKey, ID_GOOD
      ),
    }

    await render(<CredentialDetail credential={forged} isOpen onClose={vi.fn()} />)
    await waitFor(() => container.textContent!.includes('failed signature verification'))

    expect(container.textContent).not.toContain('Planted by the server')
  }, 30000)
})
