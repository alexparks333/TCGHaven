# Creators: the Creator Studio, Creator Books and the 3D maker's GPU

_Started 2026-11-11. Who is a Creator (titles, suspensions, the sidebar tab) is in
`community-and-badges.md` "Accounts". Badges, books and the Relief Studio in general are there too._

## What a creator gets

- **First, Create Community** (`components/creator/CreateCommunity.tsx`). Until a creator's
  `communities/{uid}` exists, the Studio shows only a big **Create Community** start, then four
  steps: name, bio (tagline + about), **games** (`Community.games`), colour. The community's card
  (`CommunityCard`) fills in live beside it. **Launch community** saves it, and only then does the
  Studio itself appear.
- **The loading screen** (`components/creator/StudioEntrance.tsx`). It shows on every visit for at least 1.7 s:
  - two paper doors, with the Studio's seal stamped over the seam. Its rim lettering ("✦ CREATOR STUDIO ✦ TCG HAVEN") turns slowly;
  - "Entering Creator Studio";
  - once loaded, the doors part, the seal zooms past, and the Studio rises in (`.studio-reveal`). Animations live in globals.css (`.studio-*`), and reduced motion gets a simple fade.
- **Full screen, with its own way out** (2026-11-12). On `/creator`, `ClientWrapper` drops the app's
  sidebar, phone header and bottom nav. The Studio's own sticky top bar (`components/creator/StudioBar.tsx`)
  is always there, with **Exit Creator Studio** on the right. Exit goes back to the last page outside the Studio
  (`ClientWrapper` keeps it in sessionStorage `haven:beforeStudio`, else `/`) and asks first if the cover has unsaved changes.
- **The Studio's layout** (redesigned 2026-11-12, in the app's paper: `haven-panel` / `haven-chip` / `haven-medallion`, flat walnut, no gradients or glows; hand-made touches from `components/creator/Ornaments.tsx` — corner flourishes, a fleuron divider, a lettered seal, a ribbon — over `.haven-grain` paper). **`StudioHero`** (`components/creator/StudioHero.tsx`)
  is a paper header with the community's stamp, with:
  - stats: badges, chapters and members;
  - a **checklist** of 7 steps (`studioSteps()`), with dots, a progress bar and a "Next: …" link.
    Each step jumps to its tab;
  - three paper index tabs into the panel below: **Cover** (first, and where the Studio opens), **Pages &
    badges** and **Community**. Both halves stay mounted (`hidden`),
    so switching tabs loses nothing. The Cover tab shows an amber dot while the cover is unsaved.

- **The Creator tab** (`/creator`, `components/pages/CreatorPage.tsx`) sits under a line in the
  sidebar, with a wand button on phones. It's for Creators in good standing and for **Staff**
  (`canUseCreatorStudio()` in `lib/accountRoles.ts`), so the Owner and staff can try it and help
  creators. A staff member's book is a real creator book like anyone else's.
