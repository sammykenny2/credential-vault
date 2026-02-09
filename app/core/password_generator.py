"""Password generation utilities.

Supports both random character-based passwords and passphrase generation.
"""

import secrets
import string


# Word list for passphrase generation (EFF short word list subset)
WORDLIST = [
    "acid", "acme", "aged", "also", "arch", "area", "army", "atom",
    "aunt", "avid", "axis", "back", "bail", "bake", "ball", "band",
    "bank", "barn", "base", "bath", "bead", "beam", "bean", "bear",
    "beat", "beef", "bell", "belt", "bend", "bike", "bind", "bird",
    "bite", "blow", "blue", "blur", "boat", "body", "bold", "bolt",
    "bomb", "bond", "bone", "book", "boot", "born", "boss", "bowl",
    "bulk", "bump", "burn", "busy", "buzz", "cafe", "cage", "cake",
    "calm", "came", "camp", "cape", "card", "care", "cart", "case",
    "cash", "cast", "cave", "cell", "chat", "chef", "chin", "chip",
    "chop", "city", "clad", "clam", "clan", "clap", "clay", "clip",
    "club", "clue", "coal", "coat", "code", "coil", "coin", "cold",
    "colt", "come", "cone", "cook", "cool", "cope", "cord", "core",
    "cork", "corn", "cost", "cozy", "crew", "crop", "crow", "cube",
    "cult", "cure", "curl", "cute", "dare", "dark", "dart", "dash",
    "data", "dawn", "dead", "deal", "dear", "debt", "deck", "deed",
    "deem", "deep", "deer", "demo", "dent", "deny", "desk", "dial",
    "dice", "diet", "dirt", "disc", "dish", "disk", "dive", "dock",
    "does", "dome", "done", "doom", "door", "dose", "dove", "down",
    "drag", "draw", "drip", "drop", "drug", "drum", "dual", "duck",
    "dude", "dump", "dune", "dusk", "dust", "duty", "each", "earl",
    "earn", "ease", "east", "easy", "edge", "edit", "else", "emit",
    "envy", "epic", "even", "ever", "evil", "exam", "exit", "face",
    "fact", "fade", "fail", "fair", "fake", "fall", "fame", "fang",
    "fare", "farm", "fast", "fate", "fear", "feat", "feed", "feel",
    "fell", "felt", "file", "fill", "film", "find", "fine", "fire",
    "firm", "fish", "fist", "flag", "flame", "flap", "flat", "flaw",
    "flea", "fled", "flew", "flex", "flip", "flock", "flow", "foam",
    "fold", "folk", "fond", "font", "food", "fool", "foot", "ford",
    "fork", "form", "fort", "foul", "four", "fowl", "free", "frog",
    "from", "fuel", "full", "fund", "fury", "fuse", "gain", "gale",
    "game", "gang", "gate", "gave", "gaze", "gear", "gene", "gift",
    "glad", "glow", "glue", "goat", "goes", "gold", "golf", "gone",
    "good", "grab", "gray", "grew", "grid", "grim", "grin", "grip",
    "grow", "gulf", "guru", "gust", "hack", "half", "hall", "halt",
    "hand", "hang", "hard", "hare", "harm", "harp", "hash", "haste",
    "hate", "have", "hawk", "haze", "head", "heal", "heap", "hear",
    "heat", "heel", "held", "helm", "help", "herb", "herd", "here",
    "hero", "hide", "high", "hike", "hill", "hint", "hire", "hold",
    "hole", "home", "hood", "hook", "hope", "horn", "host", "hour",
    "howl", "huge", "hull", "hung", "hunt", "hurt", "hush", "icon",
    "idea", "inch", "into", "iron", "isle", "item", "jack", "jade",
    "jail", "jazz", "jean", "jest", "jobs", "join", "joke", "journal",
    "jump", "june", "jury", "just", "keen", "keep", "kept", "kick",
    "kind", "king", "kiss", "kite", "knee", "knit", "knob", "knot",
    "know", "lack", "laid", "lake", "lamp", "land", "lane", "lark",
    "last", "late", "lawn", "lazy", "lead", "leaf", "lean", "leap",
    "left", "lend", "lens", "lent", "less", "liar", "lick", "life",
    "lift", "like", "lime", "limp", "line", "link", "lion", "list",
    "live", "load", "loan", "lock", "loft", "logo", "long", "look",
    "lord", "lose", "loss", "lost", "loud", "love", "luck", "lump",
    "lung", "lure", "lurk", "lush", "mace", "made", "maid", "mail",
    "main", "make", "male", "mall", "malt", "mane", "many", "maps",
    "mare", "mark", "mars", "mask", "mass", "mast", "mate", "maze",
    "meal", "mean", "meat", "meet", "meld", "melt", "memo", "mend",
    "menu", "mesh", "mild", "milk", "mill", "mind", "mine", "mint",
    "miss", "mist", "moat", "mock", "mode", "mold", "monk", "mood",
    "moon", "more", "moss", "most", "moth", "move", "much", "mule",
    "muse", "must", "myth", "nail", "name", "navy", "near", "neat",
    "neck", "need", "nest", "news", "next", "nice", "nine", "node",
    "none", "noon", "norm", "nose", "note", "noun", "nova", "nuts",
    "oath", "odds", "oink", "omen", "once", "only", "onto", "open",
    "oral", "orca", "oval", "oven", "over", "owed", "oxen", "pace",
    "pack", "page", "paid", "pail", "pain", "pair", "pale", "palm",
    "pane", "park", "part", "pass", "past", "path", "pave", "pawn",
    "peak", "pear", "peel", "peer", "pier", "pike", "pile", "pine",
    "pink", "pipe", "plan", "play", "plea", "plot", "plow", "ploy",
    "plug", "plus", "poem", "poet", "pole", "poll", "pond", "pool",
    "pope", "pore", "pork", "port", "pose", "post", "pour", "pray",
    "prey", "prop", "pull", "pulp", "pump", "pure", "push", "quit",
    "quiz", "race", "rack", "rage", "raid", "rail", "rain", "rake",
    "ramp", "rang", "rank", "rare", "rash", "rate", "rave", "rays",
    "read", "real", "reap", "rear", "reef", "rein", "rely", "rent",
    "rest", "rice", "rich", "ride", "rift", "ring", "riot", "rise",
    "risk", "road", "roam", "robe", "rock", "rode", "role", "roll",
    "roof", "room", "root", "rope", "rose", "ruin", "rule", "rush",
    "rust", "sack", "safe", "sage", "said", "sail", "sake", "sale",
    "salt", "same", "sand", "sang", "sank", "save", "scam", "scan",
    "seal", "seam", "seed", "seek", "seen", "self", "sell", "send",
    "sent", "shed", "shin", "ship", "shop", "shot", "show", "shut",
    "sick", "side", "sift", "sigh", "sign", "silk", "sing", "sink",
    "site", "size", "skip", "slab", "slam", "slap", "sled", "slew",
    "slid", "slim", "slip", "slot", "slow", "slug", "snap", "snow",
    "soak", "soap", "soar", "sock", "soft", "soil", "sold", "sole",
    "some", "song", "soon", "sort", "soul", "sour", "span", "spar",
    "spec", "sped", "spin", "spit", "spot", "star", "stay", "stem",
    "step", "stew", "stir", "stop", "stub", "such", "suit", "sulk",
    "sure", "surf", "swan", "swap", "swim", "tabs", "tack", "tail",
    "take", "tale", "talk", "tall", "tame", "tank", "tape", "taps",
    "task", "taxi", "team", "tear", "teen", "tell", "tend", "tent",
    "term", "test", "text", "than", "that", "them", "then", "they",
    "thin", "this", "thorn", "tick", "tide", "tidy", "tied", "tier",
    "tile", "till", "tilt", "time", "tiny", "tire", "toad", "toes",
    "toil", "told", "toll", "tomb", "tone", "took", "tool", "tops",
    "tore", "torn", "toss", "tour", "town", "trap", "tray", "tree",
    "trek", "trim", "trio", "trip", "trod", "trot", "true", "tube",
    "tuck", "tuna", "tune", "turf", "turn", "twin", "type", "unit",
    "upon", "urge", "used", "user", "vain", "vale", "vane", "vary",
    "vast", "veil", "vein", "vent", "verb", "vest", "veto", "vice",
    "view", "vine", "void", "volt", "vote", "wade", "wage", "wait",
    "wake", "walk", "wall", "wand", "want", "ward", "warm", "warn",
    "warp", "wary", "wash", "wasp", "wave", "wavy", "waxy", "weak",
    "wear", "weed", "week", "well", "went", "were", "west", "what",
    "when", "whom", "wide", "wife", "wild", "will", "wilt", "wimp",
    "wind", "wine", "wing", "wink", "wipe", "wire", "wise", "wish",
    "with", "woke", "wolf", "wood", "wool", "word", "wore", "work",
    "worm", "worn", "wrap", "wren", "yard", "yarn", "year", "yell",
    "yoga", "yoke", "zero", "zinc", "zone", "zoom",
]


