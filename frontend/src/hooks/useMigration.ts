/**
 * Migration Hook
 *
 * Manages the localStorage to backend migration state.
 * Used to detect when migration is needed and track completion.
 */

import { useCallback, useMemo } from 'react'
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

const CHECKING: MigrationState = {
  isChecking: true,
  needsMigration: false,
  hasBackendTemplates: false,
  hasLocalTemplates: false,
  error: null,
}

/**
 * Hook to manage template migration from localStorage to backend.
 *
 * Returns migration state and a function to recheck migration status.
 * The state is derived from the backend query instead of mirrored into
 * local state, so there is nothing to keep in sync.
 */
export function useMigration() {
  const backendQuery = useHasBackendTemplates()

  const state = useMemo<MigrationState>(() => {
    if (backendQuery.isLoading || backendQuery.isFetching) {
      return CHECKING
    }

    if (backendQuery.isError) {
      return { ...CHECKING, isChecking: false, error: 'Failed to check backend templates' }
    }

    const localHasTemplates = hasLocalTemplates()
    const migrationCompleted = isMigrationCompleted()
    const backendHasTemplates = backendQuery.data ?? false

    // Migration is needed if:
    // - localStorage has custom templates
    // - Migration hasn't been completed
    // - Backend doesn't have templates yet
    return {
      isChecking: false,
      needsMigration: localHasTemplates && !migrationCompleted && !backendHasTemplates,
      hasBackendTemplates: backendHasTemplates,
      hasLocalTemplates: localHasTemplates,
      error: null,
    }
  }, [backendQuery.isLoading, backendQuery.isFetching, backendQuery.isError, backendQuery.data])

  const recheck = useCallback(() => {
    backendQuery.refetch()
  }, [backendQuery])

  return {
    ...state,
    recheck,
  }
}

export default useMigration
