import { useState, useEffect } from 'react'
import { Fingerprint, Plus, Trash2, Shield } from 'lucide-react'
import { webauthnService } from '@/services/webauthnService'
import type { WebAuthnCredentialInfo } from '@/types'

export default function WebAuthnPanel() {
  const [credentials, setCredentials] = useState<WebAuthnCredentialInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadCredentials()
  }, [])

  const loadCredentials = async () => {
    try {
      const data = await webauthnService.listCredentials()
      setCredentials(data)
    } catch {
      // Silently fail
    }
    setLoading(false)
  }

  const handleRegister = async () => {
    if (!deviceName) return
    setRegistering(true)
    setError('')

    try {
      // Get registration options from server
      const { options } = await webauthnService.getRegistrationOptions(deviceName)

      // Check if WebAuthn is supported
      if (!window.PublicKeyCredential) {
        setError('WebAuthn is not supported in this browser')
        setRegistering(false)
        return
      }

      // Convert challenge and user.id from base64url to ArrayBuffer
      const challenge = Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
      const userId = Uint8Array.from(atob(options.user.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        ...options,
        challenge,
        user: { ...options.user, id: userId },
        excludeCredentials: (options.excludeCredentials || []).map((c: { id: string; type: string }) => ({
          ...c,
          id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)),
        })),
      }

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      }) as PublicKeyCredential

      if (!credential) {
        setError('Registration cancelled')
        setRegistering(false)
        return
      }

      const response = credential.response as AuthenticatorAttestationResponse

      // Encode to base64url
      const encode = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

      await webauthnService.completeRegistration({
        device_name: deviceName,
        credential_id: encode(credential.rawId),
        public_key: encode(response.getPublicKey?.() || response.attestationObject),
        attestation_object: encode(response.attestationObject),
        client_data_json: encode(response.clientDataJSON),
        transports: (response as { getTransports?: () => string[] }).getTransports?.() || [],
      })

      setShowAdd(false)
      setDeviceName('')
      loadCredentials()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    }
    setRegistering(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this security key?')) return
    try {
      await webauthnService.deleteCredential(id)
      setCredentials(credentials.filter(c => c.id !== id))
    } catch {
      // Show error
    }
  }

  if (loading) {
    return <div className="flex justify-center p-8">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Fingerprint className="w-5 h-5" />
          Passkeys & Security Keys
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Key
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 border">
          <p className="text-sm text-gray-600">
            Register a security key (YubiKey) or passkey (Touch ID, Windows Hello)
            as an additional authentication method.
          </p>
          <input
            type="text"
            placeholder="Device name (e.g., YubiKey 5)"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleRegister}
              disabled={registering || !deviceName}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {registering ? 'Registering...' : 'Register'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setError('') }}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {credentials.length === 0 ? (
        <div className="text-center py-6 text-gray-400">
          <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No security keys registered</p>
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map(cred => (
            <div key={cred.id} className="bg-white border rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Fingerprint className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="font-medium text-gray-900">{cred.device_name}</p>
                  <p className="text-xs text-gray-500">
                    Added {new Date(cred.created_at).toLocaleDateString()}
                    {cred.last_used_at && ` · Last used ${new Date(cred.last_used_at).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDelete(cred.id)}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
