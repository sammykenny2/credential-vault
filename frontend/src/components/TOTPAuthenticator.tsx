import { useState, useEffect, useCallback } from 'react'
import { Clock, Plus, Trash2, Copy, Check } from 'lucide-react'
import { totpService } from '@/services/totpService'
import type { TOTPAccount, TOTPCodeResponse } from '@/types'

function TOTPCard({ account, onDelete }: {
  account: TOTPAccount
  onDelete: (id: string) => void
}) {
  const [code, setCode] = useState<TOTPCodeResponse | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchCode = useCallback(async () => {
    try {
      const result = await totpService.generateCode(account.id)
      setCode(result)
    } catch {
      setCode(null)
    }
  }, [account.id])

  useEffect(() => {
    fetchCode()
    const interval = setInterval(fetchCode, account.period * 1000)
    return () => clearInterval(interval)
  }, [fetchCode, account.period])

  // Countdown timer - resets when a new TOTP code is generated
  useEffect(() => {
    if (!code) return
    const timer = setInterval(() => {
      setCode(prev => prev ? {
        ...prev,
        remaining_seconds: Math.max(0, prev.remaining_seconds - 1),
      } : null)
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code?.code])

  const copyCode = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const progress = code ? (code.remaining_seconds / code.period) * 100 : 0

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-medium text-gray-900">
            {account.icon && <span className="mr-1">{account.icon}</span>}
            {account.issuer}
          </p>
          <p className="text-sm text-gray-500">{account.account_name}</p>
        </div>
        <button
          onClick={() => onDelete(account.id)}
          className="p-1.5 text-gray-400 hover:text-red-500"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {code ? (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <button
              onClick={copyCode}
              className="flex items-center gap-2 bg-gray-50 rounded-lg px-4 py-2 font-mono text-2xl font-bold tracking-widest text-gray-900 hover:bg-gray-100"
            >
              {code.code.replace(/(\d{3})/, '$1 ')}
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-gray-400" />
              )}
            </button>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <Clock className="w-3.5 h-3.5" />
              <span>{code.remaining_seconds}s</span>
            </div>
          </div>
          <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                progress > 30 ? 'bg-blue-500' : 'bg-red-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 text-sm text-gray-400">Loading code...</div>
      )}
    </div>
  )
}

export default function TOTPAuthenticator() {
  const [accounts, setAccounts] = useState<TOTPAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [issuer, setIssuer] = useState('')
  const [accountName, setAccountName] = useState('')
  const [secret, setSecret] = useState('')

  useEffect(() => {
    loadAccounts()
  }, [])

  const loadAccounts = async () => {
    try {
      const data = await totpService.listAccounts()
      setAccounts(data)
    } catch {
      // Silently fail
    }
    setLoading(false)
  }

  const handleAdd = async () => {
    if (!issuer || !accountName || !secret) return
    try {
      await totpService.createAccount({
        encrypted_secret: secret, // In production, encrypt with user's key
        issuer,
        account_name: accountName,
      })
      setShowAdd(false)
      setIssuer('')
      setAccountName('')
      setSecret('')
      loadAccounts()
    } catch {
      // Show error
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this TOTP account?')) return
    try {
      await totpService.deleteAccount(id)
      setAccounts(accounts.filter(a => a.id !== id))
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
          <Clock className="w-5 h-5" />
          Authenticator
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      {showAdd && (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3 border">
          <input
            type="text"
            placeholder="Issuer (e.g., Google)"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder="Account (e.g., user@gmail.com)"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
          <input
            type="text"
            placeholder="Secret key (base32)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
            >
              Add
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <Clock className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>No TOTP accounts yet</p>
          <p className="text-sm">Add accounts to use as authenticator</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map(account => (
            <TOTPCard key={account.id} account={account} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
