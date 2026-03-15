import { useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { User, FileText, ShieldCheck } from 'lucide-react'
import TemplateManager from '@/components/TemplateManager'
import WebAuthnPanel from '@/components/WebAuthnPanel'
import PasswordVerifyModal from '@/components/PasswordVerifyModal'

export default function SettingsPage() {
  const { user } = useAuthStore()
  const [showPasswordModal, setShowPasswordModal] = useState(false)

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

      {/* Profile Section */}
      <section className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <User className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Profile</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-500">Display Name</label>
            <p className="font-medium">{user?.display_name}</p>
          </div>
          <div>
            <label className="text-sm text-gray-500">Email</label>
            <p className="font-medium">{user?.email}</p>
          </div>
          <div>
            <label className="text-sm text-gray-500">Role</label>
            <p className="font-medium capitalize">{user?.role}</p>
          </div>
          <div>
            <label className="text-sm text-gray-500">Authentication</label>
            {user?.has_google_linked ? (
              <div className="flex items-center gap-2">
                <p className="font-medium">Google OAuth</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Linked
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <p className="font-medium">Local (password)</p>
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Link Google Account
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Vault Status Section */}
      <section className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Vault Encryption</h2>
        </div>
        {user?.has_vault_keys ? (
          <div className="space-y-2">
            <p className="text-green-600 font-medium">E2EE vault is configured</p>
            <p className="text-sm text-gray-500">
              Your credentials are encrypted end-to-end with your vault password.
              The server never sees your plaintext data.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-yellow-600 font-medium">Vault not configured</p>
            <p className="text-sm text-gray-500">
              Visit the Credentials page to set up your vault password and encryption keys.
            </p>
          </div>
        )}
      </section>

      {/* WebAuthn / Passkeys Section */}
      <section className="card mb-6">
        <WebAuthnPanel />
      </section>

      {/* Templates Section */}
      <section className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Credential Templates</h2>
        </div>
        <TemplateManager />
      </section>

      {showPasswordModal && (
        <PasswordVerifyModal
          onClose={() => setShowPasswordModal(false)}
          onVerified={async () => {
            setShowPasswordModal(false)
            localStorage.setItem('oauth_action', 'link')
            try {
              const redirectUri = `${window.location.origin}/login`
              const authUrl = await authService.getGoogleAuthUrl(redirectUri)
              window.location.href = authUrl
            } catch {
              // If Google auth URL fails, clean up
              localStorage.removeItem('oauth_action')
            }
          }}
        />
      )}
    </div>
  )
}
