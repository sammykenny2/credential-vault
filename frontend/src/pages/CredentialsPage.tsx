import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { credentialService } from '@/services/credentialService'
import { Plus, Search, Key, ExternalLink, MoreVertical } from 'lucide-react'
import clsx from 'clsx'

export default function CredentialsPage() {
  const [searchQuery, setSearchQuery] = useState('')

  const { data: credentials, isLoading } = useQuery({
    queryKey: ['credentials', searchQuery],
    queryFn: () =>
      searchQuery
        ? credentialService.search(searchQuery)
        : credentialService.list(),
  })

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Credentials</h1>
        <button className="btn btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Credential
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search credentials..."
            className="input pl-10"
          />
        </div>
      </div>

      {/* Credentials List */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : credentials?.length === 0 ? (
        <div className="card text-center py-12">
          <Key className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">
            {searchQuery ? 'No credentials found' : 'No credentials yet'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {credentials?.map((cred) => (
            <div
              key={cred.id}
              className={clsx(
                'card flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer',
                !cred.is_active && 'opacity-50'
              )}
            >
              <div className="p-3 bg-primary-100 rounded-lg">
                <Key className="w-5 h-5 text-primary-600" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{cred.name}</p>
                  {cred.category && (
                    <span className="px-2 py-0.5 text-xs bg-gray-100 rounded-full">
                      {cred.category}
                    </span>
                  )}
                </div>
                {cred.description && (
                  <p className="text-sm text-gray-500 truncate">{cred.description}</p>
                )}
              </div>

              {cred.website_url && (
                <a
                  href={cred.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-400 hover:text-primary-600"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-5 h-5" />
                </a>
              )}

              <button className="p-2 text-gray-400 hover:text-gray-600">
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