def generate_password(
    length: int = 20,
    uppercase: bool = True,
    lowercase: bool = True,
    digits: bool = True,
    symbols: bool = True,
    exclude_ambiguous: bool = False,
) -> str:
    """Generate a cryptographically secure random password.

    Args:
        length: Password length (8-128).
        uppercase: Include uppercase letters.
        lowercase: Include lowercase letters.
        digits: Include digits.
        symbols: Include special characters.
        exclude_ambiguous: Exclude ambiguous characters (0O, 1lI).

    Returns:
        Generated password string.
    """
    length = max(8, min(128, length))

    charset = ""
    required = []

    if uppercase:
        chars = string.ascii_uppercase
        if exclude_ambiguous:
            chars = chars.replace("O", "").replace("I", "")
        charset += chars
        required.append(secrets.choice(chars))

    if lowercase:
        chars = string.ascii_lowercase
        if exclude_ambiguous:
            chars = chars.replace("l", "")
        charset += chars
        required.append(secrets.choice(chars))

    if digits:
        chars = string.digits
        if exclude_ambiguous:
            chars = chars.replace("0", "").replace("1", "")
        charset += chars
        required.append(secrets.choice(chars))

    if symbols:
        chars = "!@#$%^&*()-_=+[]{}|;:,.<>?"
        charset += chars
        required.append(secrets.choice(chars))

    if not charset:
        charset = string.ascii_letters + string.digits
        required = [secrets.choice(string.ascii_letters)]

    # Fill remaining length
    remaining = length - len(required)
    password_chars = required + [secrets.choice(charset) for _ in range(remaining)]

    # Shuffle to avoid predictable positions of required chars
    result = list(password_chars)
    for i in range(len(result) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        result[i], result[j] = result[j], result[i]

    return "".join(result)


def generate_passphrase(
    word_count: int = 5,
    separator: str = "-",
    capitalize: bool = False,
    include_number: bool = False,
) -> str:
    """Generate a passphrase from random words.

    Args:
        word_count: Number of words (3-10).
        separator: Word separator character.
        capitalize: Capitalize first letter of each word.
        include_number: Append a random number to one word.

    Returns:
        Generated passphrase string.
    """
    word_count = max(3, min(10, word_count))

    words = [secrets.choice(WORDLIST) for _ in range(word_count)]

    if capitalize:
        words = [w.capitalize() for w in words]

    if include_number:
        idx = secrets.randbelow(len(words))
        words[idx] = words[idx] + str(secrets.randbelow(100))

    return separator.join(words)
