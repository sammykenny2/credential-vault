/**
 * Encrypted-backup reminder.
 *
 * The server keeps no backup of the vault, so the only recovery path is the
 * client-side .cvault export. Remember when the last export happened (per
 * browser, in localStorage; nothing sensitive) and nag when it is overdue.
 */

const STORAGE_KEY = 'last_backup_at'
export const BACKUP_REMINDER_DAYS = 30

export function recordBackupCompleted(now: number = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(now))
  } catch {
    // Storage unavailable: the reminder simply keeps showing.
  }
}

export function lastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** True when no backup was ever recorded or the last one is older than the threshold. */
export function isBackupDue(now: number = Date.now()): boolean {
  const last = lastBackupAt()
  if (last === null) return true
  return now - last > BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000
}

export function daysSinceBackup(now: number = Date.now()): number | null {
  const last = lastBackupAt()
  if (last === null) return null
  return Math.floor((now - last) / (24 * 60 * 60 * 1000))
}
