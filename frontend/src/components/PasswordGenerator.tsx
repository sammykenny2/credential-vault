import { useState, useCallback } from 'react'
import { Copy, RefreshCw, Check } from 'lucide-react'
import { toolsService } from '@/services/toolsService'
import type { PasswordStrengthResult } from '@/types'

interface PasswordGeneratorProps {
  onSelect?: (password: string) => void
}

const strengthColors: Record<string, string> = {
  very_weak: 'bg-red-500',
  weak: 'bg-orange-500',
  fair: 'bg-yellow-500',
  strong: 'bg-green-500',
  very_strong: 'bg-emerald-600',
}

const strengthLabels: Record<string, string> = {
  very_weak: 'Very Weak',
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
  very_strong: 'Very Strong',
}

export default function PasswordGenerator({ onSelect }: PasswordGeneratorProps) {
  const [mode, setMode] = useState<'password' | 'passphrase'>('password')
  const [password, setPassword] = useState('')
  const [strength, setStrength] = useState<PasswordStrengthResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  // Password options
  const [length, setLength] = useState(20)
  const [uppercase, setUppercase] = useState(true)
  const [lowercase, setLowercase] = useState(true)
  const [digits, setDigits] = useState(true)
  const [symbols, setSymbols] = useState(true)
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false)

  // Passphrase options
  const [wordCount, setWordCount] = useState(5)
  const [separator, setSeparator] = useState('-')
  const [capitalize, setCapitalize] = useState(false)
  const [includeNumber, setIncludeNumber] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      if (mode === 'password') {
        const result = await toolsService.generatePassword({
          length, uppercase, lowercase, digits, symbols,
          exclude_ambiguous: excludeAmbiguous,
        })
        setPassword(result.password)
        setStrength(result.strength)
      } else {
        const result = await toolsService.generatePassphrase({
          word_count: wordCount, separator, capitalize,
          include_number: includeNumber,
        })
        setPassword(result.passphrase)
        setStrength(result.strength)
      }
    } catch {
      // Fallback to client-side generation
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()'
      let result = ''
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      setPassword(result)
    }
    setLoading(false)
  }, [mode, length, uppercase, lowercase, digits, symbols, excludeAmbiguous, wordCount, separator, capitalize, includeNumber])

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Password Generator</h3>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setMode('password')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              mode === 'password' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Password
          </button>
          <button
            onClick={() => setMode('passphrase')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              mode === 'passphrase' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Passphrase
          </button>
        </div>
      </div>

      {/* Generated password display */}
      {password && (
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-gray-50 px-3 py-2 rounded-md text-sm font-mono break-all border">
            {password}
          </code>
          <button
            onClick={copyToClipboard}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="Copy"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}

      {/* Strength indicator */}
      {strength && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{strengthLabels[strength.level]}</span>
            <span>{strength.crack_time_display}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${strengthColors[strength.level]}`}
              style={{ width: `${strength.score}%` }}
            />
          </div>
        </div>
      )}

      {/* Options */}
      {mode === 'password' ? (
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-600">Length: {length}</label>
            <input
              type="range"
              min={8}
              max={64}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Uppercase (A-Z)', value: uppercase, setter: setUppercase },
              { label: 'Lowercase (a-z)', value: lowercase, setter: setLowercase },
              { label: 'Digits (0-9)', value: digits, setter: setDigits },
              { label: 'Symbols (!@#)', value: symbols, setter: setSymbols },
              { label: 'Exclude ambiguous', value: excludeAmbiguous, setter: setExcludeAmbiguous },
            ].map(({ label, value, setter }) => (
              <label key={label} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  className="rounded"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-600">Words: {wordCount}</label>
            <input
              type="range"
              min={3}
              max={10}
              value={wordCount}
              onChange={(e) => setWordCount(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-sm text-gray-600">Separator</label>
              <input
                type="text"
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                className="w-full mt-1 px-2 py-1 border rounded text-sm"
                maxLength={3}
              />
            </div>
            <div className="space-y-1 pt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={capitalize}
                  onChange={(e) => setCapitalize(e.target.checked)}
                  className="rounded"
                />
                Capitalize
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeNumber}
                  onChange={(e) => setIncludeNumber(e.target.checked)}
                  className="rounded"
                />
                Include number
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={generate}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Generate
        </button>
        {password && onSelect && (
          <button
            onClick={() => onSelect(password)}
            className="bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 text-sm"
          >
            Use this
          </button>
        )}
      </div>
    </div>
  )
}
