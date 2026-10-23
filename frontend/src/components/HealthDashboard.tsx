import { useEffect, useState } from 'react'
import { Shield, AlertTriangle, Clock, Copy, TrendingUp } from 'lucide-react'
import { healthService } from '@/services/healthService'
import type { CredentialHealthSummary } from '@/types'

function ScoreRing({ score }: { score: number }) {
  const radius = 45
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444'

  return (
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 -rotate-90">
        <circle cx="56" cy="56" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="56" cy="56" r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        <span className="text-xs text-gray-500">/ 100</span>
      </div>
    </div>
  )
}

function StrengthBar({ label, count, total, color }: {
  label: string; count: number; total: number; color: string
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 text-gray-600">{label}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-gray-500">{count}</span>
    </div>
  )
}

export default function HealthDashboard() {
  const [health, setHealth] = useState<CredentialHealthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadHealth()
  }, [])

  const loadHealth = async () => {
    setLoading(true)
    try {
      const data = await healthService.getHealthSummary()
      setHealth(data)
    } catch {
      setError('Failed to load health data')
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (error || !health) {
    return (
      <div className="text-center p-8 text-gray-500">
        {error || 'No health data available'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center gap-6">
          <ScoreRing score={health.overall_score} />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">Security Score</h3>
            <p className="text-sm text-gray-500 mt-1">
              Based on {health.total_credentials} credentials
            </p>
            {health.issues.length > 0 && (
              <div className="mt-3 space-y-1">
                {health.issues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm font-medium">Avg Strength</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{health.avg_strength_score}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <Copy className="w-4 h-4" />
            <span className="text-sm font-medium">Reused Passwords</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{health.reused_passwords}</p>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="flex items-center gap-2 text-gray-600 mb-2">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">Expiring Soon</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{health.expiring_soon.length}</p>
        </div>
      </div>

      {/* Strength Distribution */}
      <div className="bg-white rounded-lg border p-4">
        <h4 className="font-medium text-gray-900 mb-3">Password Strength Distribution</h4>
        <div className="space-y-2">
          <StrengthBar label="Very Strong" count={health.strength_distribution.very_strong} total={health.total_credentials} color="bg-emerald-500" />
          <StrengthBar label="Strong" count={health.strength_distribution.strong} total={health.total_credentials} color="bg-green-500" />
          <StrengthBar label="Fair" count={health.strength_distribution.fair} total={health.total_credentials} color="bg-yellow-500" />
          <StrengthBar label="Weak" count={health.strength_distribution.weak} total={health.total_credentials} color="bg-orange-500" />
          <StrengthBar label="Very Weak" count={health.strength_distribution.very_weak} total={health.total_credentials} color="bg-red-500" />
        </div>
      </div>

      {/* Weak Credentials */}
      {health.weak_credentials.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-red-500" />
            Weak Credentials ({health.weak_credentials.length})
          </h4>
          <div className="space-y-2">
            {health.weak_credentials.map((cred) => (
              <div key={cred.id} className="flex items-center justify-between py-1.5 px-2 bg-red-50 rounded-sm text-sm">
                <span className="font-medium text-gray-900 font-mono text-xs">{cred.id.substring(0, 8)}...</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  cred.level === 'very_weak' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {cred.score}/100
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate Groups */}
      {health.duplicate_groups.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            <Copy className="w-4 h-4 text-amber-500" />
            Reused Passwords ({health.duplicate_groups.length} groups)
          </h4>
          <div className="space-y-2">
            {health.duplicate_groups.map((group, i) => (
              <div key={i} className="py-1.5 px-2 bg-amber-50 rounded-sm text-sm">
                <span className="text-gray-600">Same password used by: </span>
                <span className="font-medium text-gray-900">{group.credentials.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiring Soon */}
      {health.expiring_soon.length > 0 && (
        <div className="bg-white rounded-lg border p-4">
          <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            Expiring Soon
          </h4>
          <div className="space-y-2">
            {health.expiring_soon.map((cred) => (
              <div key={cred.id} className="flex items-center justify-between py-1.5 px-2 bg-amber-50 rounded-sm text-sm">
                <span className="font-medium text-gray-900 font-mono text-xs">{cred.id.substring(0, 8)}...</span>
                <span className="text-amber-600">{cred.days_left} days left</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
