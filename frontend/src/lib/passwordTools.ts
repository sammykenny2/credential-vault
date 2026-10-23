/**
 * Client-side password tools: generation, strength analysis and breach check.
 *
 * Everything here runs in the browser. Nothing talks to the vault backend, so
 * the server never sees a generated or checked password. Randomness comes from
 * `crypto.getRandomValues` with rejection sampling (no modulo bias).
 */

import type { BreachCheckResult, PasswordStrengthResult } from '@/types'

// === Secure randomness ===

/**
 * Uniform random integer in [0, maxExclusive) from the Web Crypto CSPRNG.
 */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('randomInt: maxExclusive must be a positive integer')
  }
  // Largest multiple of maxExclusive that fits in 32 bits; values at or above
  // it are rejected so every residue is equally likely.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const buf = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return value % maxExclusive
}

function randomChar(charset: string): string {
  return charset[randomInt(charset.length)]
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

// === Password generation ===

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?'

export interface PasswordGenerateOptions {
  /** 8-128, clamped. Default 20. */
  length?: number
  uppercase?: boolean
  lowercase?: boolean
  digits?: boolean
  symbols?: boolean
  /** Drop 0/O and 1/l/I. */
  excludeAmbiguous?: boolean
}

/**
 * Generate a random password. Every selected character class is guaranteed to
 * appear at least once; positions are shuffled with the CSPRNG.
 */
export function generatePassword(options: PasswordGenerateOptions = {}): string {
  const {
    uppercase = true,
    lowercase = true,
    digits = true,
    symbols = true,
    excludeAmbiguous = false,
  } = options
  const length = Math.max(8, Math.min(128, Math.floor(options.length ?? 20)))

  let charset = ''
  const required: string[] = []

  if (uppercase) {
    const chars = excludeAmbiguous ? UPPERCASE.replace(/[OI]/g, '') : UPPERCASE
    charset += chars
    required.push(randomChar(chars))
  }
  if (lowercase) {
    const chars = excludeAmbiguous ? LOWERCASE.replace(/l/g, '') : LOWERCASE
    charset += chars
    required.push(randomChar(chars))
  }
  if (digits) {
    const chars = excludeAmbiguous ? DIGITS.replace(/[01]/g, '') : DIGITS
    charset += chars
    required.push(randomChar(chars))
  }
  if (symbols) {
    charset += SYMBOLS
    required.push(randomChar(SYMBOLS))
  }
  if (!charset) {
    charset = UPPERCASE + LOWERCASE + DIGITS
    required.push(randomChar(UPPERCASE + LOWERCASE))
  }

  const chars = [...required]
  while (chars.length < length) {
    chars.push(randomChar(charset))
  }
  return shuffleInPlace(chars).join('')
}

// === Passphrase generation ===

export const WORDLIST: readonly string[] = [
  'acid', 'acme', 'aged', 'also', 'arch', 'area', 'army', 'atom', 'aunt', 'avid', 'axis',
  'back', 'bail', 'bake', 'ball', 'band', 'bank', 'barn', 'base', 'bath', 'bead', 'beam',
  'bean', 'bear', 'beat', 'beef', 'bell', 'belt', 'bend', 'bike', 'bind', 'bird', 'bite',
  'blow', 'blue', 'blur', 'boat', 'body', 'bold', 'bolt', 'bomb', 'bond', 'bone', 'book',
  'boot', 'born', 'boss', 'bowl', 'bulk', 'bump', 'burn', 'busy', 'buzz', 'cafe', 'cage',
  'cake', 'calm', 'came', 'camp', 'cape', 'card', 'care', 'cart', 'case', 'cash', 'cast',
  'cave', 'cell', 'chat', 'chef', 'chin', 'chip', 'chop', 'city', 'clad', 'clam', 'clan',
  'clap', 'clay', 'clip', 'club', 'clue', 'coal', 'coat', 'code', 'coil', 'coin', 'cold',
  'colt', 'come', 'cone', 'cook', 'cool', 'cope', 'cord', 'core', 'cork', 'corn', 'cost',
  'cozy', 'crew', 'crop', 'crow', 'cube', 'cult', 'cure', 'curl', 'cute', 'dare', 'dark',
  'dart', 'dash', 'data', 'dawn', 'dead', 'deal', 'dear', 'debt', 'deck', 'deed', 'deem',
  'deep', 'deer', 'demo', 'dent', 'deny', 'desk', 'dial', 'dice', 'diet', 'dirt', 'disc',
  'dish', 'disk', 'dive', 'dock', 'does', 'dome', 'done', 'doom', 'door', 'dose', 'dove',
  'down', 'drag', 'draw', 'drip', 'drop', 'drug', 'drum', 'dual', 'duck', 'dude', 'dump',
  'dune', 'dusk', 'dust', 'duty', 'each', 'earl', 'earn', 'ease', 'east', 'easy', 'edge',
  'edit', 'else', 'emit', 'envy', 'epic', 'even', 'ever', 'evil', 'exam', 'exit', 'face',
  'fact', 'fade', 'fail', 'fair', 'fake', 'fall', 'fame', 'fang', 'fare', 'farm', 'fast',
  'fate', 'fear', 'feat', 'feed', 'feel', 'fell', 'felt', 'file', 'fill', 'film', 'find',
  'fine', 'fire', 'firm', 'fish', 'fist', 'flag', 'flame', 'flap', 'flat', 'flaw', 'flea',
  'fled', 'flew', 'flex', 'flip', 'flock', 'flow', 'foam', 'fold', 'folk', 'fond', 'font',
  'food', 'fool', 'foot', 'ford', 'fork', 'form', 'fort', 'foul', 'four', 'fowl', 'free',
  'frog', 'from', 'fuel', 'full', 'fund', 'fury', 'fuse', 'gain', 'gale', 'game', 'gang',
  'gate', 'gave', 'gaze', 'gear', 'gene', 'gift', 'glad', 'glow', 'glue', 'goat', 'goes',
  'gold', 'golf', 'gone', 'good', 'grab', 'gray', 'grew', 'grid', 'grim', 'grin', 'grip',
  'grow', 'gulf', 'guru', 'gust', 'hack', 'half', 'hall', 'halt', 'hand', 'hang', 'hard',
  'hare', 'harm', 'harp', 'hash', 'haste', 'hate', 'have', 'hawk', 'haze', 'head', 'heal',
  'heap', 'hear', 'heat', 'heel', 'held', 'helm', 'help', 'herb', 'herd', 'here', 'hero',
  'hide', 'high', 'hike', 'hill', 'hint', 'hire', 'hold', 'hole', 'home', 'hood', 'hook',
  'hope', 'horn', 'host', 'hour', 'howl', 'huge', 'hull', 'hung', 'hunt', 'hurt', 'hush',
  'icon', 'idea', 'inch', 'into', 'iron', 'isle', 'item', 'jack', 'jade', 'jail', 'jazz',
  'jean', 'jest', 'jobs', 'join', 'joke', 'journal', 'jump', 'june', 'jury', 'just', 'keen',
  'keep', 'kept', 'kick', 'kind', 'king', 'kiss', 'kite', 'knee', 'knit', 'knob', 'knot',
  'know', 'lack', 'laid', 'lake', 'lamp', 'land', 'lane', 'lark', 'last', 'late', 'lawn',
  'lazy', 'lead', 'leaf', 'lean', 'leap', 'left', 'lend', 'lens', 'lent', 'less', 'liar',
  'lick', 'life', 'lift', 'like', 'lime', 'limp', 'line', 'link', 'lion', 'list', 'live',
  'load', 'loan', 'lock', 'loft', 'logo', 'long', 'look', 'lord', 'lose', 'loss', 'lost',
  'loud', 'love', 'luck', 'lump', 'lung', 'lure', 'lurk', 'lush', 'mace', 'made', 'maid',
  'mail', 'main', 'make', 'male', 'mall', 'malt', 'mane', 'many', 'maps', 'mare', 'mark',
  'mars', 'mask', 'mass', 'mast', 'mate', 'maze', 'meal', 'mean', 'meat', 'meet', 'meld',
  'melt', 'memo', 'mend', 'menu', 'mesh', 'mild', 'milk', 'mill', 'mind', 'mine', 'mint',
  'miss', 'mist', 'moat', 'mock', 'mode', 'mold', 'monk', 'mood', 'moon', 'more', 'moss',
  'most', 'moth', 'move', 'much', 'mule', 'muse', 'must', 'myth', 'nail', 'name', 'navy',
  'near', 'neat', 'neck', 'need', 'nest', 'news', 'next', 'nice', 'nine', 'node', 'none',
  'noon', 'norm', 'nose', 'note', 'noun', 'nova', 'nuts', 'oath', 'odds', 'oink', 'omen',
  'once', 'only', 'onto', 'open', 'oral', 'orca', 'oval', 'oven', 'over', 'owed', 'oxen',
  'pace', 'pack', 'page', 'paid', 'pail', 'pain', 'pair', 'pale', 'palm', 'pane', 'park',
  'part', 'pass', 'past', 'path', 'pave', 'pawn', 'peak', 'pear', 'peel', 'peer', 'pier',
  'pike', 'pile', 'pine', 'pink', 'pipe', 'plan', 'play', 'plea', 'plot', 'plow', 'ploy',
  'plug', 'plus', 'poem', 'poet', 'pole', 'poll', 'pond', 'pool', 'pope', 'pore', 'pork',
  'port', 'pose', 'post', 'pour', 'pray', 'prey', 'prop', 'pull', 'pulp', 'pump', 'pure',
  'push', 'quit', 'quiz', 'race', 'rack', 'rage', 'raid', 'rail', 'rain', 'rake', 'ramp',
  'rang', 'rank', 'rare', 'rash', 'rate', 'rave', 'rays', 'read', 'real', 'reap', 'rear',
  'reef', 'rein', 'rely', 'rent', 'rest', 'rice', 'rich', 'ride', 'rift', 'ring', 'riot',
  'rise', 'risk', 'road', 'roam', 'robe', 'rock', 'rode', 'role', 'roll', 'roof', 'room',
  'root', 'rope', 'rose', 'ruin', 'rule', 'rush', 'rust', 'sack', 'safe', 'sage', 'said',
  'sail', 'sake', 'sale', 'salt', 'same', 'sand', 'sang', 'sank', 'save', 'scam', 'scan',
  'seal', 'seam', 'seed', 'seek', 'seen', 'self', 'sell', 'send', 'sent', 'shed', 'shin',
  'ship', 'shop', 'shot', 'show', 'shut', 'sick', 'side', 'sift', 'sigh', 'sign', 'silk',
  'sing', 'sink', 'site', 'size', 'skip', 'slab', 'slam', 'slap', 'sled', 'slew', 'slid',
  'slim', 'slip', 'slot', 'slow', 'slug', 'snap', 'snow', 'soak', 'soap', 'soar', 'sock',
  'soft', 'soil', 'sold', 'sole', 'some', 'song', 'soon', 'sort', 'soul', 'sour', 'span',
  'spar', 'spec', 'sped', 'spin', 'spit', 'spot', 'star', 'stay', 'stem', 'step', 'stew',
  'stir', 'stop', 'stub', 'such', 'suit', 'sulk', 'sure', 'surf', 'swan', 'swap', 'swim',
  'tabs', 'tack', 'tail', 'take', 'tale', 'talk', 'tall', 'tame', 'tank', 'tape', 'taps',
  'task', 'taxi', 'team', 'tear', 'teen', 'tell', 'tend', 'tent', 'term', 'test', 'text',
  'than', 'that', 'them', 'then', 'they', 'thin', 'this', 'thorn', 'tick', 'tide', 'tidy',
  'tied', 'tier', 'tile', 'till', 'tilt', 'time', 'tiny', 'tire', 'toad', 'toes', 'toil',
  'told', 'toll', 'tomb', 'tone', 'took', 'tool', 'tops', 'tore', 'torn', 'toss', 'tour',
  'town', 'trap', 'tray', 'tree', 'trek', 'trim', 'trio', 'trip', 'trod', 'trot', 'true',
  'tube', 'tuck', 'tuna', 'tune', 'turf', 'turn', 'twin', 'type', 'unit', 'upon', 'urge',
  'used', 'user', 'vain', 'vale', 'vane', 'vary', 'vast', 'veil', 'vein', 'vent', 'verb',
  'vest', 'veto', 'vice', 'view', 'vine', 'void', 'volt', 'vote', 'wade', 'wage', 'wait',
  'wake', 'walk', 'wall', 'wand', 'want', 'ward', 'warm', 'warn', 'warp', 'wary', 'wash',
  'wasp', 'wave', 'wavy', 'waxy', 'weak', 'wear', 'weed', 'week', 'well', 'went', 'were',
  'west', 'what', 'when', 'whom', 'wide', 'wife', 'wild', 'will', 'wilt', 'wimp', 'wind',
  'wine', 'wing', 'wink', 'wipe', 'wire', 'wise', 'wish', 'with', 'woke', 'wolf', 'wood',
  'wool', 'word', 'wore', 'work', 'worm', 'worn', 'wrap', 'wren', 'yard', 'yarn', 'year',
  'yell', 'yoga', 'yoke', 'zero', 'zinc', 'zone', 'zoom',
]

export interface PassphraseGenerateOptions {
  /** 3-10, clamped. Default 5. */
  wordCount?: number
  separator?: string
  capitalize?: boolean
  /** Append a random number (0-99) to one word. */
  includeNumber?: boolean
}

export function generatePassphrase(options: PassphraseGenerateOptions = {}): string {
  const { separator = '-', capitalize = false, includeNumber = false } = options
  const wordCount = Math.max(3, Math.min(10, Math.floor(options.wordCount ?? 5)))

  let words = Array.from({ length: wordCount }, () => WORDLIST[randomInt(WORDLIST.length)])

  if (capitalize) {
    words = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  }
  if (includeNumber) {
    const idx = randomInt(words.length)
    words[idx] = words[idx] + String(randomInt(100))
  }
  return words.join(separator)
}

// === Strength analysis ===

const COMMON_PASSWORDS = new Set([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567', 'letmein',
  'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine', 'ashley', 'michael',
  'shadow', '123123', '654321', 'superman', 'qazwsx', 'password1', 'password123', 'admin',
  'welcome', 'hello', 'charlie', 'donald', 'login', 'princess', 'starwars', 'passw0rd',
  'p@ssw0rd', 'p@ssword', 'football', 'access', 'flower', 'hottie', 'loveme', 'zaq1zaq1',
  '00000000', '11111111', '12345', '123456789', '1234567890', 'qwerty123', '1q2w3e4r',
  '1qaz2wsx', 'abcdef', 'abcdefgh',
])

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']
const KEYBOARD_PATTERNS = [...KEYBOARD_ROWS, ...KEYBOARD_ROWS.map((r) => [...r].reverse().join(''))]

function estimateCrackTime(entropyBits: number): string {
  if (entropyBits <= 0) return 'instant'
  const guesses = 2 ** entropyBits
  const seconds = guesses / 10_000_000_000 // 10 billion guesses/sec
  const year = 86400 * 365

  if (seconds < 1) return 'instant'
  if (seconds < 60) return `${Math.trunc(seconds)} seconds`
  if (seconds < 3600) return `${Math.trunc(seconds / 60)} minutes`
  if (seconds < 86400) return `${Math.trunc(seconds / 3600)} hours`
  if (seconds < year) return `${Math.trunc(seconds / 86400)} days`
  if (seconds < year * 1000) return `${Math.trunc(seconds / year)} years`
  if (seconds < year * 1_000_000) return `${Math.trunc(seconds / (year * 1000))}K years`
  if (seconds < year * 1_000_000_000) return `${Math.trunc(seconds / (year * 1_000_000))}M years`
  return 'centuries'
}

/**
 * Heuristic password strength score (0-100) with feedback. Mirrors the scoring
 * the backend used before it was removed, so existing UI expectations hold.
 */
export function analyzePassword(password: string): PasswordStrengthResult {
  if (!password) {
    return {
      score: 0,
      level: 'very_weak',
      feedback: ['Password is empty'],
      details: {},
      crack_time_display: 'instant',
    }
  }

  const chars = Array.from(password)
  const length = chars.length
  const feedback: string[] = []
  const details: Record<string, number | boolean> = {}

  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasDigit = /\d/.test(password)
  const hasSymbol = /[^a-zA-Z0-9]/.test(password)
  const hasUnicode = chars.some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f)

  let charsetSize = 0
  if (hasLower) charsetSize += 26
  if (hasUpper) charsetSize += 26
  if (hasDigit) charsetSize += 10
  if (hasSymbol) charsetSize += 33
  if (hasUnicode) charsetSize += 100

  details.charset_size = charsetSize
  details.has_lowercase = hasLower
  details.has_uppercase = hasUpper
  details.has_digits = hasDigit
  details.has_symbols = hasSymbol
  details.length = length

  const entropy = charsetSize > 0 ? length * Math.log2(charsetSize) : 0
  details.entropy_bits = Math.round(entropy * 10) / 10

  let score = 0
  score += Math.min(30, length * 2)
  const diversity = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length
  score += diversity * 6.25
  score += Math.min(25, entropy / 4)

  const uniqueCount = new Set(chars).size

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    score = Math.min(score, 5)
    feedback.push('This is a commonly used password')
  }

  if (uniqueCount === 1) {
    score = Math.min(score, 5)
    feedback.push('Password contains only one unique character')
  }

  let sequentialCount = 0
  for (let i = 0; i < length - 2; i++) {
    const a = chars[i].codePointAt(0)!
    const b = chars[i + 1].codePointAt(0)!
    const c = chars[i + 2].codePointAt(0)!
    if (a + 1 === b && b === c - 1) sequentialCount++
  }
  if (sequentialCount > 0) {
    score -= sequentialCount * 5
    feedback.push('Avoid sequential characters (abc, 123)')
  }

  for (let patternLen = 1; patternLen <= Math.floor(length / 2); patternLen++) {
    const pattern = chars.slice(0, patternLen)
    const repeatCount = Math.floor(length / patternLen)
    const repeated = Array.from({ length: repeatCount }, () => pattern).flat()
    const prefix = chars.slice(0, patternLen * repeatCount)
    if (repeated.join('') === prefix.join('') && repeatCount >= 3) {
      score -= 15
      feedback.push('Avoid repeating patterns')
      break
    }
  }

  const lowerPw = password.toLowerCase()
  let keyboardHit = false
  for (const pattern of KEYBOARD_PATTERNS) {
    for (let i = 0; i < pattern.length - 3; i++) {
      if (lowerPw.includes(pattern.slice(i, i + 4))) {
        keyboardHit = true
        break
      }
    }
    if (keyboardHit) break
  }
  if (keyboardHit) {
    score -= 10
    feedback.push('Avoid keyboard patterns (qwerty, asdf)')
  }

  if (length < 8) {
    feedback.push('Use at least 8 characters')
  } else if (length < 12) {
    feedback.push('Consider using 12+ characters for better security')
  }
  if (!hasUpper) feedback.push('Add uppercase letters')
  if (!hasLower) feedback.push('Add lowercase letters')
  if (!hasDigit) feedback.push('Add numbers')
  if (!hasSymbol) feedback.push('Add special characters (!@#$%)')

  const uniqueRatio = length > 0 ? uniqueCount / length : 0
  if (uniqueRatio < 0.5 && length > 4) {
    score -= 10
    feedback.push('Use more unique characters')
  }

  let finalScore = Math.max(0, Math.min(100, Math.trunc(score)))
  if (length >= 20 && diversity >= 3) finalScore = Math.max(finalScore, 80)
  if (length >= 16 && diversity >= 4) finalScore = Math.max(finalScore, 75)

  let level: PasswordStrengthResult['level']
  if (finalScore >= 80) level = 'very_strong'
  else if (finalScore >= 60) level = 'strong'
  else if (finalScore >= 40) level = 'fair'
  else if (finalScore >= 20) level = 'weak'
  else level = 'very_weak'

  return {
    score: finalScore,
    level,
    feedback: feedback.slice(0, 5),
    details,
    crack_time_display: estimateCrackTime(entropy),
  }
}

// === Breach check (Have I Been Pwned, k-anonymity) ===

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'

/**
 * Check a password against HIBP without revealing it: only the first 5 hex
 * characters of its SHA-1 leave the browser. Requires the page CSP to allow
 * `connect-src https://api.pwnedpasswords.com`.
 */
export async function checkPasswordBreach(password: string): Promise<BreachCheckResult> {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
    const prefix = hex.slice(0, 5)
    const suffix = hex.slice(5)

    const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    })
    if (!response.ok) {
      return { breached: false, count: 0, error: `HIBP API error: HTTP ${response.status}` }
    }

    const body = await response.text()
    for (const line of body.split('\n')) {
      const [hashSuffix, countText] = line.trim().split(':')
      if (hashSuffix === suffix) {
        const count = parseInt(countText ?? '0', 10) || 0
        // Padded entries carry a count of 0 and are not real matches.
        return { breached: count > 0, count, error: null }
      }
    }
    return { breached: false, count: 0, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { breached: false, count: 0, error: `HIBP API error: ${message}` }
  }
}
