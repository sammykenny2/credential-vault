import { useState, useEffect } from 'react'
import { Share2, Users, X, Shield } from 'lucide-react'
import { sharingService } from '@/services/sharingService'
import type { SharedByMe, SharedWithMe } from '@/types'

export default function SharingPanel() {
  const [tab, setTab] = useState<'shared-by-me' | 'shared-with-me'>('shared-with-me')
  const [sharedByMe, setSharedByMe] = useState<SharedByMe[]>([])
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMe[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [byMe, withMe] = await Promise.all([
        sharingService.listSharedByMe(),
        sharingService.listSharedWithMe(),
      ])
      setSharedByMe(byMe)
      setSharedWithMe(withMe)
    } catch {
      // Silently fail
    }
    setLoading(false)
  }

  const handleRevoke = async (shareId: string) => {
    if (!confirm('Revoke this share?')) return
    try {
      await sharingService.revokeShare(shareId)
      setSharedByMe(sharedByMe.filter(s => s.id !== shareId))
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
      <div className="flex items-center gap-2 mb-4">
        <Share2 className="w-5 h-5 text-gray-600" />
        <h3 className="font-semibold text-gray-900">Shared Credentials</h3>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab('shared-with-me')}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'shared-with-me' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          Shared with me ({sharedWithMe.length})
        </button>
        <button
          onClick={() => setTab('shared-by-me')}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'shared-by-me' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          Shared by me ({sharedByMe.length})
        </button>
      </div>

      {tab === 'shared-with-me' ? (
        sharedWithMe.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No credentials shared with you</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sharedWithMe.map(share => (
              <div key={share.id} className="bg-white border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{share.credential_name}</p>
                    <p className="text-xs text-gray-500">
                      From {share.shared_by_name} ({share.shared_by_email})
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    share.permission === 'read_write'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {share.permission === 'read_write' ? 'Read/Write' : 'Read Only'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        sharedByMe.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">You haven't shared any credentials</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sharedByMe.map(share => (
              <div key={share.id} className="bg-white border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{share.credential_name}</p>
                    <p className="text-xs text-gray-500">
                      With {share.shared_with_name} ({share.shared_with_email})
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(share.id)}
                    className="p-1 text-gray-400 hover:text-red-500"
                    title="Revoke"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
