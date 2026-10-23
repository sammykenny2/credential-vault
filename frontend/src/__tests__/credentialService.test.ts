/**
 * Credential Service Storage Integrity Tests
 *
 * Tests the post-write re-read verification and rollback logic
 * in credentialService.create() and credentialService.update().
 *
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the api module before importing credentialService
vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

// Destructive calls attach a proof of vault unlock; stub it with a fixed value
const PROOF_HEADERS = { 'X-Vault-Proof': 'test-proof' }
vi.mock('@/lib/vaultProof', () => ({
  vaultProofHeaders: vi.fn(async () => ({ 'X-Vault-Proof': 'test-proof' })),
}))

import api from '@/services/api'
import { credentialService } from '@/services/credentialService'

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

// ── Helpers ─────────────────────────────────────────────────────────────

const BLOB = 'ZW5jcnlwdGVkLWJsb2ItYmFzZTY0'
const DIFFERENT_BLOB = 'Y29ycnVwdGVkLWJsb2ItYmFzZTY0'
const OLD_BLOB = 'b2xkLWVuY3J5cHRlZC1ibG9i'
const CREDENTIAL_ID = 'cred-uuid-123'

function makeResponse(encrypted_data: string, id = CREDENTIAL_ID) {
  return {
    data: {
      id,
      encrypted_data,
      is_active: true,
      expires_at: null,
      revoked_at: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('credentialService storage integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('create()', () => {
    it('should succeed when re-read blob matches sent data', async () => {
      mockedApi.post.mockResolvedValue(makeResponse(BLOB))
      mockedApi.get.mockResolvedValue(makeResponse(BLOB))

      const result = await credentialService.create({ encrypted_data: BLOB })

      expect(result.encrypted_data).toBe(BLOB)
      // Should have done an independent re-read
      expect(mockedApi.get).toHaveBeenCalledWith(`/credentials/${CREDENTIAL_ID}`)
    })

    it('should delete and throw when re-read blob differs from sent data', async () => {
      mockedApi.post.mockResolvedValue(makeResponse(BLOB))
      mockedApi.get.mockResolvedValue(makeResponse(DIFFERENT_BLOB))
      mockedApi.delete.mockResolvedValue({})

      await expect(
        credentialService.create({ encrypted_data: BLOB })
      ).rejects.toThrow('Storage integrity check failed')

      // Should have deleted the corrupted credential, proving vault unlock
      expect(mockedApi.delete).toHaveBeenCalledWith(`/credentials/${CREDENTIAL_ID}`, {
        headers: PROOF_HEADERS,
      })
    })

    it('should perform re-read against the created credential ID', async () => {
      const customId = 'new-cred-456'
      mockedApi.post.mockResolvedValue(makeResponse(BLOB, customId))
      mockedApi.get.mockResolvedValue(makeResponse(BLOB, customId))

      await credentialService.create({ encrypted_data: BLOB })

      expect(mockedApi.get).toHaveBeenCalledWith(`/credentials/${customId}`)
    })
  })

  describe('update() with encrypted_data', () => {
    it('should fetch previous data, update, re-read, and succeed when blob matches', async () => {
      // 1st GET: fetch previous data for rollback
      mockedApi.get.mockResolvedValueOnce(makeResponse(OLD_BLOB))
      // PATCH: apply update
      mockedApi.patch.mockResolvedValue(makeResponse(BLOB))
      // 2nd GET: re-read verification
      mockedApi.get.mockResolvedValueOnce(makeResponse(BLOB))

      const result = await credentialService.update(CREDENTIAL_ID, { encrypted_data: BLOB })

      expect(result.encrypted_data).toBe(BLOB)
      // Should have called GET twice (previous + verification)
      expect(mockedApi.get).toHaveBeenCalledTimes(2)
      // Ciphertext overwrite carries the proof header
      expect(mockedApi.patch).toHaveBeenCalledWith(
        `/credentials/${CREDENTIAL_ID}`,
        { encrypted_data: BLOB },
        { headers: PROOF_HEADERS }
      )
    })

    it('should rollback and throw when re-read blob differs after update', async () => {
      // 1st GET: fetch previous data
      mockedApi.get.mockResolvedValueOnce(makeResponse(OLD_BLOB))
      // PATCH: apply update
      mockedApi.patch.mockResolvedValueOnce(makeResponse(BLOB))
      // 2nd GET: re-read returns different data
      mockedApi.get.mockResolvedValueOnce(makeResponse(DIFFERENT_BLOB))
      // Rollback PATCH
      mockedApi.patch.mockResolvedValueOnce(makeResponse(OLD_BLOB))

      await expect(
        credentialService.update(CREDENTIAL_ID, { encrypted_data: BLOB })
      ).rejects.toThrow('Storage integrity check failed')

      // Should have called patch twice: update + rollback
      expect(mockedApi.patch).toHaveBeenCalledTimes(2)
      // Rollback should restore previous blob, still carrying the proof
      expect(mockedApi.patch).toHaveBeenLastCalledWith(
        `/credentials/${CREDENTIAL_ID}`,
        { encrypted_data: OLD_BLOB },
        { headers: PROOF_HEADERS }
      )
    })

    it('should rollback to correct previous blob even when update response looks fine', async () => {
      // The update response might look correct but re-read reveals corruption
      mockedApi.get.mockResolvedValueOnce(makeResponse(OLD_BLOB))
      mockedApi.patch.mockResolvedValueOnce(makeResponse(BLOB))
      // Re-read shows corruption
      mockedApi.get.mockResolvedValueOnce(makeResponse(DIFFERENT_BLOB))
      mockedApi.patch.mockResolvedValueOnce(makeResponse(OLD_BLOB))

      await expect(
        credentialService.update(CREDENTIAL_ID, { encrypted_data: BLOB })
      ).rejects.toThrow('Rolled back to previous data')

      // Verify rollback used the OLD_BLOB, not the BLOB or DIFFERENT_BLOB
      expect(mockedApi.patch.mock.calls[1][1]).toEqual({ encrypted_data: OLD_BLOB })
    })
  })

  describe('update() without encrypted_data', () => {
    it('should skip verification when only metadata is updated', async () => {
      mockedApi.patch.mockResolvedValue(makeResponse(BLOB))

      const result = await credentialService.update(CREDENTIAL_ID, { expires_at: '2025-12-31' })

      expect(result.encrypted_data).toBe(BLOB)
      // No GET calls — no blob verification needed
      expect(mockedApi.get).not.toHaveBeenCalled()
      // Only one PATCH — no rollback, and no proof needed for metadata
      expect(mockedApi.patch).toHaveBeenCalledTimes(1)
      expect(mockedApi.patch).toHaveBeenCalledWith(`/credentials/${CREDENTIAL_ID}`, {
        expires_at: '2025-12-31',
      })
    })
  })
})
