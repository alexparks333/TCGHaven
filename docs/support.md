# Support (/support)

Collectors reach us at **support@tcghaven.org** or through the support page.

- **Page:** `/support` (`components/pages/SupportPage.tsx`, public — the App Store support URL). Two
  kinds: **A card is missing** (game, set, card name, number, note) and **Help & bug reports** (topic:
  Account status / Bug report / Billing & Premium / Something else, message). The reply address is
  the account's email, editable. Signed out: sign in, or the email link (reports come from an
  account — staff can answer, spam stays out).
- **Links in:** the sidebar (small "Support" under your profile card), Settings (phones), and
  "Missing a card? Report it" when a Cardex or Add Card search finds nothing — prefilled
  (`?type=missing&game=…&q=…&from=cardex|add-card`; also `?type=help&topic=bug`).
- **Saved to** `support_requests/{id}` (`lib/support.ts`): `{ kind, status: 'open'|'done', uid,
  email, name, message, platform: 'app'|'web', createdAt, game?, setName?, cardName?, number?,
  topic?, page?, photos? }`. `firestore.rules`: a signed-in, not banned account creates its own (shape and
  lengths checked — keep `SUPPORT_LIMITS` in step); only staff read, update, delete.
- **Photos (2026-11-24):** up to 10 a report, either kind. Shrunk to ≤ 2000px JPEG in the browser
  (`uploadSupportPhoto()`), saved to Storage `support/{uid}/…` before the report is sent; `photos` =
  their paths. `storage.rules`: you add your own (image, < 10 MB), only staff / the Owner / the bot
  open them; the inbox shows thumbnails (`supportPhotoUrl()` via the staff portal's sign-in).
- **Staff:** the staff portal's **Support** tab (`/admin/support`, `components/admin/SupportInbox.tsx`)
  — newest first, Open / Done / All, Missing cards / Help; reply by email (the address link), mark
  done. A missing card is added in Admin Catalog as usual.
- **Not built:** an email to support@tcghaven.org for each new report (needs an email service and a
  secret) — staff check the Support tab.
