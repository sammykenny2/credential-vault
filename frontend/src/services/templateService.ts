/**
 * Template Service
 *
 * API client for backend template operations.
 * Handles CRUD, usage tracking, and localStorage migration.
 */

import api from './api'
import type {
  BackendTemplate,
  TemplateListResponse,
  TemplateCreateRequest,
  TemplateUpdateRequest,
  UsageStatsResponse,
  RecordUsageResponse,
  SyncRequest,
  SyncResponse,
  VersionConflictError,
} from '@/types/template'
import { AxiosError } from 'axios'

/**
 * Check if an error is a version conflict error.
 */
export function isVersionConflictError(error: unknown): error is AxiosError<VersionConflictError> {
  return (
    error instanceof AxiosError &&
    error.response?.status === 409 &&
    'server_version' in (error.response?.data ?? {})
  )
}

/**
 * Template API service.
 */
export const templateService = {
  /**
   * List all templates for current user.
   */
  async list(params?: {
    category?: string
    include_inactive?: boolean
    skip?: number
    limit?: number
  }): Promise<TemplateListResponse> {
    const response = await api.get<TemplateListResponse>('/templates', { params })
    return response.data
  },

  /**
   * Get a single template by ID.
   */
  async get(id: string): Promise<BackendTemplate> {
    const response = await api.get<BackendTemplate>(`/templates/${id}`)
    return response.data
  },

  /**
   * Create a new template.
   */
  async create(data: TemplateCreateRequest): Promise<BackendTemplate> {
    const response = await api.post<BackendTemplate>('/templates', data)
    return response.data
  },

  /**
   * Update a template.
   * Requires sync_version for optimistic locking.
   * Throws AxiosError with VersionConflictError data on 409.
   */
  async update(id: string, data: TemplateUpdateRequest): Promise<BackendTemplate> {
    const response = await api.patch<BackendTemplate>(`/templates/${id}`, data)
    return response.data
  },

  /**
   * Delete a template.
   * @param hardDelete If true, permanently delete. Otherwise soft delete.
   */
  async delete(id: string, hardDelete = false): Promise<void> {
    await api.delete(`/templates/${id}`, {
      params: hardDelete ? { hard_delete: true } : undefined,
    })
  },

  /**
   * Record template usage.
   * @param credentialId Optional ID of credential created from this template.
   */
  async recordUsage(templateId: string, credentialId?: string): Promise<RecordUsageResponse> {
    const response = await api.post<RecordUsageResponse>(`/templates/${templateId}/use`, {
      credential_id: credentialId,
    })
    return response.data
  },

  /**
   * Get usage statistics for all templates.
   */
  async getUsageStats(): Promise<UsageStatsResponse> {
    const response = await api.get<UsageStatsResponse>('/templates/usage/stats')
    return response.data
  },

  /**
   * Sync templates from localStorage to backend.
   * Used during migration when user first enables backend sync.
   */
  async sync(data: SyncRequest): Promise<SyncResponse> {
    const response = await api.post<SyncResponse>('/templates/sync', data)
    return response.data
  },

  /**
   * Check if backend has any templates.
   * Used to determine if migration is needed.
   */
  async hasTemplates(): Promise<boolean> {
    const response = await this.list({ limit: 1 })
    return response.total > 0
  },
}

export default templateService
