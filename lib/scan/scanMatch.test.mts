// Offline tests for the card scanner's matching — `npm run test:scan`.
// Fixtures are real catalog cards (trimmed); the OCR lines are what each card prints, laid out
// where it prints it. lib/scan/scanMatch.ts reads them, lib/scan/decide.ts makes the final call.
import assert from 'node:assert/strict'
import { readClues, matchScan, numKey, nameScore, fold, onePiecePrintedCode, printedName, readSlabLabel, type OcrLine, type ScanCatalog } from './scanMatch.ts'
import { decide } from './decide.ts'

const L = (text: string, y: number, h = 0.03): OcrLine => ({ text, x: 0.05, y, w: 0.6, h })

const pokemon: ScanCatalog = {
  key: 'pokemon',
  cards: [
    { id: 'sv1-199', name: 'Tarountula', number: '199', set: 'sv1' },
    { id: 'sv3-199', name: 'Ninetales', number: '199', set: 'sv3' },
    { id: 'sv3pt5-199', name: 'Charizard ex', number: '199', set: 'sv3pt5' },
    { id: 'sv3pt5-6', name: 'Charizard ex', number: '6', set: 'sv3pt5' },
    { id: 'sv3-125', name: 'Charizard ex', number: '125', set: 'sv3' },
    { id: 'swsh11-5', name: 'Parasect', number: '5', set: 'swsh11' },
    { id: 'swsh11tg-TG05', name: 'Pikachu', number: 'TG05', set: 'swsh11tg' },
    { id: 'swsh10tg-TG05', name: 'Gardevoir', number: 'TG05', set: 'swsh10tg' },
    { id: 'swshp-SWSH123', name: 'Galarian Articuno', number: 'SWSH123', set: 'swshp' },
  ],
  sets: [
    { id: 'sv1', name: 'Scarlet & Violet', total: 258 },
    { id: 'sv3', name: 'Obsidian Flames', total: 230 },
    { id: 'sv3pt5', name: '151', total: 207 },
    { id: 'swsh11', name: 'Lost Origin', total: 217 },
    { id: 'swsh11tg', name: 'Lost Origin Trainer Gallery', total: 30 },
    { id: 'swsh10tg', name: 'Astral Radiance Trainer Gallery', total: 30 },
    { id: 'swshp', name: 'SWSH Black Star Promos', total: 304 },
  ],
}
const pokemonJp: ScanCatalog = {
  key: 'pokemon-jp',
  cards: [
    { id: 'jp-565756', name: 'Pansage', number: '001', set: 'jp-23610', setName: 'SV4K: Ancient Roar' },
    { id: 'jp-1', name: 'Pikachu', number: '001', set: 'jp-9', setName: 'SV1: Scarlet ex' },
  ],
  sets: [{ id: 'jp-23610', name: 'SV4K: Ancient Roar', total: 95 }, { id: 'jp-9', name: 'SV1: Scarlet ex', total: 108 }],
}
const onepiece: ScanCatalog = {
  key: 'onepiece',
  cards: [
    { id: 'OP05-119', name: 'Monkey.D.Luffy', number: '119', set: 'OP05' },
    { id: 'OP05-119_p1', name: 'Monkey.D.Luffy', number: '119', set: 'OP05' },
    { id: 'OP05-119_p3', name: 'Monkey.D.Luffy', number: '119', set: 'PRB01' },
    { id: 'P-001', name: 'Monkey.D.Luffy', number: '001', set: 'P' },
    { id: 'tcg-412113', name: 'Monkey.D.Luffy', number: '001', set: 'ST01' },
    { id: 'OP01-001', name: 'Roronoa Zoro', number: '001', set: 'OP01' },
  ],
}
const lorcana: ScanCatalog = {
  key: 'lorcana',
  cards: [
    { id: 'crd_rapunzel', name: 'Rapunzel - Creative Captor', number: '143', set: '10' },
    { id: 'crd_tui', name: 'Chief Tui - Respected Leader', number: '143', set: '1' },
  ],
}
const riftbound: ScanCatalog = {
  key: 'riftbound',
  cards: [
    { id: 'ogn-048-298', name: 'Meditation', number: '48', setCode: 'OGN', publicCode: 'OGN-048/298' },
    { id: 'sfd-048-221', name: 'Stellacorn Herder', number: '48', setCode: 'SFD', publicCode: 'SFD-048/221' },
  ],
}
const mtg: ScanCatalog = {
  key: 'mtg',
  cards: [
    { id: 'blb-280', name: 'Forest', number: '280', set: 'blb' },
    { id: 'blb-281', name: 'Forest', number: '281', set: 'blb' },
    { id: 'm20-1', name: 'Aerial Assault', number: '1', set: 'm20' },
    { id: 'dmu-1', name: 'Archangel of Wrath', number: '1', set: 'dmu' },
  ],
}
const ALL = [pokemon, pokemonJp, onepiece, lorcana, riftbound, mtg]
const top = (lines: OcrLine[], cats = ALL) => matchScan(readClues(lines), cats)
const ids = (lines: OcrLine[]) => top(lines).map((c) => c.id)

