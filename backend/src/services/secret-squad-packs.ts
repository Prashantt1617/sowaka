/**
 * Secret Squad word bank and office plans (docs/secret-squad.md). Plain data:
 * the rules that use it are in secret-squad-engine.ts.
 *
 * Bank: one category per squad. A squad of n takes the category's FIRST n
 * words, in the order listed, so small squads always get one easy word and
 * the traps (words that look like they belong to another category played in
 * the same round). A word is used once per round: every word in the bank is
 * different (checked by src/scripts/secret-squad-packs-check.ts).
 *
 * Plans: which categories each office's rounds use, with that office's squad
 * size, hunt length and break. A family of categories plays in the same
 * round so its traps trick each other. `secret-squad.ts schedule` copies a
 * plan into a session (by office name, or `--plan <name>`); nothing here is
 * read while a game runs except through the session's own round settings.
 *
 * Source: the "Secret Squad — Developer Handoff" word packs, 16 Oct 2026.
 */

export interface SquadCategory {
  category: string;
  /** In dealing order: member 1 gets words[0], member 2 words[1], … */
  words: string[];
  /** The words meant to pull toward another category (for people, not the server). */
  traps: string[];
}

export interface SquadPlanRound {
  squadSize: number;
  huntMs: number;
  /** The break after it; ignored after the last round. */
  breakMs: number;
  /** Categories for this round's squads, taken in this order. */
  categories: string[];
}

export interface SquadPlan {
  /** The office name it is for (compared without case or surrounding space). */
  name: string;
  /** How many people the plan was written for. */
  people: number;
  rounds: SquadPlanRound[];
}

