/**
 * Secret Squad word packs. Plain data: no logic lives here.
 *
 * Each squad in a round gets one theme; each member gets a different word of
 * it, and nobody is told the theme. A pack is four themes written to mislead
 * each other: every word should look like it could belong to at least one
 * other theme of the same pack, so teammates can't be spotted just by reading
 * words. The server deals whole packs together where it can and skips packs
 * an org played recently.
 *
 * Every theme has 24 words, ordered TRICKIEST FIRST: the words that pull
 * hardest toward another theme come first, the plain ones last. A squad of
 * `s` takes the first `s` words, so small squads get the best traps and the
 * tail is only reached by squads of 20 or more.
 *
 * Rules (checked by `src/scripts/secret-squad-packs-check.ts`): 4 themes per
 * pack, at least 20 words per theme, at most 14 characters per word, and no
 * word anywhere twice (ignoring case, spaces and punctuation). Pack ids are
 * stable: rotation history refers to them, so never rename one.
 */

export interface SquadTheme {
  name: string;
  words: string[];
  /** One line on what this theme's words pull toward. */
  traps: string;
}

export interface SquadPack {
  id: string;
  name: string;
  difficulty: 'easy' | 'medium' | 'hard';
  themes: SquadTheme[];
}

export const SQUAD_PACKS: SquadPack[] = [
  {
    id: 'mars-jaguar',
    name: 'Mars or Jaguar?',
    difficulty: 'medium',
    themes: [
      {
        name: 'Chocolates',
        words: [
          'MARS', 'GALAXY', 'MILKY WAY', 'GEMS', 'BOUNTY', 'PERK', 'MUNCH', 'FUSE',
          'SILK', 'FIVE STAR', 'AERO', 'KINDER', 'ECLAIRS', 'MELODY', 'TWIX', 'SNICKERS',
          'KITKAT', 'BOURNVILLE', 'TEMPTATIONS', 'TOBLERONE', 'FERRERO', 'DAIRY MILK', 'NUTTIES', 'ALPENLIEBE',
        ],
        traps: 'Mars, Galaxy, Milky Way and Five Star pull toward Space; Gems toward Ruby; Perk, Munch, Fuse and Silk read as plain words.',
      },
      {
        name: 'Car names',
        words: [
          'JAGUAR', 'BEETLE', 'MUSTANG', 'SWIFT', 'SAFARI', 'SCORPIO', 'PUNCH', 'NANO',
          'POLO', 'COMPASS', 'CIVIC', 'VENUE', 'CITY', 'ZEN', 'ALTO', 'HECTOR',
          'INNOVA', 'THAR', 'BALENO', 'VERNA', 'FORTUNER', 'ERTIGA', 'NEXON', 'CRETA',
        ],
        traps: 'Jaguar, Beetle and Mustang look like animals; Swift like a coding language; Scorpio like a star sign (Space); Safari like a browser.',
      },
      {
        name: 'Coding languages',
        words: [
          'PYTHON', 'RUBY', 'JAVA', 'RUST', 'DART', 'GO', 'PERL', 'JULIA',
          'PASCAL', 'BASIC', 'SCRATCH', 'BASH', 'SCALA', 'C SHARP', 'LUA', 'KOTLIN',
          'MATLAB', 'HASKELL', 'COBOL', 'FORTRAN', 'SQL', 'PHP', 'TYPESCRIPT', 'JAVASCRIPT',
        ],
        traps: 'Python pulls toward Jaguar and Beetle; Ruby and Perl toward Gems; Java reads as coffee, Dart as a pub game, Julia as a name.',
      },
      {
        name: 'Space',
        words: [
          'MERCURY', 'PLUTO', 'ORBIT', 'COMET', 'VENUS', 'NOVA', 'ROVER', 'ECLIPSE',
          'COSMOS', 'MANGALYAAN', 'SATURN', 'NEBULA', 'ROCKET', 'GRAVITY', 'NEPTUNE', 'ASTEROID',
          'SATELLITE', 'SUPERNOVA', 'QUASAR', 'BLACK HOLE', 'TELESCOPE', 'SPUTNIK', 'CHANDRAYAAN', 'MOON',
        ],
        traps: 'The obvious-looking squad Mars is not in. Rover sounds like a car; Orbit is a gum, Pluto a cartoon dog, Venus a razor, Mangalyaan pulls toward Mars.',
      },
    ],
  },
  {
    id: 'out-for-a-duck',
    name: 'Out for a duck',
    difficulty: 'easy',
    themes: [
      {
        name: 'Cricket',
        words: [
          'DUCK', 'MAIDEN', 'SLIP', 'COVER', 'PITCH', 'BOUNCER', 'GULLY', 'OVER',
          'FINE LEG', 'SILLY POINT', 'CENTURY', 'INNINGS', 'STUMPS', 'BAILS', 'GOOGLY', 'YORKER',
          'DOOSRA', 'NIGHTWATCHMAN', 'NO BALL', 'FREE HIT', 'POWERPLAY', 'RUN OUT', 'BOUNDARY', 'WICKET',
        ],
        traps: 'Duck pulls toward Birds; Pitch toward Music; Slip and Cover toward Laundry; Maiden, Bouncer and Gully read as everyday words.',
      },
      {
        name: 'Birds',
        words: [
          'KITE', 'CRANE', 'ROBIN', 'KINGFISHER', 'PENGUIN', 'JAY', 'FALCON', 'CUCKOO',
          'NIGHTINGALE', 'LARK', 'KOEL', 'SWAN', 'PARROT', 'PEACOCK', 'SPARROW', 'EAGLE',
          'OWL', 'HAWK', 'PIGEON', 'MYNA', 'FLAMINGO', 'HORNBILL', 'WOODPECKER', 'OSTRICH',
        ],
        traps: 'Nightingale, Koel, Cuckoo and Lark sound like Music (singers); Kite and Crane read as a toy and a machine; Kingfisher and Penguin as brands.',
      },
      {
        name: 'Music words',
        words: [
          'RECORD', 'NOTE', 'KEY', 'BEAT', 'SCALE', 'BAR', 'REST', 'STAFF',
          'FLAT', 'BASS', 'TREBLE', 'TEMPO', 'CHORD', 'RHYTHM', 'TUNE', 'RAGA',
          'TAAL', 'RIFF', 'SOLO', 'DUET', 'ENCORE', 'OCTAVE', 'HARMONY', 'CHORUS',
        ],
        traps: 'Record pulls toward Cricket; Beat toward Laundry (the dhobi beats clothes); Key, Note, Bar, Rest, Staff and Flat read as everyday words.',
      },
      {
        name: 'Laundry day',
        words: [
          'SPIN', 'CREASE', 'PRESS', 'IRON', 'STARCH', 'BLEACH', 'RINSE', 'FOLD',
          'SOAK', 'STAIN', 'HANGER', 'PEG', 'TUMBLE', 'WRING', 'STEAM', 'LOAD',
          'DETERGENT', 'SOFTENER', 'LINT', 'BUCKET', 'DHOBI', 'CLOTHESLINE', 'DRY CLEAN', 'WRINKLE',
        ],
        traps: 'Spin and Crease pull hard toward Cricket; Press, Iron and Steam read as other things; Tumble and Fold sound like a dance or a card game.',
      },
    ],
  },
  {
    id: 'blender-rhino',
    name: 'Blender & Rhino',
    difficulty: 'hard',
    themes: [
      {
        name: 'Design software',
        words: [
          'BLENDER', 'RHINO', 'GRASSHOPPER', 'MAYA', 'UNITY', 'UNREAL', 'HOUDINI', 'SKETCHUP',
          'PREMIERE', 'NUKE', 'SUBSTANCE', 'KEYSHOT', 'LUMION', 'REVIT', 'V-RAY', 'ENSCAPE',
          'TWINMOTION', 'ZBRUSH', '3DS MAX', 'CINEMA 4D', 'AUTOCAD', 'PHOTOSHOP', 'FIGMA', 'CANVA',
        ],
        traps: 'Blender pulls toward the Kitchen; Grasshopper toward Insects; Rhino reads as an animal, Maya as a name, Houdini as a magician; Revit pulls toward Architecture.',
      },
      {
        name: 'Kitchen',
        words: [
          'MIXER', 'CHIMNEY', 'GRILL', 'PAN', 'CHOPPER', 'COOKER', 'INDUCTION', 'MICROWAVE',
          'STRAINER', 'TONGS', 'WHISK', 'PEELER', 'GRATER', 'LADLE', 'SPATULA', 'KETTLE',
          'TOASTER', 'OVEN', 'TAWA', 'KADHAI', 'BELAN', 'CHAKLA', 'SIEVE', 'JUICER',
        ],
        traps: 'Chimney and Grill pull toward Architecture; Mixer and Pan sound like software tools; Chopper reads as a helicopter.',
      },
      {
        name: 'Creepy crawlies',
        words: [
          'CRICKET', 'CATERPILLAR', 'MANTIS', 'FIREFLY', 'TICK', 'FLY', 'BEDBUG', 'SILVERFISH',
          'ANT', 'MOTH', 'WASP', 'BEE', 'SPIDER', 'SCORPION', 'FLEA', 'SLUG',
          'LADYBUG', 'DRAGONFLY', 'LOCUST', 'TERMITE', 'COCKROACH', 'MOSQUITO', 'CENTIPEDE', 'SNAIL',
        ],
        traps: 'Grasshopper (software) pulls here; Caterpillar reads as a construction machine (Architecture); Cricket, Tick and Fly read as other things.',
      },
      {
        name: 'Architecture',
        words: [
          'COLUMN', 'BEAM', 'SLAB', 'LOBBY', 'PODIUM', 'FOYER', 'ATRIUM', 'FACADE',
          'ELEVATION', 'BLUEPRINT', 'ARCH', 'PLINTH', 'TRUSS', 'SKYLIGHT', 'SPIRE', 'LINTEL',
          'CANTILEVER', 'PARAPET', 'BALCONY', 'VERANDA', 'PILLAR', 'DOME', 'COURTYARD', 'MEZZANINE',
        ],
        traps: 'Elevation, Blueprint and Skylight sound like software; Column, Beam, Slab and Lobby read as everyday words; Chimney (Kitchen) looks like it belongs here.',
      },
    ],
  },
  {
    id: 'puma-nike',
    name: 'Puma & Nike',
    difficulty: 'medium',
    themes: [
      {
        name: 'Shoe brands',
        words: [
          'PUMA', 'NIKE', 'REEBOK', 'CROCS', 'JORDAN', 'METRO', 'MOCHI', 'CONVERSE',
          'CAMPUS', 'LIBERTY', 'ACTION', 'VANS', 'WOODLAND', 'LOTTO', 'DECATHLON', 'BATA',
          'ASICS', 'FILA', 'RED TAPE', 'SKECHERS', 'ADIDAS', 'SPARX', 'RELAXO', 'HUSH PUPPIES',
        ],
        traps: 'Puma, Reebok and Crocs pull toward Animals; Nike toward Greek myths (the goddess); Jordan toward Countries; Metro and Campus read as places.',
      },
      {
        name: 'Animals',
        words: [
          'LYNX', 'IMPALA', 'WHALE', 'GAZELLE', 'BULL', 'SEAL', 'COBRA', 'PANTHER',
          'BAT', 'CHEETAH', 'FOX', 'BEAR', 'WOLF', 'ANTELOPE', 'ZEBRA', 'GIRAFFE',
          'HIPPO', 'ELEPHANT', 'LION', 'LEOPARD', 'KANGAROO', 'PANDA', 'SLOTH', 'OTTER',
        ],
        traps: 'Gazelle sounds like a shoe; Whale like Wales (Countries); Lynx is a deo, Impala a car, Bull and Seal read as other things.',
      },
      {
        name: 'Greek myths',
        words: [
          'ATLAS', 'HERCULES', 'HERMES', 'TITAN', 'APOLLO', 'PANDORA', 'ORACLE', 'ECHO',
          'MIDAS', 'PHOENIX', 'PEGASUS', 'CENTAUR', 'MINOTAUR', 'TROY', 'ODYSSEY', 'ACHILLES',
          'CUPID', 'MEDUSA', 'HYDRA', 'SIREN', 'ZEUS', 'ATHENA', 'POSEIDON', 'OLYMPUS',
        ],
        traps: 'Hermes reads as a fashion brand (Shoe brands); Pegasus, Centaur and Minotaur as Animals; Atlas and Hercules as cycles, Titan as a watch, Apollo as a hospital.',
      },
      {
        name: 'Countries',
        words: [
          'TURKEY', 'GREECE', 'HUNGARY', 'WALES', 'CHILE', 'CHINA', 'CHAD', 'GEORGIA',
          'PANAMA', 'GUINEA', 'CUBA', 'MALI', 'TOGO', 'JAMAICA', 'PERU', 'OMAN',
          'KENYA', 'NEPAL', 'BHUTAN', 'JAPAN', 'BRAZIL', 'CYPRUS', 'ICELAND', 'NORWAY',
        ],
        traps: 'Turkey pulls toward Animals; Greece toward Greek myths; Hungary, Chile, China, Chad and Mali read as words or names.',
      },
    ],
  },
  {
    id: 'thunder-chrome',
    name: 'Thunder & Chrome',
    difficulty: 'medium',
    themes: [
      {
        name: 'Bikes & scooters',
        words: [
          'PULSAR', 'JUPITER', 'METEOR', 'AVENGER', 'UNICORN', 'THUNDERBIRD', 'HORNET', 'APACHE',
          'CHETAK', 'PLATINA', 'SHINE', 'SPLENDOR', 'PASSION', 'GLAMOUR', 'PLEASURE', 'DISCOVER',
          'BULLET', 'CLASSIC', 'HIMALAYAN', 'HUNTER', 'DUKE', 'ACTIVA', 'ACCESS', 'SCOOTY',
        ],
        traps: 'Avenger pulls toward Superheroes; Thunderbird and Shine toward Weather; Platina toward Metals; Pulsar, Jupiter and Meteor look like space words.',
      },
      {
        name: 'Superheroes',
        words: [
          'THOR', 'STORM', 'FLASH', 'IRON MAN', 'MAGNETO', 'SILVER SURFER', 'CYCLOPS', 'BLACK PANTHER',
          'BLACK WIDOW', 'HAWKEYE', 'ANT MAN', 'VENOM', 'LOKI', 'GROOT', 'THANOS', 'HULK',
          'BATMAN', 'SUPERMAN', 'SPIDER MAN', 'WOLVERINE', 'DEADPOOL', 'WONDER WOMAN', 'KRRISH', 'SHAKTIMAAN',
        ],
        traps: 'Storm, Flash and Thor (god of thunder) pull toward Weather; Iron Man, Silver Surfer and Magneto toward Metals.',
      },
      {
        name: 'Weather',
        words: [
          'THUNDER', 'LIGHTNING', 'HAIL', 'FROST', 'MIST', 'BREEZE', 'DEW', 'SUNSHINE',
          'TORNADO', 'HURRICANE', 'CYCLONE', 'TYPHOON', 'MONSOON', 'DRIZZLE', 'FOG', 'SMOG',
          'HUMIDITY', 'HEATWAVE', 'SNOWFALL', 'RAINBOW', 'BLIZZARD', 'SLEET', 'DROUGHT', 'CLOUDBURST',
        ],
        traps: 'Thunder and Lightning pull toward Thor, Flash and Thunderbird; Tornado and Hurricane sound like fighter jets or bikes; Frost and Dew read as brands.',
      },
      {
        name: 'Metals & elements',
        words: [
          'PLATINUM', 'CHROME', 'COPPER', 'TITANIUM', 'STEEL', 'NICKEL', 'TIN', 'LEAD',
          'ZINC', 'COBALT', 'BRASS', 'BRONZE', 'ALUMINIUM', 'GOLD', 'SILVER', 'NEON',
          'HELIUM', 'CARBON', 'OXYGEN', 'HYDROGEN', 'SODIUM', 'CALCIUM', 'URANIUM', 'SILICON',
        ],
        traps: 'Platinum and Chrome pull toward Bikes (Platina, chrome trim); Steel and Titanium toward Superheroes; Copper, Lead and Tin read as other words.',
      },
    ],
  },
  {
    id: 'monaco-bourbon',
    name: 'Monaco & Bourbon',
    difficulty: 'easy',
    themes: [
      {
        name: 'Biscuits',
        words: [
          'MONACO', 'NICE TIME', 'BOURBON', 'TIGER', 'HIDE AND SEEK', 'TREAT', 'FIFTY FIFTY', 'LITTLE HEARTS',
          'GOOD DAY', 'TOP', 'MAGIX', 'JIM JAM', 'DARK FANTASY', 'KRACKJACK', 'OREO', 'MARIE',
          'PARLE G', 'MILK BIKIS', 'DIGESTIVE', 'HAPPY HAPPY', 'NUTRICHOICE', 'UNIBIC', 'CREAM CRACKER', 'BRITANNIA',
        ],
        traps: 'Hide and Seek and Top pull toward Childhood games; Bourbon toward Drinks; Cream Cracker and Treat toward the Bakery; Monaco reads as a country.',
      },
      {
        name: 'Drinks',
        words: [
          'THUMS UP', 'SPRITE', 'SLICE', 'RED BULL', 'MONSTER', 'STING', 'REAL', 'BOOST',
          'TANG', 'PAPER BOAT', 'MAAZA', 'FROOTI', 'LIMCA', 'FANTA', 'MIRINDA', 'APPY FIZZ',
          'ROOH AFZA', 'HORLICKS', 'BOURNVITA', 'COMPLAN', 'GLUCON D', 'PEPSI', 'COCA COLA', 'RASNA',
        ],
        traps: 'Paper Boat pulls toward Childhood games; Slice toward the Bakery; Thums Up, Sprite, Monster, Sting and Real read as plain words.',
      },
      {
        name: 'Bakery',
        words: [
          'SWISS ROLL', 'DANISH', 'BLACK FOREST', 'RED VELVET', 'BROWNIE', 'PUFF', 'RUSK', 'BUN',
          'TART', 'CHOCO LAVA', 'CROISSANT', 'MUFFIN', 'CUPCAKE', 'DONUT', 'CREAM ROLL', 'KHARI',
          'NAAN KHATAI', 'PASTRY', 'BAGEL', 'PRETZEL', 'FRUIT CAKE', 'PLUM CAKE', 'PATTIES', 'CHEESECAKE',
        ],
        traps: 'Naan Khatai and Khari look like Biscuits; Swiss Roll, Danish and Black Forest read as places; Puff and Bun as everyday words.',
      },
      {
        name: 'Childhood games',
        words: [
          'STATUE', 'ICE WATER', 'CHUPAN CHUPAI', 'CHOR POLICE', 'MUSICAL CHAIRS', 'LEMON SPOON', 'LATTU', 'MONOPOLY',
          'UNO', 'KANCHE', 'PITTHU', 'STAPU', 'KHO KHO', 'GILLI DANDA', 'LANGDI', 'ANTAKSHARI',
          'CARROM', 'LUDO', 'SAANP SEEDHI', 'SCRABBLE', 'PICTIONARY', 'DUMB CHARADES', 'TREASURE HUNT', 'TUG OF WAR',
        ],
        traps: 'Ice Water pulls toward Drinks; Chupan Chupai is Hide and Seek (a biscuit); Statue, Lemon Spoon and Lattu read as things.',
      },
    ],
  },
  {
    id: 'dove-pears',
    name: 'Dove & Pears',
    difficulty: 'easy',
    themes: [
      {
        name: 'Soaps & detergents',
        words: [
          'DOVE', 'PEARS', 'SANTOOR', 'LIFEBUOY', 'TIDE', 'WHEEL', 'GHADI', 'ARIEL',
          'LUX', 'VIM', 'SURF EXCEL', 'MARGO', 'HAMAM', 'RIN', 'NIRMA', 'MEDIMIX',
          'CINTHOL', 'LIRIL', 'DETTOL', 'SAVLON', 'CHANDRIKA', 'FIAMA', 'NIVEA', 'MYSORE SANDAL',
        ],
        traps: 'Pears pulls toward Fruits; Santoor toward Instruments; Lifebuoy, Tide and Surf Excel toward the Beach; Dove reads as a bird.',
      },
      {
        name: 'Fruits',
        words: [
          'COCONUT', 'KIWI', 'DATE', 'MANGO', 'ORANGE', 'CHERRY', 'FIG', 'STAR FRUIT',
          'DRAGON FRUIT', 'BANANA', 'GUAVA', 'PAPAYA', 'LYCHEE', 'CHIKOO', 'JAMUN', 'POMEGRANATE',
          'WATERMELON', 'GRAPES', 'PINEAPPLE', 'STRAWBERRY', 'CUSTARD APPLE', 'JACKFRUIT', 'AMLA', 'MUSKMELON',
        ],
        traps: 'Coconut pulls toward the Beach; Kiwi reads as a bird, Date as a calendar, Mango as a clothes brand, Orange as a colour; Pears (a soap) looks like a fruit.',
      },
      {
        name: 'Instruments',
        words: [
          'KEYBOARD', 'ORGAN', 'TRIANGLE', 'RECORDER', 'HARP', 'DRUM', 'FLUTE', 'BUGLE',
          'BANJO', 'CYMBAL', 'TRUMPET', 'VIOLIN', 'GUITAR', 'PIANO', 'TABLA', 'SITAR',
          'VEENA', 'SHEHNAI', 'DHOL', 'SAROD', 'HARMONIUM', 'MRIDANGAM', 'BANSURI', 'SAXOPHONE',
        ],
        traps: 'Keyboard, Organ, Triangle and Recorder read as everyday things; Santoor (a soap) and Conch (the beach) look like instruments.',
      },
      {
        name: 'Beach & sea',
        words: [
          'WAVE', 'CONCH', 'ANCHOR', 'SAILOR', 'CORAL', 'REEF', 'BAY', 'LAGOON',
          'PIER', 'ISLAND', 'LIGHTHOUSE', 'HARBOUR', 'SEAWEED', 'STARFISH', 'JELLYFISH', 'CRAB',
          'LOBSTER', 'DOLPHIN', 'OYSTER', 'SURFBOARD', 'SUNSCREEN', 'SEAGULL', 'YACHT', 'SANDCASTLE',
        ],
        traps: 'Conch pulls toward Instruments (the shankh); Tide, Lifebuoy and Surf Excel (Soaps) look like they belong here; Anchor, Sailor and Coral read as a toothpaste, a job and a colour.',
      },
    ],
  },
  {
    id: 'pant-jersey',
    name: 'Pant & Jersey',
    difficulty: 'medium',
    themes: [
      {
        name: 'Indian cricketers',
        words: [
          'VIRAT', 'GAMBHIR', 'SHIKHAR', 'SURYA', 'PANT', 'GILL', 'KAPIL', 'LAXMAN',
          'SAMSON', 'YUVRAJ', 'SACHIN', 'DHONI', 'ROHIT', 'BUMRAH', 'JADEJA', 'ASHWIN',
          'DRAVID', 'GANGULY', 'SEHWAG', 'ZAHEER', 'KUMBLE', 'SHAMI', 'MITHALI', 'HARMANPREET',
        ],
        traps: 'Pant pulls toward Clothes; Kapil toward TV (The Kapil Sharma Show); Virat, Gambhir and Shikhar read as Hindi words; Surya and Laxman as names.',
      },
      {
        name: 'Bollywood stars',
        words: [
          'REKHA', 'RANI', 'TABU', 'VIDYA', 'VARUN', 'KARTIK', 'SHRADDHA', 'PANKAJ',
          'GOVINDA', 'JUHI', 'SALMAN', 'AAMIR', 'AKSHAY', 'AJAY', 'HRITHIK', 'RANBIR',
          'RANVEER', 'DEEPIKA', 'KATRINA', 'ALIA', 'KAJOL', 'MADHURI', 'AMITABH', 'SHAH RUKH',
        ],
        traps: 'Pankaj pulls toward Shows (Mirzapur); Ajay toward Cricketers (Jadeja); Rekha, Rani, Vidya and Kartik read as Hindi words.',
      },
      {
        name: 'Clothes',
        words: [
          'JERSEY', 'CAP', 'LUNGI', 'SHORTS', 'STOLE', 'BOXERS', 'SUIT', 'TIE',
          'MUFFLER', 'PATIALA', 'BLAZER', 'GOWN', 'VEST', 'KAFTAN', 'TUXEDO', 'JACKET',
          'HOODIE', 'SWEATER', 'KURTA', 'SAREE', 'DHOTI', 'SHERWANI', 'LEHENGA', 'DUPATTA',
        ],
        traps: 'Jersey and Cap pull toward Cricketers; Lungi toward Bollywood (Lungi Dance); Shorts toward Shows; Stole, Boxers, Suit and Tie read as other words.',
      },
      {
        name: 'TV & web series',
        words: [
          'INSIDE EDGE', 'SELECTION DAY', 'PITCHERS', 'FRIENDS', 'THE OFFICE', 'FAMILY MAN', 'PANCHAYAT', 'MIRZAPUR',
          'GULLAK', 'FARZI', 'SHARK TANK', 'BREATHE', 'ASPIRANTS', 'ROADIES', 'FLAMES', 'KOTA FACTORY',
          'SCAM 1992', 'MONEY HEIST', 'MASTERCHEF', 'BIGG BOSS', 'CID', 'KBC', 'INDIAN IDOL', 'TAARAK MEHTA',
        ],
        traps: 'Inside Edge, Selection Day and Pitchers pull toward Cricketers; Friends, Farzi, Breathe and Flames read as words; Mirzapur as a city.',
      },
    ],
  },
  {
    id: 'mouse-pupil',
    name: 'Mouse & Pupil',
    difficulty: 'easy',
    themes: [
      {
        name: 'Computer words',
        words: [
          'MOUSE', 'BUG', 'VIRUS', 'WORM', 'COOKIE', 'CHIP', 'CLOUD', 'WINDOW',
          'SHELL', 'TROJAN', 'SERVER', 'PORT', 'BOOT', 'SPAM', 'KERNEL', 'PATCH',
          'CACHE', 'SCROLL', 'BLUETOOTH', 'FOLDER', 'ROUTER', 'PIXEL', 'CURSOR', 'FIREWALL',
        ],
        traps: 'Virus and Patch pull toward Hospital; Bluetooth toward the Body; Folder and Scroll toward School; Mouse, Bug and Worm read as animals.',
      },
      {
        name: 'Hospital',
        words: [
          'TABLET', 'CAPSULE', 'SCAN', 'PLASTER', 'CAST', 'THEATRE', 'WARD', 'PULSE',
          'DRIP', 'SYRUP', 'STITCHES', 'OPERATION', 'X RAY', 'BANDAGE', 'INJECTION', 'STETHOSCOPE',
          'THERMOMETER', 'STRETCHER', 'CRUTCHES', 'ICU', 'OPD', 'VACCINE', 'WHEELCHAIR', 'AMBULANCE',
        ],
        traps: 'Tablet and Scan pull toward Computer words; Pulse toward the Body; Plaster, Cast and Theatre read as building, film and stage words.',
      },
      {
        name: 'Body parts',
        words: [
          'PUPIL', 'IRIS', 'TEMPLE', 'COLON', 'SOLE', 'CALF', 'SPINE', 'ARMS',
          'LASH', 'NAVEL', 'KIDNEY', 'LIVER', 'KNEE', 'ELBOW', 'SHIN', 'WRIST',
          'ANKLE', 'CHIN', 'CHEEK', 'THUMB', 'TONGUE', 'SKULL', 'RIBS', 'JAW',
        ],
        traps: 'Pupil pulls toward School; Kidney and Liver toward Hospital; Iris, Temple, Colon, Sole, Calf and Spine read as a flower, a place, punctuation, a fish, a cow and a book.',
      },
      {
        name: 'School days',
        words: [
          'MONITOR', 'NOTEBOOK', 'PROXY', 'ASSEMBLY', 'PRINCIPAL', 'RULER', 'RECESS', 'TIMETABLE',
          'LIBRARY', 'BUNK', 'TIFFIN', 'CANTEEN', 'BLACKBOARD', 'CHALK', 'UNIFORM', 'HOMEWORK',
          'REPORT CARD', 'BACKBENCHER', 'TOPPER', 'PTM', 'UNIT TEST', 'SLAM BOOK', 'STAFF ROOM', 'SPORTS DAY',
        ],
        traps: 'Monitor, Notebook, Proxy and Library pull toward Computer words; Pupil (Body parts) looks like it belongs here; Principal, Ruler and Assembly read as other words.',
      },
    ],
  },
  {
    id: 'bench-plank',
    name: 'Bench & Plank',
    difficulty: 'medium',
    themes: [
      {
        name: 'Gym',
        words: [
          'PLANK', 'CRUNCH', 'DIPS', 'CURL', 'ROW', 'CHIN UP', 'LUNGE', 'SQUAT',
          'SHRUG', 'BURPEE', 'DEADLIFT', 'PULL UP', 'PUSH UP', 'SIT UP', 'CARDIO', 'SKIPPING',
          'KETTLEBELL', 'DUMBBELL', 'TREADMILL', 'PILATES', 'AEROBICS', 'PROTEIN', 'STRETCH', 'LEG DAY',
        ],
        traps: 'Plank pulls toward Trees and Furniture (wood); Crunch, Dips and Curl read as food and hair; Row as a line of seats.',
      },
      {
        name: 'Furniture',
        words: [
          'CHEST', 'BENCH', 'CABINET', 'OTTOMAN', 'STOOL', 'CONSOLE', 'DRESSER', 'CRADLE',
          'DIWAN', 'ALMIRAH', 'CHARPAI', 'RECLINER', 'BUNK BED', 'TABLE', 'SOFA', 'CUPBOARD',
          'SHELF', 'WARDROBE', 'DESK', 'BEAN BAG', 'HAMMOCK', 'COUCH', 'MATTRESS', 'ROCKING CHAIR',
        ],
        traps: 'Chest and Bench pull toward the Gym; Cabinet, Ottoman, Stool and Console read as government, an empire, a test and a game box.',
      },
      {
        name: 'Tools',
        words: [
          'DRILL', 'HAMMER', 'VICE', 'FILE', 'LEVEL', 'BOLT', 'NUT', 'WASHER',
          'AXE', 'SAW', 'TORCH', 'CLAMP', 'MALLET', 'CHISEL', 'SPANNER', 'PLIERS',
          'WRENCH', 'SCREWDRIVER', 'RIVET', 'SANDPAPER', 'CROWBAR', 'TOOLBOX', 'SHOVEL', 'MEASURING TAPE',
        ],
        traps: 'Drill pulls toward the Gym; Saw and Sandpaper toward Furniture making; Vice, File, Level, Bolt and Axe read as a captain, a document, a game, a sprinter and a deo.',
      },
      {
        name: 'Trees',
        words: [
          'PALM', 'TEAK', 'SHEESHAM', 'ROSEWOOD', 'MAHOGANY', 'BANYAN', 'ASH', 'FIR',
          'WILLOW', 'MAPLE', 'BEECH', 'ASHOKA', 'SPRUCE', 'POPLAR', 'PINE', 'OAK',
          'PEEPAL', 'NEEM', 'BAMBOO', 'CEDAR', 'BIRCH', 'EUCALYPTUS', 'GULMOHAR', 'SANDALWOOD',
        ],
        traps: 'Teak, Sheesham, Rosewood and Mahogany pull toward Furniture; Palm reads as a body part, Banyan as a vest, Fir as a police report, Willow as a cricket bat.',
      },
    ],
  },
  {
    id: 'garba-pongal',
    name: 'Garba & Pongal',
    difficulty: 'medium',
    themes: [
      {
        name: 'Festivals',
        words: [
          'BIHU', 'LOHRI', 'PONGAL', 'ONAM', 'BAISAKHI', 'NAVRATRI', 'DUSSEHRA', 'SANKRANTI',
          'CHHATH', 'TEEJ', 'HOLI', 'DIWALI', 'EID', 'CHRISTMAS', 'DURGA PUJA', 'RAKSHA BANDHAN',
          'BHAI DOOJ', 'KARVA CHAUTH', 'JANMASHTAMI', 'UGADI', 'GUDI PADWA', 'VISHU', 'GURPURAB', 'DHANTERAS',
        ],
        traps: 'Bihu is also a Dance; Pongal is also a dish (Street food); Lohri and Baisakhi pull toward Bhangra; Navratri toward Garba.',
      },
      {
        name: 'Dances',
        words: [
          'GARBA', 'DANDIYA', 'BHANGRA', 'GIDDHA', 'SALSA', 'MOONWALK', 'TANGO', 'DISCO',
          'GHOOMAR', 'LAVANI', 'KATHAK', 'KATHAKALI', 'BHARATANATYAM', 'KUCHIPUDI', 'ODISSI', 'MANIPURI',
          'MOHINIYATTAM', 'CHHAU', 'ZUMBA', 'BALLET', 'HIP HOP', 'BREAKDANCE', 'WALTZ', 'SAMBA',
        ],
        traps: 'Garba and Dandiya pull toward Navratri (Festivals); Bhangra and Giddha toward Lohri; Salsa reads as food.',
      },
      {
        name: 'Mithai',
        words: [
          'MODAK', 'GUJIYA', 'GAJAK', 'REWRI', 'THEKUA', 'PAYASAM', 'TILGUL', 'SANDESH',
          'CHAMCHAM', 'JALEBI', 'PETHA', 'GHEVAR', 'LADOO', 'RASGULLA', 'GULAB JAMUN', 'BARFI',
          'PEDA', 'KAJU KATLI', 'SOAN PAPDI', 'HALWA', 'KHEER', 'RASMALAI', 'MYSORE PAK', 'IMARTI',
        ],
        traps: 'Modak, Gujiya, Gajak, Thekua, Payasam and Tilgul each belong to a Festival; Jalebi pulls toward Street food; Sandesh and Chamcham read as message and spoon.',
      },
      {
        name: 'Street food',
        words: [
          'FAFDA', 'SABUDANA VADA', 'DHOKLA', 'POHA', 'MOMOS', 'CHAAT', 'PANI PURI', 'VADA PAV',
          'SAMOSA', 'KACHORI', 'PAV BHAJI', 'BHEL PURI', 'CHOLE BHATURE', 'ALOO TIKKI', 'DABELI', 'KATHI ROLL',
          'MISAL PAV', 'JHALMURI', 'KHANDVI', 'PAKODA', 'DOSA', 'IDLI', 'LITTI CHOKHA', 'FRANKIE',
        ],
        traps: 'Fafda pulls toward Dussehra and Sabudana Vada toward Navratri fasts (Festivals); Dhokla toward Garba nights; Jalebi (Mithai) looks like it belongs here.',
      },
    ],
  },
  {
    id: 'queen-pink',
    name: 'Queen & Pink',
    difficulty: 'medium',
    themes: [
      {
        name: 'Bollywood films',
        words: [
          'QUEEN', 'PINK', 'BLACK', 'ANIMAL', 'FAN', 'WAR', 'RACE', 'KICK',
          'DON', 'SULTAN', 'FASHION', 'HEROINE', 'ROCKSTAR', 'DHOOM', 'GOLMAAL', 'LAGAAN',
          'DANGAL', 'SHOLAY', 'PATHAAN', 'JAWAN', 'DEVDAS', 'STREE', 'PIKU', '3 IDIOTS',
        ],
        traps: 'Queen pulls toward Chess & cards; Pink and Black toward Colours; Fan, War, Race, Kick and Fashion read as plain words.',
      },
      {
        name: 'Colours',
        words: [
          'SALMON', 'IVORY', 'PEACH', 'LIME', 'PLUM', 'OLIVE', 'MINT', 'MUSTARD',
          'INDIGO', 'NAVY', 'KHAKI', 'AMBER', 'CREAM', 'MAROON', 'TEAL', 'ROSE',
          'CHARCOAL', 'CRIMSON', 'SCARLET', 'MAGENTA', 'TURQUOISE', 'LAVENDER', 'BEIGE', 'VIOLET',
        ],
        traps: 'Turquoise and Amber look like Jewellery & gems; Ivory like chess pieces; Salmon, Peach, Lime, Plum and Mint read as food; Indigo as an airline.',
      },
      {
        name: 'Chess & cards',
        words: [
          'KING', 'KNIGHT', 'BISHOP', 'CASTLE', 'JOKER', 'ACE', 'CLUB', 'HEART',
          'SPADE', 'JACK', 'BRIDGE', 'BLUFF', 'DECK', 'ENDGAME', 'ROOK', 'PAWN',
          'CHECKMATE', 'SHUFFLE', 'STALEMATE', 'GAMBIT', 'GRANDMASTER', 'POKER', 'RUMMY', 'TEEN PATTI',
        ],
        traps: 'King looks like Queen\'s squad (Films); Heart and Club read as plain words; Diamond and Solitaire (Jewellery) look like they belong here.',
      },
      {
        name: 'Jewellery & gems',
        words: [
          'DIAMOND', 'SOLITAIRE', 'CROWN', 'TIARA', 'PEARL', 'EMERALD', 'SAPPHIRE', 'TOPAZ',
          'JADE', 'JHUMKA', 'PAYAL', 'KADA', 'CHOKER', 'BANGLE', 'NECKLACE', 'NOSE PIN',
          'PENDANT', 'ANKLET', 'BROOCH', 'LOCKET', 'EARRING', 'BRACELET', 'CUFFLINKS', 'MAANG TIKKA',
        ],
        traps: 'Diamond and Solitaire pull toward Chess & cards; Crown and Tiara toward the King and Queen; Emerald, Sapphire and Jade toward Colours; Jhumka toward film songs.',
      },
    ],
  },
  {
    id: 'nutmeg-sweeper',
    name: 'Nutmeg & Sweeper',
    difficulty: 'hard',
    themes: [
      {
        name: 'Spices & herbs',
        words: [
          'NUTMEG', 'MACE', 'STAR ANISE', 'SAGE', 'THYME', 'ROSEMARY', 'GINGER', 'PEPPER',
          'CLOVE', 'SAFFRON', 'SESAME', 'BAY LEAF', 'BASIL', 'CINNAMON', 'CHILLI', 'OREGANO',
          'PAPRIKA', 'GARLIC', 'ELAICHI', 'HING', 'AJWAIN', 'JEERA', 'HALDI', 'SAUNF',
        ],
        traps: 'Nutmeg pulls toward Football (a skill); Vinegar and Baking Soda (Cleaning) look like they belong here; Mace, Sage, Thyme and Rosemary read as a weapon, a wise man, time and a name.',
      },
      {
        name: 'Football',
        words: [
          'SWEEPER', 'CLEAN SHEET', 'CLEARANCE', 'HAT TRICK', 'CORNER', 'CROSS', 'PASS', 'VOLLEY',
          'HEADER', 'TACKLE', 'DRIBBLE', 'STRIKER', 'KEEPER', 'WINGER', 'DERBY', 'OFFSIDE',
          'PENALTY', 'FREE KICK', 'RED CARD', 'BICYCLE KICK', 'KICK OFF', 'INJURY TIME', 'MIDFIELD', 'TIKI TAKA',
        ],
        traps: 'Sweeper, Clean Sheet and Clearance pull toward Cleaning; Volley and Header sound like other sports; Dive (At the pool) looks like it belongs here.',
      },
      {
        name: 'Cleaning',
        words: [
          'ALL OUT', 'GOOD KNIGHT', 'POLISH', 'SPONGE', 'VACUUM', 'SCRUB', 'WIPE', 'MOP',
          'COLIN', 'MORTEIN', 'VINEGAR', 'BAKING SODA', 'BROOM', 'DUSTER', 'PHENYL', 'HARPIC',
          'LIZOL', 'JHADU', 'POCHA', 'DUSTPAN', 'WIPER', 'ODONIL', 'SANITISER', 'GLOVES',
        ],
        traps: 'Vinegar and Baking Soda pull toward Spices; Gloves toward Football (the keeper); All Out and Good Knight read as cricket and chess; Polish as a nationality.',
      },
      {
        name: 'At the pool',
        words: [
          'BUTTERFLY', 'FREESTYLE', 'MEDLEY', 'DIVE', 'FLOAT', 'LAP', 'TUBE', 'TRUNKS',
          'SPLASH', 'CANNONBALL', 'BELLY FLOP', 'RELAY', 'POOL', 'CHLORINE', 'BACKSTROKE', 'BREASTSTROKE',
          'GOGGLES', 'FLIPPERS', 'SNORKEL', 'SCUBA', 'DOGGY PADDLE', 'DEEP END', 'LIFEGUARD', 'DIVING BOARD',
        ],
        traps: 'Dive pulls toward Football; Chlorine toward Cleaning; Butterfly, Freestyle, Medley and Float read as an insect, a dance, music and a parade.',
      },
    ],
  },
  {
    id: 'subway-signal',
    name: 'Subway & Signal',
    difficulty: 'medium',
    themes: [
      {
        name: 'Apps',
        words: [
          'SIGNAL', 'THREADS', 'SLACK', 'DISCORD', 'NOTION', 'ZOOM', 'TELEGRAM', 'OLA',
          'CRED', 'GROWW', 'BLINKIT', 'ZEPTO', 'RAPIDO', 'AMAZON', 'UBER', 'ZOMATO',
          'SWIGGY', 'PAYTM', 'PHONEPE', 'MYNTRA', 'NYKAA', 'INSTAGRAM', 'WHATSAPP', 'SPOTIFY',
        ],
        traps: 'Signal pulls toward the Road; Ola, Uber and Rapido toward the Road too; Zomato and Swiggy toward Food chains; Threads, Slack and Discord read as words.',
      },
      {
        name: 'Video games',
        words: [
          'TEMPLE RUN', 'HALO', 'PORTAL', 'SONIC', 'SNAKE', 'ASPHALT', 'SUBWAY SURFERS', 'CROSSY ROAD',
          'ROAD RASH', 'NEED FOR SPEED', 'HILL CLIMB', 'FRUIT NINJA', 'CANDY CRUSH', 'ANGRY BIRDS', 'AMONG US', 'HITMAN',
          'CONTRA', 'FORTNITE', 'MINECRAFT', 'FREE FIRE', 'POKEMON', 'TETRIS', 'PAC MAN', 'MARIO',
        ],
        traps: 'Asphalt, Crossy Road, Road Rash and Need for Speed pull toward the Road; Subway Surfers toward Food chains (Subway); Halo, Portal and Sonic read as words.',
      },
      {
        name: 'Food chains',
        words: [
          'SUBWAY', "DOMINO'S", 'SOCIAL', 'BURGER KING', 'PIZZA HUT', 'TACO BELL', 'BARISTA', 'NATURALS',
          'WOW MOMO', 'BOX8', 'THIRD WAVE', 'BLUE TOKAI', 'CHAAYOS', 'CHAI POINT', 'KFC', "MCDONALD'S",
          "HALDIRAM'S", 'BIKANERVALA', 'STARBUCKS', 'CCD', 'FAASOS', 'BEHROUZ', 'BASKIN ROBBINS', 'THEOBROMA',
        ],
        traps: 'Subway pulls toward Video games and the Road; Social toward Apps; Domino\'s reads as a game, Barista as a job, Naturals as a word.',
      },
      {
        name: 'On the road',
        words: [
          'DRIVE THRU', 'SPEED BREAKER', 'MILESTONE', 'BYPASS', 'TRAFFIC JAM', 'ROUNDABOUT', 'LANE', 'TOLL',
          'DETOUR', 'DIVERSION', 'JUNCTION', 'FLYOVER', 'U TURN', 'OVERTAKE', 'HONK', 'POTHOLE',
          'CHALLAN', 'DIVIDER', 'FOOTPATH', 'HIGHWAY', 'EXPRESSWAY', 'PETROL PUMP', 'SEAT BELT', 'TRAFFIC POLICE',
        ],
        traps: 'Drive Thru pulls toward Food chains; Milestone and Bypass read as a goal and surgery; Traffic Jam as food; Highway and Overtake look like racing games.',
      },
    ],
  },
  {
    id: 'taj-darjeeling',
    name: 'Taj & Darjeeling',
    difficulty: 'hard',
    themes: [
      {
        name: 'Rivers',
        words: [
          'RAVI', 'KRISHNA', 'KAVERI', 'GODAVARI', 'NARMADA', 'GANGA', 'YAMUNA', 'TAPTI',
          'BEAS', 'KOSI', 'GOMTI', 'INDUS', 'HOOGHLY', 'TEESTA', 'SUTLEJ', 'CHENAB',
          'JHELUM', 'BRAHMAPUTRA', 'MAHANADI', 'SABARMATI', 'CHAMBAL', 'PERIYAR', 'NILE', 'THAMES',
        ],
        traps: 'Beas and Teesta pull toward Hill stations (Manali, Darjeeling); Hooghly toward Landmarks (Howrah Bridge); Ravi, Krishna and Kaveri read as names.',
      },
      {
        name: 'Hill stations',
        words: [
          'DARJEELING', 'COORG', 'MUNNAR', 'OOTY', 'SHIMLA', 'MANALI', 'MUSSOORIE', 'NAINITAL',
          'GULMARG', 'KASAULI', 'LONAVALA', 'MAHABALESHWAR', 'MATHERAN', 'KODAIKANAL', 'SHILLONG', 'GANGTOK',
          'AULI', 'DALHOUSIE', 'MOUNT ABU', 'LANSDOWNE', 'MCLEODGANJ', 'KASOL', 'DHARAMSHALA', 'PACHMARHI',
        ],
        traps: 'Darjeeling, Coorg and Munnar pull hard toward Tea & coffee; Mount Abu and Shimla look like Landmarks.',
      },
      {
        name: 'Landmarks',
        words: [
          'AJANTA', 'VICTORIA', 'BIG BEN', 'INDIA GATE', 'KONARK', 'HOWRAH BRIDGE', 'MARINE DRIVE', 'CHARMINAR',
          'QUTUB MINAR', 'RED FORT', 'HAWA MAHAL', 'LOTUS TEMPLE', 'ELLORA', 'HAMPI', 'SANCHI', 'JANTAR MANTAR',
          "HUMAYUN'S TOMB", 'FATEHPUR SIKRI', 'BULAND DARWAZA', 'GOLCONDA', 'MYSORE PALACE', 'EIFFEL TOWER', 'COLOSSEUM', 'GREAT WALL',
        ],
        traps: 'Taj Mahal (Tea & coffee) looks like it belongs here; Howrah Bridge pulls toward the Hooghly; Ajanta reads as a clock brand, Victoria as a name.',
      },
      {
        name: 'Tea & coffee',
        words: [
          'TAJ MAHAL', 'AMERICANO', 'KAHWA', 'CUTTING', 'IRANI CHAI', 'FLAT WHITE', 'MOCHA', 'SOCIETY',
          'RED LABEL', 'WAGH BAKRI', 'BROOKE BOND', 'TATA TEA', 'NESCAFE', 'BRU', 'LIPTON', 'MASALA CHAI',
          'ESPRESSO', 'LATTE', 'CAPPUCCINO', 'COLD BREW', 'GREEN TEA', 'LEMON TEA', 'FILTER COFFEE', 'SULAIMANI',
        ],
        traps: 'Taj Mahal pulls toward Landmarks; Kahwa toward Kashmir hill stations; Cutting, Society and Flat White read as plain words.',
      },
    ],
  },
  {
    id: 'wand-quill',
    name: 'Wand & Quill',
    difficulty: 'medium',
    themes: [
      {
        name: 'Harry Potter',
        words: [
          'SIRIUS', 'LUNA', 'DRACO', 'NIMBUS', 'HEDWIG', 'SNITCH', 'MUGGLE', 'GOBLET',
          'SPELL', 'POTION', 'NAGINI', 'FAWKES', 'DOBBY', 'HOGWARTS', 'QUIDDITCH', 'VOLDEMORT',
          'HERMIONE', 'DUMBLEDORE', 'HORCRUX', 'PATRONUS', 'GRYFFINDOR', 'SLYTHERIN', 'HAGRID', 'SORTING HAT',
        ],
        traps: 'Spell and Potion pull toward the Magic show; Sirius, Luna and Draco read as space words; Snitch and Goblet as plain words; Potter (Jobs) looks like it belongs here.',
      },
      {
        name: 'Magic show',
        words: [
          'WAND', 'TOP HAT', 'RABBIT', 'CARD TRICK', 'CAPE', 'ASSISTANT', 'VANISH', 'ESCAPE',
          'MIRROR', 'SMOKE', 'TRAPDOOR', 'CURTAIN', 'ILLUSION', 'ABRACADABRA', 'HOCUS POCUS', 'LEVITATE',
          'MIND READING', 'HYPNOSIS', 'PC SORCAR', 'MANDRAKE', 'CRYSTAL BALL', 'CUPS AND BALLS', 'SAWING IN HALF', 'BLINDFOLD',
        ],
        traps: 'Wand and Mandrake pull toward Harry Potter; Assistant toward Jobs; Vanish and Escape read as a stain remover and a key.',
      },
      {
        name: 'Stationery',
        words: [
          'PILOT', 'PARKER', 'CELLO', 'QUILL', 'INVISIBLE INK', 'NATRAJ', 'APSARA', 'CLASSMATE',
          'CAMLIN', 'FLAIR', 'DOMS', 'CRAYONS', 'REYNOLDS', 'LINC', 'ADD GEL', 'FEVICOL',
          'FEVISTICK', 'FABER CASTELL', 'STAPLER', 'HIGHLIGHTER', 'PAPER CLIP', 'STICKY NOTES', 'SHARPENER', 'ERASER',
        ],
        traps: 'Pilot pulls toward Jobs; Quill toward Harry Potter; Invisible Ink toward the Magic show; Cello reads as an instrument, Classmate as a person.',
      },
      {
        name: 'Jobs',
        words: [
          'POTTER', 'MAGICIAN', 'CONDUCTOR', 'DRIVER', 'TAILOR', 'MASON', 'COOK', 'MINER',
          'JUDGE', 'CAPTAIN', 'BAKER', 'BARBER', 'CHEMIST', 'ASTRONAUT', 'CARPENTER', 'PLUMBER',
          'ELECTRICIAN', 'FARMER', 'ARCHITECT', 'ANIMATOR', 'PAINTER', 'DETECTIVE', 'PHOTOGRAPHER', 'JEWELLER',
        ],
        traps: 'Potter pulls toward Harry Potter; Magician toward the Magic show; Painter toward Stationery; Conductor and Driver read as music and computer words.',
      },
    ],
  },
  {
    id: 'sprint-squash',
    name: 'Sprint & Squash',
    difficulty: 'medium',
    themes: [
      {
        name: 'Sports',
        words: [
          'GOLF', 'BOXING', 'FENCING', 'SHOOTING', 'SURFING', 'MARATHON', 'BOWLING', 'HURDLES',
          'ROWING', 'SKATING', 'TABLE TENNIS', 'BASKETBALL', 'ARCHERY', 'BADMINTON', 'JUDO', 'KARATE',
          'WRESTLING', 'KABADDI', 'HOCKEY', 'CYCLING', 'POLE VAULT', 'JAVELIN', 'SNOOKER', 'HIGH JUMP',
        ],
        traps: 'Marathon and Hurdles pull toward Office life; Squash (Vegetables) looks like it belongs here; Golf reads as a car, Surfing as the internet.',
      },
      {
        name: 'Office life',
        words: [
          'SPRINT', 'HUDDLE', 'OVERTIME', 'OFFSITE', 'PING', 'STANDUP', 'BRAINSTORM', 'PANTRY',
          'HYBRID', 'PROMOTION', 'PROBATION', 'BANDWIDTH', 'BONUS', 'DEADLINE', 'ESCALATION', 'APPRAISAL',
          'CUBICLE', 'PAYSLIP', 'ONBOARDING', 'TOWN HALL', 'INTERN', 'NOTICE PERIOD', 'LANYARD', 'WORK FROM HOME',
        ],
        traps: 'Sprint, Huddle, Overtime, Offsite and Ping pull toward Sports; Pantry toward Snacks; Hybrid reads as a car, Standup as comedy.',
      },
      {
        name: 'Vegetables',
        words: [
          'SQUASH', 'DRUMSTICK', 'LADYFINGER', 'SPRING ONION', 'POTATO', 'BEANS', 'PEAS', 'CORN',
          'MUSHROOM', 'PUMPKIN', 'TURNIP', 'CUCUMBER', 'SHIMLA MIRCH', 'KARELA', 'LAUKI', 'TINDA',
          'METHI', 'CAULIFLOWER', 'CABBAGE', 'BEETROOT', 'RADISH', 'SPINACH', 'BRINJAL', 'CARROT',
        ],
        traps: 'Squash pulls toward Sports; Corn and Potato toward Snacks; Drumstick and Ladyfinger read as an instrument and a biscuit.',
      },
      {
        name: 'Snacks',
        words: [
          'LAYS', 'BINGO', 'PEANUTS', 'POPCORN', 'CORNITOS', 'MAKHANA', 'BANANA CHIPS', 'KURKURE',
          'UNCLE CHIPPS', 'PRINGLES', 'DORITOS', 'CHEETOS', 'TOO YUMM', 'MAD ANGLES', 'TEDHE MEDHE', 'BHUJIA',
          'MOONG DAL', 'NACHOS', 'CHAKLI', 'MATHRI', 'KHAKHRA', 'SHAKARPARA', 'MURUKKU', 'CHIVDA',
        ],
        traps: 'Popcorn, Cornitos and Makhana pull toward Vegetables; Bingo and Peanuts toward Office life (Friday housie, paid peanuts).',
      },
    ],
  },
  {
    id: 'lava-nothing',
    name: 'Lava & Nothing',
    difficulty: 'easy',
    themes: [
      {
        name: 'Phone brands',
        words: [
          'NOTHING', 'HONOR', 'LAVA', 'SPICE', 'KARBONN', 'APPLE', 'BLACKBERRY', 'POCO',
          'JIO', 'REDMI', 'ONEPLUS', 'REALME', 'VIVO', 'OPPO', 'SAMSUNG', 'NOKIA',
          'MOTOROLA', 'IQOO', 'INFINIX', 'MICROMAX', 'XIAOMI', 'LENOVO', 'SONY', 'ASUS',
        ],
        traps: 'Lava pulls toward Nature; Nothing, Honor and Spice read as words; Apple and Blackberry as fruits.',
      },
      {
        name: 'Nature',
        words: [
          'GEYSER', 'SPRING', 'SUMMIT', 'DELTA', 'OASIS', 'CANYON', 'GORGE', 'RIDGE',
          'DESERT', 'VALLEY', 'RAPIDS', 'CRATER', 'VOLCANO', 'GLACIER', 'PLATEAU', 'DUNE',
          'CAVE', 'CLIFF', 'WATERFALL', 'MEADOW', 'SWAMP', 'PENINSULA', 'RAINFOREST', 'MOUNTAIN',
        ],
        traps: 'Geyser pulls toward Gadgets (the water heater) and the Bathroom; Spring toward the Bathroom; Summit, Delta and Oasis read as a meeting, an airline and a band.',
      },
      {
        name: 'Bathroom',
        words: [
          'SHOWER', 'BASIN', 'TAP', 'FLUSH', 'SINK', 'MUG', 'TUB', 'DRAIN',
          'TILES', 'TOWEL', 'COMB', 'RAZOR', 'LOOFAH', 'SHAMPOO', 'CONDITIONER', 'TOOTHBRUSH',
          'TOOTHPASTE', 'BATHROBE', 'HAIR DRYER', 'FACE WASH', 'HANDWASH', 'COMMODE', 'EXHAUST FAN', 'BATH MAT',
        ],
        traps: 'Shower and Basin pull toward Nature (rain, a river basin); Hair Dryer and Exhaust Fan toward Gadgets; Conditioner reads as an AC.',
      },
      {
        name: 'Gadgets',
        words: [
          'SPEAKER', 'REMOTE', 'ALEXA', 'POWER BANK', 'EXTENSION', 'CHARGER', 'KINDLE', 'COOLER',
          'HEATER', 'PROJECTOR', 'FRIDGE', 'INVERTER', 'STABILIZER', 'PURIFIER', 'EARPHONES', 'SMARTWATCH',
          'AIR FRYER', 'SOUNDBAR', 'DOORBELL', 'CCTV', 'CEILING FAN', 'DISHWASHER', 'TRIMMER', 'SET TOP BOX',
        ],
        traps: 'Charger, Earphones and Smartwatch pull toward Phone brands; Trimmer toward the Bathroom; Remote and Kindle read as a place and fire.',
      },
    ],
  },
];