// ── helpers ──
assert.equal(numKey('025'), '25')
assert.equal(numKey('TG05'), 'tg5')
assert.equal(numKey('SWSH123'), 'swsh123')
assert.equal(fold('Pokémon Café'), 'pokemon cafe')
assert.ok(nameScore('Charizard ex', new Set(['charizard', 'ex'])) === 1)
assert.ok(nameScore('Charizard ex', new Set(['charizrd', 'ex'])) > 0.85, 'one OCR slip still counts')
assert.equal(nameScore('Mew', new Set(['new'])), 0, 'short names need an exact read')
assert.equal(onePiecePrintedCode({ id: 'OP05-119_p3', name: '', number: '119', set: 'PRB01' }), 'OP05-119')
assert.equal(onePiecePrintedCode({ id: 'tcg-412113', name: '', number: '001', set: 'ST01' }), 'ST01-001')

// ── reading the card ──
{
  const c = readClues([L('Charizard ex HP 330', 0.04, 0.05), L('199/165 SIR', 0.93, 0.015)])
  assert.deepEqual(c.fractions, [{ pre: '', num: '199', suf: '', den: 165 }])
  assert.ok(c.pokemonWords)
  assert.equal(c.nameLines[0], 'Charizard ex')
}
{
  // OCR slips inside the number: O for 0, l for 1
  const c = readClues([L('Charizard ex', 0.04, 0.05), L('l99/l65', 0.93, 0.015)])
  assert.deepEqual(c.fractions.map((f) => `${f.num}/${f.den}`), ['199/165'])
}
{
  const c = readClues([L('SV4K 001/095', 0.93, 0.015)])
  assert.ok(c.bottomTokens.includes('SV4K'))
  assert.equal(c.fractions[0].num, '1', 'a set mark followed by a space is not part of the number')
}
assert.deepEqual(readClues([L('OP05-119 SEC', 0.92)]).opCodes, ['OP05-119'])
assert.deepEqual(readClues([L('0P05 - 119', 0.92)]).opCodes, [], 'a zero misread as O is not guessed at')
assert.deepEqual(readClues([L('P-001', 0.92)]).opCodes, ['P-001'])
assert.deepEqual(readClues([L('143/204 • EN • 10', 0.95)]).lorcanaSet, ['10'])
assert.deepEqual(readClues([L('BLB • EN', 0.95)]).mtgSets, ['blb'])

// ── Pokémon: the number picks the set, the name confirms ──
assert.equal(ids([L('Charizard ex HP 330', 0.04, 0.05), L('Weakness', 0.85), L('199/165', 0.93, 0.015)])[0], 'sv3pt5-199')
assert.equal(ids([L('Pikachu HP 60', 0.04, 0.05), L('TG05/TG30', 0.93, 0.015)])[0], 'swsh11tg-TG05', 'Trainer Gallery numbers')
assert.equal(ids([L('Galarian Articuno V', 0.04, 0.05), L('SWSH123', 0.93, 0.015)])[0], 'swshp-SWSH123', 'black-star promos')
// Number unreadable (glare): the name alone still finds every Charizard ex
{
  const r = top([L('Charizard ex HP 330', 0.04, 0.05), L('Retreat', 0.85)])
  assert.deepEqual(r.filter((c) => c.name === 'Charizard ex').length, 3)
}

