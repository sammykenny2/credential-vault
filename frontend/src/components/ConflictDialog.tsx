/**
 * Conflict Dialog Component
 *
 * Shown when a version conflict occurs during template update.
 * Allows user to choose between keeping server version or overwriting.
 */

import { AlertTriangle, X, Server, Edit3 } from 'lucide-react'
import type { BackendTemplate } from '@/types/template'

interface ConflictDialogProps {
  isOpen: boolean
  onClose: () => void
  serverData: BackendTemplate
  clientVersion: number
  serverVersion: number
  onUseServer: () => void
  onOverwrite: () => void
}

export default function ConflictDialog({
  isOpen,
  onClose,
  serverData,
  clientVersion,
  serverVersion,
  onUseServer,
  onOverwrite,
}: ConflictDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-amber-50">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Version Conflict</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-amber-100 rounded text-amber-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-gray-600 mb-4">
            This template was modified on another device or browser tab.
            Your version ({clientVersion}) is older than the server version ({serverVersion}).
          </p>

          {/* Server version preview */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 text-gray-700 mb-2">
              <Server className="w-4 h-4" />
              <span className="font-medium">Server Version</span>
              <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">v{serverVersion}</span>
            </div>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-gray-500">Name:</span>{' '}
                <span className="text-gray-900">{serverData.name}</span>
              </p>
              <p>
                <span className="text-gray-500">Fields:</span>{' '}
                <span className="text-gray-900">{serverData.fields.length} field(s)</span>
              </p>
              <p>
                <span className="text-gray-500">Updated:</span>{' '}
                <span className="text-gray-900">
                  {new Date(serverData.updated_at).toLocaleString()}
                </span>
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            Choose how to resolve this conflict:
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={onUseServer}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            <Server className="w-4 h-4" />
            <span>Use Server Version</span>
            <span className="text-xs text-gray-400 ml-2">(Discard your changes)</span>
          </button>

          <button
            onClick={onOverwrite}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            <Edit3 className="w-4 h-4" />
            <span>Overwrite Server</span>
            <span className="text-xs text-amber-200 ml-2">(Keep your changes)</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
          >
            Cancel and Review
          </button>
        </div>
      </div>
    </div>
  )
}
