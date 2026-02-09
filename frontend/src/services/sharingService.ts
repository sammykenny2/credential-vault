import api from './api'
import type { ShareCreate, SharedByMe, SharedWithMe } from '@/types'

export const sharingService = {
  async shareCredential(data: ShareCreate) {
    const response = await api.post('/sharing/', data)
    return response.data
  },

  async listSharedByMe(): Promise<SharedByMe[]> {
    const response = await api.get<SharedByMe[]>('/sharing/by-me')
    return response.data
  },

  async listSharedWithMe(): Promise<SharedWithMe[]> {
    const response = await api.get<SharedWithMe[]>('/sharing/with-me')
    return response.data
  },

  async revokeShare(shareId: string): Promise<void> {
    await api.delete(`/sharing/${shareId}`)
  },

  async updateShare(shareId: string, data: { permission?: string; is_active?: boolean }) {
    const response = await api.patch(`/sharing/${shareId}`, data)
    return response.data
  },
}
