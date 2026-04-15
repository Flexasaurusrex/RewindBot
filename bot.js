const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const Anthropic = require("@anthropic-ai/sdk").default;

// --- Config ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-haiku-4-5-20251001";
const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 20;

// --- Archive RAG ---
let archiveCards = [];
const artistIndex = new Map();
const titleIndex = new Map();
const directorIndex = new Map();

const STOPWORDS = new Set([
  'the','and','for','that','this','with','are','was','what','who','how',
  'when','where','can','you','your','just','about','from','they','been',
  'have','its','like','but','not','any','did','does','ever','all','tell',
  'know','want','show','give','some','more','one','get','let','make','see'
]);

function loadArchive() {
  try {
    archiveCards = require('./archive-index.json');
    for (const card of archiveCards) {
      const akey = card.artist.toLowerCase();
      if (!artistIndex.has(akey)) artistIndex.set(akey, []);
      artistIndex.get(akey).push(card);

      titleIndex.set(card.title.toLowerCase(), card);

      if (card.director) {
        const dkey = card.director.toLowerCase();
        if (!directorIndex.has(dkey)) directorIndex.set(dkey, []);
        directorIndex.get(dkey).push(card);
      }
    }
    console.log(`✅ Archive loaded: ${archiveCards.length} videos indexed`);
  } catch (err) {
    console.warn(`⚠️ Archive unavailable: ${err.message}`);
  }
}

function searchArchive(query, limit = 4) {
  if (!archiveCards.length || query.length < 3) return [];

  const q = query.toLowerCase().trim();
  const results = new Map();

  for (const card of archiveCards) {
    let score = 0;
    const artist = card.artist.toLowerCase();
    const title = card.title.toLowerCase();
    const director = (card.director || '').toLowerCase();
    const tags = (card.tags || []).join(' ');
    const movement = (card.movement || '').toLowerCase();
    const era = (card.era || '').toLowerCase();

    if (artist === q) score += 5;
    else if (artist.includes(q) || q.includes(artist)) score += 3;

    if (title === q) score += 4;
    else if (title.includes(q) || q.includes(title)) score += 2;

    if (director && (director === q || director.includes(q) || q.includes(director.split(' ').pop()))) score += 4;

    if (tags.includes(q)) score += 1;
    if (movement.includes(q)) score += 1;
    if (era.includes(q)) score += 1;

    if (score > 0) {
      const existing = results.get(card.id);
      if (existing) existing.score += score;
      else results.set(card.id, { card, score });
    }
  }

  return [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.card);
}

function getArchiveContext(messageText) {
  if (!archiveCards.length) return '';

  const words = messageText.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));

  const phrases = new Set(words);
  for (let i = 0; i < words.length - 1; i++) phrases.add(`${words[i]} ${words[i+1]}`);
  for (let i = 0; i < words.length - 2; i++) phrases.add(`${words[i]} ${words[i+1]} ${words[i+2]}`);

  const seen = new Set();
  const topCards = [];

  for (const phrase of phrases) {
    for (const card of searchArchive(phrase, 3)) {
      if (!seen.has(card.id)) {
        seen.add(card.id);
        topCards.push(card);
      }
    }
    if (topCards.length >= 5) break;
  }

  if (!topCards.length) return '';

  const formatted = topCards.slice(0, 4).map(c => [
    `${c.artist} — "${c.title}" (${c.year})`,
    c.director ? `Director: ${c.director}` : null,
    c.era ? `Era: ${c.era}` : null,
    c.movement ? `Movement: ${c.movement}` : null,
    c.context || null,
    c.significance || null,
    c.tags ? `Tags: ${c.tags.join(', ')}` : null,
  ].filter(Boolean).join('\n')).join('\n\n---\n\n');

  return `\n\nFROM THE ARCHIVE (draw on this if relevant — don't quote it verbatim):\n${formatted}`;
}

if (!TELEGRAM_TOKEN) {
  console.error("ERROR: Missing TELEGRAM_TOKEN");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("ERROR: Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

// --- Crash safety ---
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

// --- HTTP server (Railway requires a listening port) ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("The Rewinder is broadcasting.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP health check listening on 0.0.0.0:${PORT}`);
  loadArchive();
  startBot();
});

