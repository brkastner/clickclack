/* Shared emoji catalog powering `:shortcode:` completion and the composer
   picker. Kept as a hand-curated table instead of a dependency: the list is
   small enough to audit, ships no runtime data fetch, and the shortcodes match
   the Discord/GitHub names people already have in muscle memory. */

export type EmojiGroup =
  | "smileys"
  | "people"
  | "nature"
  | "food"
  | "activity"
  | "travel"
  | "objects"
  | "symbols";

export type EmojiEntry = {
  char: string;
  /* Canonical shortcode, without the surrounding colons. */
  name: string;
  /* Alternate shortcodes that resolve to the same emoji. */
  aliases: string[];
  /* Free-text search terms, space separated. */
  keywords: string;
  group: EmojiGroup;
};

type EmojiSpec = [char: string, name: string, aliases: string, keywords: string];

export const EMOJI_GROUP_LABELS: Record<EmojiGroup, string> = {
  smileys: "Smileys",
  people: "People",
  nature: "Nature",
  food: "Food",
  activity: "Activity",
  travel: "Travel",
  objects: "Objects",
  symbols: "Symbols",
};

export const EMOJI_GROUP_ORDER: EmojiGroup[] = [
  "smileys",
  "people",
  "nature",
  "food",
  "activity",
  "travel",
  "objects",
  "symbols",
];

const SMILEYS: EmojiSpec[] = [
  ["😀", "grinning", "", "smile happy grin face"],
  ["😃", "smiley", "", "smile happy joy face"],
  ["😄", "smile", "", "happy joy laugh face"],
  ["😁", "grin", "", "happy smile teeth"],
  ["😆", "laughing", "satisfied", "laugh happy haha"],
  ["😅", "sweat_smile", "", "laugh nervous relief"],
  ["🤣", "rofl", "rolling_on_the_floor_laughing", "laugh lol rolling floor"],
  ["😂", "joy", "", "laugh cry tears lol"],
  ["🙂", "slightly_smiling_face", "slight_smile", "smile polite"],
  ["🙃", "upside_down_face", "upside_down", "silly sarcasm flipped"],
  ["🫠", "melting_face", "melting", "melt hot dread"],
  ["😉", "wink", "", "flirt joke"],
  ["😊", "blush", "", "smile shy happy"],
  ["😇", "innocent", "", "angel halo"],
  ["🥰", "smiling_face_with_three_hearts", "smiling_face_with_hearts", "love hearts adore"],
  ["😍", "heart_eyes", "", "love crush adore"],
  ["🤩", "star_struck", "", "starry eyes wow amazed"],
  ["😘", "kissing_heart", "", "kiss love blow"],
  ["😗", "kissing", "", "kiss"],
  ["😚", "kissing_closed_eyes", "", "kiss"],
  ["😙", "kissing_smiling_eyes", "", "kiss"],
  ["🥲", "smiling_face_with_tear", "", "happy sad tear grateful"],
  ["😋", "yum", "", "tongue delicious tasty"],
  ["😛", "stuck_out_tongue", "", "tongue silly"],
  ["😜", "stuck_out_tongue_winking_eye", "", "tongue wink silly"],
  ["🤪", "zany_face", "", "goofy wild crazy"],
  ["😝", "stuck_out_tongue_closed_eyes", "", "tongue silly"],
  ["🤑", "money_mouth_face", "", "money rich dollar"],
  ["🤗", "hugs", "hugging_face", "hug embrace"],
  ["🤭", "hand_over_mouth", "", "oops giggle quiet"],
  ["🫢", "face_with_open_eyes_and_hand_over_mouth", "", "gasp shock oops"],
  ["🤫", "shushing_face", "", "quiet shh secret"],
  ["🤔", "thinking", "thinking_face", "think hmm consider"],
  ["🫡", "saluting_face", "salute", "yes sir respect ack"],
  ["🤐", "zipper_mouth_face", "", "quiet secret"],
  ["🤨", "raised_eyebrow", "", "suspicious skeptic doubt"],
  ["😐", "neutral_face", "", "meh blank"],
  ["😑", "expressionless", "", "blank meh"],
  ["😶", "no_mouth", "", "silence blank"],
  ["🫥", "dotted_line_face", "", "invisible hide"],
  ["😏", "smirk", "", "smug sly"],
  ["😒", "unamused", "", "meh annoyed"],
  ["🙄", "roll_eyes", "face_with_rolling_eyes", "eyeroll annoyed whatever"],
  ["😬", "grimacing", "", "awkward yikes"],
  ["🤥", "lying_face", "", "lie pinocchio"],
  ["😌", "relieved", "", "calm content"],
  ["😔", "pensive", "", "sad down"],
  ["😪", "sleepy", "", "tired"],
  ["🤤", "drooling_face", "", "drool want"],
  ["😴", "sleeping", "", "sleep zzz tired"],
  ["😷", "mask", "", "sick ill"],
  ["🤒", "face_with_thermometer", "", "sick fever ill"],
  ["🤕", "face_with_head_bandage", "", "hurt injured"],
  ["🤢", "nauseated_face", "", "sick gross"],
  ["🤮", "vomiting_face", "", "sick puke gross"],
  ["🤧", "sneezing_face", "", "sick sneeze"],
  ["🥵", "hot_face", "", "hot heat burning"],
  ["🥶", "cold_face", "", "cold freezing"],
  ["🥴", "woozy_face", "", "dizzy drunk"],
  ["😵", "dizzy_face", "", "dizzy confused"],
  ["🤯", "exploding_head", "", "mind blown wow"],
  ["🤠", "cowboy_hat_face", "", "cowboy yeehaw"],
  ["🥳", "partying_face", "", "party celebrate birthday"],
  ["🥸", "disguised_face", "", "disguise incognito"],
  ["😎", "sunglasses", "", "cool shades"],
  ["🤓", "nerd_face", "", "nerd geek glasses"],
  ["🧐", "monocle_face", "", "inspect examine"],
  ["😕", "confused", "", "unsure"],
  ["🫤", "face_with_diagonal_mouth", "", "meh unsure"],
  ["😟", "worried", "", "concerned"],
  ["🙁", "slightly_frowning_face", "", "sad frown"],
  ["😮", "open_mouth", "", "surprise wow"],
  ["😯", "hushed", "", "surprise quiet"],
  ["😲", "astonished", "", "shock wow"],
  ["😳", "flushed", "", "embarrassed blush shock"],
  ["🥺", "pleading_face", "", "please beg puppy eyes"],
  ["🥹", "face_holding_back_tears", "", "grateful proud tears"],
  ["😦", "frowning", "", "sad"],
  ["😧", "anguished", "", "shock pain"],
  ["😨", "fearful", "", "scared afraid"],
  ["😰", "cold_sweat", "", "nervous scared"],
  ["😥", "disappointed_relieved", "", "sad phew"],
  ["😢", "cry", "", "sad tear"],
  ["😭", "sob", "", "cry sad tears bawling"],
  ["😱", "scream", "", "shock fear horror"],
  ["😖", "confounded", "", "frustrated"],
  ["😣", "persevere", "", "struggle"],
  ["😞", "disappointed", "", "sad"],
  ["😓", "sweat", "", "stress nervous"],
  ["😩", "weary", "", "tired exhausted"],
  ["😫", "tired_face", "", "tired exhausted"],
  ["🥱", "yawning_face", "", "bored tired"],
  ["😤", "triumph", "", "huff determined"],
  ["😡", "rage", "pout", "angry mad"],
  ["😠", "angry", "", "mad annoyed"],
  ["🤬", "cursing_face", "", "swear angry"],
  ["😈", "smiling_imp", "", "devil evil mischief"],
  ["👿", "imp", "", "devil angry"],
  ["💀", "skull", "", "dead rip dying laughing"],
  ["☠️", "skull_and_crossbones", "", "dead danger poison"],
  ["💩", "poop", "hankey shit", "poo crap"],
  ["🤡", "clown_face", "", "clown joke"],
  ["👹", "japanese_ogre", "", "ogre monster"],
  ["👻", "ghost", "", "spooky halloween"],
  ["👽", "alien", "", "ufo space"],
  ["🤖", "robot", "", "bot android ai"],
  ["😺", "smiley_cat", "", "cat happy"],
  ["😹", "joy_cat", "", "cat laugh"],
  ["😻", "heart_eyes_cat", "", "cat love"],
  ["🙈", "see_no_evil", "", "monkey hide oops"],
  ["🙉", "hear_no_evil", "", "monkey"],
  ["🙊", "speak_no_evil", "", "monkey quiet"],
];

