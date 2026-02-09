import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { credentialService } from '@/services/credentialService'
import { Key, ShieldCheck, Clock, Wand2 } from 'lucide-react'
import HealthDashboard from '@/components/HealthDashboard'
import PasswordGenerator from '@/components/PasswordGenerator'
import TOTPAuthenticator from '@/components/TOTPAuthenticator'
import SharingPanel from '@/components/SharingPanel'
import { useState } from 'react'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const [showGenerator, setShowGenerator] = useState(false)

  const { data: credentials } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialService.list(),
  })

  const stats = [
    {
      label: 'Total Credentials',
      value: credentials?.length ?? 0,
      icon: Key,
      color: 'bg-blue-500',
    },
    {
      label: 'MFA Status',
      value: user?.mfa_enabled ? 'Enabled' : 'Disabled',
      icon: ShieldCheck,
      color: user?.mfa_enabled ? 'bg-green-500' : 'bg-yellow-500',
    },
    {
      label: 'Last Login',
      value: user?.last_login_at
        ? new Date(user.last_login_at).toLocaleDateString()
        : 'N/A',
      icon: Clock,
      color: 'bg-purple-500',
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {user?.display_name}
        </h1>
        <button
          onClick={() => setShowGenerator(!showGenerator)}
          className="flex items-center gap-2 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg hover:bg-blue-100"
        >
          <Wand2 className="w-4 h-4" />
          Password Generator
        </button>
      </div>

      {/* Password Generator (toggle) */}
      {showGenerator && (
        <div className="mb-6">
          <PasswordGenerator />
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="card flex items-center gap-4">
            <div className={`p-3 rounded-lg ${stat.color}`}>
              <stat.icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className="text-xl font-semibold">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Health Dashboard */}
      <div className="mb-8">
        <HealthDashboard />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* TOTP Authenticator */}
        <div className="card">
          <TOTPAuthenticator />
        </div>

        {/* Shared Credentials */}
        <div className="card">
          <SharingPanel />
        </div>
      </div>

      {/* Recent Credentials */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Recent Credentials</h2>
        {credentials?.length === 0 ? (
          <p className="text-gray-500">No credentials yet. Add your first one!</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {credentials?.slice(0, 5).map((cred) => (
              <li key={cred.id} className="py-3 flex justify-between items-center">
                <div>
                  <p className="font-medium">{cred.name}</p>
                  {cred.website_url && (
                    <p className="text-sm text-gray-500">{cred.website_url}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {cred.expires_at && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      new Date(cred.expires_at) < new Date()
                        ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {new Date(cred.expires_at) < new Date() ? 'Expired' : `Expires ${new Date(cred.expires_at).toLocaleDateString()}`}
                    </span>
                  )}
                  <span className="text-sm text-gray-400">
                    {new Date(cred.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
