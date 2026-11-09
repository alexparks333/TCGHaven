# Friends, profiles, Haven Badges, the pin book & the Relief Studio

Moved out of CLAUDE.md (2026-10-30) so it's read only when needed. Section numbers (§N) refer to
the original CLAUDE.md layout.

## Friends (2026-10-26)

The first community feature (Creators/Communities come next). `lib/firebase/friends.ts` +
`components/friends/`:

- **Collections** (rules in `firestore.rules`): `profiles/{uid}` (name, `@username`, photo —
  never email; readable by any signed-in user, created/kept in step on sign-in by
  `ensureProfile()`), `usernames/{name}` (claim doc — its id makes usernames unique; rules allow create, never
  update, so no one can take a held name. Renaming keeps your last 3 old names (`KEEP_OLD_USERNAMES`,
  `profile.previousUsernames`, newest first): `/u/{old}` still resolves to you and the address bar is
  swapped to your current name, and you can switch back. On each rename `changeUsername()` deletes
  every claim you hold beyond those (including leftovers), which frees it for anyone),
  `friendships/{uidA_uidB}` (sorted pair id; `{ users, requester, addressee, status:
  'pending'|'accepted' }` — only the addressee can accept, either side can delete = decline /
  cancel / unfriend), `invite_codes/{code}` → `{ uid }` (get-only, never listable; the owner's
  current code lives in `users/{uid}/private/invite`).
- **Haven link** — "Your Haven link" in the Friends popup/page (and the QR code) is just your
  profile address, `/u/{username}`: it opens your Haven, where they tap "Add" and you get a
  request to accept. There is no way to become someone's friend without their say-so — the rules
  only allow creating a friendship as `pending` (2026-10-27; invite links used to create it
  already accepted). Old `/invite/{code}` links (`InvitePage.tsx`) now just redirect to that
  person's Haven. Signed-out visitors go through `/login?next=…` and come back
  (`AuthGuard` + `lib/authRedirect.ts`); new accounts still need the signup passcode.
- **UI:** the Friends page `/friends` (`components/pages/FriendsPage.tsx` — profile header with
  editable @username and counts, requests waiting on you, friend cards, sent requests, and the
  invite link + "Find people" search (name or @username, prefix match) on the right). Deep links:
  `?focus={uid}`, `?add=1`, `?tab=requests`. `FriendsProvider` (mounted in `ClientWrapper.tsx`)
  keeps live listeners on the two friendship queries and the open state of the quick Friends
  popup (`FriendsDialog.tsx`: Friends / Requests / Add Friends tabs). Sidebar card above the account
  box (`FriendsSidebar.tsx`): its inner controls (invite, ➕, requests, a friend) open the popup; the
  card itself goes to `/friends`. The phone top bar's Friends button goes to the page.

### Friend request popup & dev tools

- **Popup** (`components/friends/FriendRequestToast.tsx`, mounted in `ClientWrapper.tsx`): top right
  (full width under the status bar on phones) whenever a request arrives — Accept / Decline in
  place, tap the person for their profile; auto-hides after 9s (paused on hover). Each request pops
  once: shown ids are remembered per account in localStorage (`tcghaven-seen-requests:{uid}`), so a
  request that arrived while you were away pops on your next visit. Also pops "X accepted your
  friend request" when one you sent is accepted while the app is open.