const PEOPLE: EmojiSpec[] = [
  ["👋", "wave", "", "hello hi bye hand"],
  ["🤚", "raised_back_of_hand", "", "hand"],
  ["🖐️", "raised_hand_with_fingers_splayed", "", "hand stop"],
  ["✋", "hand", "raised_hand", "stop high five"],
  ["🖖", "vulcan_salute", "", "spock star trek"],
  ["🫱", "rightwards_hand", "", "hand offer"],
  ["👌", "ok_hand", "", "ok perfect good"],
  ["🤌", "pinched_fingers", "", "italian chef gesture"],
  ["🤏", "pinching_hand", "", "small tiny bit"],
  ["✌️", "v", "victory", "peace two"],
  ["🤞", "crossed_fingers", "", "luck hope"],
  ["🫰", "hand_with_index_finger_and_thumb_crossed", "", "money heart finger"],
  ["🤟", "love_you_gesture", "", "love rock"],
  ["🤘", "metal", "", "rock horns"],
  ["🤙", "call_me_hand", "", "shaka hang loose"],
  ["👈", "point_left", "", "left finger"],
  ["👉", "point_right", "", "right finger this"],
  ["👆", "point_up_2", "", "up finger this"],
  ["🖕", "middle_finger", "fu", "rude"],
  ["👇", "point_down", "", "down finger"],
  ["☝️", "point_up", "", "up finger"],
  ["👍", "+1", "thumbsup thumbs_up", "yes good approve like lgtm"],
  ["👎", "-1", "thumbsdown thumbs_down", "no bad reject dislike"],
  ["✊", "fist", "fist_raised", "power solidarity"],
  ["👊", "punch", "fist_oncoming facepunch", "bump bro fist"],
  ["🤛", "fist_left", "", "bump"],
  ["🤜", "fist_right", "", "bump"],
  ["👏", "clap", "", "applause bravo praise"],
  ["🙌", "raised_hands", "", "praise celebrate hooray"],
  ["🫶", "heart_hands", "", "love heart hands"],
  ["👐", "open_hands", "", "hug"],
  ["🤲", "palms_up_together", "", "pray please"],
  ["🤝", "handshake", "", "deal agree partner"],
  ["🙏", "pray", "", "please thanks thank you namaste"],
  ["✍️", "writing_hand", "", "write sign"],
  ["💅", "nail_care", "", "nails polish sassy"],
  ["💪", "muscle", "", "strong flex biceps"],
  ["🦾", "mechanical_arm", "", "robot prosthetic strong"],
  ["🧠", "brain", "", "smart think mind"],
  ["👀", "eyes", "", "look watch see attention"],
  ["👁️", "eye", "", "look see"],
  ["🫀", "anatomical_heart", "", "heart organ"],
  ["👶", "baby", "", "child infant"],
  ["🧑", "adult", "", "person"],
  ["🧑‍💻", "technologist", "", "developer coder engineer laptop"],
  ["👨‍💻", "man_technologist", "", "developer coder engineer"],
  ["👩‍💻", "woman_technologist", "", "developer coder engineer"],
  ["🕵️", "detective", "", "spy investigate search"],
  ["💂", "guard", "", "royal"],
  ["🧑‍🚀", "astronaut", "", "space rocket"],
  ["🦸", "superhero", "", "hero save"],
  ["🧙", "mage", "", "wizard magic"],
  ["🧑‍🍳", "cook", "", "chef kitchen"],
  ["🤦", "facepalm", "person_facepalming", "disbelief ugh smh"],
  ["🤷", "shrug", "person_shrugging", "idk whatever dunno"],
  ["🙋", "raising_hand", "", "question volunteer me"],
  ["🙇", "bow", "", "sorry apology respect"],
  ["💁", "information_desk_person", "tipping_hand_person", "sassy info"],
  ["🙅", "no_good", "", "no stop refuse"],
  ["🙆", "ok_woman", "ok_person", "yes ok"],
  ["🕺", "man_dancing", "", "dance party"],
  ["💃", "dancer", "", "dance party"],
  ["🚶", "walking", "", "walk"],
  ["🏃", "runner", "running", "run fast"],
  ["🧘", "lotus_position", "", "meditate calm yoga"],
  ["🛌", "sleeping_bed", "", "sleep rest"],
];

