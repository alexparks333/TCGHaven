// npm run test:riftbound-tcgplayer — how Riftbound TCGplayer products are keyed (riftbound-tcgplayer.mjs)
import assert from 'node:assert/strict'
import { tcgKey, signatureNumberFixes, isUltimate } from './riftbound-tcgplayer.mjs'

// The plain shapes
assert.equal(tcgKey('OGN', '066/298', 'Ahri, Alluring'), 'OGN:66:regular')
assert.equal(tcgKey('OGN', '066a/298', 'Ahri, Alluring (Alternate Art)'), 'OGN:66:altart')
assert.equal(tcgKey('SFD', '227*/221', 'Ahri, Inquisitive (Signature)'), 'SFD:227:star')
assert.equal(tcgKey('SFD', '227/221', 'Ahri, Inquisitive (Overnumbered)'), 'SFD:227:over')
assert.equal(tcgKey('VEN', 'SP3/006', 'Seraphine'), 'VEN:sp3')
assert.equal(tcgKey('OGN', 'T01', 'Token'), null)

// Overnumbered under other names (2026-11-23: these were left at $0)
assert.equal(tcgKey('RAD', '179/167', 'Aphelios, Exalted (Heartsteel Overnumbered)'), 'RAD:179:over')
assert.equal(tcgKey('RAD', '179*/167', 'Aphelios, Exalted (Heartsteel Signature)'), 'RAD:179:star')
assert.equal(tcgKey('UNL', '238/219', 'Baron Nashor (Ultimate)'), 'UNL:238:over')
assert.equal(tcgKey('RAD', '184/167', 'Packed Amphitheater (Ultimate)'), 'RAD:184:over')
// Ultimates are their own card type, told apart by name
assert.equal(isUltimate('Baron Nashor (Ultimate)'), true)
assert.equal(isUltimate('Aphelios, Exalted (Heartsteel Overnumbered)'), false)
assert.equal(isUltimate('Baron Nashor'), false)
// …and by number alone, whatever the name says
assert.equal(tcgKey('RAD', '185/167', 'Someone New'), 'RAD:185:over')
// a plain card at the set's last number stays plain
assert.equal(tcgKey('RAD', '167/167', 'Neeko, Blending In'), 'RAD:167:regular')

// Radiance's Jarvan IV Signature, listed under Aphelios's number
const rows = [
  { productId: 722306, name: 'Jarvan IV, Exemplar of Demacia (Overnumbered)', extNumber: '176/167' },
  { productId: 724641, name: 'Jarvan IV, Exemplar of Demacia (Signature)', extNumber: '179*/167' },
  { productId: 721350, name: 'Aphelios, Exalted (Heartsteel Overnumbered)', extNumber: '179/167' },
  { productId: 724664, name: 'Aphelios, Exalted (Heartsteel Signature)', extNumber: '179*/167' },
  { productId: 722338, name: 'Seraphine, Starry-Eyed Songstress (Overnumbered)', extNumber: '174/167' },
  { productId: 724655, name: 'Seraphine, Starry-Eyed Songstress (Signature)', extNumber: '174*/167' },
]
const fixes = signatureNumberFixes(rows)
assert.deepEqual([...fixes], [['724641', '176*/167']])

console.log('riftbound tcgplayer keys: all tests passed')
