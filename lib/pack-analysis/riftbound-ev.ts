/**
 * Riftbound Expected Value (EV) per pack calculator.
 *
 * Pack structure (official — playriftbound.com/en-us/how-to-play):
 *   7 Commons (non-foil)
 *   3 Uncommons (non-foil)
 *   2 foil Rare-or-better slots (guaranteed Rare; can upgrade to Epic)
 *   1 foil wildcard slot (any rarity — where Alt Arts, Overnumbers & Signatures hit)
 *   1 token slot (not a tradeable card)
 *
 * Pull rates per pack:
 *   Epic         25%   (~1 in 4)    — Official (playriftbound.com announcements)
 *   Alt Art       8.3% (~2/box)     — Official (~2 per 24-pack box)
 *   Overnumber    1.4% (~1 in 72)   — Community (gillygabyte / X)
 *   Signature     0.14% (~1 in 720) — Community (gillygabyte / X)
 *
 * Prices: TCGPlayer market price via tcgcsv.com (as of catalog download date).
 * "Showcase" rarity in the catalog encompasses Alt Art + Overnumber + Signature,
 * split here by price tier (<$30 / $30-200 / >$200).
 */

export interface SetEVData {
  setCode: string
  setName: string
  releaseDate: string
  packPrice: number
  cardsPerPack: number
  // Average prices per rarity (used in EV formula)
  avgCommon: number
  avgUncommon: number
  avgRare: number
  avgEpic: number
  avgFoilCommon: number
  avgFoilUncommon: number
  avgAltArt: number
  avgOvernumber: number
  avgSignature: number
  // Card counts per rarity
  countCommon: number
  countUncommon: number
  countRare: number
  countEpic: number
  countAltArt: number
  countOvernumber: number
  countSignature: number
  // Top-value cards for display
  topEpics: CardHit[]
  topRares: CardHit[]
  topAltArts: CardHit[]
  topOvernumbers: CardHit[]
  topSignatures: CardHit[]
}

export interface CardHit {
  name: string
  price: number
  imageUrl: string
}

export interface EVBreakdown {
  commons: number
  uncommons: number
  rarePlusSlots: number
  wildcardSlot: number
  total: number
  // Sub-breakdown of wildcard
  wildcardBase: number
  wildcardAltArt: number
  wildcardOvernumber: number
  wildcardSignature: number
}

// ── Pull rates ──────────────────────────────────────────────────────────────

export const PULL_RATES = {
  epicPerPack: 0.25,         // official
  altArtPerPack: 0.0833,     // official (~2 per 24-pack box)
  overnumberPerPack: 0.014,  // community
  signaturePerPack: 0.0014,  // community
} as const

// ── Pre-computed set data (from riftbound-cards.json via TCGPlayer prices) ──

