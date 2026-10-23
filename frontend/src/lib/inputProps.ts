/**
 * Attribute sets for form fields, so every input states how browsers,
 * password managers and writing assistants may treat it.
 *
 * Account fields (admin setup, break-glass login, password verification) use
 * the standard autocomplete tokens instead (username, new-password,
 * current-password) so password managers pair them correctly.
 */

/**
 * Secrets that must never leave the page: credential values and notes, the
 * vault master password, and backup / export file passwords.
 *
 * - autocomplete off: no autofill from saved site passwords. Chrome ignores
 *   it for the "save password?" prompt on password fields, so that prompt
 *   still has to be declined in the browser.
 * - spellcheck off: Chrome's Enhanced Spell Check and Edge's Microsoft Editor
 *   send checked text to their servers, including a password field switched
 *   to plain text with a show button.
 * - data-* opt-outs for 1Password, LastPass, Bitwarden, Dashlane and Grammarly.
 */
export const secretFieldProps = {
  autoComplete: 'off',
  spellCheck: false,
  autoCapitalize: 'off',
  autoCorrect: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
  'data-gramm': 'false',
  'data-enable-grammarly': 'false',
} as const

/**
 * Private but not secret text: credential names, categories, field names,
 * templates and search boxes. No autofill and no cloud spell checking, but
 * password managers do not need to be told to stay away.
 */
export const privateFieldProps = {
  autoComplete: 'off',
  spellCheck: false,
  autoCorrect: 'off',
  'data-gramm': 'false',
  'data-enable-grammarly': 'false',
} as const