const NATURE: EmojiSpec[] = [
  ["🐶", "dog", "", "puppy pet"],
  ["🐱", "cat", "", "kitten pet"],
  ["🐭", "mouse", "", "rodent"],
  ["🐹", "hamster", "", "pet"],
  ["🐰", "rabbit", "", "bunny"],
  ["🦊", "fox", "", "fox_face"],
  ["🐻", "bear", "", "grizzly"],
  ["🐼", "panda_face", "panda", "bear"],
  ["🐨", "koala", "", "bear australia"],
  ["🐯", "tiger", "", "cat big"],
  ["🦁", "lion", "", "cat big"],
  ["🐮", "cow", "", "moo"],
  ["🐷", "pig", "", "oink"],
  ["🐸", "frog", "", "toad"],
  ["🐵", "monkey_face", "", "ape"],
  ["🐔", "chicken", "", "hen"],
  ["🐧", "penguin", "", "bird cold"],
  ["🐦", "bird", "", "tweet"],
  ["🦆", "duck", "", "bird quack"],
  ["🦉", "owl", "", "bird wise"],
  ["🦄", "unicorn", "", "magic rare"],
  ["🐝", "bee", "honeybee", "buzz"],
  ["🐛", "bug", "", "insect defect issue"],
  ["🐞", "lady_beetle", "ladybug", "insect bug"],
  ["🕷️", "spider", "", "web insect"],
  ["🐢", "turtle", "", "slow"],
  ["🐍", "snake", "", "python"],
  ["🦖", "t_rex", "", "dinosaur"],
  ["🐙", "octopus", "", "sea tentacles"],
  ["🦑", "squid", "", "sea"],
  ["🦀", "crab", "", "rust sea"],
  ["🐬", "dolphin", "", "sea"],
  ["🐳", "whale", "", "sea docker"],
  ["🦈", "shark", "", "sea"],
  ["🐊", "crocodile", "", "gator"],
  ["🐴", "horse", "", "pony"],
  ["🦋", "butterfly", "", "insect"],
  ["🌵", "cactus", "", "plant desert"],
  ["🌲", "evergreen_tree", "", "tree pine"],
  ["🌳", "deciduous_tree", "", "tree"],
  ["🌴", "palm_tree", "", "tree beach"],
  ["🌱", "seedling", "", "plant grow sprout new"],
  ["🌿", "herb", "", "plant leaf"],
  ["🍀", "four_leaf_clover", "", "luck lucky"],
  ["🍁", "maple_leaf", "", "autumn canada"],
  ["🍂", "fallen_leaf", "", "autumn"],
  ["🌸", "cherry_blossom", "", "flower spring sakura"],
  ["🌹", "rose", "", "flower love"],
  ["🌻", "sunflower", "", "flower"],
  ["🌼", "blossom", "", "flower"],
  ["🌷", "tulip", "", "flower"],
  ["🌎", "earth_americas", "", "world globe planet"],
  ["🌍", "earth_africa", "", "world globe planet"],
  ["🌏", "earth_asia", "", "world globe planet"],
  ["🌕", "full_moon", "", "moon night"],
  ["🌙", "crescent_moon", "", "moon night"],
  ["⭐", "star", "", "favorite"],
  ["🌟", "star2", "glowing_star", "sparkle shine"],
  ["✨", "sparkles", "", "shiny magic new clean"],
  ["⚡", "zap", "", "lightning fast power"],
  ["🔥", "fire", "", "hot lit flame burn"],
  ["💥", "boom", "collision", "explosion crash"],
  ["🌈", "rainbow", "", "pride colors"],
  ["☀️", "sunny", "", "sun clear weather"],
  ["⛅", "partly_sunny", "", "cloud weather"],
  ["☁️", "cloud", "", "weather cloudy"],
  ["🌧️", "cloud_with_rain", "", "rain weather"],
  ["⛈️", "thunder_cloud_and_rain", "", "storm weather"],
  ["❄️", "snowflake", "", "cold snow winter freeze"],
  ["🌊", "ocean", "", "wave water sea"],
  ["💧", "droplet", "", "water drop"],
];

