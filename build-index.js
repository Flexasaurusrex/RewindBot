// build-index.js
// Run once: node build-index.js
// Generates a compact archive-index.json from the full RAD cards.json

const fs = require('fs');

const SRC = process.argv[2] || '/Users/flex/Desktop/rad/public/data/cards.json';
const OUT = './archive-index.json';
const CONTEXT_CHARS = 400;
const SIG_CHARS = 300;
const CURATORIAL_CHARS = 200;
const MAX_TAGS = 8;

console.log(`Reading ${SRC}...`);
const cards = JSON.parse(fs.readFileSync(SRC, 'utf8'));
console.log(`${cards.length} cards loaded`);

const compact = cards.map(c => {
  const out = {
    id: c.id,
    artist: c.artist,
    title: c.title,
    year: c.year,
  };

  if (c.director) out.director = c.director;

  // First sentence of era
  if (c.era) out.era = c.era.split(' - ')[0].split('. ')[0];

  if (c.movement) out.movement = c.movement;

  if (c.cultural_context)
    out.context = c.cultural_context.slice(0, CONTEXT_CHARS);

  if (c.genre_significance)
    out.significance = c.genre_significance.slice(0, SIG_CHARS);

  if (c.curatorial_value)
    out.curatorial = c.curatorial_value.slice(0, CURATORIAL_CHARS);

  if (c.tags && c.tags.length)
    out.tags = c.tags.slice(0, MAX_TAGS);

  if (c.subcultures && c.subcultures.length)
    out.subcultures = c.subcultures.slice(0, 4);

  return out;
});

fs.writeFileSync(OUT, JSON.stringify(compact));
const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`✅ Written ${OUT} (${size} MB, ${compact.length} cards)`);
