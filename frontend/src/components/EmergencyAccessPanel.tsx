import { useState, useEffect } from 'react'
import { HeartPulse, Plus, Trash2, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { emergencyService } from '@/services/emergencyService'
import type { EmergencyAccessGrant } from '@/types'

const statusIcons: Record<string, React.ReactNode> = {
  accepted: <CheckCircle className="w-4 h-4 text-green-500" />,
  recovery_initiated: <Clock className="w-4 h-4 text-amber-500" />,
  recovery_approved: <CheckCircle className="w-4 h-4 text-blue-500" />,
  recovery_rejected: <XCircle className="w-4 h-4 text-red-500" />,
}

const statusLabels: Record<string, string> = {
  invited: 'Invited',
  accepted: 'Active',
  recovery_initiated: 'Recovery Pending',
  recovery_approved: 'Recovery Approved',
  recovery_rejected: 'Recovery Rejected',
}

export default function EmergencyAccessPanel() {
  const [tab, setTab] = useState<'my-grants' | 'granted-to-me'>('my-grants')
  const [myGrants, setMyGrants] = useState<EmergencyAccessGrant[]>([])
  const [grantedToMe, setGrantedToMe] = useState<EmergencyAccessGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [email, setEmail] = useState('')
  const [waitDays, setWaitDays] = useState(7)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [grants, toMe] = await Promise.all([
        emergencyService.listMyGrants(),
        emergencyService.listGrantedToMe(),
      ])
      setMyGrants(grants)
      setGrantedToMe(toMe)
    } catch {
      // Silently fail
    }
    setLoading(false)
  }

  const handleCreate = async () => {
    if (!email) return
    try {
      await emergencyService.createGrant(email, waitDays)
      setShowAdd(false)
      setEmail('')
      loadData()
    } catch {
      // Show error
    }
  }

  const handleRevoke = async (grantId: string) => {
    if (!confirm('Revoke this emergency access?')) return
    try {
      await emergencyService.revokeGrant(grantId)
      loadData()
    } catch {
      // Show error
    }
  }

  const handleInitiateRecovery = async (grantId: string) => {
    if (!confirm('Initiate emergency recovery? The vault owner will be notified.')) return
    try {
      await emergencyService.initiateRecovery(grantId)
      loadData()
    } catch {
      // Show error
    }
  }

  const handleApprove = async (grantId: string) => {
    try {
      await emergencyService.approveRecovery(grantId)
      loadData()
    } catch {
      // Show error
    }
  }

  const handleReject = async (grantId: string) => {
    try {
      await emergencyService.rejectRecovery(grantId)
      loadData()
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
          <HeartPulse className="w-5 h-5" />
          Emergency Access
        </h3>
        {tab === 'my-grants' && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Contact
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab('my-grants')}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'my-grants' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          My Trusted Contacts ({myGrants.length})
        </button>
        <button
          onClick={() => setTab('granted-to-me')}
          className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'granted-to-me' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          I'm Trusted By ({grantedToMe.length})
        </button>
      </div>

      {showAdd && tab === 'my-grants' && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 border">
          <p className="text-sm text-gray-600">
            Grant emergency access to a trusted contact. They can request access to your vault
            after a waiting period, giving you time to reject if unauthorized.
          </p>
          <input
            type="email"
            placeholder="Contact's email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <div>
            <label className="text-sm text-gray-600">Wait time: {waitDays} days</label>
            <input
              type="range"
              min={1}
              max={30}
              value={waitDays}
              onChange={(e) => setWaitDays(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700">
              Grant Access
            </button>
            <button onClick={() => setShowAdd(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {tab === 'my-grants' ? (
        myGrants.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <HeartPulse className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No emergency contacts configured</p>
          </div>
        ) : (
          <div className="space-y-2">
            {myGrants.map(grant => (
              <div key={grant.id} className="bg-white border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {statusIcons[grant.status] || <AlertCircle className="w-4 h-4 text-gray-400" />}
                    <div>
                      <p className="font-medium text-gray-900">{grant.grantee_name || grant.grantee_email}</p>
                      <p className="text-xs text-gray-500">
                        {statusLabels[grant.status]} · Wait: {grant.wait_time_days} days
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {grant.status === 'recovery_initiated' && (
                      <>
                        <button onClick={() => handleApprove(grant.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Approve</button>
                        <button onClick={() => handleReject(grant.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Reject</button>
                      </>
                    )}
                    <button onClick={() => handleRevoke(grant.id)} className="p-1 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        grantedToMe.length === 0 ? (
          <div className="text-center py-6 text-gray-400">
            <p className="text-sm">No one has granted you emergency access</p>
          </div>
        ) : (
          <div className="space-y-2">
            {grantedToMe.map(grant => (
              <div key={grant.id} className="bg-white border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {statusIcons[grant.status] || <AlertCircle className="w-4 h-4 text-gray-400" />}
                    <div>
                      <p className="font-medium text-gray-900">{grant.grantor_name || grant.grantor_email}</p>
                      <p className="text-xs text-gray-500">{statusLabels[grant.status]}</p>
                    </div>
                  </div>
                  {grant.status === 'accepted' && (
                    <button
                      onClick={() => handleInitiateRecovery(grant.id)}
                      className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200"
                    >
                      Request Recovery
                    </button>
                  )}
                  {grant.status === 'recovery_initiated' && grant.recovery_deadline && (
                    <span className="text-xs text-amber-600">
                      Auto-approves: {new Date(grant.recovery_deadline).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