const FOOD: EmojiSpec[] = [
  ["🍏", "green_apple", "", "fruit"],
  ["🍎", "apple", "", "fruit"],
  ["🍐", "pear", "", "fruit"],
  ["🍊", "tangerine", "orange", "fruit citrus"],
  ["🍋", "lemon", "", "fruit citrus sour"],
  ["🍌", "banana", "", "fruit"],
  ["🍉", "watermelon", "", "fruit summer"],
  ["🍇", "grapes", "", "fruit wine"],
  ["🍓", "strawberry", "", "fruit berry"],
  ["🫐", "blueberries", "", "fruit berry"],
  ["🍒", "cherries", "", "fruit"],
  ["🍑", "peach", "", "fruit"],
  ["🥭", "mango", "", "fruit tropical"],
  ["🍍", "pineapple", "", "fruit tropical"],
  ["🥥", "coconut", "", "fruit tropical"],
  ["🥑", "avocado", "", "toast fruit"],
  ["🍆", "eggplant", "", "aubergine vegetable"],
  ["🥕", "carrot", "", "vegetable"],
  ["🌽", "corn", "", "vegetable maize"],
  ["🌶️", "hot_pepper", "", "spicy chili"],
  ["🥦", "broccoli", "", "vegetable"],
  ["🧄", "garlic", "", "vegetable"],
  ["🍄", "mushroom", "", "fungus"],
  ["🥐", "croissant", "", "bread french"],
  ["🍞", "bread", "", "loaf toast"],
  ["🥨", "pretzel", "", "snack"],
  ["🧀", "cheese", "", "dairy"],
  ["🥚", "egg", "", "breakfast"],
  ["🥞", "pancakes", "", "breakfast"],
  ["🥓", "bacon", "", "breakfast pork"],
  ["🍔", "hamburger", "", "burger food"],
  ["🍟", "fries", "", "chips food"],
  ["🍕", "pizza", "", "slice food"],
  ["🌭", "hotdog", "", "food"],
  ["🌮", "taco", "", "mexican food"],
  ["🌯", "burrito", "", "mexican food"],
  ["🥗", "green_salad", "", "healthy food"],
  ["🍜", "ramen", "", "noodles soup"],
  ["🍣", "sushi", "", "japanese fish"],
  ["🍦", "icecream", "", "dessert sweet"],
  ["🍩", "doughnut", "donut", "dessert sweet"],
  ["🍪", "cookie", "", "dessert sweet biscuit"],
  ["🎂", "birthday", "", "cake celebrate"],
  ["🍰", "cake", "", "dessert sweet"],
  ["🍫", "chocolate_bar", "", "sweet candy"],
  ["🍿", "popcorn", "", "movie snack drama"],
  ["🍯", "honey_pot", "", "sweet"],
  ["☕", "coffee", "", "cafe espresso morning"],
  ["🍵", "tea", "", "green drink"],
  ["🧋", "bubble_tea", "", "boba drink"],
  ["🍺", "beer", "", "drink pub"],
  ["🍻", "beers", "", "cheers drink"],
  ["🥂", "champagne_glasses", "clinking_glasses", "cheers celebrate toast"],
  ["🍷", "wine_glass", "", "drink"],
  ["🥃", "tumbler_glass", "", "whiskey drink"],
  ["🍸", "cocktail", "", "drink martini"],
  ["🧉", "mate", "", "drink"],
  ["🥤", "cup_with_straw", "", "soda drink"],
  ["🧊", "ice_cube", "", "cold freeze"],
];