// ── Pokémon Japanese: number + set mark ──
{
  const r = top([L('ヤナップ HP 70', 0.04, 0.05), L('SV4K 001/095', 0.93, 0.015)])
  assert.equal(r[0].id, 'jp-565756')
  assert.ok(r[0].score > r[1].score)
}

// ── One Piece: the code, reprints included ──
{
  const r = top([L('Monkey.D.Luffy', 0.82, 0.04), L('OP05-119', 0.9, 0.015)])
  const luffys = r.filter((c) => c.score === r[0].score).map((c) => c.id).sort()
  assert.deepEqual(luffys, ['OP05-119', 'OP05-119_p1', 'OP05-119_p3'], 'every printing of the code ties — the picture decides')
  assert.equal(ids([L('Monkey.D.Luffy', 0.82, 0.04), L('ST01-001', 0.9, 0.015)])[0], 'tcg-412113')
  assert.equal(ids([L('Monkey.D.Luffy', 0.82, 0.04), L('P-001', 0.9, 0.015)])[0], 'P-001')
}

// ── Lorcana: number + set number ──
assert.equal(ids([L('Rapunzel', 0.55, 0.04), L('Creative Captor', 0.6), L('143/204 • EN • 10', 0.95, 0.012)])[0], 'crd_rapunzel')
assert.equal(ids([L('Chief Tui', 0.55, 0.04), L('143/204 • EN • 1', 0.95, 0.012)])[0], 'crd_tui')

// ── Riftbound: set code + number/total ──
assert.equal(ids([L('Meditation', 0.55, 0.04), L('OGN • 048/298', 0.95, 0.012)])[0], 'ogn-048-298')
assert.equal(ids([L('SFD • 048/221', 0.95, 0.012)])[0], 'sfd-048-221', 'the total alone tells the sets apart')

// ── Magic: set code + collector number ──
assert.equal(ids([L('Forest', 0.04, 0.04), L('0281 L', 0.93, 0.012), L('BLB • EN', 0.955, 0.012)])[0], 'blb-281')
assert.equal(ids([L('Aerial Assault', 0.04, 0.04), L('001/280 C', 0.93, 0.012), L('M20 • EN', 0.955, 0.012)])[0], 'm20-1')

// ── What real OCR does (from Apple Vision runs on real card images) ──
{
  // A regulation mark glued to the number, an S read for a 5, a Cyrillic а in a set mark
  assert.ok(readClues([L('F091/086 AR', 0.93)]).fractions.some((f) => f.pre === '' && f.num === '91' && f.den === 86))
  assert.ok(readClues([L('F TG0S/TG30 *', 0.93)]).fractions.some((f) => f.pre === 'TG' && f.num === '5' && f.den === 30))
  assert.ok(readClues([L('Sv6а 034/064 U', 0.93)]).bottomTokens.includes('Sv6a'))
  assert.ok(readClues([L('SM 9b', 0.93)]).bottomTokens.includes('SM9b'))
  // One Piece: an O for a 0, the rarity glued on
  assert.deepEqual(readClues([L('OPO4-021 EE O', 0.92)]).opCodes, ['OP04-021'])
  assert.deepEqual(readClues([L('OP17-042E S', 0.92)]).opCodes, ['OP17-042'])
  // Japanese promos number against the promo series
  assert.deepEqual(readClues([L('C) 388/SM-P', 0.93)]).jpPromos, [{ num: '388', mark: 'sm-p' }])
  // Riftbound signatures
  assert.equal(readClues([L('UNL • 226*/219 •', 0.95)]).fractions[0].suf, '*')
}
assert.equal(printedName('Pumpkaboo (Pokemon League) [4th Place]'), 'Pumpkaboo')
assert.equal(printedName('Daybreak Ranger // Nightfall Predator'), 'Daybreak Ranger')
assert.equal(printedName('Mr.3(Galdino) (Alternate Art)'), 'Mr.3(Galdino)', "a name's own brackets stay")

