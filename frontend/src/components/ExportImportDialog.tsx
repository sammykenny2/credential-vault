/**
 * Export/Import Dialog Component
 *
 * Handles exporting and importing template data with encryption.
 * Features:
 * - Export with Master Password (default) or custom password
 * - Import with password verification and conflict handling
 * - File download/upload
 * - Google Drive reminder
 */

import { useState, useRef } from 'react'
import {
  X,
  Download,
  Upload,
  Key,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useMasterPassword } from '@/hooks/useVaultKey'
import {
  exportTemplates,
  downloadExportFile,
  importTemplates,
  readExportFile,
  getExportMetadata,
} from '@/lib/templateExport'
import type { ExportFile, ImportConflictStrategy, ImportResult } from '@/types/template'
import { secretFieldProps } from '@/lib/inputProps'

interface ExportImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onImportComplete?: () => void
}

type TabType = 'export' | 'import'

export default function ExportImportDialog({
  isOpen,
  onClose,
  onImportComplete,
}: ExportImportDialogProps) {
  const { getMasterPassword } = useMasterPassword()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('export')

  // Export state
  const [useMasterPw, setUseMasterPw] = useState(true)
  const [exportPassword, setExportPassword] = useState('')
  const [showExportPassword, setShowExportPassword] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportSuccess, setExportSuccess] = useState(false)

  // Import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedFile, setParsedFile] = useState<ExportFile | null>(null)
  const [importPassword, setImportPassword] = useState('')
  const [showImportPassword, setShowImportPassword] = useState(false)
  const [conflictStrategy, setConflictStrategy] = useState<ImportConflictStrategy>('skip')
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // Reset state when closing
  const handleClose = () => {
    setActiveTab('export')
    setUseMasterPw(true)
    setExportPassword('')
    setExportError('')
    setExportSuccess(false)
    setSelectedFile(null)
    setParsedFile(null)
    setImportPassword('')
    setImportError('')
    setImportResult(null)
    onClose()
  }

  // ==========================================================================
  // Export handlers
  // ==========================================================================

  const handleExport = async () => {
    setExportError('')
    setExportSuccess(false)
    setIsExporting(true)

    try {
      let password: string

      if (useMasterPw) {
        const masterPw = getMasterPassword()
        if (!masterPw) {
          setExportError('Vault is locked. Please unlock first.')
          return
        }
        password = masterPw
      } else {
        if (!exportPassword) {
          setExportError('Please enter a password')
          return
        }
        if (exportPassword.length < 8) {
          setExportError('Password must be at least 8 characters')
          return
        }
        password = exportPassword
      }

      const exportFile = await exportTemplates(password)
      downloadExportFile(exportFile, `templates-${new Date().toISOString().split('T')[0]}`)
      setExportSuccess(true)
    } catch (error) {
      setExportError('Failed to export templates')
      console.error('Export error:', error)
    } finally {
      setIsExporting(false)
    }
  }

  // ==========================================================================
  // Import handlers
  // ==========================================================================

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    setImportError('')
    setImportResult(null)
    setParsedFile(null)

    try {
      const parsed = await readExportFile(file)
      setParsedFile(parsed)

      const metadata = getExportMetadata(parsed)
      if (!metadata.isCompatible) {
        setImportError(`File version ${metadata.version} is not compatible with this app`)
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Failed to read file')
    }
  }

  const handleTryMasterPassword = () => {
    const masterPw = getMasterPassword()
    if (masterPw) {
      setImportPassword(masterPw)
    } else {
      setImportError('Vault is locked. Please unlock first.')
    }
  }

  const handleImport = async () => {
    if (!selectedFile) {
      setImportError('Please select a file')
      return
    }

    if (!importPassword) {
      setImportError('Please enter the export password')
      return
    }

    setImportError('')
    setImportResult(null)
    setIsImporting(true)

    try {
      const result = await importTemplates(selectedFile, importPassword, conflictStrategy)
      setImportResult(result)

      if (result.success && onImportComplete) {
        onImportComplete()
      }
    } catch (error) {
      setImportError('Failed to import templates')
      console.error('Import error:', error)
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
          <h2 className="text-lg font-bold text-gray-900">Export / Import Templates</h2>
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
            Export
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
            Import
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'export' ? (
            <div className="space-y-4">
              {/* Export Password Options */}
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useMasterPw}
                    onChange={(e) => setUseMasterPw(e.target.checked)}
                    className="rounded-sm border-gray-300 text-primary-600"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Use Master Password
                  </span>
                  <span className="text-xs text-gray-500">(Recommended)</span>
                </label>

                {!useMasterPw && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Custom Export Password
                    </label>
                    <div className="relative">
                      <input
                        {...secretFieldProps}
                        type={showExportPassword ? 'text' : 'password'}
                        value={exportPassword}
                        onChange={(e) => setExportPassword(e.target.value)}
                        className="input pr-10"
                        placeholder="Enter password (min 8 characters)"
                      />
                      <button
                        type="button"
                        onClick={() => setShowExportPassword(!showExportPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showExportPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Warning for Master Password */}
              {useMasterPw && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium">Remember:</p>
                      <p>If you change your Master Password later, you'll need to re-export your templates.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error/Success Messages */}
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
                      <p className="font-medium">Export successful!</p>
                      <p>Your templates have been downloaded.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Export Button */}
              <button
                onClick={handleExport}
                disabled={isExporting || (!useMasterPw && !exportPassword)}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                {isExporting ? 'Exporting...' : 'Export Templates'}
              </button>

              {/* Google Drive Hint */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex gap-2">
                  <Upload className="w-5 h-5 text-blue-600 shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">Tip: Back up to Google Drive</p>
                    <p>After downloading, upload the .cvault file to Google Drive or another cloud storage for safekeeping.</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select Export File
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
                        <p className="text-sm text-gray-500 mt-1">
                          Exported: {new Date(parsedFile.exportedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      <p>Click to select .cvault file</p>
                    </div>
                  )}
                </button>
              </div>

              {/* Password Input */}
              {selectedFile && parsedFile && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Export Password
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          {...secretFieldProps}
                          type={showImportPassword ? 'text' : 'password'}
                          value={importPassword}
                          onChange={(e) => setImportPassword(e.target.value)}
                          className="input pr-10"
                          placeholder="Enter the password used during export"
                        />
                        <button
                          type="button"
                          onClick={() => setShowImportPassword(!showImportPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showImportPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <button
                        onClick={handleTryMasterPassword}
                        className="btn btn-secondary whitespace-nowrap flex items-center gap-1"
                        title="Try your current Master Password"
                      >
                        <Key className="w-4 h-4" />
                        Try Master
                      </button>
                    </div>
                  </div>

                  {/* Conflict Strategy */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      If template names conflict:
                    </label>
                    <div className="space-y-2">
                      {[
                        { value: 'skip', label: 'Skip', desc: 'Keep existing, ignore imported' },
                        { value: 'replace', label: 'Replace', desc: 'Overwrite with imported' },
                        { value: 'keep-both', label: 'Keep Both', desc: 'Rename imported template' },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className="flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="conflictStrategy"
                            value={option.value}
                            checked={conflictStrategy === option.value}
                            onChange={(e) =>
                              setConflictStrategy(e.target.value as ImportConflictStrategy)
                            }
                            className="mt-1"
                          />
                          <div>
                            <span className="font-medium text-sm">{option.label}</span>
                            <span className="text-xs text-gray-500 ml-2">{option.desc}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Error Message */}
              {importError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                  {importError}
                </div>
              )}

              {/* Import Result */}
              {importResult && (
                <div
                  className={`p-3 rounded-lg border ${
                    importResult.success
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  {importResult.success ? (
                    <div className="flex gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                      <div className="text-sm text-green-800">
                        <p className="font-medium">Import successful!</p>
                        <ul className="mt-1 space-y-0.5">
                          {importResult.imported > 0 && (
                            <li>{importResult.imported} template(s) imported</li>
                          )}
                          {importResult.replaced > 0 && (
                            <li>{importResult.replaced} template(s) replaced</li>
                          )}
                          {importResult.skipped > 0 && (
                            <li>{importResult.skipped} template(s) skipped</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <p className="text-red-600 text-sm">{importResult.error}</p>
                  )}
                </div>
              )}

              {/* Import Button */}
              <button
                onClick={handleImport}
                disabled={isImporting || !selectedFile || !parsedFile || !importPassword}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {isImporting ? 'Importing...' : 'Import Templates'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
