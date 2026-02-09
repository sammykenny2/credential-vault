import { useState, useRef } from 'react'
import { Download, Upload, Shield, CheckCircle, AlertTriangle } from 'lucide-react'
import { backupService } from '@/services/backupService'
import type { RestoreResult } from '@/types'

export default function BackupRestorePanel() {
  const [mode, setMode] = useState<'backup' | 'restore'>('backup')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleBackup = async () => {
    if (!password || password.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const result = await backupService.createBackup(password)
      backupService.downloadBackup(result)
      setMessage({
        type: 'success',
        text: `Backup created: ${result.metadata.credential_count} credentials, ${result.metadata.template_count} templates, ${result.metadata.totp_account_count} TOTP accounts`,
      })
    } catch {
      setMessage({ type: 'error', text: 'Failed to create backup' })
    }
    setLoading(false)
  }

  const handleRestore = async (file: File) => {
    if (!password || password.length < 8) {
      setMessage({ type: 'error', text: 'Enter the backup password' })
      return
    }
    setLoading(true)
    setMessage(null)
    setRestoreResult(null)

    try {
      const text = await file.text()
      const backupData = JSON.parse(text)
      const result = await backupService.restoreBackup(
        backupData.encrypted_data,
        password,
        overwrite,
      )
      setRestoreResult(result)
      setMessage({
        type: result.errors.length === 0 ? 'success' : 'error',
        text: result.errors.length === 0
          ? 'Restore completed successfully!'
          : `Restored with ${result.errors.length} error(s)`,
      })
    } catch {
      setMessage({ type: 'error', text: 'Failed to restore backup. Check password and file.' })
    }
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-gray-600" />
        <h3 className="font-semibold text-gray-900">Backup & Restore</h3>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => { setMode('backup'); setMessage(null); setRestoreResult(null) }}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
            mode === 'backup' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          Backup
        </button>
        <button
          onClick={() => { setMode('restore'); setMessage(null); setRestoreResult(null) }}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
            mode === 'restore' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          Restore
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm text-gray-600">
            {mode === 'backup' ? 'Set backup password' : 'Backup password'}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
          />
        </div>

        {mode === 'backup' ? (
          <button
            onClick={handleBackup}
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            <Download className={`w-4 h-4 ${loading ? 'animate-bounce' : ''}`} />
            {loading ? 'Creating Backup...' : 'Download Backup'}
          </button>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                className="rounded"
              />
              Overwrite existing data
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleRestore(file)
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              <Upload className={`w-4 h-4 ${loading ? 'animate-bounce' : ''}`} />
              {loading ? 'Restoring...' : 'Select Backup File'}
            </button>
          </>
        )}
      </div>

      {message && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {restoreResult && (
        <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
          <p>Credentials restored: <strong>{restoreResult.credentials_restored}</strong></p>
          <p>Templates restored: <strong>{restoreResult.templates_restored}</strong></p>
          <p>TOTP accounts restored: <strong>{restoreResult.totp_accounts_restored}</strong></p>
          {restoreResult.errors.length > 0 && (
            <div className="mt-2 text-red-600">
              {restoreResult.errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