// Stamped copies tie with the plain card on text (the stamp isn't a word) — never a silent pick
{
  const cat: ScanCatalog = {
    key: 'pokemon',
    cards: [
      { id: 'xy1-56', name: 'Pumpkaboo', number: '56', set: 'xy1' },
      { id: 'tcg-230930', name: 'Pumpkaboo (Pokemon League) [4th Place]', number: '56', set: 'xy1' },
    ],
    sets: [{ id: 'xy1', name: 'XY', total: 146 }],
  }
  const r = top([L('Pumpkaboo HP 60', 0.04, 0.05), L('056/146', 0.93, 0.015)], [cat])
  assert.equal(r[0].score, r[1].score)
}
// Riftbound reprints in their own sets print the original code — a close second, not dropped
{
  const cat: ScanCatalog = {
    key: 'riftbound',
    cards: [
      { id: 'sfd-193-221', name: 'Jax, Grandmaster At Arms', number: '193', setCode: 'SFD', publicCode: 'SFD-193/221' },
      { id: 'mtl-684988', name: 'Jax, Grandmaster At Arms (Best Of)', number: '193', setCode: 'MTL', publicCode: 'MTL-193/221' },
    ],
  }
  const r = top([L('Jax', 0.55, 0.04), L('Grandmaster At Arms', 0.6), L('SFD • 193/221', 0.95, 0.012)], [cat])
  assert.equal(r[0].id, 'sfd-193-221')
  assert.ok(r[1].id === 'mtl-684988' && r[0].score - r[1].score < 10, 'the reprint stays close enough that a matching picture means asking')
}
// Found by a name many printings share: only the picture can settle it — a near-exact match
// clearly ahead of the other printings is added; printings that look alike are asked about
{
  const r = top([L('Forest', 0.04, 0.04)], [mtg])
  assert.ok(r.length === 2 && r.every((c) => !c.exact))
  const cands = r.map((c) => ({ key: c.id, score: c.score, exact: c.exact }))
  assert.equal(decide(cands, [0.05, 0.6]).status, 'matched')
  assert.equal(decide(cands, [0.05, 0.07]).status, 'pick')
  assert.equal(decide(cands).status, 'pick')
}
// Japanese promo: number against its promo series
{
  const cat: ScanCatalog = {
    key: 'pokemon-jp',
    cards: [{ id: 'jp-598465', name: 'Rainbow Flower', number: '388', set: 'jp-23881' }, { id: 'jp-x', name: 'Other', number: '388', set: 'jp-1' }],
    sets: [{ id: 'jp-23881', name: 'SM-P: Sun & Moon Promos', total: 413 }, { id: 'jp-1', name: 'S1: Sword', total: 400 }],
  }
  assert.equal(top([L('レインボーフラワー', 0.04, 0.05), L('C) 388/SM-P', 0.93, 0.015)], [cat])[0].id, 'jp-598465')
}

// ── Graded slabs: the label names the card (a real PSA 9 Mew VMAX, read on an iPhone 17 Pro Max) ──
{
  const at = (text: string, x: number, y: number): OcrLine => ({ text, x, y, w: 0.3, h: 0.025 })
  const slabLines = [
    at('2022 POKEMON SWSH', 0.05, 0.02), at('FA/MEW VMAX', 0.05, 0.05), at('LOST ORIGIN', 0.05, 0.08),
    at('#TG30', 0.8, 0.02), at('MINT', 0.82, 0.05), at('9', 0.86, 0.08), at('140713476', 0.72, 0.11),
    at('Gross Fusion Strike', 0.3, 0.7), at('E TGЗОЛTGВО *', 0.1, 0.95),  // the card's own number, garbled by the plastic
  ]
  const label = readSlabLabel(slabLines)
  assert.deepEqual({ ...label, text: undefined }, { company: 'PSA', grade: '9', cert: '140713476', number: 'TG30', game: 'pokemon', text: undefined })
  const cat: ScanCatalog = {
    key: 'pokemon',
    cards: [
      { id: 'swsh11tg-TG30', name: 'Mew VMAX', number: 'TG30', set: 'swsh11tg', setName: 'Lost Origin Trainer Gallery' },
      { id: 'swsh12tg-TG30', name: 'Duraludon VMAX', number: 'TG30', set: 'swsh12tg', setName: 'Silver Tempest Trainer Gallery' },
    ],
    sets: [{ id: 'swsh11tg', name: 'Lost Origin Trainer Gallery', total: 30 }, { id: 'swsh12tg', name: 'Silver Tempest Trainer Gallery', total: 30 }],
  }
  const r = top(slabLines, [cat])
  assert.equal(r[0].id, 'swsh11tg-TG30')
  assert.ok(r[0].score - r[1].score >= 20)
  // An ordinary card is never mistaken for a slab
  assert.equal(readSlabLabel([at('Charizard ex', 0.05, 0.04), at('HP 330', 0.8, 0.04), at('199/165', 0.05, 0.93)]), null)
}

