/**
 * Migration Dialog Component
 *
 * Shown when user has localStorage templates that need to be migrated to backend.
 * Handles the sync process and shows progress/results.
 */

import { useState } from 'react'
import { X, Cloud, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { useSyncTemplates } from '@/hooks/useTemplates'
import {
  prepareSyncRequest,
  clearLocalTemplatesAfterMigration,
  hasLocalTemplates,
} from '@/lib/templateStorage'

interface MigrationDialogProps {
  isOpen: boolean
  onClose: () => void
  onMigrationComplete: () => void
}

type MigrationState = 'confirm' | 'migrating' | 'success' | 'error'

export default function MigrationDialog({
  isOpen,
  onClose,
  onMigrationComplete,
}: MigrationDialogProps) {
  const [state, setState] = useState<MigrationState>('confirm')
  const [result, setResult] = useState<{ synced: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const syncMutation = useSyncTemplates()

  if (!isOpen) return null

  const handleMigrate = async () => {
    setState('migrating')
    setError(null)

    try {
      const syncRequest = prepareSyncRequest()
      const response = await syncMutation.mutateAsync(syncRequest)

      setResult({ synced: response.synced, skipped: response.skipped })
      clearLocalTemplatesAfterMigration()
      setState('success')
    } catch (err) {
      console.error('Migration failed:', err)
      setError(err instanceof Error ? err.message : 'Migration failed')
      setState('error')
    }
  }

  const handleClose = () => {
    if (state === 'success') {
      onMigrationComplete()
    }
    onClose()
    // Reset state for next time
    setState('confirm')
    setResult(null)
    setError(null)
  }

  const handleSkip = () => {
    // User chose to skip migration - mark as completed to not show again
    clearLocalTemplatesAfterMigration()
    onClose()
  }

  const templateCount = hasLocalTemplates()
    ? prepareSyncRequest().templates.length
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary-600" />
            <h2 className="text-lg font-semibold">Sync Templates to Cloud</h2>
          </div>
          {state !== 'migrating' && (
            <button
              onClick={handleClose}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4">
          {state === 'confirm' && (
            <>
              <p className="text-gray-600 mb-4">
                You have <strong>{templateCount}</strong> custom template(s) stored locally.
                Would you like to sync them to the cloud for cross-device access?
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Benefits of syncing:</strong>
                </p>
                <ul className="text-sm text-blue-700 list-disc list-inside mt-1">
                  <li>Access templates on any device</li>
                  <li>Templates won't be lost if browser data is cleared</li>
                  <li>Automatic backup</li>
                </ul>
              </div>
            </>
          )}

          {state === 'migrating' && (
            <div className="flex flex-col items-center py-6">
              <Loader2 className="w-12 h-12 text-primary-600 animate-spin mb-4" />
              <p className="text-gray-600">Syncing templates to cloud...</p>
            </div>
          )}

          {state === 'success' && result && (
            <div className="flex flex-col items-center py-4">
              <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
              <p className="text-gray-900 font-medium mb-2">Migration Complete!</p>
              <p className="text-gray-600 text-sm text-center">
                {result.synced} template(s) synced successfully.
                {result.skipped > 0 && (
                  <span className="block text-gray-500">
                    {result.skipped} skipped (already exist on server).
                  </span>
                )}
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center py-4">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <p className="text-gray-900 font-medium mb-2">Migration Failed</p>
              <p className="text-red-600 text-sm text-center mb-4">{error}</p>
              <p className="text-gray-500 text-sm text-center">
                Your local templates are still safe. You can try again later.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
          {state === 'confirm' && (
            <>
              <button
                onClick={handleSkip}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Skip for Now
              </button>
              <button
                onClick={handleMigrate}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Sync to Cloud
              </button>
            </>
          )}

          {state === 'migrating' && (
            <button disabled className="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed">
              Syncing...
            </button>
          )}

          {state === 'success' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Done
            </button>
          )}

          {state === 'error' && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Close
              </button>
              <button
                onClick={handleMigrate}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