export const SQUAD_BANK: SquadCategory[] = [
  {
    category: 'Pets',
    words: ['Dog', 'Parrot', 'Cat', 'Goldfish', 'Rabbit', 'Tortoise', 'Puppy', 'Kitten', 'Labrador', 'Pomeranian'],
    traps: ['Parrot', 'Goldfish', 'Rabbit'],
  },
  {
    category: 'Predators',
    words: ['Lion', 'Jaguar', 'Shark', 'Leopard', 'Cheetah', 'Wolf', 'Fox', 'Crocodile', 'Cobra', 'Panther'],
    traps: ['Jaguar', 'Shark'],
  },
  {
    category: 'Herbivores',
    words: ['Elephant', 'Camel', 'Zebra', 'Giraffe', 'Deer', 'Rhino', 'Hippo', 'Kangaroo', 'Panda', 'Gorilla'],
    traps: ['Camel'],
  },
  {
    category: 'Aquatic animals',
    words: ['Dolphin', 'Starfish', 'Octopus', 'Jellyfish', 'Seahorse', 'Whale', 'Crab', 'Turtle', 'Prawn', 'Seal'],
    traps: ['Starfish', 'Jellyfish', 'Seahorse'],
  },
  {
    category: 'Planets',
    words: ['Saturn', 'Mercury', 'Venus', 'Earth', 'Jupiter', 'Uranus', 'Neptune', 'Pluto'],
    traps: ['Mercury'],
  },
  {
    category: 'Fruits',
    words: ['Mango', 'Orange', 'Kiwi', 'Banana', 'Grapes', 'Papaya', 'Guava', 'Watermelon', 'Pineapple', 'Apple'],
    traps: ['Orange', 'Kiwi'],
  },
  {
    category: 'Veggies',
    words: ['Potato', 'Tomato', 'Ladyfinger', 'Drumstick', 'Onion', 'Brinjal', 'Cabbage', 'Palak', 'Gobhi', 'Carrot'],
    traps: ['Tomato', 'Ladyfinger', 'Drumstick'],
  },
  {
    category: 'North Indian food',
    words: ['Chole Bhature', 'Rajma Chawal', 'Paratha', 'Butter Chicken', 'Dal Makhani', 'Paneer Tikka', 'Naan', 'Kachori', 'Lassi', 'Makki di Roti'],
    traps: [],
  },
  {
    category: 'South Indian food',
    words: ['Idli', 'Pongal', 'Dosa', 'Vada', 'Sambar', 'Upma', 'Uttapam', 'Appam', 'Rasam', 'Payasam'],
    traps: ['Pongal'],
  },
  {
    category: 'Ice cream flavours',
    words: ['Vanilla', 'Strawberry', 'Kulfi', 'Belgian Chocolate', 'Tender Coconut', 'Butterscotch', 'Kesar Pista', 'Tutti Frutti', 'Black Currant', 'Choco Chip'],
    traps: ['Strawberry', 'Kulfi', 'Belgian Chocolate', 'Tender Coconut'],
  },
  {
    category: 'Body parts',
    words: ['Elbow', 'Palm', 'Knee', 'Nail', 'Thumb', 'Ankle', 'Chin', 'Ear', 'Nose', 'Lip'],
    traps: ['Palm'],
  },
  {
    category: 'Internal organs',
    words: ['Brain', 'Kidney', 'Stomach', 'Lungs', 'Liver', 'Intestine', 'Appendix', 'Bladder', 'Food Pipe', 'Windpipe'],
    traps: ['Kidney', 'Stomach', 'Appendix'],
  },
  {
    category: 'Shapes',
    words: ['Circle', 'Heart', 'Cone', 'Diamond', 'Square', 'Triangle', 'Star', 'Oval', 'Cube', 'Arrow'],
    traps: ['Heart', 'Cone', 'Diamond'],
  },
  {
    category: 'Sports',
    words: ['Hockey', 'Chess', 'Cricket', 'Football', 'Kabaddi', 'Kho-Kho', 'Badminton', 'Tennis', 'Wrestling', 'Volleyball'],
    traps: ['Chess', 'Cricket'],
  },
  {
    category: 'Board games',
    words: ['Ludo', 'Carrom', 'Snakes & Ladders', 'Business', 'Scrabble', 'Chinese Checkers', 'Pictionary'],
    traps: ['Carrom'],
  },
  {
    category: 'Dances',
    words: ['Bhangra', 'Garba', 'Dandiya', 'Kathak', 'Bharatanatyam', 'Ghoomar', 'Lavani', 'Kuchipudi', 'Odissi', 'Kathakali'],
    traps: ['Garba', 'Dandiya'],
  },
  {
    category: 'Festivals',
    words: ['Diwali', 'Bihu', 'Onam', 'Holi', 'Eid', 'Christmas', 'Navratri', 'Lohri', 'Durga Puja', 'Raksha Bandhan'],
    traps: ['Bihu'],
  },
  {
    category: 'Cars',
    words: ['Creta', 'Safari', 'Scorpio', 'Swift', 'Thar', 'Nano', 'Alto', 'Innova', 'Fortuner', 'Wagon R'],
    traps: ['Safari', 'Scorpio'],
  },
  {
    category: 'Phone brands',
    words: ['Samsung', 'BlackBerry', 'Redmi', 'Vivo', 'Oppo', 'Realme', 'OnePlus', 'Nokia', 'Motorola', 'Lava'],
    traps: ['BlackBerry'],
  },
  {
    category: 'Watch brands',
    words: ['Titan', 'Noise', 'boAt', 'Fastrack', 'Casio', 'Sonata', 'Timex', 'Fossil', 'Rolex', 'HMT'],
    traps: ['Noise', 'boAt'],
  },
  {
    category: 'Airlines',
    words: ['Air India', 'IndiGo', 'SpiceJet', 'Emirates', 'Vistara', 'Akasa', 'Qatar Airways', 'Etihad', 'Lufthansa', 'British Airways'],
    traps: ['IndiGo', 'SpiceJet'],
  },
  {
    category: 'Office items',
    words: ['Stapler', 'Mouse', 'Keyboard', 'Monitor', 'Laptop', 'Printer', 'Pen', 'Notebook', 'Calendar', 'Whiteboard'],
    traps: ['Mouse', 'Keyboard'],
  },
  {
    category: 'Colours',
    words: ['Red', 'Peach', 'Lime', 'Blue', 'Green', 'Yellow', 'Pink', 'Purple', 'Maroon', 'Brown'],
    traps: ['Peach', 'Lime'],
  },
  {
    category: 'Rivers',
    words: ['Ganga', 'Yamuna', 'Kaveri', 'Narmada', 'Godavari', 'Brahmaputra', 'Sutlej', 'Hooghly', 'Ravi', 'Nile'],
    traps: [],
  },
  {
    category: 'Europe',
    words: ['France', 'Russia', 'Germany', 'Italy', 'Spain', 'England', 'Switzerland', 'Greece', 'Netherlands', 'Portugal'],
    traps: ['Russia'],
  },
  {
    category: 'Asia',
    words: ['Japan', 'China', 'Nepal', 'Bhutan', 'Sri Lanka', 'Thailand', 'Singapore', 'Malaysia', 'Bangladesh', 'Indonesia'],
    traps: [],
  },
  {
    category: 'Chocolates',
    words: ['Dairy Milk', 'Mars', 'Five Star', 'Gems', 'Galaxy', 'Munch', 'Perk', 'KitKat', 'Milky Bar', 'Eclairs'],
    traps: ['Mars', 'Five Star', 'Gems', 'Galaxy'],
  },
  {
    category: 'Mithai',
    words: ['Laddoo', 'Jalebi', 'Barfi', 'Rasgulla', 'Gulab Jamun', 'Peda', 'Kaju Katli', 'Rasmalai', 'Halwa', 'Sandesh'],
    traps: [],
  },
  {
    category: 'Biscuits',
    words: ['Parle-G', 'Tiger', 'Hide & Seek', 'Monaco', 'Good Day', 'Marie', 'Bourbon', 'Oreo', 'Krackjack', '50-50'],
    traps: ['Tiger', 'Hide & Seek'],
  },
  {
    category: 'Birds',
    words: ['Peacock', 'Kingfisher', 'Sparrow', 'Crow', 'Eagle', 'Owl', 'Pigeon', 'Myna', 'Koel', 'Swan'],
    traps: ['Kingfisher'],
  },
  {
    category: 'Insects',
    words: ['Ant', 'Butterfly', 'Mosquito', 'Bee', 'Housefly', 'Cockroach', 'Grasshopper', 'Dragonfly', 'Firefly', 'Termite'],
    traps: [],
  },
  {
    category: 'Cricket words',
    words: ['Wicket', 'Duck', 'Bat', 'Six', 'Four', 'Over', 'Boundary', 'Catch', 'Run', 'Pitch'],
    traps: ['Duck', 'Bat'],
  },
  {
    category: 'Jewellery',
    words: ['Bangle', 'Ring', 'Chain', 'Necklace', 'Earrings', 'Payal', 'Nath', 'Bracelet', 'Kada', 'Locket'],
    traps: ['Ring', 'Chain'],
  },
  {
    category: 'Clothes',
    words: ['Saree', 'Tie', 'Kurta', 'Jeans', 'Shirt', 'Dupatta', 'Jacket', 'Sweater', 'Socks', 'Lehenga'],
    traps: ['Tie'],
  },
  {
    category: 'Instruments',
    words: ['Sitar', 'Drum', 'Flute', 'Tabla', 'Guitar', 'Harmonium', 'Dholak', 'Piano', 'Violin', 'Shehnai'],
    traps: [],
  },
  {
    category: 'Flowers',
    words: ['Rose', 'Sunflower', 'Lotus', 'Jasmine', 'Marigold', 'Hibiscus', 'Tulip', 'Lily', 'Champa', 'Raat Ki Rani'],
    traps: ['Sunflower'],
  },
  {
    category: 'Cities',
    words: ['Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Jaipur', 'Pune', 'Agra', 'Lucknow', 'Indore', 'Bhopal'],
    traps: [],
  },
  {
    category: 'Spices',
    words: ['Haldi', 'Mustard', 'Jeera', 'Elaichi', 'Laung', 'Dalchini', 'Kali Mirch', 'Ajwain', 'Hing', 'Saunf'],
    traps: ['Mustard'],
  },
  {
    category: 'Breakfast',
    words: ['Poha', 'Cornflakes', 'Bread Butter', 'Toast', 'Omelette', 'Boiled Eggs', 'Oats', 'Sandwich', 'Chilla', 'Muesli'],
    traps: ['Cornflakes'],
  },
  {
    category: 'Weather',
    words: ['Rain', 'Cloud', 'Storm', 'Thunder', 'Fog', 'Monsoon', 'Snow', 'Breeze', 'Rainbow', 'Lightning'],
    traps: ['Cloud'],
  },
  {
    category: 'Hot drinks',
    words: ['Chai', 'Hot Chocolate', 'Coffee', 'Green Tea', 'Kadha', 'Haldi Doodh', 'Lemon Tea', 'Badam Milk', 'Filter Coffee', 'Bournvita'],
    traps: ['Hot Chocolate'],
  },
  {
    category: 'Cold drinks',
    words: ['Thums Up', 'Red Bull', 'Mountain Dew', 'Sprite', 'Limca', 'Maaza', 'Frooti', 'Pepsi', 'Coke', 'Rooh Afza'],
    traps: ['Red Bull', 'Mountain Dew'],
  },
];