- **The book tabs** (Pages & badges, Cover):
  1. **No book yet:** name it ("PewDiePie Cuties") and it's made, with a random leather and gold
     foil, chapter "Chapter One", and collection = its name.
  2. **The Cover tab** (`components/creator/CoverDesigner.tsx`, always open beside the book).
     Every change shows on the big book (`CoverStage`, on binder paper) but stays
     unsaved until **Save cover** in the bar at the bottom of the designer. **Undo all** puts the
     saved cover back, and closing the browser tab asks first. A save writes only the cover's own
     fields (`COVER_KEYS` in CreatorPage.tsx), so chapter or inside changes made meanwhile on the
     Pages tab stay. The designer offers:
     - **Title:** the name, **about 60 fonts in groups** (Elegant — including `haven`, TCG Haven's own Cinzel lettering — Classic, Clean, Bold, Fun, Script, Retro, Spooky — `lib/coverFonts.ts`; Google Fonts, loaded only when used),
       size, **height on the cover**, and a **finish**: a flat colour (12 swatches or any) or metal foil (gold, silver, rose gold, copper, emerald, sapphire, amethyst — `TITLE_FINISHES`), with **Glow behind** (the Haven covers' plate). **Haven style** sets the Haven font + gold foil + glow in one tap;
     - **the line above the title:** on/off, its text, its colour;
     - **earned count**, on/off (the cover's emblem and the title's Shine were removed 2026-11-12; old
       `showEmblem` / `emblemColor` / `titleShine` settings are ignored)
       with its own colour. It starts gold (`COVER_TEXT_GOLD`) and is set in
       Text;
     - **page edges:** the colour of the page block at the side (`BookThickness pageColor`);
     - these are stored as `BadgeSet.coverStyle` (`CoverStyle` in `lib/badges.ts`). A book with a
       `coverStyle` is drawn by `StyledCover` in BadgeLibrary.tsx; creator books always have one,
       and staff books (none) keep the classic cover;
     - **the cover picture — required** (2026-11-12). A creator cover is always their artwork; the
       leather and "Stitching & clasp" pickers and "Surprise me" are gone. With no picture the book is
       plain tan (`BLANK_COVER`), the Studio says "Add your cover picture", and **Save cover** waits
       for one. Old `cover.from/to/accent` stay in the data (tabs, progress bar) but aren't picked any more.
       The picture is uploaded as is (big ones shrunk to 2400 px), then **placed**: drag and zoom
       (slider or wheel), Fill cover / Center. It's saved as `BadgeSet.coverFit` `{ x, y, scale }`, in %
       of the picture's space. Staff covers have no `coverFit` and still fill the cover;
     - **Spine** (its own section; `components/badges/CoverSpine.tsx`): 14 looks — Raised bands,
       Stitched, Gilded, Bookcloth, Racing stripes, Chevrons, Polka dots, Harlequin, Dragon scales,
       Starry night, Waves, Riveted metal, Laced up, Checkerboard. Each look is a `SpineDef` in `SPINES`:
       its colour parts (main + `accent` + sometimes `detail`, e.g. Thread, Gold, Eyelets, Moon — swatches
       or **any colour**) and its own sliders (`sliders`, stored per look in `CoverStyle.spineParams[look]`).
       Every look also has Width (8–24%, `spineWidth`) and Roundness (`spineRound`), plus Surprise me and
       Reset. The spine **eats into the cover**: the picture, title and count sit in what's left
       (`coverArea()`), so every book stays the same size. Add a new look by adding a `SpineDef` —
       the designer builds its controls from it.
     - Book saves use `mergeFields` (not `merge`), so a setting switched off (a missing key) really goes.
     The big book on the left (`CoverStage`) is the real `BookCover`, tilting toward the pointer.
  3. **The Pages & badges tab** (`components/creator/BookPlanner.tsx`): the open book on binder
     paper, in its own leather and velvet, 2 × 3 pin spots a page, a chapter title engraved on each chapter's first page (tap
     to rename), chapter pills, page turning, and "+ Chapter".
     - Each chapter shows its badges and **one "+ Add a badge" spot**.
     - **Beside the book, a panel with two tabs.**
       - **Chapters:** each with a trim-coloured numeral and its last page's six spots in miniature.
         Rename, move up or down, jump to one (👁), add. Only an empty chapter can
         be removed; that asks first.
       - **Inside look** (`BadgeSet.insideStyle`): the pages' felt colour (12 presets or any),
         the trim colour (frames, chapter titles, rules), page frame on/off, felt texture on/off,
         and "Back to the classic inside".
       - **Where it's drawn:** `insideLook()` (lib/badges.ts) puts the `.pinbook-styled` class and
         `--page` / `--trim` on the book. The real `BadgeBook` and the Studio's pages share those
         classes (globals.css), so fans see what the creator sees. Books without it are unchanged.
     - Tap a pin to edit it.
  4. **The badge maker** (`components/creator/BadgeMaker.tsx`): the pin shown big on velvet, and
     four steps.
     - **Pin art:** uploaded to `creators/{uid}/badges/{id}/`.
       Cut out **or on plain white**: art with no see-through pixels has the white touching its
       edges cut away in the browser before upload (`lib/pinArtCutout.ts` `cutOutWhite`, the same
       flood fill the 3D pin uses), saved as a PNG. Needed because the flat pin (book, shelf, cover
       emblem) draws the picture as is; the 3D pin and HavenRelief would cope either way. Photos or
       coloured backgrounds aren't removed.
     - **Name it:** name, how to earn it, what the cards are called.
     - **Cards to collect:** pick a game (pills), then search it, or **browse the whole Cardex**
       full screen (the staff badge editor's `CardexCardPicker`: every set, multi-select, Shift+click
       ranges). Each card is one slot. Below that, **When fans unlock the pin**: the Grayscale and
       Full colour points (`tiers` / `tiersOff`), set by % or by card count.
     - **Make it 3D:** the staff Relief Studio itself (`components/admin/ReliefStudio.tsx`, given
       the collector app's Storage and the creator's folder).
  5. **Preview:** the real `BadgeBook`, given the creator's own badges (`defs`), exactly as
     followers will see it.
  - Everything saves as you go: the cover about 0.7 s after the last change, badges on Save.
- **Community** tab (`components/creator/CommunityStudio.tsx`): the community page, edited right on it.
  - Click the name, tagline or about and type. Tap a banner colour on the banner, and tap games on or off.
  - It saves itself 0.8 s after the last change, and saves straight away when leaving. A name needs 2+ letters before it saves.
  - Beside it: the save state, View page, Copy link, the book fans collect there (with Edit the book), and a "Coming soon" card (news posts, events).

## Data

| Where | What | Rules |
|---|---|---|
| `creator_books/{uid}` | `{ owner, book: BadgeSet, badges: BadgeDef[], createdAt, updatedAt }`: one doc per creator, so one book each | Any signed-in user reads. Only that uid writes, and only if `canCreate()` (a Creator not suspended or banned, or staff). Badges ≤ 200 |
| `communities/{uid}` | `{ name, nameLower, tagline, about, color, games, updatedAt }` | Same; fixed keys |
| Storage `creators/{uid}/**` | Cover pictures, badge art, Relief Studio kits, maps and builds | Public read. That creator writes, ≤ 25 MB a file |

Rules deployed 2026-11-11 (`npx firebase-tools deploy --only firestore:rules,storage --project
tcghaven-85a34`, which needs the owner's OK). Until they're deployed, every creator save fails
with `permission-denied`, and the Studio now says so instead of looking saved.

- The book and badges use the same shapes as TCG Haven's (`lib/badges.ts`):
  - book id `creator-{uid}`;
  - badge ids `c-{uid8}-{slug}-{rand}`, unique across every book, because earned badges are keyed by id.
- **A creator's slots carry an extra `game` field** (the card's game). The badge's `game` is taken
  from its first slot.
- `/api/badge-asset` also serves `creators/` files, so WebGL and canvas can read creator art.
- `BookCover`, `BadgeBook` and their chapters take an optional `defs` (the book's own badges).
  Without it, they read TCG Haven's catalog as before.
- **Rule from the Accounts work:** show a creator's book only while its maker `isCreator()`.
  Suspended or former creators' books are hidden and come back unchanged.

## Communities: joining (2026-11-11)

- **Find them:** Friends page → the search card's **People | Communities** switch
  (`FriendsPage.tsx` `CommunitySearch`). It's a name prefix search on `communities.nameLower`,
  which `saveCommunity()` writes.
- **Join:** a membership doc, `community_members/{communityUid}_{memberUid}` =
  `{ community, member, joinedAt }` (`lib/communities.ts`). You create and delete only your own.
- **Your communities:** a section under "Your friends" on the Friends page (`#communities`). Your
  profile shows a **Communities** count beside Friends.
- **A community's page:** `/c/{creatorUid}` (`CommunityPage.tsx`) shows:
  - the banner, name, tagline and member count (a count query);
  - the creator;
  - **Join community / Joined** (hover: Leave);
  - their Creator Book (the cover, which opens into the real pin book);
  - About.
  The creator sees "Edit in Creator Studio" instead of Join; the Studio's Community tab links here.
- **Hidden** (`getCommunity()` returns null) while the creator can't run one
  (`canUseCreatorStudio`).

## Not built yet (next steps)

1. **Earning a community's badges.** A joined community's book appears on your Badges shelf under
   its collection (`BadgeSet.collection`). `FriendsProvider` counts its badges with the same
   "collect one of each" rule, using `useMyCommunities` → `creator_books/{uid}` for each.
2. **A nicer address for a community** (`/c/{handle}` instead of the uid), and news posts.
3. **Prompt → pin art** (an image model), then Meshy or HavenRelief. The old badges plan mentions this.
4. **Per-creator 3D limits**: count tickets per day in Firestore (needs a server write).

## The 3D maker's GPU

**How it's wired (built 2026-11-11):**
- The Relief Studio's AI step (`tools/havenrelief/server.py`: Segment Anything 2.1 Large, Marigold
  Depth and Normals) needs an NVIDIA GPU. Creators must never need one.
- The Creator Studio asks **`POST /api/relief/ticket`**, which checks the caller is a Creator or
  staff (`verifyCreatorRequest`).
- The answer is the GPU server's address (`HAVENRELIEF_URL`) and a **2-hour ticket**,
  `{uid}.{expires}.{HMAC}`, signed with `HAVENRELIEF_SECRET`.
- The Studio sends it as `X-Relief-Ticket`. `server.py` refuses analyses without a valid ticket
  whenever `HAVENRELIEF_SECRET` is set on it.
- **Moving the GPU anywhere** means changing two Vercel env vars plus `HAVENRELIEF_ORIGINS` on the
  server. Store the secret in 1Password; never in git.
- With neither env set, the Studio says the 3D maker is being set up, and the pin gets the
  automatic 3D look from its art. On `localhost` it uses the HavenRelief server on that machine.

**The cloud GPU: Modal (`tools/havenrelief/modal_app.py`, set up 2026-11-11):**
- **Web half:** a small CPU web app. It answers `/health` and checks the ticket and origin. It
  answers art it has seen before from the cache, for free.
- **GPU half:** a `Relief` class on an **L40S**. It's started only for new art, with **at most 3 at
  once** (`MAX_GPUS`). It is let go 5 s after a pin (`IDLE_SECONDS`): only the AI analysis ever uses the GPU — sculpting, finishes, baking and the 3D view run in the browser.
- **Storage:** model weights (~6 GB, downloaded on the first run) and finished analyses live in the
  Modal Volume `havenrelief-store`.
- **Jobs:** Modal ends a web request at 150 s, so new art gets `202 { job }`. The Studio
  (`lib/reliefStudio.ts` `serverFiles`) then asks `GET /job/{id}` until it's done. `server.py`
  never returns a job, so the same Studio works with the PC.
- **Fail-closed:** without `HAVENRELIEF_SECRET` in the Modal secret `havenrelief`, every request is
  refused. The secret also holds `HAVENRELIEF_ORIGINS`
  (`https://www.tcghaven.org,https://tcghaven.org`).
- **Setup:**
  1. `uv tool install modal` and `modal setup`.
  2. Create the `havenrelief` secret. The value lives in 1Password; never paste it in chat or git.
  3. `cd tools/havenrelief && modal deploy modal_app.py` prints the `…-web.modal.run` address.
  4. In Vercel, set `HAVENRELIEF_URL` = that address and `HAVENRELIEF_SECRET` = the same value,
     then redeploy.
- **When `havenrelief.py` changes:** run `modal deploy` again. If `KIT_VERSION` / `ANALYSIS_REV`
  change, also update the copies in `modal_app.py`'s `web()`.
- **Live:** deployed 2026-11-11 to the owner's Modal workspace as app `havenrelief`, at
  `https://alexparks333--havenrelief-web.us-east.modal.run`. Starter plan: $30 of free credit a month, then the card.
- **Changing the secret:** `modal secret create --force havenrelief …`, then `modal deploy`. Also stop
  any running web container (`modal container list`, then `modal container stop -y <id>`): a warm one
  keeps the old secret. Then update Vercel and `.env.local` and redeploy Vercel.
- **Watch the bill:** set a monthly budget in Modal's dashboard (Settings → Usage/Billing).

**What an analysis costs:**
- About **2½ min on an RTX 4090** at `high`. Expect roughly 2½ min on an L40S or 48 GB card, and
  5–6 min on an L4 or A10G.
- Plus a cold start of ~0.5–1.5 min when the server has been idle, to load ~4 GB of models.
- Re-tuning in the Studio is free: it runs in the browser. The same art twice is free too (the
  server's disk cache).
- Plan on about 1.5 analyses per badge.

| Option | How it bills | Per analysis | ~1,500/mo (100 creators × 10 badges) | Notes |
|---|---|---|---|---|
| **The Owner's 4090 PC** + a Cloudflare Tunnel | Electricity | ~$0.01 | ~$15 power | Free; the PC must stay on; one at a time; home internet |
| **Modal** (serverless, Python-native web endpoint) | Per second: L4 ~$0.80/h, L40S ~$1.95/h | ~$0.08–0.10 | ~$120–150 | Easiest: wraps `server.py` almost as is; scales to zero; monthly free credit |
| **RunPod Serverless** | Per second: 24 GB ~$0.69/h, 48 GB ~$1.22/h | ~$0.04–0.07 | ~$60–105 | Cheapest pay-per-use; needs a Docker image + a network volume for the weights; cap max workers |
| **RunPod pod, always on** (RTX 4090) | ~$0.34/h community | — | ~$250 flat | Becomes cheaper above ~3,000–5,000 analyses a month; no cold starts |

Prices are from public sources in Nov 2026 and change often. Check modal.com/pricing and
runpod.io/pricing before choosing.

**Recommendation:**
1. **Now (testing with the first creators):** the 4090 PC through a Cloudflare Tunnel. It's free,
   and `server.py` with `HAVENRELIEF_SECRET` + `HAVENRELIEF_ORIGINS=https://www.tcghaven.org` is
   already safe to expose.
2. **Launch:** a serverless GPU, Modal for simplicity or RunPod for the lowest price, with a max of
   2–3 workers and a monthly spend alert. Costs stay proportional to use, at a few cents a badge.
3. **Scale** (thousands of badges a month): add one always-on RunPod 4090 pod and keep serverless
   for overflow.
4. **Either way:** add a per-creator daily cap (e.g. 10 analyses), and consider counting 3D builds
   toward a Creator plan's limits (`premium-business.md`).
