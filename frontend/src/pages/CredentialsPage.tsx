import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { credentialService } from '@/services/credentialService'
import { useMasterPassword } from '@/hooks/useMasterPassword'
import MasterPasswordModal from '@/components/MasterPasswordModal'
import CredentialForm from '@/components/CredentialForm'
import CredentialDetail from '@/components/CredentialDetail'
import TemplateSelector from '@/components/TemplateSelector'
import { Plus, Search, Key, ExternalLink, MoreVertical, Lock, Trash2, Ban } from 'lucide-react'
import clsx from 'clsx'
import type { Credential, CredentialListItem, CredentialTemplate } from '@/types'
import { recordTemplateUsage } from '@/lib/templateStorage'

export default function CredentialsPage() {
  const queryClient = useQueryClient()
  const { isUnlocked, hasPassword } = useMasterPassword()

  const [searchQuery, setSearchQuery] = useState('')
  const [showMasterPasswordModal, setShowMasterPasswordModal] = useState(false)
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [showCredentialForm, setShowCredentialForm] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<CredentialTemplate | null>(null)
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)

  // Check if vault needs to be unlocked
  useEffect(() => {
    if (!isUnlocked) {
      setShowMasterPasswordModal(true)
    }
  }, [isUnlocked])

  const { data: credentials, isLoading } = useQuery({
    queryKey: ['credentials', searchQuery],
    queryFn: () =>
      searchQuery
        ? credentialService.search(searchQuery)
        : credentialService.list(),
    enabled: isUnlocked,
  })

  const createMutation = useMutation({
    mutationFn: credentialService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: credentialService.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: credentialService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
    },
  })

  const handleCredentialClick = async (cred: CredentialListItem) => {
    // Fetch full credential with encrypted data
    const fullCredential = await credentialService.get(cred.id)
    setSelectedCredential(fullCredential)
    setShowDetail(true)
  }

  const handleRevoke = async (id: string) => {
    if (confirm('Are you sure you want to revoke this credential?')) {
      await revokeMutation.mutateAsync(id)
    }
    setActiveMenu(null)
  }

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to permanently delete this credential? This cannot be undone.')) {
      await deleteMutation.mutateAsync(id)
    }
    setActiveMenu(null)
  }

  // Handle "Add Credential" button - show template selector first
  const handleAddCredential = () => {
    setShowTemplateSelector(true)
  }

  // Handle template selection
  const handleTemplateSelect = (template: CredentialTemplate | null) => {
    setSelectedTemplate(template)
    setShowTemplateSelector(false)
    setShowCredentialForm(true)
  }

  // Handle credential form close
  const handleCredentialFormClose = () => {
    setShowCredentialForm(false)
    setSelectedTemplate(null)
  }

  // Show lock screen if not unlocked
  if (!isUnlocked) {
    return (
      <>
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <Lock className="w-16 h-16 text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Vault Locked</h2>
          <p className="text-gray-500 mb-4">Enter your master password to access credentials</p>
          <button
            onClick={() => setShowMasterPasswordModal(true)}
            className="btn btn-primary"
          >
            Unlock Vault
          </button>
        </div>
        <MasterPasswordModal
          isOpen={showMasterPasswordModal}
          onUnlock={() => setShowMasterPasswordModal(false)}
          isFirstTime={!hasPassword}
        />
      </>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Credentials</h1>
        <button
          onClick={handleAddCredential}
          className="btn btn-primary flex items-center gap-2"
        >
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
          {!searchQuery && (
            <button
              onClick={handleAddCredential}
              className="btn btn-primary mt-4"
            >
              Add Your First Credential
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {credentials?.map((cred) => (
            <div
              key={cred.id}
              className={clsx(
                'card flex items-center gap-4 hover:shadow-md transition-shadow',
                !cred.is_active && 'opacity-50'
              )}
            >
              <div
                className="flex-1 flex items-center gap-4 cursor-pointer"
                onClick={() => handleCredentialClick(cred)}
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
                    {!cred.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                        Revoked
                      </span>
                    )}
                  </div>
                  {cred.description && (
                    <p className="text-sm text-gray-500 truncate">{cred.description}</p>
                  )}
                </div>
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

              {/* Actions Menu */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveMenu(activeMenu === cred.id ? null : cred.id)
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>

                {activeMenu === cred.id && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                    {cred.is_active && (
                      <button
                        onClick={() => handleRevoke(cred.id)}
                        className="w-full px-4 py-2 text-left text-sm text-yellow-600 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <Ban className="w-4 h-4" />
                        Revoke
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(cred.id)}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Permanently
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Click outside to close menu */}
      {activeMenu && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setActiveMenu(null)}
        />
      )}

      {/* Modals */}
      <MasterPasswordModal
        isOpen={showMasterPasswordModal}
        onUnlock={() => setShowMasterPasswordModal(false)}
        isFirstTime={!hasPassword}
      />

      <TemplateSelector
        isOpen={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onSelect={handleTemplateSelect}
      />

      <CredentialForm
        isOpen={showCredentialForm}
        onClose={handleCredentialFormClose}
        onSave={async (data, templateId) => {
          const result = await createMutation.mutateAsync(data)
          // Record template usage if a template was used
          if (templateId) {
            recordTemplateUsage(templateId, result?.id)
          }
        }}
        template={selectedTemplate}
      />

      <CredentialDetail
        credential={selectedCredential}
        isOpen={showDetail}
        onClose={() => {
          setShowDetail(false)
          setSelectedCredential(null)
        }}
      />
    </div>
  )
}
