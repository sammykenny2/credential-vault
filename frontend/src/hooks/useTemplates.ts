/**
 * Template Hooks
 *
 * React Query hooks for template operations.
 * Provides caching, invalidation, and optimistic updates.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { templateService, isVersionConflictError } from '@/services/templateService'
import type {
  BackendTemplate,
  TemplateCreateRequest,
  TemplateUpdateRequest,
  SyncRequest,
  VersionConflictError,
} from '@/types/template'

// Query keys for cache management
export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (params?: { category?: string; include_inactive?: boolean }) =>
    [...templateKeys.lists(), params] as const,
  details: () => [...templateKeys.all, 'detail'] as const,
  detail: (id: string) => [...templateKeys.details(), id] as const,
  usage: () => [...templateKeys.all, 'usage'] as const,
}

/**
 * Hook to fetch list of templates.
 */
export function useTemplates(params?: {
  category?: string
  include_inactive?: boolean
  skip?: number
  limit?: number
}) {
  return useQuery({
    queryKey: templateKeys.list(params),
    queryFn: () => templateService.list(params),
  })
}

/**
 * Hook to fetch a single template.
 */
export function useTemplate(id: string | undefined) {
  return useQuery({
    queryKey: templateKeys.detail(id!),
    queryFn: () => templateService.get(id!),
    enabled: !!id,
  })
}

/**
 * Hook to fetch usage statistics.
 */
export function useTemplateUsageStats() {
  return useQuery({
    queryKey: templateKeys.usage(),
    queryFn: () => templateService.getUsageStats(),
  })
}

/**
 * Hook to create a new template.
 */
export function useCreateTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: TemplateCreateRequest) => templateService.create(data),
    onSuccess: () => {
      // Invalidate list queries to refetch
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
    },
  })
}

/**
 * Hook to update a template.
 * Handles version conflict errors.
 */
export function useUpdateTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TemplateUpdateRequest }) =>
      templateService.update(id, data),
    onSuccess: (updatedTemplate) => {
      // Update cache with new data
      queryClient.setQueryData(templateKeys.detail(updatedTemplate.id), updatedTemplate)
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
    },
    onError: (error) => {
      // Version conflict errors are expected and should be handled by the caller
      if (isVersionConflictError(error)) {
        // Let the error propagate with the server data
        return
      }
      // Log other errors
      console.error('Update template error:', error)
    },
  })
}

/**
 * Hook to delete a template.
 */
export function useDeleteTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, hardDelete = false }: { id: string; hardDelete?: boolean }) =>
      templateService.delete(id, hardDelete),
    onSuccess: (_, { id }) => {
      // Remove from detail cache
      queryClient.removeQueries({ queryKey: templateKeys.detail(id) })
      // Invalidate list queries
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
    },
  })
}

/**
 * Hook to record template usage.
 */
export function useRecordTemplateUsage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ templateId, credentialId }: { templateId: string; credentialId?: string }) =>
      templateService.recordUsage(templateId, credentialId),
    onSuccess: () => {
      // Invalidate usage stats
      queryClient.invalidateQueries({ queryKey: templateKeys.usage() })
    },
  })
}

/**
 * Hook to sync templates from localStorage to backend.
 */
export function useSyncTemplates() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: SyncRequest) => templateService.sync(data),
    onSuccess: () => {
      // Invalidate all template queries after sync
      queryClient.invalidateQueries({ queryKey: templateKeys.all })
    },
  })
}

/**
 * Hook to check if backend has templates.
 */
export function useHasBackendTemplates() {
  return useQuery({
    queryKey: [...templateKeys.all, 'hasTemplates'] as const,
    queryFn: () => templateService.hasTemplates(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

/**
 * Helper type for version conflict handling.
 */
export type VersionConflictResult = {
  isConflict: true
  serverVersion: number
  clientVersion: number
  serverData: BackendTemplate
}

/**
 * Extract version conflict data from error.
 */
export function extractVersionConflict(
  error: unknown
): VersionConflictResult | null {
  if (isVersionConflictError(error)) {
    const data = error.response?.data as VersionConflictError
    return {
      isConflict: true,
      serverVersion: data.server_version,
      clientVersion: data.client_version,
      serverData: data.server_data,
    }
  }
  return null
}
