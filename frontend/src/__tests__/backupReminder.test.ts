/**
 * Backup reminder bookkeeping tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BACKUP_REMINDER_DAYS,
  daysSinceBackup,
  isBackupDue,
  lastBackupAt,
  recordBackupCompleted,
} from '@/lib/backupReminder'

const DAY = 24 * 60 * 60 * 1000

describe('backupReminder', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is due when no backup was ever recorded', () => {
    expect(lastBackupAt()).toBeNull()
    expect(daysSinceBackup()).toBeNull()
    expect(isBackupDue()).toBe(true)
  })

  it('is not due right after a backup', () => {
    const now = Date.parse('2026-10-23T00:00:00Z')
    recordBackupCompleted(now)
    expect(lastBackupAt()).toBe(now)
    expect(isBackupDue(now + DAY)).toBe(false)
    expect(daysSinceBackup(now + 3 * DAY)).toBe(3)
  })

  it('becomes due after the reminder window', () => {
    const now = Date.parse('2026-10-23T00:00:00Z')
    recordBackupCompleted(now)
    expect(isBackupDue(now + BACKUP_REMINDER_DAYS * DAY)).toBe(false)
    expect(isBackupDue(now + (BACKUP_REMINDER_DAYS + 1) * DAY)).toBe(true)
  })

  it('treats a corrupted value as no backup', () => {
    localStorage.setItem('last_backup_at', 'yesterday')
    expect(lastBackupAt()).toBeNull()
    expect(isBackupDue()).toBe(true)
  })
})
