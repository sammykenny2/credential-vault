/**
 * Credential Backup/Restore Dialog
 *
 * Modal with Export/Import tabs for encrypted credential backup.
 */

import { useState, useRef } from 'react'
import {
  X,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react'
import { useCredentialCrypto } from '@/hooks/useCredentialCrypto'
import { credentialService } from '@/services/credentialService'
import {
  encryptBackup,
  decryptBackup,
  readBackupFile,
  downloadBackupFile,
} from '@/lib/credentialBackup'
import type { CredentialBackupFile, CredentialBackupEntry } from '@/lib/credentialBackup'
import { recordBackupCompleted } from '@/lib/backupReminder'

interface CredentialBackupDialogProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete?: () => void
  /** Decrypted credentials currently in memory */
  decryptedCache: Array<{
    id: string
    data: import('@/lib/crypto').CredentialData
    expires_at: string | null
    created_at: string
  }>
}

type TabType = 'export' | 'import'

export default function CredentialBackupDialog({
  isOpen,
  onClose,
  onImportComplete,
  decryptedCache,
}: CredentialBackupDialogProps) {
  const { encrypt } = useCredentialCrypto()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('export')

  // Export state
  const [exportPassword, setExportPassword] = useState('')
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('')
  const [showExportPassword, setShowExportPassword] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportSuccess, setExportSuccess] = useState(false)

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedFile, setParsedFile] = useState<CredentialBackupFile | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [showImportPassword, setShowImportPassword] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState(false)
  const [importProgress, setImportProgress] = useState('')

  const handleClose = () => {
    setActiveTab('export')
    setExportPassword('')
    setExportPasswordConfirm('')
    setExportError('')
    setExportSuccess(false)
    setSelectedFile(null)
    setParsedFile(null)
    setImportPassword('')
    setImportError('')
    setImportSuccess(false)
    setImportProgress('')
    onClose()
  }

  // ==========================================================================
  // Export
  // ==========================================================================

  const handleExport = async () => {
    setExportError('')
    setExportSuccess(false)

    if (!exportPassword) {
      setExportError('Please enter a password.')
      return
    }
    if (exportPassword.length < 8) {
      setExportError('Password must be at least 8 characters.')
      return
    }
    if (exportPassword !== exportPasswordConfirm) {
      setExportError('Passwords do not match.')
      return
    }
    if (decryptedCache.length === 0) {
      setExportError('No credentials to export.')
      return
    }

    setIsExporting(true)
    try {
      const entries: CredentialBackupEntry[] = decryptedCache.map((c) => ({
        data: c.data,
        expires_at: c.expires_at,
        created_at: c.created_at,
      }))

      const backupFile = await encryptBackup(entries, exportPassword)
      downloadBackupFile(backupFile)
      recordBackupCompleted()
      setExportSuccess(true)
    } catch (error) {
      setExportError('Failed to create backup.')
      console.error('Backup export error:', error)
    } finally {
      setIsExporting(false)
    }
  }

  // ==========================================================================
  // Import
  // ==========================================================================

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setImportError('')
    setImportSuccess(false)
    setParsedFile(null)
    setImportProgress('')

    try {
      const parsed = await readBackupFile(file)
      setParsedFile(parsed)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to read file')
    }
  }

  const handleImport = async () => {
    if (!parsedFile) return

    if (!importPassword) {
      setImportError('Please enter the backup password.')
      return
    }

    setImportError('')
    setImportSuccess(false)
    setIsImporting(true)
    setImportProgress('Decrypting backup...')

    try {
      // 1. Decrypt the backup
      const payload = await decryptBackup(parsedFile, importPassword)

      if (!payload.credentials || payload.credentials.length === 0) {
        setImportError('Backup contains no credentials.')
        return
      }

      // 2. Re-encrypt each credential with user's RSA public key
      setImportProgress(`Re-encrypting ${payload.credentials.length} credentials...`)
      const encryptedCredentials: Array<{
        id: string
        encrypted_data: string
        expires_at?: string | null
      }> = []

      for (const entry of payload.credentials) {
        const id = crypto.randomUUID()
        const encryptedData = await encrypt(entry.data, id)
        if (!encryptedData) {
          throw new Error('Vault is locked. Please unlock your vault and try again.')
        }
        encryptedCredentials.push({
          id,
          encrypted_data: encryptedData,
          expires_at: entry.expires_at,
        })
      }

      // 3. Upload all via batch import
      setImportProgress('Uploading credentials...')
      const result = await credentialService.importBatch(encryptedCredentials)

      if (result.errors.length > 0) {
        setImportError(`Imported ${result.imported}, but ${result.errors.length} errors occurred.`)
      } else {
        setImportSuccess(true)
        setImportProgress(`Successfully imported ${result.imported} credential(s).`)
        onImportComplete?.()
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed.')
      console.error('Backup import error:', error)
    } finally {
      setIsImporting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg m-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Backup / Restore Credentials</h2>
          <button
            onClick={handleClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('export')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${
              activeTab === 'export'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Download className="w-4 h-4" />
            Backup
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${
              activeTab === 'import'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Upload className="w-4 h-4" />
            Restore
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'export' ? (
            <div className="space-y-4">
              {/* Credential count */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                <strong>{decryptedCache.length}</strong> credential(s) will be included in the backup.
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Backup Password
                </label>
                <div className="relative">
                  <input
                    type={showExportPassword ? 'text' : 'password'}
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    className="input pr-10"
                    placeholder="Enter a strong password (min 8 characters)"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExportPassword(!showExportPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showExportPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type={showExportPassword ? 'text' : 'password'}
                  value={exportPasswordConfirm}
                  onChange={(e) => setExportPasswordConfirm(e.target.value)}
                  className="input"
                  placeholder="Re-enter the password"
                />
              </div>

              {/* Warning */}
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium">Remember this password!</p>
                    <p>You will need it to restore your credentials. There is no way to recover the backup without it.</p>
                  </div>
                </div>
              </div>

              {/* Error/Success */}
              {exportError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {exportError}
                </div>
              )}
              {exportSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    <div className="text-sm text-green-800">
                      <p className="font-medium">Backup created!</p>
                      <p>Your encrypted backup file has been downloaded.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Export button */}
              <button
                onClick={handleExport}
                disabled={isExporting || !exportPassword || !exportPasswordConfirm}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating backup...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Create Backup
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Backup File
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".cvault,.json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-primary-400 hover:bg-primary-50 transition-colors"
                >
                  {selectedFile ? (
                    <div>
                      <p className="font-medium text-gray-900">{selectedFile.name}</p>
                      {parsedFile && (
                        <div className="text-sm text-gray-500 mt-1 space-y-0.5">
                          <p>Exported: {new Date(parsedFile.exportedAt).toLocaleDateString()}</p>
                          <p>{parsedFile.credentialCount} credential(s)</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      <p>Click to select .cvault backup file</p>
                    </div>
                  )}
                </button>
              </div>

              {/* Password input */}
              {selectedFile && parsedFile && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Backup Password
                    </label>
                    <div className="relative">
                      <input
                        type={showImportPassword ? 'text' : 'password'}
                        value={importPassword}
                        onChange={(e) => setImportPassword(e.target.value)}
                        className="input pr-10"
                        placeholder="Enter the password used during backup"
                      />
                      <button
                        type="button"
                        onClick={() => setShowImportPassword(!showImportPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showImportPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Restore warning */}
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex gap-2">
                      <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
                      <div className="text-sm text-yellow-800">
                        <p className="font-medium">Restore adds credentials</p>
                        <p>The {parsedFile.credentialCount} credential(s) from this backup will be added to your vault. Existing credentials are not affected.</p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Progress */}
              {importProgress && !importError && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm flex items-center gap-2">
                  {isImporting && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
                  {importProgress}
                </div>
              )}

              {/* Error */}
              {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {importError}
                </div>
              )}

              {/* Success */}
              {importSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                    <div className="text-sm text-green-800">
                      <p className="font-medium">Restore complete!</p>
                      <p>{importProgress}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Import button */}
              <button
                onClick={handleImport}
                disabled={isImporting || !selectedFile || !parsedFile || !importPassword || importSuccess}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Restore Credentials
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
