import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { userService } from '@/services/userService'
import { useAuthStore } from '@/stores/authStore'
import { useVaultKey } from '@/hooks/useVaultKey'
import { vaultProofHeaders, VaultLockedError } from '@/lib/vaultProof'
import { UserCheck, UserX, Key, ShieldCheck, ShieldOff } from 'lucide-react'
import clsx from 'clsx'

function describeError(err: unknown): string {
  return err instanceof VaultLockedError
    ? 'Your vault is locked. Unlock it, then try again.'
    : 'The change could not be saved.'
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuthStore()
  const queryClient = useQueryClient()
  // Changing accounts needs proof of vault unlock, so the actions stay
  // disabled while the vault is locked.
  const { isUnlocked } = useVaultKey()
  const [actionError, setActionError] = useState('')

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: userService.list,
  })

  // Count active admins to protect the last one
  const activeAdminCount = useMemo(
    () => users?.filter((u) => u.role === 'admin' && u.is_active).length ?? 0,
    [users]
  )

  const mutationCallbacks = {
    onMutate: () => setActionError(''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (err: unknown) => setActionError(describeError(err)),
  }

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => userService.deactivate(id, await vaultProofHeaders()),
    ...mutationCallbacks,
  })

  const activateMutation = useMutation({
    mutationFn: async (id: string) =>
      userService.update(id, { is_active: true }, await vaultProofHeaders()),
    ...mutationCallbacks,
  })

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'user' | 'admin' }) =>
      userService.updateRole(id, role, await vaultProofHeaders()),
    ...mutationCallbacks,
  })

  const handlePromote = (id: string, displayName: string) => {
    if (confirm(`Promote "${displayName}" to admin?`)) {
      roleMutation.mutate({ id, role: 'admin' })
    }
  }

  const handleDemote = (id: string, displayName: string) => {
    if (confirm(`Demote "${displayName}" to regular user?`)) {
      roleMutation.mutate({ id, role: 'user' })
    }
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Access denied. Admin privileges required.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-blue-800 text-sm">
          As an admin, you can manage users but cannot view their credentials.
          Each user's credentials remain private and encrypted.
          Users are created automatically when they sign in with Google OAuth.
        </p>
      </div>

      {!isUnlocked && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm mb-6">
          Your vault is locked. Changing users requires an unlocked vault, so a stolen session
          alone cannot change accounts.{' '}
          <Link to="/credentials" className="font-medium underline">
            Unlock it on the Credentials page
          </Link>
          .
        </div>
      )}

      {actionError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm mb-6">
          {actionError}
        </div>
      )}

      {/* Users Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                  User
                </th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                  Role
                </th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                  Credentials
                </th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                  Vault
                </th>
                <th className="text-left px-6 py-3 text-sm font-medium text-gray-500">
                  Status
                </th>
                <th className="text-right px-6 py-3 text-sm font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users?.map((user) => {
                const isSelf = user.id === currentUser?.id
                const isLastAdmin = user.role === 'admin' && activeAdminCount <= 1

                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium">
                          {user.display_name}
                          {isSelf && <span className="text-gray-400 text-sm ml-1">(you)</span>}
                        </p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'px-2 py-1 text-xs font-medium rounded-full',
                          user.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-700'
                        )}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1 text-gray-500">
                        <Key className="w-4 h-4" />
                        <span>{user.credential_count}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'px-2 py-1 text-xs font-medium rounded-full',
                          user.has_vault_keys
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        )}
                      >
                        {user.has_vault_keys ? 'Set Up' : 'Not Set Up'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          'px-2 py-1 text-xs font-medium rounded-full',
                          user.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        )}
                      >
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Promote / Demote */}
                        {!isSelf && user.is_active && (
                          user.role === 'user' ? (
                            <button
                              onClick={() => handlePromote(user.id, user.display_name)}
                              disabled={!isUnlocked}
                              className="p-1 text-purple-600 hover:text-purple-800 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Promote to Admin"
                            >
                              <ShieldCheck className="w-5 h-5" />
                            </button>
                          ) : !isLastAdmin ? (
                            <button
                              onClick={() => handleDemote(user.id, user.display_name)}
                              disabled={!isUnlocked}
                              className="p-1 text-yellow-600 hover:text-yellow-800 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Demote to User"
                            >
                              <ShieldOff className="w-5 h-5" />
                            </button>
                          ) : (
                            <span
                              className="p-1 text-gray-300 cursor-not-allowed"
                              title="Cannot demote the last admin"
                            >
                              <ShieldOff className="w-5 h-5" />
                            </span>
                          )
                        )}

                        {/* Deactivate / Reactivate */}
                        {!isSelf && (
                          user.is_active ? (
                            !isLastAdmin ? (
                              <button
                                onClick={() => deactivateMutation.mutate(user.id)}
                                disabled={!isUnlocked}
                                className="p-1 text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Deactivate"
                              >
                                <UserX className="w-5 h-5" />
                              </button>
                            ) : (
                              <span
                                className="p-1 text-gray-300 cursor-not-allowed"
                                title="Cannot deactivate the last admin"
                              >
                                <UserX className="w-5 h-5" />
                              </span>
                            )
                          ) : (
                            <button
                              onClick={() => activateMutation.mutate(user.id)}
                              disabled={!isUnlocked}
                              className="p-1 text-green-600 hover:text-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Reactivate"
                            >
                              <UserCheck className="w-5 h-5" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
