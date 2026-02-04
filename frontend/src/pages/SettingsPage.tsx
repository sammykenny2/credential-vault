import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { authService } from '@/services/authService'
import { Shield, Key, User, FileText } from 'lucide-react'
import TemplateManager from '@/components/TemplateManager'

export default function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const queryClient = useQueryClient()

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')

  // MFA state
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; qr_code_base64: string } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaError, setMfaError] = useState('')

  const changePasswordMutation = useMutation({
    mutationFn: () => authService.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
    onError: () => {
      setPasswordError('Failed to change password. Check your current password.')
    },
  })

  const setupMfaMutation = useMutation({
    mutationFn: authService.setupMFA,
    onSuccess: (data) => {
      setMfaSetup({ secret: data.secret, qr_code_base64: data.qr_code_base64 })
    },
  })

  const enableMfaMutation = useMutation({
    mutationFn: () => authService.enableMFA(mfaCode, mfaSetup!.secret),
    onSuccess: async () => {
      const updatedUser = await authService.getMe()
      setUser(updatedUser)
      setMfaSetup(null)
      setMfaCode('')
    },
    onError: () => {
      setMfaError('Invalid code. Please try again.')
    },
  })

  const disableMfaMutation = useMutation({
    mutationFn: () => authService.disableMFA(mfaCode),
    onSuccess: async () => {
      const updatedUser = await authService.getMe()
      setUser(updatedUser)
      setMfaCode('')
    },
    onError: () => {
      setMfaError('Invalid code. Please try again.')
    },
  })

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }

    changePasswordMutation.mutate()
  }

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
        </div>
      </section>

      {/* MFA Section */}
      <section className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Two-Factor Authentication</h2>
        </div>

        {user?.mfa_enabled ? (
          <div>
            <p className="text-green-600 mb-4">MFA is enabled</p>
            <div className="space-y-4">
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter code to disable"
                className="input"
                maxLength={6}
              />
              {mfaError && <p className="text-red-600 text-sm">{mfaError}</p>}
              <button
                onClick={() => disableMfaMutation.mutate()}
                disabled={mfaCode.length !== 6}
                className="btn btn-danger"
              >
                Disable MFA
              </button>
            </div>
          </div>
        ) : mfaSetup ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Scan this QR code with your authenticator app:
            </p>
            <img
              src={`data:image/png;base64,${mfaSetup.qr_code_base64}`}
              alt="MFA QR Code"
              className="w-48 h-48 mx-auto"
            />
            <input
              type="text"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit code"
              className="input text-center"
              maxLength={6}
            />
            {mfaError && <p className="text-red-600 text-sm">{mfaError}</p>}
            <button
              onClick={() => enableMfaMutation.mutate()}
              disabled={mfaCode.length !== 6}
              className="btn btn-primary w-full"
            >
              Verify & Enable
            </button>
          </div>
        ) : (
          <div>
            <p className="text-gray-500 mb-4">
              Add an extra layer of security to your account
            </p>
            <button
              onClick={() => setupMfaMutation.mutate()}
              className="btn btn-primary"
            >
              Enable MFA
            </button>
          </div>
        )}
      </section>

      {/* Templates Section */}
      <section className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Credential Templates</h2>
        </div>
        <TemplateManager />
      </section>

      {/* Password Section */}
      <section className="card">
        <div className="flex items-center gap-3 mb-4">
          <Key className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold">Change Password</h2>
        </div>

        <form onSubmit={handlePasswordChange} className="space-y-4">
          {passwordError && (
            <p className="text-red-600 text-sm">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="text-green-600 text-sm">{passwordSuccess}</p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary">
            Change Password
          </button>
        </form>
      </section>
    </div>
  )
}