// Riftbound promo mark: "UNL • 156/219 • P" (a real Loyal Poro Nexus promo, read on the phone)
{
  const cat: ScanCatalog = {
    key: 'riftbound',
    cards: [
      { id: 'unl-156-219', name: 'Loyal Poro', number: '156', setCode: 'UNL', setName: 'Unleashed', publicCode: 'UNL-156/219' },
      { id: 'tcg-1', name: 'Loyal Poro (Nexus Promo)', number: '156', setCode: 'UNLN', setName: 'Unleashed Nexus', publicCode: 'UNL-156/219' },
    ],
  }
  const r = top([L('Loyal Poro', 0.5, 0.04), L('UNL • 156/219 • P', 0.95, 0.012)], [cat])
  assert.equal(r[0].id, 'tcg-1')
  assert.equal(top([L('Loyal Poro', 0.5, 0.04), L('UNL • 156/219 • U', 0.95, 0.012)], [cat])[0].id, 'unl-156-219')
}
// Real phone scans: number + name clearly ahead, picture only fair (toploader glare) → accepted
assert.equal(decide([{ key: 'a', score: 100, exact: true }, { key: 'b', score: 48, exact: true }], [0.52, 0.8]).status, 'matched')
// …but a picture that looks like nothing still sends it to the person
assert.equal(decide([{ key: 'a', score: 100, exact: true }, { key: 'b', score: 48, exact: true }], [0.85, 0.9]).status, 'pick')

// Name only + a near-exact picture, clearly ahead: accepted (a real Squirtle with its number unread)
assert.equal(decide([{ key: 'a', score: 65, exact: false }, { key: 'b', score: 65, exact: false }], [0.084, 0.6]).status, 'matched')
// …but name only with an ordinary picture stays a question
assert.equal(decide([{ key: 'a', score: 65, exact: false }, { key: 'b', score: 65, exact: false }], [0.3, 0.6]).status, 'pick')
// A grading label isn't overruled by a poor picture (the card cut from the slab can be off)
assert.equal(decide([{ key: 'a', score: 99, exact: true, trusted: true }], [0.889]).status, 'matched')

// e-Card era Pokémon: the number alone ("95a"), no "/total" — a real Aquapolis Mr. Mime
{
  const cat: ScanCatalog = {
    key: 'pokemon',
    cards: [
      { id: 'ecard2-95', name: 'Mr. Mime', number: '95', set: 'ecard2' },
      { id: 'tcg-87590', name: 'Mr. Mime', number: '095a', set: 'tcg-1' },
      { id: 'tcg-87591', name: 'Mr. Mime', number: '095b', set: 'tcg-1' },
    ],
    sets: [{ id: 'ecard2', name: 'Aquapolis', total: 182 }],
  }
  const r = top([L('Mr. Mime', 0.04, 0.05), L('50 HP', 0.04, 0.03), L('ID: C-22-b', 0.12), L('© 2002 Pokémon / Nintendo', 0.95, 0.012), L('95a', 0.93, 0.015)], [cat])
  // The letter isn't trusted (a real 95b was read as "95a"): every version ties, to be picked
  assert.deepEqual(r.map((c) => c.id).sort(), ['ecard2-95', 'tcg-87590', 'tcg-87591'])
  assert.ok(r.every((c) => c.exact && c.score === r[0].score))
}