const ACTIVITY: EmojiSpec[] = [
  ["⚽", "soccer", "", "football sport ball"],
  ["🏀", "basketball", "", "sport ball"],
  ["🏈", "football", "", "sport ball nfl"],
  ["⚾", "baseball", "", "sport ball"],
  ["🎾", "tennis", "", "sport ball"],
  ["🏐", "volleyball", "", "sport ball"],
  ["🏓", "ping_pong", "", "table tennis sport"],
  ["🏸", "badminton", "", "sport"],
  ["🥅", "goal_net", "", "sport hockey"],
  ["⛳", "golf", "", "sport hole"],
  ["🎯", "dart", "", "target bullseye goal aim"],
  ["🎳", "bowling", "", "sport strike"],
  ["🎮", "video_game", "", "game controller play"],
  ["🕹️", "joystick", "", "game arcade"],
  ["🎲", "game_die", "", "dice random luck"],
  ["🧩", "jigsaw", "puzzle_piece", "puzzle piece fit"],
  ["♟️", "chess_pawn", "", "chess strategy"],
  ["🎨", "art", "", "paint design palette"],
  ["🎭", "performing_arts", "", "theater drama"],
  ["🎤", "microphone", "", "sing mic podcast"],
  ["🎧", "headphones", "", "music listen audio"],
  ["🎵", "musical_note", "", "music song"],
  ["🎶", "notes", "", "music song"],
  ["🎸", "guitar", "", "music rock"],
  ["🥁", "drum", "", "music beat"],
  ["🎹", "musical_keyboard", "", "piano music"],
  ["🎬", "clapper", "", "movie film action"],
  ["🏆", "trophy", "", "win award champion"],
  ["🥇", "1st_place_medal", "first_place", "gold win"],
  ["🥈", "2nd_place_medal", "second_place", "silver"],
  ["🥉", "3rd_place_medal", "third_place", "bronze"],
  ["🏅", "medal_sports", "", "award win"],
  ["🎖️", "military_medal", "", "award honor"],
  ["🎉", "tada", "", "party celebrate hooray launch"],
  ["🎊", "confetti_ball", "", "party celebrate"],
  ["🎈", "balloon", "", "party birthday"],
  ["🎁", "gift", "", "present birthday"],
  ["🎃", "jack_o_lantern", "", "halloween pumpkin"],
  ["🎄", "christmas_tree", "", "holiday xmas"],
  ["🧨", "firecracker", "", "explode boom"],
  ["🪩", "mirror_ball", "", "disco party"],
];

const TRAVEL: EmojiSpec[] = [
  ["🚀", "rocket", "", "launch ship deploy fast space"],
  ["🛸", "flying_saucer", "", "ufo alien"],
  ["✈️", "airplane", "", "flight travel plane"],
  ["🛫", "airplane_departure", "", "takeoff travel"],
  ["🛬", "airplane_arriving", "", "landing travel"],
  ["🚁", "helicopter", "", "fly"],
  ["🚗", "car", "red_car", "drive auto"],
  ["🚕", "taxi", "", "cab"],
  ["🚙", "blue_car", "", "suv drive"],
  ["🚌", "bus", "", "transit"],
  ["🚑", "ambulance", "", "emergency"],
  ["🚒", "fire_engine", "", "emergency truck"],
  ["🚓", "police_car", "", "cops"],
  ["🚚", "truck", "", "delivery ship"],
  ["🚜", "tractor", "", "farm"],
  ["🏍️", "motorcycle", "", "ride"],
  ["🚲", "bike", "bicycle", "ride cycle"],
  ["🛴", "kick_scooter", "", "ride"],
  ["🚂", "steam_locomotive", "", "train rail"],
  ["🚆", "train", "", "rail transit"],
  ["🚇", "metro", "", "subway transit"],
  ["⛵", "sailboat", "", "boat sea"],
  ["🚢", "ship", "", "boat sea cargo"],
  ["⚓", "anchor", "", "ship harbor"],
  ["🗺️", "world_map", "", "travel map"],
  ["🧭", "compass", "", "direction navigate"],
  ["🏔️", "mountain_snow", "", "peak climb"],
  ["🌋", "volcano", "", "eruption lava"],
  ["🏕️", "camping", "", "tent outdoors"],
  ["🏖️", "beach_umbrella", "", "vacation sand"],
  ["🏠", "house", "", "home"],
  ["🏢", "office", "", "building work"],
  ["🏭", "factory", "", "industry build"],
  ["🏰", "european_castle", "", "castle"],
  ["🗽", "statue_of_liberty", "", "nyc usa"],
  ["🌃", "night_with_stars", "", "city night"],
  ["🌉", "bridge_at_night", "", "city night"],
  ["🚦", "vertical_traffic_light", "", "signal stop go"],
  ["🚧", "construction", "", "wip barrier work in progress"],
];