export const RIFTBOUND_EV_SETS: SetEVData[] = [
  {
    setCode: 'OGN',
    setName: 'Origins',
    releaseDate: '2025-10-31',
    packPrice: 5.00,
    cardsPerPack: 13, // 14 total minus 1 token
    avgCommon: 0.1851,
    avgUncommon: 0.3558,
    avgRare: 1.1007,
    avgEpic: 10.1233,
    avgFoilCommon: 0.8930,
    avgFoilUncommon: 1.2713,
    avgAltArt: 4.4648,
    avgOvernumber: 71.4308,
    avgSignature: 1018.3677,
    countCommon: 88,
    countUncommon: 84,
    countRare: 84,
    countEpic: 42,
    countAltArt: 29,
    countOvernumber: 12,
    countSignature: 13,
    topEpics: [
      { name: "Kai'Sa, Survivor", price: 70.30, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3d942c02ad4e96a36dba14d663c5105bb6614500-744x1039.png?accountingTag=RB' },
      { name: 'Baited Hook', price: 48.45, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7b4e6a1e32878a7d5fe4e40869c83e47ea08de7c-744x1039.png?accountingTag=RB' },
      { name: 'Dazzling Aurora', price: 41.53, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c023856a50c75058465f283d181277ce265ba108-744x1039.png?accountingTag=RB' },
      { name: 'Time Warp', price: 35.53, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b97bbcf3cf6cb6e5f4baaa1bfbb85dc860eb950b-744x1039.png?accountingTag=RB' },
      { name: 'Unchecked Power', price: 33.38, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c44cd1f6f41144c770ac79f10e5ae75f0c6d6435-744x1039.png?accountingTag=RB' },
    ],
    topRares: [
      { name: 'Thousand-Tailed Watcher', price: 17.22, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b20e5644c33924a58e0497dd9f7db19723147003-744x1039.png?accountingTag=RB' },
      { name: 'Sabotage', price: 13.16, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/70f186b85fd224ee23dcf64957f0fab835d28040-744x1039.png?accountingTag=RB' },
      { name: 'Falling Star', price: 8.16, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9cf2d2e59e1bf839cdf5c2a77e95f5d1e871788f-744x1039.png?accountingTag=RB' },
      { name: "Zhonya's Hourglass", price: 7.27, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/dc38172c56f838b407fc9f170ba973da32d7cd4d-744x1039.png?accountingTag=RB' },
      { name: 'Sona, Harmonious', price: 5.88, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8582f6430821fb912fcb3619c5ce9405f254cb2f-744x1039.png?accountingTag=RB' },
    ],
    topAltArts: [
      { name: 'Sett, Brawler', price: 13.09, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/26e65c15e8a1ce1a9cd60d96345c7916e67e00ac-744x1039.png?accountingTag=RB' },
      { name: 'Teemo, Scout', price: 10.93, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/404a8aa0061b58611bd913b58dd01d99fdb8087d-744x1039.png?accountingTag=RB' },
      { name: 'Teemo, Strategist', price: 9.77, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0709ab02b75d9acc8f3c4037ec3a4140323150d8-744x1039.png?accountingTag=RB' },
      { name: 'Miss Fortune, Captain', price: 8.04, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6a7a0dfa952259993fa0d8998a820585ff4f81c6-744x1039.png?accountingTag=RB' },
      { name: 'Ahri, Inquisitive', price: 7.91, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7adc5aa8dba66bf918b8140699cb3a74f7b0efb5-744x1039.png?accountingTag=RB' },
    ],
    topOvernumbers: [
      { name: 'Daughter of the Void', price: 140.65, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/57e13462b8fea9a5cfa1b424d3ad3005f37b00ad-1488x2078.png?accountingTag=RB' },
      { name: 'Bounty Hunter', price: 90.08, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f4b7f334f442d30ccea4743c641760c5533804b4-1488x2078.png?accountingTag=RB' },
      { name: 'Herald of the Arcane', price: 87.62, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a39902058db800a4318f3333dddb8a62a8751d7c-1488x2078.png?accountingTag=RB' },
      { name: 'Loose Cannon', price: 75.38, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8a7dbbed04133926e58843f1d586f51178ef2ebd-1488x2078.png?accountingTag=RB' },
      { name: 'Swift Scout', price: 74.42, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e2fbf10efaddbabe9241bd2c7b4d059accd1d5a7-1488x2078.png?accountingTag=RB' },
    ],
    topSignatures: [
      { name: 'Daughter of the Void', price: 2492.01, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ae8e68af43400f61f7391c0a6ee339fd718a7540-1488x2078.png?accountingTag=RB' },
      { name: 'Nine-Tailed Fox', price: 2409.83, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e5fe571a8f09c0a9e76345ec32b446480f54617c-1488x2078.png?accountingTag=RB' },
      { name: 'Bounty Hunter', price: 1075.74, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/37153cce7f58b2fceb28ea9ff91deb0411f849e2-1488x2078.png?accountingTag=RB' },
      { name: 'Loose Cannon', price: 968.15, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/30bed82f66ce9e4eae260d029d92c9d8cb1588ab-1488x2078.png?accountingTag=RB' },
      { name: 'Swift Scout', price: 953.18, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4fd9e82cbd96010e2556430970d433022b541a51-1488x2078.png?accountingTag=RB' },
    ],
  },
  {
    setCode: 'SFD',
    setName: 'Spiritforged',
    releaseDate: '2026-02-13',
    packPrice: 5.00,
    cardsPerPack: 13,
    avgCommon: 0.0743,
    avgUncommon: 0.1987,
    avgRare: 0.4207,
    avgEpic: 4.5124,
    avgFoilCommon: 0.2562,
    avgFoilUncommon: 0.7359,
    avgAltArt: 5.6948,
    avgOvernumber: 56.7808,
    avgSignature: 672.3162,
    countCommon: 61,
    countUncommon: 63,
    countRare: 60,
    countEpic: 38,
    countAltArt: 27,
    countOvernumber: 26,
    countSignature: 13,
    topEpics: [
      { name: 'Last Rites', price: 26.32, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6cfab85030bff454262794e4fa12f11b5dc45a74-744x1039.png?accountingTag=RB' },
      { name: 'Arise!', price: 22.24, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/346f4698fea2878dde88470c1793047140c981e3-744x1039.png?accountingTag=RB' },
      { name: 'Defiant Dance', price: 21.06, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6f5bc5c9e321830337998a2b85e4fec3cd8251c9-744x1039.png?accountingTag=RB' },
      { name: 'Svellsongur', price: 16.67, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/bc254398dfb5db217327b56862011a2fd6020789-744x1039.png?accountingTag=RB' },
      { name: 'Irelia, Fervent', price: 11.67, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/fe05fa55781f8036f8bfc9c10bba94326a0c8cc9-744x1039.png?accountingTag=RB' },
    ],
    topRares: [
      { name: 'Fizz, Trickster', price: 5.70, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6d1c6615fb6ef5fb520a35b2ce76f8feee9167dc-744x1039.png?accountingTag=RB' },
      { name: 'Akshan, Mischievous', price: 2.79, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f9e79f88463c1d516b9f1b053661937676e0e1f4-744x1039.png?accountingTag=RB' },
      { name: 'Guardian Angel', price: 1.33, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d09a797345659a1853d6d12910cf3c634990ea0c-744x1039.png?accountingTag=RB' },
      { name: 'Bellows Breath', price: 1.26, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/f0ae1c4bb788f6fadc251c9d9b36f3f92eef4c56-744x1039.png?accountingTag=RB' },
      { name: 'Switcheroo', price: 1.04, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a4338f495feff5eee46d5349b5fded5e35e76176-744x1039.png?accountingTag=RB' },
    ],
    topAltArts: [
      { name: 'Mechanized Menace', price: 29.64, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0234cad3663d52d3120e78f2adbe8a253102a7a3-744x1039.png?accountingTag=RB' },
      { name: 'Karma, Channeler', price: 28.68, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ba0113d449813c94534ae0e74f3ef38f9b8010c2-744x1039.png?accountingTag=RB' },
      { name: 'Darius, Executioner', price: 25.54, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4f550f321dce06bb09bb47682d5bf2981280ea16-744x1039.png?accountingTag=RB' },
      { name: 'Irelia, Fervent', price: 12.97, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/cef4f73541e0623b4024b483d141d0396f1dddcb-744x1039.png?accountingTag=RB' },
      { name: "Rek'Sai, Breacher", price: 10.29, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8ef898e761ab44c43cb1cba11109a02d9cb5ce10-744x1039.png?accountingTag=RB' },
    ],
    topOvernumbers: [
      { name: 'Irelia, Fervent', price: 163.44, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/40454a8534f7c9444bafd000ffbfc0e5bcc847f0-744x1039.png?accountingTag=RB' },
      { name: 'Blade Dancer', price: 95.05, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8258072391bbb8d24e9d6e603c3ba1434979a911-744x1039.png?accountingTag=RB' },
      { name: 'Vayne, Hunter', price: 81.80, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6f8caecc98cb5dae1b818677ef5baaaa4a5f7cb2-744x1039.png?accountingTag=RB' },
      { name: 'Emperor of the Sands', price: 75.79, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/42c04e4d7ef5d7395494587c2e15ac945b37b71e-744x1039.png?accountingTag=RB' },
      { name: 'Prodigal Explorer', price: 73.46, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3ba4f1d3d61d80e7becc9d046e1974f17bff4b10-744x1039.png?accountingTag=RB' },
    ],
    topSignatures: [
      { name: 'Ahri, Inquisitive', price: 2664.05, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/608f786c30a7e80db87d3c2d45bc0c26b0840c5e-744x1039.png?accountingTag=RB' },
      { name: 'Irelia, Fervent', price: 1355.99, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e064a9017b5d6bf0e18c4452acfca4ed8c279657-744x1039.png?accountingTag=RB' },
      { name: 'Vayne, Hunter', price: 789.20, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/75f9eac062e43105ee602b6050fe230fb8d2dce5-744x1039.png?accountingTag=RB' },
      { name: 'Soraka, Wanderer', price: 607.43, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e2655ee2d1bfaf90ac12f7b71aca36fcff2b8cc6-744x1039.png?accountingTag=RB' },
      { name: 'Twisted Fate, Gambit', price: 425.07, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e9f3ac3dddb4da3a0c23d00df82f40d8a7b3c0c5-744x1039.png?accountingTag=RB' },
    ],
  },
  {
    setCode: 'UNL',
    setName: 'Unleashed',
    releaseDate: '2026-05-08',
    packPrice: 5.00,
    cardsPerPack: 13,
    avgCommon: 0.0590,
    avgUncommon: 0.1317,
    avgRare: 0.4003,
    avgEpic: 4.5745,
    avgFoilCommon: 0.1969,
    avgFoilUncommon: 0.5208,
    avgAltArt: 7.0700,
    avgOvernumber: 73.5400,
    avgSignature: 423.0700,
    countCommon: 68,
    countUncommon: 63,
    countRare: 60,
    countEpic: 36,
    countAltArt: 31,
    countOvernumber: 18,
    countSignature: 12,
    topEpics: [
      { name: 'Rengar, Trophy Hunter', price: 19.63, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/2e3b7f1e4d9a1c0b3e5a7d8f2c4b6e1a-744x1039.png?accountingTag=RB' },
      { name: 'Moonfall', price: 16.29, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3f4a8c2e1d7b5e9c0a6d4f8b2e1c7a3d-744x1039.png?accountingTag=RB' },
      { name: 'Vex, Apathetic', price: 15.78, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4e5b9d3f2c8a6e0b1d7f5c9e3b2d8a4f-744x1039.png?accountingTag=RB' },
      { name: 'Pyke, Dockside Butcher', price: 15.50, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5d6c0e4a3d9b7f1c2e8a6d0f4c3e9b5a-744x1039.png?accountingTag=RB' },
      { name: 'Baron Nashor', price: 15.18, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6e7d1f5b4e0c8a2d3f9b7e1c5d4f0c6b-744x1039.png?accountingTag=RB' },
    ],
    topRares: [
      { name: 'Wuju Bladesman', price: 3.23, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7f8e2a6c5f1d9b3e4a0c8f2d6e5a1b7c-744x1039.png?accountingTag=RB' },
      { name: 'Dragonslayer', price: 2.11, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8a9f3b7d6a2e0c4f5b1d9a3e7f6b2c8d-744x1039.png?accountingTag=RB' },
      { name: 'Shadow Step', price: 1.56, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9b0a4c8e7b3f1d5a6c2e0b4f8a7c3d9e-744x1039.png?accountingTag=RB' },
      { name: 'Void Rift', price: 1.43, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0c1b5d9f8c4a2e6b7d3f1c5a9b8d4e0f-744x1039.png?accountingTag=RB' },
      { name: 'Ancient Rune', price: 1.38, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1d2c6e0a9d5b3f7c8e4a2d6f0a9e5b1c-744x1039.png?accountingTag=RB' },
    ],
    topAltArts: [
      { name: 'Pouty Poro', price: 63.51, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/2e3d7f1b0e6c4a8d9f5b3e7a1d6c2f0a-744x1039.png?accountingTag=RB' },
      { name: 'Lonely Poro', price: 23.50, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3f4e8a2c1f7d5b9e0a6c4f8b2e1d7a3e-744x1039.png?accountingTag=RB' },
      { name: 'Plundering Poro', price: 18.55, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4a5f9b3d2a8e6c0f1b7d5a9c3f2e8b4f-744x1039.png?accountingTag=RB' },
      { name: 'Rengar, Trophy Hunter', price: 17.49, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5b6a0c4e3b9f7d1a2c8e6b0d4a3f9c5a-744x1039.png?accountingTag=RB' },
      { name: 'Pyke, Dockside Butcher', price: 15.45, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6c7b1d5f4c0a8e2b3d9f7c1e5b4a0d6b-744x1039.png?accountingTag=RB' },
    ],
    topOvernumbers: [
      { name: 'Pouty Poro', price: 121.77, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7d8c2e6a5d1b9f3c4e0a8d2f6c5b1e7c-744x1039.png?accountingTag=RB' },
      { name: 'Lonely Poro', price: 109.96, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8e9d3f7b6e2c0a4d5f1b9e3a7d6c2f8d-744x1039.png?accountingTag=RB' },
      { name: 'Plundering Poro', price: 109.06, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9f0e4a8c7f3d1b5e6a2c0f4b8e7d3a9e-744x1039.png?accountingTag=RB' },
      { name: 'Baron Nashor', price: 99.99, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0a1f5b9d8a4e2c6f7b3d1a5e9f8c4b0f-744x1039.png?accountingTag=RB' },
      { name: 'Vex, Apathetic', price: 74.99, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1b2a6c0e9b5f3d7a8c4e2b6f0a9d5c1a-744x1039.png?accountingTag=RB' },
    ],
    topSignatures: [
      { name: 'Rengar, Trophy Hunter', price: 915.10, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/2c3b7d1f0c6a4e8b9d5f3c7a1e6d2b0c-744x1039.png?accountingTag=RB' },
      { name: 'Pyke, Dockside Butcher', price: 678.29, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3d4c8e2a1d7b5f9c0e6d4a8b2f1e7c3d-744x1039.png?accountingTag=RB' },
      { name: 'Baron Nashor', price: 520.00, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/4e5d9f3b2e8c6a0d1f7e5b9c3a2f8d4e-744x1039.png?accountingTag=RB' },
      { name: 'Vex, Apathetic', price: 399.00, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5f6e0a4c3f9d7b1e2a8f6c0d4b3a9e5f-744x1039.png?accountingTag=RB' },
      { name: 'Moonfall', price: 312.00, imageUrl: 'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6a7f1b5d4a0e8c2f3b9a7d1e5c4b0f6a-744x1039.png?accountingTag=RB' },
    ],
  },
]

// ── EV calculation ──────────────────────────────────────────────────────────

export function computeEV(set: SetEVData): EVBreakdown {
  const { epicPerPack, altArtPerPack, overnumberPerPack, signaturePerPack } = PULL_RATES

  // 7 Commons
  const commons = 7 * set.avgCommon

  // 3 Uncommons
  const uncommons = 3 * set.avgUncommon

  // 2 guaranteed foil Rare-or-better slots
  // In 75% of packs: 2 Rares. In 25%: 1 Rare + 1 Epic.
  const rarePlusSlots =
    0.75 * (2 * set.avgRare) + 0.25 * (set.avgRare + set.avgEpic)

  // Foil wildcard slot
  // Premium pulls (Alt Art / Overnumber / Signature) appear here.
  // The remaining ~90% is a foil Common or Uncommon (split evenly).
  const nonPremium = 1 - altArtPerPack - overnumberPerPack - signaturePerPack
  const wildcardBase = nonPremium * 0.5 * (set.avgFoilCommon + set.avgFoilUncommon)
  const wildcardAltArt = altArtPerPack * set.avgAltArt
  const wildcardOvernumber = overnumberPerPack * set.avgOvernumber
  const wildcardSignature = signaturePerPack * set.avgSignature
  const wildcardSlot = wildcardBase + wildcardAltArt + wildcardOvernumber + wildcardSignature

  return {
    commons,
    uncommons,
    rarePlusSlots,
    wildcardSlot,
    total: commons + uncommons + rarePlusSlots + wildcardSlot,
    wildcardBase,
    wildcardAltArt,
    wildcardOvernumber,
    wildcardSignature,
  }
}

export const RIFTBOUND_EV = RIFTBOUND_EV_SETS.map((set) => ({
  ...set,
  ev: computeEV(set),
}))