- **Dev panel** (`components/dev/DevPanel.tsx`): a minimizable "Dev" pill bottom left (under pop-up windows) (next to the
  sidebar on desktop, above the bottom bar on phones), shown only to the Owner (`ADMIN_UID`) and **only on a local dev server** — `ClientWrapper`
  renders it only when `NODE_ENV === 'development'` (so it's compiled out of production builds) and
  the route returns 404 outside development. Drives
  a test collector, **Tess Tester** (`tess.tester@tcghaven.test`, @tesstester), through
  `POST /api/dev/test-friend` (`verifyOwnerRequest()` — Owner only): send you a request, accept the
  one you sent her, unfriend/cancel, toggle her Cardex sharing, open her profile, and replay request
  popups. The route signs in **as Tess** in its own Firebase app instance, so her writes go through
  the normal `firestore.rules`; her password is derived from `CRON_SECRET` (HMAC), never stored. Her
  first request creates the account, a profile and a shared Cardex: ~half of Riftbound Origins and
  Pokémon Base Set plus a few chase cards (seeded, so it's the same every time; top 3 PSA 10).

### Haven Badges — the pin book (2026-10-27)

Trophies for collecting milestones, made only by TCG Haven and added over time.
- **Managed in the staff portal: `/admin/badges`** (`components/admin/BadgesAdmin.tsx`). Books and
  badges live in ONE Firestore doc, `badge_catalog/main` = `{ sets, badges }` (public read, staff
  write), read live everywhere through `useBadgeCatalog()` (`lib/badgeCatalog.ts`);
  `DEFAULT_BADGE_CATALOG` in `lib/badges.ts` is only the fallback until that doc exists. main is a
  few hundred KB, so apps listen to the tiny `badge_catalog/version` (`{ v }`, stamped in the same
  batch by `saveBadgeCatalog()`) and fetch main only when `v` differs from the copy kept in
  localStorage — always save through `saveBadgeCatalog(db, base, next)`, or open apps won't see the
  change. It replays only base → next onto the latest catalog in a transaction, and the badge/book
  editors merge field-by-field, asking before overwriting a field someone else changed (quirk 33).
  The admin page: book tabs (add/edit/delete — name, subtitle, monogram, game, cover colours with a
  live cover preview), the book's badges by page (preview in 3D, move up/down, edit, delete), and a
  badge editor — name (id is slugged from it once), book, page, description, slot noun, requirement
  slots (each: a label + cards found with the admin catalog search; picked cards' name/photo are
  saved on the slot as `cards` for display), and uploads to Storage `badges/{id}/…`: pin art
  (`imageUrl`, PNG with transparency — the book shows it, its holes and glint use its shape as a
  mask), a `.glb` model, a normal map. Uploaded files are loaded through `/api/badge-asset`
  (`lib/badgeAssets.ts`) because WebGL/masks need same-origin files and the bucket has no CORS;
  its `s-maxage` lets Vercel's CDN serve repeats without the function or a Storage download. Pin
  art in books and shelves (`trimmedArt.ts`) goes through `badgeArt()` — Next's image optimizer,
  ~8× smaller (1.9MB PNG → 240KB WebP) — falling back to the full file; the 3D view keeps the full one.
  A badge with no slots can't be earned (0/0 isn't "complete").
- **Definitions** (`lib/badges.ts`): each badge is "collect one of each" — `slots`, each
  filled by owning ANY of its catalog ids (matched on inventory `apiId`). First badge: **Origins
  Overnumbered** — for each of the 12 Origins Legends, own its Overnumbered (`ogn-{n}-298`) or
  Signature (`ogn-{n}-star-298`) printing (n = 299–310). Add a badge = add an entry (+ pin art).
- **Earning** (`lib/firebase/badges.ts`): `FriendsProvider` recomputes on every collection change
  and saves `shared_badges/{uid}` = `{ earned: { id: earnedAtMs }, progress: { id: [have, total] } }`.
  Earned badges are kept for good (a trophy — selling the cards doesn't take it back). Computed on
  the owner's device, like the shared Cardex. Rules: owner reads/writes; any signed-in user reads
  while `privacy.badges` is on (the default).
- **Badges page** `/badges` (`BadgesPage.tsx`, sidebar + phone bar under Cardex): your own book,
  `full` size — the page drops the usual `max-w-7xl` content cap (`ClientWrapper.tsx`) and on desktop
  the book stretches to fill the window below the title (phones keep a book's proportions); pins
  size to the tighter of page width/height.
- **Pin book** (`components/badges/BadgeBook.tsx`, also a profile's Badges tab for friends; styles `.pinbook-*` in
  `globals.css`): a collector's album (restyled 2026-10-28) — the book's own
  leather (its set's `cover` colours as CSS vars, grain, saddle stitching in its accent, gold corner
  protectors, matching strap), velvet pages in a gold-foil double frame with engraved corner
  ornaments, gilded page edges, a riveted ring mechanism, engraved serif lettering (Cinzel —
  `--font-engraved` from app/layout.tsx, `.pinbook-serif`), and a brass nameplate under every spot
  (the badge's name once earned, "? ? ?" before). No title page — pins start on page one (the book's name + earned count
  sit next to "All pin books" instead). Each badge has a `page` (e.g. "Origins"): badges are grouped
  by page, 6 a page (2 × 3 grid), and each page's name is across its top
  (gold engraved lettering between gold rules, `PageTitle`). Spots no badge uses yet are left blank (no placeholders); always ≥4 pages so it turns.
  The Badges page has no heading — the book gets the room. The arrows (or ←/→) turn
  the page in 3D: a two-faced leaf hinged at the spine rotates 180° (front = page being turned,
  back = page landing), then the spread changes. Nothing may change when the turn ends (that read as
  a jump cut): the stacked page edges fade to their new counts during the turn, the turning page has
  the same styling as a flat page (no extra shadow), and lighting overlays run during it — the front
  darkens toward upright, the back brightens as it lays down, the uncovered page starts in its
  shadow (`TurnShadow`) — all ending exactly at the flat look. An unearned badge is a pin-shaped hole in the felt;
  hover/tap shows the pin (greyed), name, how to earn it and progress (e.g. 2 / 12 Legends).
  **Two looks** (`lib/badges.ts`): Grayscale (default 75%) and Full (default 90%), per badge in
  `tiers`; Grayscale can be switched off (`tiersOff: [1]` — the pin stays a hole until Full). The
  tier numbers are 1 and 3: a middle Painted look (2) was removed 2026-11-03, and badges saved
  before still hold three percentages / old `tiersOff` values — always read them through
  `tierPercents()` / `looksOn()`, which skip the old middle look.
  **Progress fill is tiered** (`tierFill()`): it measures from the current look to the next, not
  the whole badge. A hole ghosts in toward Grayscale (Grayscale at 50% of 10 cards: 3 cards = 60%
  filled); an earned Grayscale pin has the Full pin rising over it from the bottom (`TierRise` in
  `BadgeBook.tsx`), starting again at 0. The hover card reads "To Full · 8 / 9" over a bar of the
  whole badge split into one coloured stretch per look (`TierBar`); the hole's ghost is drawn in
  the look it heads for (Grayscale). Every count goes through `tierNeed()` (whole cards). The phone book uses the same `BadgeSpot`.
- **Badge Sets & the shelf** (`BADGE_SETS` in `lib/badges.ts`; each badge has a `set`): every set
  is its own pin book — one per game: Riftbound (holds Origins Overnumbered), Pokémon, Lorcana,
  One Piece, Magic. A book with no badges yet shows its `monogram` medallion and "Coming soon". `components/badges/BadgeLibrary.tsx` (Badges page + profile Badges tab)
  starts on a shelf of closed books (`BookCover`: leather in the set's `cover` colors, stitched
  spine, strap + snap, the set's first pin or its monogram, earned count; everything centred on the
  stitched frame, not the whole cover). Under each book, `CompletionBar`: pins earned / total in the
  book's colours (animates in), gold with a shine (`.badge-bar-complete`) once the book is complete. Clicking one: the open
  book is laid out invisibly to measure where its cover lands → the closed book flies there from
  the shelf (FLIP: translate+scale) → its cover swings open around the spine (rotateY −180°; back
  face = the book's first page: `BadgeBook coverOnly` drawn at full width, clipped to its left
  half — so the page is visible as the cover swings over and lands exactly on the real one) while
  the right page shows through → the flyer is swapped for the real book (no wipe). "All pin books" goes back to the shelf. Reduced motion skips straight to open.
  Choreography: the closed book flies to the middle (centred = the open book's right half shifted
  left by half a page), then the cover swings open WHILE everything glides right into place (same
  duration + easing). All positions are relative to the library's own box and the flying book is
  drawn inside it (not `position: fixed`) — window-relative coordinates drifted whenever the page
  scrolled. The flying book is three nested layers, one motion each — fly (translate+scale),
  glide (translateX + the perspective), swing (pure rotateY 0→−180°). When the fly's scale and the
  swing shared one element and their timing overlapped, the browser interpolated the two matrices
  and squashed the cover flat instead of turning it (it looked right only some of the time).
  The 3D perspective lives on the moving book, looking from the spine, so the cover
  doesn't warp as it glides; the book scrolls into view (centred) once laid out.
  Closing ("All pin books") runs it backwards (`mode: 'closing'`): the shelf is laid out unseen to
  find the book's spot, the open cover (showing the spread you were on — BadgeBook `startSpread`)
  swings shut while the book glides back to the middle, then flies home; the shelf stays mounted
  and doesn't replay its fade-in (`Shelf intro`). In a profile the
  book is capped by window height so it always fits on screen.
- **Collections (2026-11-09):** each book has an optional `collection` (a name; unset = "Haven
  Badges", `HAVEN_COLLECTION` — TCG Haven's own books). The shelf shows one collection at a time,
  picked from a dropdown above it (`CollectionPicker` in BadgeLibrary — a native `<select>` laid
  over the title, so phones get their own picker), remembered per device in localStorage
  (`tcghaven-badge-collection`). Staff set it in the book editor (a text field suggesting the
  existing names). Always read it through `bookCollection()`; `badgeCollections()` lists them, Haven
  first. Meant for creators' books later ("PewDiePie Badges") — who can make or earn those isn't
  built yet.
- **Phones held upright** (`components/badges/PhoneBook.tsx`, 2026-10-29): a two-page spread made
  every pin tiny, so on `(max-width: 767px) and (orientation: portrait)` BadgeLibrary opens the book
  full screen (a portal over the app) one page at a time. The closed book flies from the shelf to
  fill the screen, its cover swings open on the spine while the camera glides with it, landing on
  the first (left) page. Next on a left page = the camera pans across the spread to the right page;
  next on a right page = the page turns over in 3D while the camera follows it onto the next left
  page (the same motion as the cover). Back reverses each; swipes work too; a chapter menu in the
  top bar jumps (the new page slides in). Close (✕) is opening backwards: the cover swings shut over
  the page you're on, then the closed book flies home into its spot (left empty while it's out —
  `Shelf away`). Timing: page turn 640ms, pan 420ms, cover 820ms. It's one "scene" — the spread as two screen-wide pages
  either side of the spine, with a translateX camera — and every motion's end state is laid out
  exactly as the motion finishes. Page turns (here and in BadgeBook) are two flat halves, not one 3D
  sheet: the front swings up to edge-on and hides, then the back swings down — iPhone/iPad Safari
  broke the sheet's hidden back face (black patches, pins blinking) when pages hold pin shadows and
  pinhole filters. Swipes turn as soon as they're clear (touchmove), not on lift. Every page is ONE
  element keyed by page number that only changes role (flat / under / front / back / ready — the
  next turn's pages are already drawn, out of sight); remounting pages mid-turn re-loaded their pin
  images and masks (pins blinking). The flight keeps the book's shape: a pure scale between the
  shelf and the middle of the screen, and only there grows to fill it / settles back (`grow`,
  `shrink`) — re-sizing in flight morphed the art (looked squished). The flight animates the real
  size (left/top/width/height) at the shelf book's aspect, never a scale, so the cover (art crop,
  title, earned pill) is drawn exactly like the shelf's the whole way. Desktop does the same
  (BadgeLibrary `Flyer` `at: shelf | mid | cover`; phases `grow` / `settle`), and both flights draw
  `BookThickness` (the shelf book's page block + shadow) under the cover until it opens.
  **Smooth turns on iPhone (2026-11-03)** — the turn used to stall and then snap. Four rules now:
  every page is its own layer at all times (`will-change: transform`) and a page out of sight waits
  edge-on at the spine, never `opacity: 0` (Safari doesn't draw a see-through layer ahead, so the
  landing page was drawn mid-turn); a motion settles on the `transitionend` of the element marked
  `data-end` (the timer is only a fallback — firing on time while the phone started late snapped
  the page); in-book motions start in the same frame (styles flushed, no two-frame wait); pages are
  memoized (`Half`, stable `pageProps`) so starting a turn redraws no pins. The page area has
  `touch-action: none` so iOS can't take a swipe as a scroll or back gesture.
  **Never run an endless paint animation over a moving page.** The mastered pins' platinum
  highlight (`--plat-a` in a conic gradient) repaints its pin every frame; over a turning page iPhone
  Safari couldn't redraw in time and the pins blinked and swapped mid-turn. It now runs only on the
  phone book page on screen with the book still (`phonebook-page` / `phonebook-live`), pauses during
  desktop turns (`pinbook-turning`), and the shelf's bar shine pauses under the open phone book
  (`html.phonebook-open`).
  Page titles size to the page (`cqw`, `.pinbook-page` is a size container), shrinking for long names. A slight pull-back (scale ~0.93–0.95) during moves; the moving
  layers are `will-change: transform` (without it the pan stalled ~600ms re-drawing the pinhole SVG
  filters every frame). Uses `PinPage`/`PinholeFilter`/`buildPages` exported from BadgeBook.
- **3D inspect view** (`components/badges/PinInspector.tsx`, three.js — loaded only when a pin is
  clicked; `next/dynamic` from `BadgeBook`): click a pin or its hole in the book → full-screen viewer,
  drag to turn it over, scroll/pinch to zoom, slow auto-turn until you touch it (OrbitControls,
  RoomEnvironment reflections, ACES tone mapping). A badge's `model` (.glb/.gltf in /public) is shown
  when set (centred + scaled to fit); otherwise a **stand-in** built from the 2D art: bevelled gold
  body (the silhouette extruded), an enamel face textured with the SVG art (outer band metal, middle
  glossy enamel via a roughness/metalness map + bump), the star and ribbon (`PIN_STAR`/`PIN_RIBBON`)
  raised in relief, and a back with a brushed "TCG HAVEN" back stamp, post and clutch. Dev server
  only: the Dev panel's "Show all badges as earned" (localStorage, this device only). The camera is
  fitted to the pin (fills ~84% of the shorter side of the view, refitted on resize).
  In the book, an earned pin tilts toward the pointer with a moving glint (`.pinbook-glint`).
- **3D models from Meshy (the real pins, 2026-10-28)** — the relief below can't sculpt figures, so
  pins are made as models: art → Meshy image-to-3D (GLB + base colour/metal-rough/normal maps) →
  upload the raw .glb in the badge editor — the upload field compresses it in the browser first
  (`lib/pinOptimize.ts`: gltf-transform dedup/weld/prune, WebP textures via OffscreenCanvas,
  meshopt; same mesh; loaded on demand; Umbreon 31MB → 8MB). `next.config.js` strips the `node:`
  scheme on the client so gltf-transform's Node-only reader doesn't break the bundle. The CLI
  equivalent is `npm run optimize-pin -- in.glb out.glb` (gltf-transform: the exact mesh, no simplifying — the
  owner wants the Meshy mesh as generated — meshopt-compressed, WebP textures at 2048: Meshy's
  118MB/1.2M-triangle file → 20.4MB; the Storage rule caps uploads at 25MB) → upload as the badge's
  3D model → "Book picture from 3D model" in the badge editor (`pinSnapshot.ts`: a straight-on,
  transparent render of the assembled pin saved as `imageUrl`, so the book shows exactly that pin).
  The model is shown as-is: no displacement or extra normal map (those are only for the relief). `PinInspector` loads it with the meshopt decoder and
  `assemblePin()` (`components/badges/pinBacks.ts`) makes it a pin: Meshy's back is a mirror of the
  front and Meshy is NOT consistent about which side is the real one (Origins' faces −z,
  Umbreon's +z) — so the badge editor's "Front of the pin" (`ModelFront` in BadgesAdmin.tsx)
  renders both sides (`renderPinSides`), auto-picks the one matching the uploaded pin art
  (`guessFront`: cropped 48px greyscale correlation — the wrong side is the art's mirror image),
  lets staff click the other, and remakes the book picture from the choice (saved as
  `picture-*.png`; uploaded art is `art-*.png`, which is how the art is told apart). The choice is
  `modelFrontPositiveZ` (unset = −z). The model is turned to its front, cut through its middle with the back half flattened, and given a
  standard back — a brushed-gold plate cut to the pin's own silhouette (vertex splat → close → fill
  holes → `traceOutline`) with the TCG HAVEN stamp, plus the badge's `pinBack` hardware
  (`PIN_BACKS` in `lib/badges.ts`: post & clutch, two posts, magnet). Back plates are built facing −z
  with reversed winding and mirrored UVs (`backPlateGeometry()`) — rotating a front-facing shape
  180° mirrors it, which only looked right on symmetric pins. Plan: Creators make pins by prompt →
  image → Meshy API → preview/confirm → this same assembly.
- **Art → 3D relief, no mesh** (`components/badges/pinRelief.ts`): a badge with uploaded art (and no
  `model`) is built into a 3D pin from the image in the browser: cut-out (alpha, or flood-fill of a
  white background), outline traced (Moore-neighbour) and extruded into a bevelled gold body, a
  560×560 grid (320 on phones) displaced by the broad shape only, while the fine detail (filigree,
  fur, lettering) is a 1024px normal map — putting fine detail in the mesh made it spiky. The broad
  shape comes from the badge's **depth map** when it has one (`depthMapUrl`, uploaded in the admin;
  white = near): made from the art with a depth model (Depth Anything V2 — `transformers`
  `pipeline('depth-estimation', 'depth-anything/Depth-Anything-V2-Base-hf')` on the art over white,
  normalised inside the opaque area). Without one it's guessed from colour (gold raised, figures
  mid, scene recessed), which gives flat, even-height plateaus per colour — always add a depth map.
  Relief height: 0.03 with a depth map, 0.018 guessed, on a 0.047 body; eased to 0 at the outline.
  Maps read from colour: gold → metal (roughness from brightness), small saturated
  blobs touching gold → gems (very glossy, faint inner glow), pale cyan → emissive glow, the rest
  enamel. Fixes that matter: transparent PNG pixels get the edge colours bled into them (else hidden
  white leaks in as a pale rim), gold is "de-lit" toward a true gold tone (art with painted-in
  highlights otherwise reflects as white), pale bands at the outline count as gold (AI art paints
  the coin's side in perspective), light clear coat only. Limits: depth is guessed from colour, so
  faces/figures aren't truly sculpted — a depth map or a .glb gets past that.
- **Earned vs Mastered (2026-10-29):** earned is for good (never taken away — not when cards are
  sold, not when a badge grows). A badge with `growing` (staff portal switch "Growing badge" — e.g.
  Overnumbered Legends Mastery, which gains a slot per new set) is **Mastered** while the collector
  holds every card it asks for today (`isMastered()`): its pin gets a polished platinum rim around its silhouette with a
  highlight slowly travelling round it (`.pinbook-platinum`, a conic gradient on the pin mask drawn
  slightly larger behind the pin; the owner rejected glows, rays and flames as too much), a "✦" gold nameplate, and "✦ Mastered" in the hover
  and 3D view; earned-but-behind shows "N more to master it". Fixed badges never glow. The Dev
  panel's "Show all badges as earned" also fills progress, so growing badges show Mastered.
- **Cover pictures:** a book can have `coverImage` (staff portal → edit book → "Cover image"): a
  picture of the cover on a plain light background, cut out in the browser (`lib/coverCutout.ts`:
  light colourless pixels connected to the border — backdrop and shadow — go transparent, then
  cropped, WebP). It replaces the plain leather on the shelf (`BookCover`) and is the open book's
  cover/rim (the leather stitching and gold corners are hidden — the picture has its own frame).
- **Chapters (2026-10-29):** a book is in ordered chapters — `BadgeSet.chapters` (e.g. Riftbound:
  "Overnumbers", "Alternative Arts"); a badge's `page` is its chapter (`chaptersOf()` = the book's
  list + any chapter a badge names that isn't listed). Each chapter starts on a fresh page and grows
  pages as it fills (6 a page), so adding a badge never reorders later chapters; an empty chapter
  still gets its titled page. Chapter tabs (`ChapterTabs`, `.pinbook-tab*`) run down the book's right
  edge (replacing the strap): numeral + name, the open one gilded and standing out (names hide on
  phones). Clicking one turns straight to it (a turn has a target spread, `to`); one already on the
  open spread just becomes the highlighted tab (`focus`) and its title glints.
  Staff portal: `components/admin/ChaptersBoard.tsx` — each chapter is a leather card with its pages
  as mini velvet pages of pins: rename inline, reorder, add/delete (only when empty), drag pins to
  reorder or move between chapters, click a pin to edit; the badge editor picks a chapter (or starts
  a new one, which joins the book's list).
- **HavenRelief** (`tools/havenrelief/`, 2026-10-28) — our own image → bas-relief tool, replacing
  paid ones (bas-relief.ai) and Meshy for flat-art pins: Depth Anything V2 Small (Apache-2.0) for
  layers + Marigold Normals v1.1 (Open-RAIL++) for detail, integrated and linearly scaled to 0..1
  — no compression, clipping, rims or smoothing (2026-10-29: all of that made pins look gummy).
  One command (`python havenrelief.py art.png`; README has Windows/Linux + NVIDIA setup —
  seconds on the owner's RTX 4090, ~1h on the Intel MacBook) writes `art.webp` (Pin art),
  `height.png` (Depth map) and `normal.png` (Normal map) for the badge editor. A badge with a
  depth map (and no `model`) is built by `buildRelief()` in "clean" mode: the height used as made
  (read at 2048, meshed at 1100², cut cleanly at the outline), the art's own colours, metal only
  in solid gold areas (`solidifyGold`), no invented detail. `normal.png` is Marigold's raw normals,
  applied as an **object-space** map that replaces the displaced mesh's normals — a tangent-space
  map of the same relief on top of the displaced mesh counted every slope twice (pillowy, molten).
  `RELIEF_DEPTH` is 0.026 (the default; the Studio sets it per badge — 0.055 stood taller than the
  body). Steep walls (`setWalls()`) are plain gold lit by the mesh's real normal, since the head-on
  art and normals only smear down them; the relief's cut edge is snapped onto the smooth outline
  with a gold skirt down into the body (no see-through gap, no stair-steps). Body gold stays
  shiny (roughness 0.3 + mirror clear coat); the studio environment is rendered at 1024px
  (`ENV_SIZE`, 512 on phones) because three.js's default 256 showed as staircase blocks in it.
  Run on a Windows PC: `.venv` built with Python 3.13 + cu124 torch + torchvision works.
  Never swap in Depth Anything V2 Base/Large: they're non-commercial.
- **HavenRelief analysis rework** (2026-11-08, tested on the Signature Mastery and Pokémon 151
  pins). Depth Anything V2 Small saw every pin tilted (the bottom nearer), barely saw raised
  lettering, and Segment Anything ViT-B left 40–55% of a pin with no piece — which the Studio then
  cut into diagonal depth-band wedges. Now: **pieces** = Segment Anything 2.1 Large (Apache-2.0,
  `transformers` 5) on the whole picture + 2×2 and 3×3 overlapping crops, de-duplicated, painted
  largest first; what it leaves is split by colour (Felzenszwalb, scikit-image), so every pixel has
  a piece. **Layers** = Marigold Depth v1.1 (Open-RAIL++, the normals' licence) at 768 (right
  layering) and 1536 (fine raised parts), combined piece by piece at half weight (`fuse_depth()` —
  full weight sank small raised figures). Normals unchanged. **Levels** are ranked by the change
  across each piece's own borders (depth + detail, solved together; `lib/reliefLevels.ts` and its
  Python twin `piece_heights()`), then spread by rank so all 8 levels get used. Reliefs saved
  before this keep the old median-depth rule (`levelRule: 'depth'`) so their per-piece level moves
  stay put; the Studio offers "Rank by borders instead". Rejected: Marigold at 1536 alone (tilted
  plate), a blur-based depth blend (halos round letters), k-means on raw heights (one tall group
  takes the top level). MoGe-2 (MIT) and Depth Anything 3 Mono-Large (Apache-2.0) are untested —
  they only install from GitHub. About 2½ min a pin at `high` on the 4090.
- **Relief Studio** (staff portal → Badges → edit badge → Relief Studio, 2026-10-29) —
  `components/admin/ReliefStudio.tsx` + `lib/reliefStudio.ts`. The AI runs **once per picture**
  on `tools/havenrelief/server.py` (`http://127.0.0.1:7861`, this PC's GPU for now —
  `NEXT_PUBLIC_HAVENRELIEF_URL` points it at a cloud GPU later), which returns a **kit**: art,
  depth layers, integrated detail, Marigold normals, and Segment Anything **pieces** (16-bit
  values split across two 8-bit channels; see havenrelief.py). The server caches every analysis
  on disk by the image's bytes (`cache/`, git-ignored) and frees GPU memory between models (with
  all three resident the card spilled into system RAM: 150s → 58s). Uploading pin art in the
  badge editor auto-analyzes and saves the kit with the badge (`reliefKit`); the Studio then opens
  straight onto live controls — everything below runs in the browser, no AI re-run:
  - **Relief tab:** stepped/smooth, levels (default 8, each can be switched off), Flatten all
    pieces (default 0%, so the sculpted detail shows on the steps — at 100% it wiped the detail
    out), soften, depth, detail (default 100%), gold walls; per piece raise/lower, flatten, smooth
    edges. Kits from before 2026-11-08 have gaps between Segment Anything objects; those are split
    into pieces here (`splitGaps`), so every area is selectable.
  - **Material tab:** Photoshop-style Layers (one per piece; thumbnail, rename, eye = hide its
    finish) + Material properties: a finish per layer — Auto, Regular, Gold, Gemstone (real light
    transmission), Holographic, Color Fresnel, Hole (cut through relief, body and back, one gold
    wall), Lenticular (named picture sets, each layer picks one, seamless crossfade driven by the
    whole pin's tilt), Pattern Foil (micro-ridges steered by Swirl/Perlin/Turbulence/Cracked
    Ice/Gem Facets/Sunburst noise + seed) — each with its own settings and Feather edges.
  - Selection: click; Ctrl/⌘-click adds; Shift-click ranges rows; **hold Tab to paint** pieces
    into the selection (Alt erases, scroll/[ ] resizes). Edits apply to every selected layer.
    Undo/redo: Ctrl+Z / Ctrl+X, Y, Shift+Z. H toggles the selection highlight.
  - **Finish map** (`finishMapUrl`, also read by the collector's 3D view): RGBA, R = finish id
    (0–15) + 16 × coverage (0–15, feathered edges), G/B = that finish's settings (some packed two
    per channel). Coverage rides in R, not alpha — a PNG's alpha gets premultiplied and scrambled
    the ids. Narrow unfinished slivers between same-finish pieces are closed (`closeSlivers`).
    Holes are cut by geometry only (a shader discard by this pixel map left a pixel staircase).
  - "Save relief to badge" bakes the full-size height + finish maps, uploads them with the kit,
    and **saves the badge** in the same click. Unsaved Studio work is kept per badge in
    localStorage (`tcghaven-relief-draft:{id}`), so a reload never loses it.
  - Storage: kits live in `badges/{id}/kit-{time}/` — `storage.rules` matches `{path=**}`.
  - **Saved build (2026-11-03)** — the slow part of building a relief pin (holes, outline, the
    face mesh cut to the pin with its edge snapped onto the outline, the band round each hole the
    height is carried into: ~5–8 s per open) depends only on the art, the finish map's Hole pixels
    and `holeSmooth` / `artHoles`. "Save relief to badge" works it out once
    (`pinRelief.ts bakeReliefBuild`, both grids: 1100 fine, 640 phones) and uploads it as
    `badges/{id}/build-{time}.bin` (gzipped typed arrays, ~0.7 MB) → `reliefBuildUrl` +
    `reliefBuildKey`. The 3D view loads it (`loadReliefBuild`, cached per session) only while the
    key (`lib/reliefBuild.ts reliefBuildKey`: version + art URL + finish URL + hole settings) still
    matches the badge; otherwise `cleanRelief` works it out live as before. The result is identical
    (checked point for point). Every badge was built once (2026-11-03); the one-off "Build 3D pins"
    button that did it was removed after. Changing any step in `reliefShape` / `reliefMesh` /
    `holeBand`? Bump `RELIEF_BUILD_VERSION` so old builds are ignored — each pin then builds live
    (slow) until it's re-saved in the Relief Studio (or bring back a bulk button: git `e9921aa`).
- **Pin Display (profile Badges tab, 2026-10-29)** — `components/badges/BadgeShowcase.tsx`: the
  Badges tab opens on a velvet display pad (book velvet + gold frame in a leather border) with
  `PIN_DISPLAY_SPOTS` (6) spots the owner fills: click an empty spot (a round carved pinhole,
  `#pinhole-inset`) → pick one of your earned pins; click a pin → swap / take off / view in 3D.
  Saved as `profiles/{uid}.pinDisplay` (badge ids, '' = empty; rules allow a list ≤ 6) via
  `updateProfileDetails`, shown at once and put back if the save fails. Only earned pins show.
  The tab's top-right switch "Pin Display | Full Badges" (Full = the shelf of books).
- **Pin art** (`components/badges/BadgePin.tsx`): temporary SVG enamel pins (gold hexagon rim,
  enamel, emblem, ribbon) keyed by `art`; `PIN_SILHOUETTE` is the hole's shape.

### Accounts: titles, Creators, suspensions & bans (2026-11-09)

Every collector account is **Regular**, **Premium**, **Creator** or **Staff** (`lib/accountRoles.ts`),
plus two holds that never delete anything: a Creator can be **suspended**, and any account **banned**.
- **Stored** in `account_roles/{uid}` = `{ role, creatorSince?, formerCreator?, suspended?, banned?,
  updatedAt }` (no doc = Regular, in good standing). Any signed-in collector reads it (titles show
  on profiles); only staff write it. `account_roles/{uid}/history/*` (`{ at, by, byName, action:
  title|suspend|restore|ban|unban, from?, to?, note }`) is staff-only — notes can be about
  investigations.
- **Premium** comes free with Creator and Staff (`hasPremium()`); paid Premium isn't built yet.
- **Staff portal → Accounts** (`components/admin/AccountsPage.tsx`, `/admin/accounts`, any staff
  member): search any account by name, @username or user id; lists Creators, Suspended creators,
  Former creators, Premium, Staff, Regular (paged, "Load more") and Banned — each account is in
  exactly one (`listOf()`). Manage = title cards, Suspend / Restore Creator, Ban / Unban, a note
  (required to suspend, ban or take Creator away) and the history. Writes go through
  `changeAccount()` in `lib/firebase/accountRolesStaff.ts` (the staff session).
- **Creators:** `isCreator()` = Creator, not suspended, not banned. Rule for everything creators
  will make (communities, badge books, follows): show it only while `isCreator()` holds for its
  maker, so a suspended or former creator's work is hidden from them and their followers and comes
  back unchanged. `creatorSince` is kept for good.
- **Bans:** `BanGate` (`components/auth/BanGate.tsx`, in `ClientWrapper`) shows a full-screen
  "This account has been banned" with Sign out; `firestore.rules` `notBanned()` refuses their
  writes (profiles, usernames, shared Cardex/badges, friendships, `users/{uid}`) — deletes stay
  allowed so they can still delete the account. Their profile reads as "not found" to others.
- **Collector app:** `useAccountRole(uid)` (live). Creators get a **Creator** tab under a line in
  the desktop sidebar and a wand button in the phone top bar, both to `/creator`
  (`components/pages/CreatorPage.tsx` — the Creator Studio; tools "coming soon"; suspended /
  former creators see it paused). Profiles show the title beside the @username (your own always,
  someone else's unless Regular).
- Deleting an account leaves its `account_roles` doc (only staff can delete it).

### Profiles & what friends can see

`/profile` (`components/pages/ProfilePage.tsx`) is your profile — exactly what friends see — opened
from the sidebar's profile button (its own box; Sign out sits separately below it). You curate it:
a bio (≤160 chars) and `privacy` on `profiles/{uid}` — `cardex` and `badges`. Both are **public by
default** (2026-10-28): any signed-in collector can see them on your Haven, friend or not, until you
switch them off ("Public on your Haven" on your profile). **The Portfolio is never shared** — there is
no shared copy of values, prices or purchase info anywhere. `/u/{username}` (`profilePath()`; the
profile's "Share profile" button copies it) — or `/profile/{uid}` as a fallback — shows someone else's
profile with only what they share (non-friends see name/bio and an Add button).

Layout: header card (banner, avatar, name, bio — and on your own profile the compact "Friends can
see" switches on its right), then the **showcase**, framed in the parchment palette
(`.showcase-frame` / `.showcase-inner` in `globals.css`) with Cardex | Badges tabs. The profile is
**standalone** — it's for other people, so nothing on it links into app pages a visitor can't open.
The Cardex tab is a self-contained mini Cardex: card / set / game counts, game chips, a set picker,
cards best-first (yours by today's price; a friend's shared copy is stored most-valuable-first,
without prices) paged in place with "Show more", and a click opens the Cardex's own spin-around
`CardZoomOverlay` (exported from `CardexPage.tsx`) — with no price, since profiles never show any.
Badges is a "coming soon" preview.
A **Top cards | Full Cardex** switch sits at the top of the Cardex tab: Full Cardex renders the
real `CardexPage` inside the profile with a `viewer` prop — the profile owner's cards drive
ownership (owned in color, missing grey, per-set progress), and it's read-only: no page header,
no Personalized Collections, no Shift+Click/double-tap add or eBay ⌘-click, prices zeroed (so no
tooltip/zoom prices), view-only zoom, and it never touches the URL (no ?game=&set= deep links).

- **Shared Cardex:** while `privacy.cardex` is on, `FriendsProvider` keeps `shared_cardex/{uid}` =
  `{ cards: JSON }` in step with the inventory (debounced, skips unchanged writes) — only the fields
  ownership needs (`toSharedCards()`: apiId, set, number, quantity, foil, grade… no prices, dates or
  groups). Turning sharing off deletes it. Rules: readable by the owner, or by any signed-in
  user while the profile's `privacy.cardex` is true (the default). One doc (~150 bytes/card, so the
  1MiB limit is ~6k distinct inventory rows — chunk it if someone gets close).
- The Filters summary bar (Floor / Games / Hidden · Edit) shows only on Portfolio pages
  (`FilterPanel.tsx`) — the filters don't affect anything else.