const OBJECTS: EmojiSpec[] = [
  ["💻", "computer", "", "laptop code work"],
  ["🖥️", "desktop_computer", "", "monitor screen"],
  ["⌨️", "keyboard", "", "type keys clickclack"],
  ["🖱️", "computer_mouse", "", "click"],
  ["🖨️", "printer", "", "print"],
  ["📱", "iphone", "mobile_phone", "phone mobile"],
  ["☎️", "telephone", "", "call phone"],
  ["📞", "telephone_receiver", "", "call phone"],
  ["📷", "camera", "", "photo picture"],
  ["📹", "video_camera", "", "record film"],
  ["📺", "tv", "", "television watch"],
  ["🎥", "movie_camera", "", "film record"],
  ["🔋", "battery", "", "power charge"],
  ["🔌", "electric_plug", "", "power plug connect"],
  ["💾", "floppy_disk", "", "save disk"],
  ["💿", "cd", "", "disc"],
  ["🗜️", "clamp", "", "compress squeeze"],
  ["📀", "dvd", "", "disc"],
  ["🧮", "abacus", "", "count math"],
  ["📡", "satellite", "", "signal broadcast"],
  ["🔭", "telescope", "", "space look observe"],
  ["🔬", "microscope", "", "science inspect"],
  ["🧪", "test_tube", "", "science experiment lab"],
  ["🧬", "dna", "", "genetics science"],
  ["💡", "bulb", "", "idea light"],
  ["🔦", "flashlight", "", "torch light"],
  ["🕯️", "candle", "", "light"],
  ["🧯", "fire_extinguisher", "", "put out incident"],
  ["🔨", "hammer", "", "build tool fix"],
  ["🛠️", "hammer_and_wrench", "", "tools build fix"],
  ["🔧", "wrench", "", "fix tool config"],
  ["🔩", "nut_and_bolt", "", "hardware"],
  ["⚙️", "gear", "", "settings config cog"],
  ["🧰", "toolbox", "", "tools"],
  ["🧱", "bricks", "", "wall build"],
  ["🪛", "screwdriver", "", "tool fix"],
  ["🔒", "lock", "", "secure closed private"],
  ["🔓", "unlock", "", "open insecure"],
  ["🔑", "key", "", "password access secret"],
  ["🗝️", "old_key", "", "access secret"],
  ["🛡️", "shield", "", "security protect defense"],
  ["🔐", "closed_lock_with_key", "", "secure credentials"],
  ["📦", "package", "", "box ship release npm"],
  ["📫", "mailbox", "", "mail post"],
  ["✉️", "envelope", "", "mail email"],
  ["📝", "memo", "pencil", "note write edit"],
  ["📄", "page_facing_up", "", "document file"],
  ["📋", "clipboard", "", "copy paste list"],
  ["📊", "bar_chart", "", "stats metrics graph"],
  ["📈", "chart_with_upwards_trend", "chart_increasing", "growth up metrics"],
  ["📉", "chart_with_downwards_trend", "chart_decreasing", "down loss metrics"],
  ["🗓️", "calendar", "spiral_calendar", "date schedule"],
  ["📌", "pushpin", "", "pin location note"],
  ["📎", "paperclip", "", "attach file"],
  ["🗂️", "card_index_dividers", "", "files organize"],
  ["📁", "file_folder", "", "directory folder"],
  ["🗄️", "file_cabinet", "", "storage archive"],
  ["🗑️", "wastebasket", "", "trash delete bin"],
  ["📚", "books", "", "read docs library"],
  ["📖", "open_book", "", "read docs"],
  ["🔖", "bookmark", "", "save tag"],
  ["🏷️", "label", "", "tag"],
  ["💰", "moneybag", "", "cash money"],
  ["💸", "money_with_wings", "", "spend cost burn"],
  ["💳", "credit_card", "", "pay billing"],
  ["⚖️", "balance_scale", "", "justice tradeoff fair"],
  ["🔍", "mag", "search", "find zoom look"],
  ["🔎", "mag_right", "", "search find zoom"],
  ["⏳", "hourglass_flowing_sand", "", "wait time loading"],
  ["⌛", "hourglass", "", "time done"],
  ["⏰", "alarm_clock", "", "time wake reminder"],
  ["⏱️", "stopwatch", "", "time measure speed"],
  ["🪄", "magic_wand", "", "magic fix"],
  ["🧹", "broom", "", "clean sweep cleanup"],
  ["🧼", "soap", "", "clean wash"],
  ["🩹", "adhesive_bandage", "", "bandaid patch fix hotfix"],
  ["💊", "pill", "", "medicine"],
  ["🚬", "smoking", "", "cigarette"],
  ["🪟", "window", "", "view"],
  ["🛎️", "bellhop_bell", "", "service ping notify"],
  ["🔔", "bell", "", "notify alert ring"],
  ["🔕", "no_bell", "", "mute silence"],
  ["📣", "mega", "", "announce shout loud"],
  ["📢", "loudspeaker", "", "announce broadcast"],
];