export const SQUAD_PLANS: SquadPlan[] = [
  {
    name: 'HQ',
    people: 140,
    rounds: [
      {
        squadSize: 10,
        huntMs: 8 * 60_000,
        breakMs: 1 * 60_000,
        categories: [
          'Pets',
          'Predators',
          'Herbivores',
          'Aquatic animals',
          'Ice cream flavours',
          'Chocolates',
          'Mithai',
          'Biscuits',
          'Fruits',
          'Veggies',
          'North Indian food',
          'South Indian food',
          'Body parts',
          'Internal organs',
        ],
      },
      {
        squadSize: 5,
        huntMs: 8 * 60_000,
        breakMs: 0,
        categories: [
          'Birds',
          'Insects',
          'Cricket words',
          'Shapes',
          'Sports',
          'Board games',
          'Dances',
          'Festivals',
          'Cars',
          'Phone brands',
          'Watch brands',
          'Jewellery',
          'Airlines',
          'Office items',
          'Clothes',
          'Instruments',
          'Flowers',
          'Colours',
          'Planets',
          'Spices',
          'Rivers',
          'Cities',
          'Europe',
          'Asia',
          'Hot drinks',
          'Cold drinks',
          'Breakfast',
          'Weather',
        ],
      },
    ],
  },
  {
    name: 'Noida',
    people: 43,
    rounds: [
      {
        squadSize: 6,
        huntMs: 5 * 60_000,
        breakMs: 1 * 60_000,
        categories: [
          'Pets',
          'Predators',
          'Herbivores',
          'Aquatic animals',
          'Ice cream flavours',
          'Chocolates',
          'Mithai',
        ],
      },
      {
        squadSize: 5,
        huntMs: 5 * 60_000,
        breakMs: 1 * 60_000,
        categories: [
          'Fruits',
          'Veggies',
          'North Indian food',
          'South Indian food',
          'Body parts',
          'Internal organs',
          'Shapes',
          'Planets',
          'Colours',
        ],
      },
      {
        squadSize: 3,
        huntMs: 5 * 60_000,
        breakMs: 0,
        categories: [
          'Sports',
          'Board games',
          'Dances',
          'Festivals',
          'Cars',
          'Phone brands',
          'Watch brands',
          'Jewellery',
          'Airlines',
          'Office items',
          'Clothes',
          'Instruments',
          'Europe',
          'Asia',
        ],
      },
    ],
  },
  {
    name: 'Kolkata',
    people: 14,
    rounds: [
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Pets',
          'Predators',
          'Herbivores',
          'Aquatic animals',
          'Birds',
          'Insects',
          'Cricket words',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Ice cream flavours',
          'Chocolates',
          'Colours',
          'Fruits',
          'Veggies',
          'North Indian food',
          'South Indian food',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Body parts',
          'Internal organs',
          'Shapes',
          'Sports',
          'Board games',
          'Dances',
          'Festivals',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Cars',
          'Phone brands',
          'Watch brands',
          'Airlines',
          'Office items',
          'Planets',
          'Mithai',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 0,
        categories: [
          'Europe',
          'Asia',
          'Rivers',
          'Cities',
          'Hot drinks',
          'Cold drinks',
          'Breakfast',
        ],
      },
    ],
  },
  {
    name: 'Gurgaon',
    people: 13,
    rounds: [
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Pets',
          'Predators',
          'Herbivores',
          'Aquatic animals',
          'Birds',
          'Insects',
          'Cricket words',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Ice cream flavours',
          'Chocolates',
          'Colours',
          'Fruits',
          'Veggies',
          'North Indian food',
          'South Indian food',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Body parts',
          'Internal organs',
          'Shapes',
          'Sports',
          'Board games',
          'Dances',
          'Festivals',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 30_000,
        categories: [
          'Cars',
          'Phone brands',
          'Watch brands',
          'Airlines',
          'Office items',
          'Planets',
          'Mithai',
        ],
      },
      {
        squadSize: 2,
        huntMs: 180_000,
        breakMs: 0,
        categories: [
          'Europe',
          'Asia',
          'Rivers',
          'Cities',
          'Hot drinks',
          'Cold drinks',
          'Breakfast',
        ],
      },
    ],
  },
];

const nameKey = (name: string) => name.trim().toLowerCase();

/** A category by name (without case), or undefined. */
export function categoryNamed(name: string): SquadCategory | undefined {
  return SQUAD_BANK.find((entry) => nameKey(entry.category) === nameKey(name));
}

/** An office plan by name (without case), or undefined. */
export function planNamed(name: string): SquadPlan | undefined {
  return SQUAD_PLANS.find((plan) => nameKey(plan.name) === nameKey(name));
}
