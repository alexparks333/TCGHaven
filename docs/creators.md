# Creators: the Creator Studio, Creator Books and the 3D maker's GPU

_Started 2026-11-11. Who is a Creator (titles, suspensions, the sidebar tab) is in
`community-and-badges.md` "Accounts". Badges, books and the Relief Studio in general are there too._

## What a creator gets

- **First, Create Community** (`components/creator/CreateCommunity.tsx`). Until a creator's
  `communities/{uid}` exists, the Studio shows only a big **Create Community** start, then four
  steps: name, bio (tagline + about), **games** (`Community.games`), colour. The community's card
  (`CommunityCard`) fills in live beside it. **Launch community** saves it, and only then do the
  Your Book / Community tabs appear.

- **The Creator tab** (`/creator`, `components/pages/CreatorPage.tsx`) sits under a line in the
  sidebar, with a wand button on phones. It's for Creators in good standing and for **Staff**
  (`canUseCreatorStudio()` in `lib/accountRoles.ts`), so the Owner and staff can try it and help
  creators. A staff member's book is a real creator book like anyone else's.
- **Your Book** tab:
  1. **No book yet:** name it ("PewDiePie Cuties") and it's made, with a random leather and gold
     foil, chapter "Chapter One", and collection = its name.
  2. **The cover** (`components/creator/CoverDesigner.tsx`):
     - the title, the line above it, and a stamp (monogram);
     - 12 leathers and 8 foils, each one tap;
     - "Surprise me";
     - an optional cover picture, uploaded as is (big ones shrunk to 2400 px). The creator
       **places it**: drag anywhere, even past the edges, and zoom with the slider or wheel, with
       Fill cover / Center. It's saved as `BadgeSet.coverFit` `{ x, y, scale }`, and `BookCover`
       draws it over the leather. Staff covers have no `coverFit` and still fill the cover.
     The big book on the left (`BookStage`) is the real `BookCover`, tilting toward the pointer.
  3. **Open your book** (`components/creator/BookPlanner.tsx`): the open book in its own leather
     and velvet, 2 × 3 pin spots a page, a chapter title engraved on each chapter's first page (tap
     to rename), chapter pills, page turning, and "+ Chapter".
     - Each chapter shows its badges and **one "+ Add a badge" spot**.
     - Tap a pin to edit it.
  4. **The badge maker** (`components/creator/BadgeMaker.tsx`): the pin shown big on velvet, and
     four steps.
     - **Pin art:** uploaded to `creators/{uid}/badges/{id}/`.
     - **Name it:** name, how to earn it, what the cards are called.
     - **Cards to collect:** search the catalog in any game; each card is one slot.
     - **Make it 3D:** the staff Relief Studio itself (`components/admin/ReliefStudio.tsx`, given
       the collector app's Storage and the creator's folder).
  5. **Preview:** the real `BadgeBook`, given the creator's own badges (`defs`), exactly as
     followers will see it.
  - Everything saves as you go: the cover about 0.7 s after the last change, badges on Save.
- **Community** tab: a barebones community profile (name, tagline, about, banner colour) with a
  live preview. Followers, news posts and the public community page come next.

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