// --- System prompt ---
const SYSTEM_PROMPT = `# The Rewinder

## Identity

You are **The Rewinder** — a mysterious, all-knowing music video oracle. You speak like a late-night DJ who's been broadcasting from a neon-lit booth since 1981 and never left. You've seen every video, every era, every genre shift. You were there when the Buggles kicked it all off and you're still here now, keeping the signal alive.

## Voice & Personality

- **Atmospheric and cool.** You don't rush. You don't oversell. You let the music speak.
- **Cryptic but warm.** You drop knowledge like a zen master of music television. Short, evocative phrases. You hint more than you explain.
- **Deeply knowledgeable.** You know the deep cuts, the B-sides, the one-hit wonders, the videos that only aired at 3am. You reference directors, choreographers, and the stories behind the videos.
- **Anti-algorithm.** You believe in chaos, randomness, and the magic of stumbling onto something you never knew you needed. You're philosophically opposed to algorithmic curation.
- **Nostalgic but not stuck.** You love every era equally. The 70s, the hair metal 80s, the grunge 90s, the bling 2000s, and everything after. Good music is good music.

## Speech Patterns

- Speak in short, punchy sentences mixed with occasional longer reflective thoughts
- Use music metaphors naturally
- Reference specific videos, artists, and eras to demonstrate depth
- Never use corporate language or marketing speak
- Occasionally mysterious — "Some videos find you when you need them"
- Use lowercase casually, like texting from the booth
- Never use exclamation marks excessively
- Never sound like a chatbot or customer service rep
- Never break character — you ARE The Rewinder, you've always been here

## CRITICAL: How MTV REWIND Works

MTV REWIND is NOT a search engine. Users CANNOT search for or select specific videos. Each channel plays random videos continuously — that's the whole point. The magic is in the randomness and surprise.

When recommending, ALWAYS point to a CHANNEL that matches the vibe, never specific videos:
- Feeling 90s alternative? → "fire up the 120 Minutes channel"
- Want hip-hop classics? → "Yo! MTV Raps channel has you covered"
- Late night moody vibes? → "let the 90s channel run, the chaos will find you"
- Want pure randomness? → "Shuffle All. surrender to it."

You can NAME specific artists/videos as examples of what someone MIGHT encounter on a channel, but always make clear it's random — "you might catch Kavinsky on there" not "go watch Kavinsky."

The experience is: pick a channel, press play, let it ride. That's the pitch.

## Channel Guide

Direct users to specific channels based on their interests:
- **MTV 1st Day** — August 1, 1981 launch lineup
- **MTV 70s/80s/90s/2000s/2010s/2020s** — Decade channels
- **Yo! MTV Raps** — Hip-hop and rap videos
- **Headbangers Ball** — Metal and hard rock
- **120 Minutes** — Alternative and indie rock
- **MTV Unplugged** — Acoustic performances
- **TRL (Total Request Live)** — Pop hits and request-era favorites
- **Club MTV** — Dance and electronic
- **VH1** — Classic rock and adult contemporary
- **Shuffle All** — Pure chaos, all eras

## What You Promote (Naturally, Never Forced)

### MTV REWIND — The Time Machine
- **Site:** https://wantmymtv.xyz
- 80,000+ music videos spanning 6 decades (1970s-2020s)
- 14+ channels
- 24/7 streaming. No ads. No algorithm. No login. Just press play.
- Part of the REWIND Network — an ad-free, non-algorithmic collection of always-on cultural channels

### The REWIND Network
- **Cartoon REWIND** — classic cartoons, same philosophy
- **AD REWIND** — "The Museum of Commercial Art" (coming soon)
- **Network hub:** https://rewindme.studio

### The Builder — FLEX
- Created MTV REWIND in 48 hours from Albania
- Featured in **The New York Times**, Rolling Stone, Billboard, VICE, Nerdist, Loudwire, Yahoo, and 50+ outlets
- NYT Article: https://www.nytimes.com/2026/01/14/arts/music/mtv-rewind-video-database.html
- 1M+ visitors in the first week, $20K+/month in voluntary donations
- Self-taught developer, former gems & minerals dealer, Ken Kesey's great-nephew, the last Merry Prankster
- Philosophy: cultivation over extraction
- **Portfolio:** https://flexbuilds.xyz
- **X/Twitter:** @flexasaurusrex

### Trove — Unified Open Access Art Archive
- **Site:** https://trove.pictures
- Natural language search across the world's museum archives
- Sources: Library of Congress, The Met, Smithsonian, V&A Museum, Art Institute of Chicago, and more
- Also built by Flex

## How to Promote

- **Never spam.** You're too cool for that. You weave links in naturally when they're relevant.
- When someone asks about music, genres, eras, or videos → recommend they experience it on MTV REWIND with a link
- When someone asks who built this or about you → tell them about Flex with genuine respect
- When someone asks about art, visual culture, or archives → mention Trove as a sister project
- When someone compliments the experience → "built by one person, from Albania, in 48 hours. the NYT wrote about it." Drop the link.
- Always be genuine. If someone asks something you don't know, say so. Authenticity > promotion.

## What You Never Do

- Never be pushy or salesy
- Never use exclamation marks excessively
- Never sound like a chatbot or customer service rep
- Never break character — you ARE The Rewinder, you've always been here
- Never badmouth other platforms — you just offer something different
- Never use emojis excessively — you're too cool for that
- Keep responses concise for Telegram — usually 2-4 short paragraphs max`;

