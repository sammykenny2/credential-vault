import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { credentialService } from '@/services/credentialService'
import { Key, ShieldCheck, Clock } from 'lucide-react'

export default function DashboardPage() {
  const { user } = useAuthStore()

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
      <h1 className="text-2xl font-bold text-gray-900 mb-8">
        Welcome, {user?.display_name}
      </h1>

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
                <span className="text-sm text-gray-400">
                  {new Date(cred.updated_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