const SYMBOLS: EmojiSpec[] = [
  ["❤️", "heart", "red_heart", "love like"],
  ["🧡", "orange_heart", "", "love"],
  ["💛", "yellow_heart", "", "love"],
  ["💚", "green_heart", "", "love"],
  ["💙", "blue_heart", "", "love"],
  ["💜", "purple_heart", "", "love"],
  ["🖤", "black_heart", "", "love dark"],
  ["🤍", "white_heart", "", "love"],
  ["🤎", "brown_heart", "", "love"],
  ["💔", "broken_heart", "", "sad breakup"],
  ["❣️", "heavy_heart_exclamation", "", "love"],
  ["💕", "two_hearts", "", "love"],
  ["💖", "sparkling_heart", "", "love sparkle"],
  ["💯", "100", "hundred", "perfect score agree"],
  ["✅", "white_check_mark", "check", "done yes pass approve"],
  ["☑️", "ballot_box_with_check", "", "done checkbox"],
  ["✔️", "heavy_check_mark", "", "done yes"],
  ["❌", "x", "cross_mark", "no fail wrong reject"],
  ["❎", "negative_squared_cross_mark", "", "no fail"],
  ["⚠️", "warning", "", "caution alert danger"],
  ["🚫", "no_entry_sign", "", "forbidden blocked stop"],
  ["⛔", "no_entry", "", "stop blocked"],
  ["❓", "question", "", "ask help unknown"],
  ["❗", "exclamation", "", "important alert"],
  ["‼️", "bangbang", "", "important urgent"],
  ["⁉️", "interrobang", "", "what confused"],
  ["💤", "zzz", "", "sleep idle"],
  ["💭", "thought_balloon", "", "think idea"],
  ["💬", "speech_balloon", "", "chat message comment"],
  ["🗯️", "right_anger_bubble", "", "rage shout"],
  ["♻️", "recycle", "", "reuse refactor green"],
  ["🔄", "arrows_counterclockwise", "", "refresh retry sync loop"],
  ["🔁", "repeat", "", "loop again"],
  ["🔀", "twisted_rightwards_arrows", "shuffle", "random swap"],
  ["⬆️", "arrow_up", "", "up increase"],
  ["⬇️", "arrow_down", "", "down decrease"],
  ["⬅️", "arrow_left", "", "left back"],
  ["➡️", "arrow_right", "", "right forward next"],
  ["↩️", "leftwards_arrows_hook", "", "back undo reply"],
  ["🔼", "arrow_up_small", "", "up"],
  ["🔽", "arrow_down_small", "", "down"],
  ["▶️", "arrow_forward", "play", "start run"],
  ["⏸️", "pause_button", "", "pause hold"],
  ["⏹️", "stop_button", "", "stop halt"],
  ["⏺️", "record_button", "", "record"],
  ["⏭️", "next_track_button", "", "skip forward"],
  ["⏮️", "previous_track_button", "", "back rewind"],
  ["🆕", "new", "", "fresh badge"],
  ["🆗", "ok", "", "okay fine"],
  ["🆘", "sos", "", "help emergency"],
  ["🔝", "top", "", "up best"],
  ["🔜", "soon", "", "later upcoming"],
  ["©️", "copyright", "", "legal"],
  ["®️", "registered", "", "legal trademark"],
  ["™️", "tm", "", "trademark"],
  ["#️⃣", "hash", "", "number channel"],
  ["*️⃣", "asterisk", "", "star wildcard"],
  ["0️⃣", "zero", "", "number 0"],
  ["1️⃣", "one", "", "number 1"],
  ["2️⃣", "two", "", "number 2"],
  ["3️⃣", "three", "", "number 3"],
  ["🔟", "keycap_ten", "", "number 10"],
  ["🟢", "green_circle", "", "status healthy online"],
  ["🟡", "yellow_circle", "", "status warning"],
  ["🔴", "red_circle", "", "status down error recording"],
  ["🔵", "large_blue_circle", "", "status info"],
  ["⚫", "black_circle", "", "dot"],
  ["⚪", "white_circle", "", "dot"],
  ["🟩", "green_square", "", "status pass"],
  ["🟥", "red_square", "", "status fail"],
  ["🔶", "large_orange_diamond", "", "shape"],
  ["🔺", "small_red_triangle", "", "up increase"],
  ["🔻", "small_red_triangle_down", "", "down decrease"],
  ["💠", "diamond_shape_with_a_dot_inside", "", "shape"],
  ["🕐", "clock1", "", "time one"],
  ["🏁", "checkered_flag", "", "finish race done"],
  ["🚩", "triangular_flag_on_post", "", "flag mark issue"],
  ["🏴‍☠️", "pirate_flag", "", "pirate arr"],
];

const GROUPED_SPECS: [EmojiGroup, EmojiSpec[]][] = [
  ["smileys", SMILEYS],
  ["people", PEOPLE],
  ["nature", NATURE],
  ["food", FOOD],
  ["activity", ACTIVITY],
  ["travel", TRAVEL],
  ["objects", OBJECTS],
  ["symbols", SYMBOLS],
];

export const EMOJI_CATALOG: EmojiEntry[] = GROUPED_SPECS.flatMap(([group, specs]) =>
  specs.map(([char, name, aliases, keywords]) => ({
    char,
    name,
    aliases: aliases ? aliases.split(" ").filter(Boolean) : [],
    keywords,
    group,
  })),
);