// A clearly read name is a requirement: a misread number ("43/101" on a FireRed & LeafGreen
// Jigglypuff, 65/112) must not land on another card (it matched Baltoy on the phone)
{
  const cat: ScanCatalog = {
    key: 'pokemon',
    cards: [
      { id: 'ex4-43', name: 'Baltoy', number: '43', set: 'ex4' },
      { id: 'ex6-65', name: 'Jigglypuff', number: '65', set: 'ex6' },
      { id: 'base2-54', name: 'Jigglypuff', number: '54', set: 'base2' },
      { id: 'tcg-x', name: 'Genesect EX (Andrew Estrada)', number: '11', set: 'tcg-1' },
    ],
    sets: [{ id: 'ex4', name: 'Team Magma vs Team Aqua', total: 97 }, { id: 'ex6', name: 'FireRed & LeafGreen', total: 116 }, { id: 'base2', name: 'Jungle', total: 64 }],
  }
  const r = top([L('Jigglypuff', 0.04, 0.05), L('50 HP', 0.04, 0.036), L('Sleepy Song', 0.5), L('43/101', 0.93, 0.015)], [cat])
  assert.ok(r.slice(0, 2).every((c) => c.name === 'Jigglypuff'), 'the Jigglypuffs come first')
  const baltoy = r.find((c) => c.id === 'ex4-43')
  assert.ok(!baltoy || (!baltoy.exact && baltoy.score < r[0].score), 'the wrong name never wins or auto-adds')
  // A name read with letters wrong still counts, when one name is clearly closest
  assert.ok(top([L('Jggypulf', 0.0, 0.05), L('43/101', 0.93, 0.015)], [cat]).slice(0, 2).every((c) => c.name === 'Jigglypuff'))
  // A name inside the card's name is the same card ("Genesect" on Genesect EX); "TRAINER" isn't a name
  assert.equal(top([L('Genesect', 0.04, 0.05), L('11/101', 0.93, 0.015)], [cat])[0]?.id, 'tcg-x')
  assert.ok(!readClues([L('TRAINER', 0.03, 0.04)]).topLines.some(() => false))
}

// ── Nothing readable → nothing guessed ──
assert.deepEqual(top([L('the', 0.5)]), [])

// ── decide(): text + picture (distances on the scale measured in decide.ts) ──
{
  const cands = [{ key: 'a', score: 90 }, { key: 'b', score: 90 }, { key: 'c', score: 90 }]
  // A tie on text (One Piece parallels); the picture is clearly closest to b
  const d = decide(cands, [0.55, 0.13, 0.48])
  assert.equal(d.ranked[0].key, 'b')
  assert.equal(d.status, 'matched')
  // Same-art look-alikes: pictures too close to call → the person picks
  assert.equal(decide(cands, [0.14, 0.13, 0.15]).status, 'pick')
  // The scan looks like none of them (wrong card read?) → no picture points, a pick
  assert.equal(decide(cands, [0.9, 0.75, 0.95]).status, 'pick')
  // No pictures compared → a tie stays a pick
  assert.equal(decide(cands).status, 'pick')
  // The picture never overturns a clear text win
  assert.equal(decide([{ key: 'x', score: 95 }, { key: 'y', score: 40 }], [0.5, 0.1]).ranked[0].key, 'x')
  // One candidate: a close picture confirms it, a very different one sends it to the person
  assert.equal(decide([{ key: 'x', score: 62 }], [0.15]).status, 'matched')
  assert.equal(decide([{ key: 'x', score: 80 }], [0.85]).status, 'pick')
  assert.equal(decide([{ key: 'x', score: 95 }]).status, 'matched')
  assert.equal(decide([{ key: 'x', score: 45 }]).status, 'pick')
  assert.equal(decide([]).status, 'none')
  // A clear text winner whose picture looks like nothing at all → asked, not added
  assert.equal(decide([{ key: 'x', score: 95 }, { key: 'y', score: 40 }], [0.82, 0.9]).status, 'pick')
}

console.log('scan matching: all tests passed')
