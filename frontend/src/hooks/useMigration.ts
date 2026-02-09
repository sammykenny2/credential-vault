/**
 * Migration Hook
 *
 * Manages the localStorage to backend migration state.
 * Used to detect when migration is needed and track completion.
 */

import { useState, useEffect, useCallback } from 'react'
import { hasLocalTemplates, isMigrationCompleted } from '@/lib/templateStorage'
import { useHasBackendTemplates } from './useTemplates'

interface MigrationState {
  /** Whether migration check is complete */
  isChecking: boolean
  /** Whether migration is needed */
  needsMigration: boolean
  /** Whether backend has templates */
  hasBackendTemplates: boolean
  /** Whether localStorage has templates */
  hasLocalTemplates: boolean
  /** Error if migration check failed */
  error: string | null
}

/**
 * Hook to manage template migration from localStorage to backend.
 *
 * Returns migration state and a function to recheck migration status.
 */
export function useMigration() {
  const [state, setState] = useState<MigrationState>({
    isChecking: true,
    needsMigration: false,
    hasBackendTemplates: false,
    hasLocalTemplates: false,
    error: null,
  })

  const backendQuery = useHasBackendTemplates()

  useEffect(() => {
    if (backendQuery.isLoading) {
      return
    }

    if (backendQuery.isError) {
      setState(prev => ({
        ...prev,
        isChecking: false,
        error: 'Failed to check backend templates',
      }))
      return
    }

    const localHasTemplates = hasLocalTemplates()
    const migrationCompleted = isMigrationCompleted()
    const backendHasTemplates = backendQuery.data ?? false

    // Migration is needed if:
    // - localStorage has custom templates
    // - Migration hasn't been completed
    // - Backend doesn't have templates yet
    const shouldMigrate = localHasTemplates && !migrationCompleted && !backendHasTemplates

    setState({
      isChecking: false,
      needsMigration: shouldMigrate,
      hasBackendTemplates: backendHasTemplates,
      hasLocalTemplates: localHasTemplates,
      error: null,
    })
  }, [backendQuery.isLoading, backendQuery.isError, backendQuery.data])

  const recheck = useCallback(() => {
    setState(prev => ({ ...prev, isChecking: true }))
    backendQuery.refetch()
  }, [backendQuery])

  return {
    ...state,
    recheck,
  }
}

export default useMigration