const BY_SHORTCODE = new Map<string, EmojiEntry>();
for (const entry of EMOJI_CATALOG) {
  if (!BY_SHORTCODE.has(entry.name)) BY_SHORTCODE.set(entry.name, entry);
  for (const alias of entry.aliases) {
    if (!BY_SHORTCODE.has(alias)) BY_SHORTCODE.set(alias, entry);
  }
}

/* Every shortcode is lowercase already; normalizing keeps `:SOB:` working. */
function normalizeShortcode(shortcode: string): string {
  return shortcode
    .trim()
    .toLowerCase()
    .replace(/^:+|:+$/g, "");
}

/** Resolves `sob`, `:sob:`, or an alias to its emoji entry. */
export function emojiForShortcode(shortcode: string): EmojiEntry | null {
  const key = normalizeShortcode(shortcode);
  if (!key) return null;
  return BY_SHORTCODE.get(key) ?? null;
}

export function emojiCharForShortcode(shortcode: string): string | null {
  return emojiForShortcode(shortcode)?.char ?? null;
}

export function emojiGroup(group: EmojiGroup): EmojiEntry[] {
  return EMOJI_CATALOG.filter((entry) => entry.group === group);
}

/* Ranking: exact shortcode, then name prefix, then alias prefix, then any
   substring across name/aliases/keywords. Ties fall back to shortcode length
   so `:sm` offers `smile` before `smiling_face_with_three_hearts`. */
function matchScore(entry: EmojiEntry, query: string): number {
  if (entry.name === query || entry.aliases.includes(query)) return 0;
  if (entry.name.startsWith(query)) return 1;
  if (entry.aliases.some((alias) => alias.startsWith(query))) return 2;
  if (entry.name.includes(query)) return 3;
  if (entry.aliases.some((alias) => alias.includes(query))) return 4;
  if (new RegExp(`(^| )${escapeRegExp(query)}`).test(entry.keywords)) return 5;
  if (entry.keywords.includes(query)) return 6;
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchEmoji(rawQuery: string, limit = 8): EmojiEntry[] {
  const query = normalizeShortcode(rawQuery);
  if (!query) return EMOJI_CATALOG.slice(0, limit);
  const scored: { entry: EmojiEntry; score: number; index: number }[] = [];
  EMOJI_CATALOG.forEach((entry, index) => {
    const score = matchScore(entry, query);
    if (score >= 0) scored.push({ entry, score, index });
  });
  scored.sort(
    (a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length || a.index - b.index,
  );
  return scored.slice(0, limit).map((item) => item.entry);
}

/* Matches a `:shortcode:` that the caret just completed. Anchored to the end of
   the text so callers can run it against everything before the cursor. */
const COMPLETED_SHORTCODE = /(^|[\s([{'"])(:([a-z0-9_+-]{1,64}):)$/i;

export type CompletedShortcodeMatch = {
  /* Offsets are relative to the string that was searched. */
  start: number;
  end: number;
  shortcode: string;
  char: string;
};

/** Finds a just-completed `:shortcode:` at the end of `textBeforeCaret`. */
export function completedShortcodeAt(textBeforeCaret: string): CompletedShortcodeMatch | null {
  const match = COMPLETED_SHORTCODE.exec(textBeforeCaret);
  if (!match) return null;
  const token = match[2];
  const char = emojiCharForShortcode(match[3]);
  if (!char) return null;
  return {
    start: textBeforeCaret.length - token.length,
    end: textBeforeCaret.length,
    shortcode: match[3].toLowerCase(),
    char,
  };
}

/** Replaces every known `:shortcode:` in a block of text. Unknown codes stay. */
export function replaceShortcodes(text: string): string {
  return text.replace(/:([a-z0-9_+-]{1,64}):/gi, (token, shortcode: string) => {
    return emojiCharForShortcode(shortcode) ?? token;
  });
}

const RECENTS_KEY = "clickclack:emoji-recents";
const RECENTS_LIMIT = 24;

/** Pure recents merge so the storage wrapper stays trivial and testable. */
export function mergeRecentEmoji(recents: string[], name: string): string[] {
  return [name, ...recents.filter((entry) => entry !== name)].slice(0, RECENTS_LIMIT);
}

export function loadRecentEmoji(): EmojiEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const names = JSON.parse(raw) as unknown;
    if (!Array.isArray(names)) return [];
    return names
      .filter((name): name is string => typeof name === "string")
      .map((name) => emojiForShortcode(name))
      .filter((entry): entry is EmojiEntry => entry !== null)
      .slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecentEmoji(name: string): EmojiEntry[] {
  const merged = mergeRecentEmoji(
    loadRecentEmoji().map((entry) => entry.name),
    name,
  );
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(merged));
    } catch {
      /* Storage is best-effort; a full or blocked quota must not break input. */
    }
  }
  return merged
    .map((entry) => emojiForShortcode(entry))
    .filter((entry): entry is EmojiEntry => entry !== null);
}