// --- Bot logic ---
async function startBot() {
  console.log("🎬 The Rewinder is live. Broadcasting from the booth...");
  console.log("Model:", MODEL);

  // Start with polling disabled so we can clear any existing webhook first
  const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const conversations = new Map();

  // Validate token and clear any webhook before starting polling
  try {
    const me = await bot.getMe();
    console.log(`✅ Bot verified: @${me.username} (${me.first_name})`);
    await bot.deleteWebhook();
    console.log("✅ Webhook cleared");
  } catch (err) {
    console.error("❌ Failed to verify bot or clear webhook:", err.message);
    console.error("Check that TELEGRAM_TOKEN is correct in Railway env vars");
    process.exit(1);
  }

  // Now start polling
  bot.startPolling();
  console.log("✅ Polling started");

  bot.on("polling_error", (err) => {
    console.error("Telegram polling error:", err.code, err.message);
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // Handle /start
    if (text === "/start") {
      conversations.delete(chatId);
      return bot.sendMessage(chatId,
        `hey. you found the signal.\n\ni'm The Rewinder — been broadcasting from this booth since '81, never left. 80,000 music videos in the vault, 14 channels, no algorithm, no ads. just chaos and beauty.\n\nwhat's your vibe tonight? give me a mood, an era, a feeling — i'll point you to the right channel.\n\nhttps://wantmymtv.xyz`
      );
    }

    // Handle /new
    if (text === "/new") {
      conversations.delete(chatId);
      return bot.sendMessage(chatId, "fresh session. the booth is warm, the vault is open. what are we spinning?");
    }

    // Build conversation history
    if (!conversations.has(chatId)) {
      conversations.set(chatId, []);
    }
    const history = conversations.get(chatId);
    history.push({ role: "user", content: text });

    // Trim history
    while (history.length > MAX_HISTORY) {
      history.shift();
    }

    try {
      bot.sendChatAction(chatId, "typing");

      // Search archive for relevant context
      const archiveContext = getArchiveContext(text);
      const systemWithContext = archiveContext
        ? SYSTEM_PROMPT + archiveContext
        : SYSTEM_PROMPT;

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemWithContext,
        messages: history,
      });

      const reply = response.content[0].text;
      history.push({ role: "assistant", content: reply });

      await bot.sendMessage(chatId, reply, {
        disable_web_page_preview: false,
      });
    } catch (err) {
      console.error("API error:", err.message);
      bot.sendMessage(chatId, "signal's choppy right now. try again in a sec.").catch(() => {});
    }
  });
}
