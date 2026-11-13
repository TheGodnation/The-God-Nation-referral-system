# Leadership supervision: plan for approval (nothing built yet)

Decided with the founder, 6 November 2026. Nothing below is built until the founder approves a phase.

## Decisions
| # | Decision |
|---|---|
| 1 | No separate "coordinators": the leaders themselves are the group the central admin supervises. |
| 2 | Leaders' rooms by generation of the assembly tree (existing same-generation collaboration rooms), plus an "All leaders" room. The central admin is in every room, labelled "Central team". |
| 3 | An instruction goes to chosen rooms, all rooms, or hand-picked leaders. It has a deadline; each leader marks Seen and Done (optional note). The central admin sees who has seen it, who is done, who is late, and can remind. Per instruction: leaders may or may not see each other's replies. EN/FR translation. |
| 4 | Weekly report from each leader to the central admin: people contacted, people who need help, prayer needs, free note. A "My leaders" screen with green/yellow/red. Late reminder. |
| 5 | One representative per generation, appointed and removed only by the central admin. Label "Representing the central team". Can post instructions in that generation, pick leaders for them, see who is done or late, remind, receive that generation's reports and send the central admin one summary. Cannot appoint or remove anyone, act in another generation, or read private chats or prayer requests. |
| 6 | Only the central admin removes leaders and representatives; nobody can touch the central admin. |
| 7 | Sanction of a member (3 days, 1 week, 2 weeks, 3 weeks, 1 month, until further notice) by the leaders of that assembly and by the representative of that generation. Only in the assembly the person leads. Reason required and shown to the member. The member can still read but cannot write, comment or react. Ends by itself, can be lifted early, the central admin can lift or change any. Every sanction is recorded. Leaders cannot sanction leaders or the central admin. |
| 8 | Removing a member from the community for good: only the central admin. A leader sends a "please remove this person" request with a reason. |
| 9 | A leader can message all the people they look after in one step (each gets a private message with their name). |
| 10 | Assign people to leaders in bulk: choose the assembly, choose which leaders, set how many people each (or share evenly), preview, then assign. Built for the central admin (6 Nov 2026); the generation representatives get the same tool, limited to their generation, when representatives are built. |

## Order proposed
1. Rooms and instructions with Seen/Done.
2. Sanctions and removal requests.
3. Weekly report and "My leaders".
4. Representatives.
5. "Message all my people".

## Chats page, Leadership card and bulk adding (done)

- **Leadership card** on the Chats page beside Events, shown to everyone. Leaders open their dashboard; everyone else sees a
  "You are not yet a leader" page (what opens for leaders, how to become one, button to the Leadership School with progress).
  The central admin's card goes to their profile tools. The old profile link was removed.
- **Chats page**: assemblies in a fixed order (Headquarters, then each generation, name breaks ties), unread number on each row,
  never reordered by messages. Two tabs, Assemblies and Private messages, each with a red unread number; opens on Private when
  there are new private messages. Rows refresh every minute. `GET /api/member/me/community-memberships` now returns `generation`.
- **Add many people** (`/api/admin/bulk-members`, `/api/member/central-bulk-members`; tab "Add many people" in the admin
  dashboard and the central admin's profile): choose generation / one assembly / "no assembly yet", tick who goes (Select all
  covers the whole list, up to 5,000), add to an existing assembly or a new one (with its chat), optionally take them out of
  the old assembly (off by default; memberships become INACTIVE). One `ADDED_TO_ASSEMBLY` notification each, one push.
- **Delete an assembly** now asks where its members go (default: the assembly above it; or another; or nowhere).

## Sanctions (approved rules, done)

- **Mute**: the person can read an assembly but not write in it, for **3, 7, 15 or 30 days**; it ends by itself. A reason is
  required and shown to the person with the end date. They are notified when muted, lifted and when it ends.
- **Who can mute**: the central admin anywhere; a leader only in an assembly they lead (representatives join as a third
  authority in their own step). Nobody can sanction the central admin; leaders cannot sanction other leaders.
- **Lifting**: the central admin can lift any mute; a leader can lift mutes in their assembly **except ones the central admin
  placed**.
- **Ask for excuse**: the muted person can send one short request for excuse (not an appeal); it goes to whoever muted them.
- **Removal**: leaders cannot remove anyone. They send a **removal request** with a reason; **only the central admin** approves
  (the person leaves that assembly) or declines. The central admin can also remove directly.
- Everything is recorded in the audit log. Where: leaders' dashboard tile "Sanctions", the central admin's profile tab and the
  admin dashboard tab. The Chats page keeps the Leadership Team (former Headquarters) directly under the Headquarters.

## Representatives per generation (done)

- One representative per generation (1 = directly under the Headquarters), chosen **from the leaders** and ended **only by the
  central admin** (tab "Representatives" in the profile's admin tools and the admin dashboard). One leader represents at most
  one generation; remove the current one before appointing another. Notified when appointed or ended.
- A representative: writes **instructions to the leaders of their own generation** (all of them, or hand-picked ones among them;
  never "all leaders") and follows who has seen / is done / is late and reminds, for their own instructions only; **mutes members
  and sends removal requests in every assembly of their generation** (cannot lift a mute the central admin placed, cannot remove
  directly); is in that generation's leaders' room, labelled "Representing the central team". Leaders see "From your
  representative" on their instructions. Their tools are in My Leadership Dashboard.
- Not yet: the assign-people tool limited to their generation, and receiving their generation's weekly reports (they come with the
  weekly report step).

## Weekly report and "My leaders" (approved rules, done)

- **Week**: Monday to Sunday, Cameroon time (UTC+1). A report is **on time** if sent by **Monday 23:59** after the week ends; it can
  be sent any time that week, edited until the deadline, and filed late for last week (shown as late). First reporting week:
  9 November 2026; a leader's first report is due when the week they became a leader ends.
- **Report**: people contacted, people who need help, prayer needs, free note; the app shows a hint of how many people the leader
  followed up that week ("Use this number").
- **My leaders** (profile admin tools and admin dashboard): every leader with a colour for the report now due — **green** sent on
  time, **yellow** not sent yet before the deadline or sent late, **red** deadline missed and still not sent, **grey** first report
  not due yet; counts, a generation filter, reports week by week, "missed N of the last 4".
- **Reminders**: Sunday from 18:00 a reminder to leaders with no report that week; Tuesday from 08:00 a "late" notice to those who
  missed Monday's deadline (each once); the central admin can also remind one leader or everyone late.
- **Who sees what**: the central admin sees every report and the representatives' summaries; a representative sees only the leaders
  of their generation (including prayer needs) and writes one summary a week for the central admin; a leader sees only their own.

## Message all my people (approved rules, done)

- A leader writes once — **text, photos and/or a voice message** — and everyone they look after (their active follow-ups, "My people")
  gets it as an **ordinary private message** from the leader, in their normal private chat, starting with "Hello {first name},"
  ("Bonjour" for French speakers). They can reply privately. Same text limit as any private message. **No limit** on how many
  a leader sends. The leader can leave some people out; accounts that were deleted are skipped (the leader is told how many).
  Photos/voice are uploaded once and copied into each private chat.
- **Record**: who sent it, when, to how many, what it said. The leader sees their own list; **the central admin** reads all
  (profile "Group messages" tab and admin dashboard); **a representative** reads those of the leaders of their own generation.
- **Who cannot be blocked** (everywhere in the app): the central admin and their member profile; the leaders of your own
  assembly or generation; the leader who looks after you; the representative of your generation. Older blocks of such people
  are ignored, so they can always message each other. Ordinary members and leaders far from you can still be blocked.

## Representatives: assign people to leaders (done)

- The representative of a generation has the same "assign people to leaders" tool as the central admin — choose an assembly, the
  leaders, how many each (or share evenly), preview, then assign — **limited to the assemblies of their generation** (a tile
  "Representative: assign people" in My Leadership Dashboard; `/api/member/rep-cells`). Any other assembly is refused; it stops
  the moment they are no longer the representative. Each assignment is recorded in the audit log as made by the representative.

## Assemblies and groups: only assemblies are generations (done)

- **Assembly** = part of the growth tree: the National Headquarters is the **founding generation (0)**; the assemblies it brings
  ("one brings two") are generation 1, theirs generation 2, and so on. **Group** (women, men, youth, children, prayer, leadership
  team…) = belongs to an assembly, **takes its assembly's generation and is never counted as a generation**. New field
  `Community.kind` (ASSEMBLY or GROUP); the counting in `lib/tree.ts` (`getCommunityGeneration`, `getCommunityIdsAtGeneration`)
  only steps down through assemblies, so leaders' rooms, representatives, instructions, sanctions, reports and block protection
  all follow it. Groups never receive newcomers; people are followed up in assemblies, not groups.
- The assembly that used to be the Headquarters (the **Leadership Team**) became a group automatically (migration
  `20261206090000`, and "replace Headquarters" now does it too). Anything else can be switched in Edit.
- **Rules**: a group must sit inside an assembly; an assembly of the next generation cannot sit under a group; an assembly that still
  has assemblies under it cannot become a group; the Headquarters cannot be a group.
- **Central admin's profile, tab "Groups"**: leaders of groups (any member of the group or its assembly) and "Assemblies and
  groups" (open, add, rename, change type, delete with the members' destination) — the same tools and rules as the admin
  dashboard's Communities tab (`/api/member/central-communities`, `/api/member/central-groups`).
- **Representatives** can make a member of a group (or its assembly) the leader of a group of their own generation
  (`/api/member/rep-groups`); removing leaders stays with the central admin.

## French names of assemblies and groups (done)

- Each assembly or group has its English name and, **written by the admin next to it**, a French name (`Community.nameFr`, migration
  `20261207090000`; no automatic translation). French speakers (the app sends `X-App-Language`) see the French name where one
  exists, everyone else — and French speakers when it is empty — the English one. Set in the admin dashboard's Communities tab
  (create and Edit) and in the profile's Groups tab ("Assemblies and groups"). Shown in: the Chats list and group chat header,
  Me/progress lists, events, teachings, prayer requests, a person's page (assemblies they belong to or lead), leader colleagues.
  Notifications and admin screens keep the English name.

## Making leaders of an assembly in one step (done)

- In the profile's "Assemblies and leaders" (and the admin dashboard's), each assembly has **"Make leaders of …"**: bring the leaders of
  another group or assembly (for example the old Headquarters, now the Leadership Team) in one step, or find any person by name or
  number. Each person is **added to the assembly if not a member, appointed leader, and given the Leader account** that opens their
  leadership dashboard (the same thing the old "New assignment" form did). Anyone who has not joined the app as a member can be
  appointed but has no dashboard until they join; the result says so, and an empty search explains it. The older "Ready to lead"
  appointment now also gives the Leader account. Endpoints: `GET /people`, `GET /leaders-of`, `POST /make-leaders` under
  `/api/admin/cells` and `/api/member/central-cells`.

## Book pages, exams and the faith journey (done)

- **Book page** (Leadership School): the founder's pitch (headline, bold, bullets), the chapter list (small label above each title: Introduction,
  Chapter One, Appendix A), and closing words, written with the app's chat formatting (`lib/richText`). Admin: "Paste a whole book page"
  (English or French, preview first) → `POST /api/admin/library/books/:id/page-import`. Book One was loaded by migration `20261209090000`
  (only when Book 1 had no chapters).
- **Book exams**: each set is 25 marked questions (A: 20 choices, B: 5 true/false; 70% pass = 18) plus **personal questions ("Section C")** on the Book 1
  and Book 2 exams. Admin: "Paste an exam" (question paper + teacher key, English or French, preview first) →
  `POST /api/admin/library/books/:id/exam-import` (English replaces sets nobody has taken; French fills the same sets in order).
  Book 1's three sets (English + French) were loaded by migration `20261211090000` — only while the exam is a draft; **it stays a draft until the
  central admin publishes it**.
- **Section C is the same in every set** of an exam (the founder's rule; Book 1 uses Set 1's, copied by migration `20261212090000`); only the
  marked questions differ between sets. "Paste an exam" ticks "Use the same personal questions in every set" by default.
- **Faith journey**: Section C is never marked and never changes pass/fail, but **every personal question must be answered before the exam can be
  submitted** (`PERSONAL_REQUIRED`). Answers are copied word for word (`PersonalAnswer`), with the teacher's guide beside them. Status per person
  (`FaithRecord`): *born again* only if every question that decides status (`affectsStatus`) got a clear yes (option signal `POSITIVE`) and
  nothing typed after "holding back" was flagged; otherwise *needs a conversation*. The central admin is notified
  (`FAITH_NEEDS_CONVERSATION`), reads everything under Me → Admin tools → **Faith journeys** (and the admin dashboard tab, and a card on the
  person's profile), writes private notes and marks "confirmed". Members never see any of it.
- **Leaders** read the journeys of the people of their own assembly only when the central admin switches `Settings.leadersSeeFaithJourney` on
  (checkbox in the Faith journeys tab); they are notified too, see it as a tile on the leadership dashboard, and every view by a leader is
  audited (`FAITH_VIEWED_BY_LEADER`). Endpoints: `/api/member/faith` (central admin on his profile, and leaders) and `/api/admin/faith`.
- **Book 2's exam** (Sets 1 and 2, English + French) is loaded by migration `20261213090000` (draft only; Section C = Set 1's in every set; Set 3 to come).
  In Book 2, only the repentance question and the confession decide the "born again" status; baptism, the Holy Spirit, what changed and
  "what holds you back" are flagged (⚑) and counted in the **To follow up** list (`flagged` on each row) without changing the status.
  "Paste an exam" keeps the exam's existing personal questions when a set is added later (`samePersonal`).
- **Book 2's Section C** is one combined set of personal questions, identical in all three sets (migration `20261214090000`, which also loads Set 3):
  repentance, baptism by immersion (+ when/where/who), the Holy Spirit with other tongues (+ when/how), what has changed, "would you like the team to
  help with the next step?" (+ best way to reach you), what holds you back, and the confession. **Repentance, baptism, the Holy Spirit and the
  confession decide the status** (born again = all clear); the other questions are flagged (⚑) in the journey and the "To follow up" list.
- **Book 2's page** (pitch, "Three steps. One door.", seven chapters starting with "From the Author", closing words), English and French, is loaded by
  migration `20261215090000` (only when Book 2 has no chapters). The page reader also learned: an author label, short taglines at the top, a very
  short slogan as a heading, a line ending with ":" as the introduction of the list under it, and a chapter-list heading with one sentence under it.
- **Book 3's page** ("Kingdom Keys, Volume 1: The Foundation": pitch, "Foreword and Introduction" + six chapters, closing), English and French, is loaded by
  migration `20261216090000` onto the book numbered 3 (only when it has no chapters). The page reader also keeps a headline that follows a short
  line as the headline, and puts a closing sentence after a list ("Find which one is yours...") back in a paragraph.
- **Book 3's exam, Set 1** (English + French, marked questions only: Books 3 to 15 have no personal section) is loaded by migration `20261217090000`
  (draft only). Sets 2 and 3 come later, through "Paste an exam" or the same kind of migration.
- **Book 3's exam, Set 2** (English + French, 25 marked questions; draft only, loads only if that set is still empty) is loaded by migration
  `20261218090000`. Set 3 comes later.
- **Book 3's exam, Set 3** (the final set; English + French, 25 marked questions; draft only, loads only if that set is still empty) is loaded by migration
  `20261219090000`. Book 3's exam now has all three sets and stays a draft until the founder publishes it.

## Leader follow-up on WhatsApp (links and greeting)

- On "My referrals", a leader sees, for each person who has a WhatsApp number, three buttons: **Say hello** (a plain greeting, no names, in the person's language),
  **Send our links** (a tick list of our places; WhatsApp opens with the message typed, the leader presses send) and **Which apps do you use?** (a question with every link under it).
- The places, in order: WhatsApp group (the person's language first), Telegram group, Messenger group, Facebook group, Facebook page, Instagram page. Channels are left out. Only links the admin has filled in are shown.
- A leader is also told who has not yet tapped "join our WhatsApp group" (`tappedGroup` on `GET /api/member/referrals/mine`, leaders only).
- Nothing is sent by the app and nothing new is asked of people. Telegram usernames and Messenger links are not collected (many people do not know them); people are sent our links to join instead.

## Public About page and Terms of Use

- The public About page (`/en/about/`, `/fr/a-propos/`) carries the founder's seven sections as he wrote them (10 November 2026). The app's own About page keeps its earlier wording on purpose (no separate "Our mission", short name "The God Nation") until the founder says to change it.
- **Terms of Use** at `/terms` (English and French, from the language of the app), linked in the footer of the app pages and of every public page. It was drafted for the founder to review: community rules, what happens when they are broken, content and materials, exams, payments, ambassador links, spiritual guidance, law and contact.

## "One brings two": at most two assemblies under each assembly (done)

- **Limit**: an assembly can have at most **2 assemblies directly under it** (`lib/assemblyLimit.ts`, `MAX_CHILD_ASSEMBLIES`), so the generations grow 2, 4, 8, 16… Groups are not generations and are never limited or counted. The limit holds for every way of making an assembly: creating one (admin dashboard, the central admin's profile, Assembly info), a group changed into an assembly, an assembly moved under another, deleting an assembly whose sub-assemblies would step up to a full parent, replacing the Headquarters with "move sub-assemblies up", the add-many-people tool's new assembly, and the app's automatic opening of a new assembly when one is full (which now counts every assembly under a parent, including those made by hand). Refusals say "<name> already has its 2 assemblies" (`code: ASSEMBLY_LIMIT`). Nothing that already exists is changed.
- **Two choices on Assembly info**: "New group here" (stays in the same generation, group by default) and "New next-generation assembly" (generation + 1). The old single "New sub-assembly" button always made an assembly, which is why an assembly made inside the Headquarters became generation 1.
- **Preview before saving**: "This will be generation N. <parent> has x of 2 assembly places used." For a group: "This stays in generation N. A group is not a new generation and has no limit." Create is switched off when the two places are taken. Endpoints: `GET /api/communities/:id/new-child-preview`, `/api/admin/communities/:id/new-child-preview` and `/api/member/central-communities/:id/new-child-preview`.

## Instructions read professionally (done)

- An instruction is shown to leaders (and in the central admin's tracker) with the same formatting as posts and book pages: `# Heading`, `## Sub-heading`, `*bold*`, `_italic_`, `- bullets`, `1. steps`, `> quote`, with roomy spacing for long reading. The writing box has the same formatting bar. Older instructions written as plain text still show correctly (paragraphs, lists).

## Instructions in private messages, and "Your leader" (done)

- **Instructions**: when the National Coordinator (or a representative) sends an instruction, each leader also gets a short private message from the sender, in the leader's language: "📌 New instruction: Title, Due: date, Tap to read it and mark it done", with a link that opens the Instructions card on the leader's dashboard at that instruction and marks it Seen. A reminder sends "⏰ Reminder: …" the same way. The full instruction stays in the Instructions tracker (Seen / Done / late, notes). If the sender has no member profile linked, only the in-app notice goes. Code: `lib/leaderInstructions.ts`, `lib/privateNotice.ts`.
- **Your leader**: when a person is assigned to a leader, the person is told who it is **once the leader has opened their dashboard** (`POST /api/member/my-leader/introduce`, called when the dashboard opens): a notification (`LEADER_ASSIGNED`, "<Name>, from the Leadership Team, has been assigned to follow you up"), a push, and a first private message from the leader in the person's language. Each assignment is introduced once (`FollowUpAssignment.introducedAt`); a hand-over to another leader resets it so the new leader introduces themselves. Assignments that existed before this feature were marked as done by the migration (`20261221090000`), so nobody got a message out of the blue; their card still shows. The person sees a **"Your leader" card** on Home (photo, name, "From the Leadership Team", a button to write), and a **"Your leader · Leadership Team" label** beside that leader's name in the private chat and the chat list (`GET /api/member/my-leader`).

## Group messages carry no names (done)

- "Message all my people" no longer puts the person's first name in front. Every message opens with the same greeting from the ministry, in the person's own language ("Hello, greetings from The God Nation 🙏" / "Bonjour, salutations de The God Nation 🙏"), then what the leader wrote. The same wording is used by the leaders' WhatsApp "Say hello" button.

## Starting the Leadership School: welcome, website email, WhatsApp (done)

- **Welcome** from the central admin's own member profile (the founder, by name; `centralAdminPerson` = the oldest active admin with a linked member profile) in the person's private chat, once, when training starts (website: at once; Play Store app: when the admin approves). It says nothing about prices, payment or the website, because the Play Store version shows this chat too (`lib/trainingWelcome.ts`). Replies come to the founder.
- **The Play Store version** (`isStoreApp`) shows no prices or payment screens: the person asks to read, the admin approves in Library > Trainees, and the person then continues **on the website** with the same account. That link goes **outside the app**:
  - an **email** sent automatically on approval ("Your Leadership School request is approved", button to `/member/school`), and **"Email the next 100"** in the Library for everyone the admin approved who has not been emailed (`TrainingEnrollment.websiteInvitedAt`; people who started by themselves are not included);
  - a **WhatsApp** button on each trainee row (the website link in the person's language, the leader presses send);
  - leaders' **"Send our links"** has "Continue your study on our website" (not ticked by default; never in "Which apps do you use?").
- **Message** button on each trainee row: a private message from the founder's own name (`POST /api/admin/library/trainees/:id/message`).
- **Rule kept for Google Play**: nothing automatic or sent to many people inside the app (welcome, notifications, group messages) mentions the website or payment; a message a person writes by hand to one person is a judgement call. Ask Google Play support about payments in Cameroon.

## Take back everyone a leader follows (done)

- To undo a mistaken or test assignment: in the central admin's "Assign people" tool (profile tab "Cells" / the admin dashboard), each leader who follows people has **"Take back everyone (N)"**. After a confirmation, all that leader's active follow-ups **in that assembly** are closed ("Taken back by the central admin"); nothing is deleted (history and chats stay), the people become unassigned and can be assigned again, and they no longer show that leader as theirs. `POST /api/admin/cells/release` and `/api/member/central-cells/release` (central admin only).
- What cannot be undone: if the leader had already opened their Leadership page, the people were told once (a notification and a first message); those stay.

## The central admin is never followed up by a leader (done)

- The central admin follows up the leaders; leaders never follow up the central admin. Every way of making a follow-up now refuses or skips the central admin's own member profile: the admin's "add a follow-up" (`POST /api/admin/follow-ups`), a leader adding a person to their own follow-ups (`POST /api/leader/follow-ups`), "split between leaders" (`bulk-distribute`), "Assign people" (already skipped them) and sharing a person with another leader. Before this, the three manual ways did not check, and "Assign people" only skipped leaders of that same assembly.
- A migration (`20261223090000`) closes any active follow-up whose followed person is an admin's member profile (nothing is deleted). As a second safety, the "Your leader" card, the introduction message and the notification are never shown for the central admin.
- **Leaders are followed up only by the central admin and the generation representatives** (decided 10 November 2026), never by other leaders (`lib/followRules.ts`). Every way of making a follow-up refuses a leader following a leader (the admin may follow any leader, and so may a representative); the automatic tools ("Assign people", "split between leaders", sharing) never hand a leader to a leader, wherever that leader leads; and when someone becomes a leader, any follow-up of them by an ordinary leader ends (nothing is deleted). Migration `20261224090000` closes the ones that already exist.

## Instruction translation (EN <-> FR) made reliable

- Cause found: an instruction was translated once, at the moment it was sent, and given up after 15 seconds. The live logs show the translator
  timing out ("This operation was aborted") and refusing at busy moments, so some instructions were saved with no translation, and nothing ever tried again.
- Now: the instruction is saved first, then title and text are translated separately (a long text no longer blocks the title). A few seconds are given so it
  usually goes out in both languages; anything not ready is retried automatically after 5 minutes, 15 minutes and 1 hour (same queue as posts and messages).
- Push notifications and the private message are written in each leader's language, with the translated title when it is ready.
- At every server start, recent instructions (last 60 days) still without a translation are queued again, so the ones people complained about get fixed.

## "Just joined" line in assembly and group chats

- When someone joins an assembly or group (signup placement, the admin or a leader adding them, the central admin's add tool, moving someone in, or the "add many people" tool),
  its chat shows a line with their name (a link to their profile): "Name has just joined us. Welcome them!" (EN/FR). Nothing is shown when someone leaves; coming back counts as joining again.
- It is a message of kind JOINED written by the person who joined. It sends no push, is never counted as unread, is not shown as the chat's last message, is not found by search, and does not count as the person having written anything.
- More than 10 people added at once show as one line with the number ("42 people have just joined us"). The same person is not announced twice within a minute. The central admin is never announced.

## "Your leader" is a message, not a Home card

- The "Your leader" card on a person's Home page is removed. Nothing now sits on the home page.
- The person is told by the leader's private message (sent once the leader has opened their dashboard), a notification (bell and phone), and the "Your leader" label on that conversation in their private chats.
- No phone number is shared automatically: the person replies in the app, and the leader may share a WhatsApp number themselves.

## The National Coordinator's desk: "People who need me"

- The central admin can do everything a leader can, and more. The WhatsApp number and the three WhatsApp buttons (Say hello, Send our links, Which apps do you use?) now show on the people who joined through the coordinator's own link, as they do for leaders. Ordinary ambassadors still do not see numbers.
- New admin tab "People who need me" (admin dashboard and the central admin's profile, Admin tools). It lists everyone who has joined (except the central admin), newest contact last: how far each has got, their leader, the days since anyone last contacted them (a leader's contact note or private message, or the coordinator's), whether they tapped the group link. Filters: need me, not signed in, not finished joining, quiet, no leader, leader not following up (7 days), not in our group, my people, everyone; plus search, assembly and language.
- Each person has the WhatsApp buttons, a message in the app, "Take over" (the current leader stops following them; the coordinator follows them directly; nothing is deleted) and, for people taken over, "I contacted" (wellbeing and a note, recorded like a leader's contact).
- Writing to many: tick people (or "select all" for the whole filter, up to 1,000) and write one message with text, photo or voice. Each person gets it as a private message from the coordinator, who shows with the "National Coordinator" label in their private chats, in the chat header, in the notification bell and in the phone alert. It is kept in the group-message record.
- Not built yet (proposed): the WhatsApp queue (one tap per person), "Today's 20", leader alerts.

- Language: every person in "People who need me" shows 🇫🇷 French speaker or 🇬🇧 English speaker (from the language they chose when joining); the selection bar counts English and French readers and warns when the message will go to a mix, because private messages are not translated (only group chats, posts, announcements and instructions are). In a private chat the leader or coordinator sees the person's language under their name (the person is never shown this about the other side).
- Proposed, not built: translating a message to many people once, with a preview (each person receives their own language), and a "Translate" tap in one-to-one private chats.

## Tap to translate in private chats

- Private (one-to-one) messages are never translated by themselves. A small "🌐 Translate" under the other person's text message translates it when tapped. The translation is made once (English <-> French), stored on the message, and both people then read the same stored copy: no second request to the translator, however often anyone taps. Once translated it shows with "Translated from … / Show original".
- If the translator is down the person is told and can tap again; nothing is stored. Correcting a message clears its old translation. Only the two people in the chat can use it.

## Today's 20, the WhatsApp queue and leader alerts

- **Today's 20** is the desk's opening view: the 20 people who most need the coordinator today, ranked by urgency (a worrying last contact such as an emergency or needs-attention, no leader, leader not following up, not signed in or not finished joining, quiet, not in our group, and how long since anyone contacted them; the coordinator's own people count when overdue). Someone reached in the last 20 hours is not listed. A line says how many people were reached today.
- **"I contacted"** now works for anyone, without taking them over. It is the coordinator's own record (CoordinatorContact: wellbeing and a note) and counts as contact; nobody's follow-up changes.
- **WhatsApp queue**: select people, write the message once in English and once in French, then go through them one by one: WhatsApp opens with the words ready in each person's language, signed "— National Coordinator, The God Nation"; press send there, come back, "Done, next" (records the contact, optionally). The app sends nothing itself, so it cannot get the number banned.
- **Leader alerts**: a card at the top of the desk lists leaders who have people but have not logged a contact or sent a message for 7 days (or ever), with "Message the leader" and "Take over their people". Once a day in the daytime (Cameroon), if any, the central admin gets a notification and phone alert; nothing is sent when all is well.

## Writing to many people in two languages (translate once, with a preview)

- When the people chosen read both languages, "Send" (coordinator desk and leaders' "Message all my people") first translates the message once, shows it in both languages with how many people get each, lets the sender correct either, and sends only on confirmation. Each person then receives the version in their own language (greeting included); the group-message record keeps both versions. If the translator is down the sender is told and can send as written to everyone or cancel. A switch turns translation on or off.
- In the WhatsApp queue, one box filled and the other empty offers "Translate my message into the other language".
- Leaders' "My people" cards now carry each person's language and WhatsApp number (WhatsApp buttons and queue), and the broadcast people list carries the language.
- Phone alerts that name the National Coordinator (private message from the coordinator, post in the leaders' rooms, leaders-not-following-up alert) are written in each reader's own language.

## New-member welcome (onboarding Phase A)

- **Welcome page** (`/member/welcome-group`, also `/member/welcome`): shown right after the details form. It always appears, even when no community links are set. Four optional steps: notifications, install the app, the welcome community, first teaching. Each shows done / not yet; nothing is compulsory.
- **Founder welcome message**: sent once, from the National Coordinator's own profile, to the member's private chat the first time their profile is completed (`sendFounderWelcome` in `server/src/lib/memberOnboarding.ts`; EN/FR by the member's language; no prices, payment or links). Skipped for test data, erased/deleting people, the founder, and anyone the founder already wrote to (e.g. trainees who got the training welcome). The claim is stored in `MemberOnboarding.welcomeMessageSentAt` before sending, so it can never go twice.
- **First sign-in date**: `MemberAccount.firstLoginAt`, stamped the first time (`lastLoginAt` is overwritten on each sign-in). Accounts that signed in before this existed stay empty.
- **Get started card** on Chats and Home: progress, the next step, Continue, and ✕ (stored server-side in `MemberOnboarding.dismissedAt`). It reaches existing members too, and disappears when all steps are done or it is closed. Status comes from `GET /api/member/onboarding`; closing is `POST /api/member/onboarding/dismiss`.
- Link taps are shown only as "tapped a community link", never as confirmed membership.

## The Assembly Agreement (rules before writing)

- A person who signs up **after** `Settings.assemblyAgreementFrom` (set by the migration to the moment the rule started; empty = rule off) is already in their assembly and can **read everything and react** to messages, but cannot **post or reply** until they tap **I agree** (there is no "disagree"). Everyone who already had an account is left alone, and so are the central admin, leaders of the assembly and the representative of its generation.
- Server: `lib/assemblyAgreement.ts` (`agreementRequired`, `pendingAgreements`) is checked inside `canPostCommunityMessage`, so posting, replying, typing, editing and forwarding into the assembly are all refused with `403 AGREEMENT_REQUIRED`. `GET .../conversation/messages` returns `agreementRequired`. `POST /api/communities/:id/agreement` records it (`AssemblyAgreement`, one row per person per assembly, once).
- **Agreeing counts as joining:** the "just joined" line is held back at placement and appears when they agree (`joinNotice` skips people who still have to agree), and the National Coordinator's profile sends them a private message "You are now part of …" with a link into the assembly (`lib/assemblyAgreeing.ts`, EN/FR).
- The rules text (five rules, EN/FR) lives in the app's translations (`assemblyAgreement.*`). Changing it later only affects people who have not agreed yet (agreements are recorded once and never asked again).
- The welcome checklist's last step is now "Read the rules and join your assembly" (replaces "open your first teaching"). Existing members have it, and the community step, ticked automatically.

## Community step: a tap is not joining (onboarding Phase B)

- A new member's community step (welcome page and a card on Chats) lists the places to join (YouTube left out). Tapping a link only records "tapped a group link" (`GROUP_LINK_CLICKED`). The links open other apps, so we cannot see whether they really joined; the app then asks "I have joined?" and the step ticks only on their own answer (`MemberOnboarding.communityConfirmedAt`, `POST /api/member/onboarding/community-joined`).
- Existing members (accounts older than the Assembly Agreement start) are not asked: the step is ticked for them and the card is never shown.
- Growth report: the old "WhatsApp group" column is now **Tapped a group link**, and a new column **Says they joined** counts the self-reports. Neither is ever shown as confirmed membership.

## WhatsApp follow-up with consent (onboarding Phase C)

- **Three levels of consent** (`server/src/lib/whatsappConsent.ts`, from the latest recorded WhatsApp choice): **AGREED** (ticked the box), **NONE** (never ticked, or declined at sign-up) and **OPTED_OUT** (asked us to stop: the "Opted out of WhatsApp" button records a `ContactConsent` row with source `whatsapp-stop`; ticking the box again later wins).
- Shown on the coordinator's desk rows and in the WhatsApp queue (and carried on leaders' cards). The WhatsApp buttons are hidden for someone who opted out.
- **The queue asks what kind of message it is.** *Welcome, help to sign in or finish setting up, or a reply* may go to anyone who has not opted out. *We miss you, a reminder or an update* goes only to people who agreed, unless the sender ticks "Also include those who never ticked". People who opted out are never included, whatever the message. The queue starts on "help" for the "Not signed in" and "Not finished joining" lists, and on "nudge" otherwise.
- Ready-made welcome/help and "we miss you" texts (EN/FR); `{name}` becomes each person's first name. Inside the queue, "They asked us to stop" records the opt-out and drops the person at once (leaders have the same button, `POST /api/leader/follow-ups/:id/whatsapp-stop`; the desk uses `POST /api/admin/needs-me/whatsapp-stop`).
- New desk list **Never came back**: finished setting up, joined at least 3 days ago, and never seen again after the first day (alongside "Not signed in", "Not finished joining" and "Quiet").
- The app still sends nothing itself: the person presses send in WhatsApp.

## Private chats offline

- **Messages:** the last 50 messages of the 20 chats used most recently, and the chat list, are kept on the phone (`client/src/lib/chatCache.ts`, localStorage, per member, a few hundred KB at most; removed on sign-out and account deletion). Without internet a private chat opens from that copy with a note ("No internet. You are reading the last messages kept on this phone"); new messages appear when the connection is back. A chat never opened online has nothing kept and shows the usual "could not load" message. Messages waiting to be sent are not part of the copy (they already wait with a 🕓).
- **Photos and voice notes** seen or heard in a chat (group or private) are kept on the phone (`MEDIA` in `offlineStore`). **Limits: 100 MB in all, 10 MB for one file; the oldest go first; videos are never kept.** If the file cannot be fetched as a file, the plain link is used as before. Me → Downloads shows how much is kept, the limit, and a "Clear photos and voice notes" button. Books and PDFs are separate and not counted in the 100 MB.
- **PDFs:** a PDF opened once is kept and opens offline (from the chat, or Me → Downloads). Fixed: the pieces needed to open it offline (Downloads page, PDF.js) were only fetched on the *next* visit after a PDF was kept; now they are fetched right away. The private chat page is also fetched in the background on every visit (not when "Save data" is on) so it opens offline.

## Notification reliability and "is the app installed?" (onboarding Phase D)

- **How the app knows the app is installed.** A normal browser tab cannot see it. The app learns it when (1) it is running as the installed app (`display-mode: standalone`, or iPhone's Home Screen app), (2) Chrome on Android says so from a browser tab (`getInstalledRelatedApps`, which needs the manifest's `related_applications` entry), or (3) the member taps **"I have already installed it"** (welcome step) / **"Already installed"** (banner). Any of these is remembered on that phone (`localStorage godnation:installed`) and sent to the server (`MemberOnboarding.installedAt`, which then ticks the step on every phone and stops the banner). Not detectable: iPhone Safari tab, other browsers that hide it, and an app that was uninstalled later (the remembered flag stays).
- **Help guide panel:** "Open in a new tab" was removed from the panel (some phone browsers refuse new tabs); the panel already shows the whole guide.
- **Push: one retry** for passing failures (no answer, timeout, 408, 429, 5xx) after 1.5 s; refusals on purpose (400/401/403) are never retried; 404/410 (gone) are removed at once, as before. The delivery log now also says how many were retried and recovered (`PUSH_RETRY_DELAY_MS` changes the wait). Subscriptions are not auto-deleted for repeated 4xx errors on purpose: a wrong key would wipe everyone's.
- **Admin count** in the growth report: members with notifications on, out of all members, with the percentage and the number of phones (`notificationsOn()` in `lib/growthReport.ts`).
- **Ask again after install:** the first time the app is opened as the installed app and notifications can be turned on there, one clear "The app is installed. One last step" card asks once (`AfterInstallPushAsk`); closing or answering ends it, the usual banner still comes back on later visits.

## Helping people finish registering (WhatsApp)

- Placement is unchanged: people are placed in an assembly when they finish the details form, and the app never places someone who has not given their details. Instead, the coordinator and leaders get a one-tap way to help the people who have not finished.
- **"Help them finish registering"** (on each person who is *not signed in* or *not finished joining*, on the desk, in "My people" and in "My friends"): opens WhatsApp with the message typed in the person's language and first name, with the link `…/member/login?continue=1` (`&lang=fr` for French). It says "you are already registered" and the sign-in page opens on the emailed-code step with a welcome-back note; after the code the app takes them to the details form (name, country, place), where they stopped. Their account is the one they already have, so nothing starts from zero.
- **Personal link (coordinator only, on the desk):** "Send a personal link (no email code needed)" makes the same private one-time, 24-hour link as "Help them sign in" in Admin → People (`POST …/needs-me/continue-link`, audited as `MEMBER_CONTINUE_LINK_MADE`) and opens WhatsApp with it. They choose a password, are signed in as themselves, and the app sends them to the details form. Use it for people who cannot get emailed codes. Not offered to leaders. Care: the link works for whoever holds the phone, so only send it when you are sure the WhatsApp number is theirs.
- In the **WhatsApp queue**, those two lists open with the same text already in the boxes (it can be edited), as a *help* message: it goes to everyone who has not opted out, whether or not they ticked the WhatsApp box (see Phase C). A "finish registering" text button is also there for help messages.
- The app sends nothing itself: the sender reads the message and presses send in WhatsApp.

## Safety rules for every automatic nudge, and phone/in-app nudges at 3 and 7 days (onboarding Phase E)

- **One set of rules** (`server/src/lib/nudgeRules.ts`), used for every automatic nudge the app sends on its own: the reminder emails and the new phone/in-app nudges (the `MemberReminder` ledger counts all of them together):
  1. never within 48 hours of the person being seen in the app;
  2. at most one nudge in 3 days, of any kind;
  3. at most 4 in all per person;
  4. stop after 3 unanswered (nudges sent since the person was last seen);
  5. only 08:00–19:00 Cameroon time (UTC+1, no daylight saving), checked at the moment of sending, with the person's latest facts, not from an earlier list.
  The WhatsApp messages the coordinator or a leader sends by hand are not automatic nudges and are not limited by these rules.
- **Member stage** (`lib/memberStage.ts`): not confirmed (never signed in) / unfinished (signed in, details not given) / never back (finished, never came back) / quiet (no visit for the quiet days set in Reminders) / active.
- **Nudges at day 3 and day 7** (`lib/memberNudges.ts`, checked hourly with the emails): for people who signed in but did not finish (opens the details form) and for people who finished but never came back or went quiet (opens their chats). Day 3 is 3 days after signing up (or after they were last seen); day 7 is 7 days later in the same spell. Someone who comes back and goes quiet again starts a fresh spell. Each arrives in the bell and as a phone alert, in the person's own language, with no price and no link to pay. At most 150 per hourly run.
- **Admin switch:** Admin → Growth → Reminders → "Phone and in-app nudges" (`Settings.nudgesEnabled`, **off by default**, separate from the email switch). The card shows how many are waiting for each nudge and how many went out in the last 7 days. Reminder emails now also follow the daytime rule and the shared limits.
- Migration `20261231130000_member_nudges` adds `NUDGE_DAY3`/`NUDGE_DAY7` (reminder kinds), `MEMBER_NUDGE` (notification type) and `nudgesEnabled`.

## Three ways to delete a person (free to return / only with approval / never)

- **The choice:** when the central admin deletes a person (Admin → People → "Delete This Person", or "Delete for good" under Account deletions after the 30 days), a choice is shown: **free to return** (the default), **return only with my approval**, or **never allowed back**, with a private note for the last two. `DELETE /api/admin/people/:id` and `POST /api/admin/account-deletions/:id` take `mode` (`FREE`/`APPROVAL`/`NEVER`) and `note`.
- **The list** (`ContactBlock`, `lib/contactBlocks.ts`): for approval and never, the person's WhatsApp number and every email address on the account (and any linked leader account) are kept, with the name and the note. Central admin only; the only personal details kept after a deletion (the privacy page says so).
- **Sign-up check:** `POST /api/member/auth/signup` looks at the number and the email *after* the usual password hashing (so the reply time does not give it away). A match gets the same ordinary "Check your email" reply, nothing is created or sent, and the attempt is counted once per deletion (`attempts`, `lastAttemptAt`, audit `BLOCKED_CONTACT_ATTEMPT`, no raw contact in the log). The admin cannot add such a number by hand either (`409 KEPT_OUT`). People cannot change their number or email themselves, so these are the only doors.
- **Account deletions → "Kept out":** the list, people who tried to come back first. For "only with approval": **Allow them to register** (they then sign up as a brand-new member) or **Keep out for good** (turns it into never). For "never": **Lift the block**. Decisions are audited (`CONTACT_BLOCK_APPROVED`, `CONTACT_BLOCK_LIFTED`, `CONTACT_BLOCK_MADE_PERMANENT`). Deleting someone again after an allow puts the entry back as active.
- **Nothing comes back:** a person who registers again after a deletion (free, or allowed) is a brand-new member: no old profile, messages, groups, roles or training.
- **The gap that was closed:** the old sign-up record used to keep the WhatsApp number after a deletion, so a person could never register again. Now, on every deletion, the old record keeps only what the statistics and the referring leader's credit need (the number, name, email, person link and ad click ids are wiped); the number is free again, and the list is what keeps it out when the admin chose that.
- A scammer who comes back with a different number *and* a different email cannot be recognised by the app.
- Migration `20261231140000_contact_blocks`.

## Offline, round two: assembly chats, "Ready for offline?", and networks that never answer

- **Why books/chats could fail to open offline on a phone:** a phone can say "connected" while nothing comes through (weak data, Wi-Fi without internet). The service worker and the app then waited for ever, so the saved copies never showed. Fixed two ways: (1) `public/sw.js` — when a saved start page exists and the network has not answered a page load within 4 s (`NAV_WAIT_MS`), the saved page is shown at once and the slow request refreshes the copy in the background; with no saved page yet it still waits as before. Checked in a real Chromium against the production build: a network that never answers draws the app in about 4 s. (2) `lib/api.ts` — a read (GET) with no answer in 25 s (`GET_TIMEOUT_MS`) counts as "no internet", so the pages with saved copies (private and assembly chats, the School and its books) show them. Writes are not timed out.
- **Assembly (group) chats offline:** the last 50 messages and the name and picture of each assembly are kept on the phone (`chatCache`, key `group:<communityId>`, shared with the 20-chat limit), shown with "No internet. You are reading the last messages kept on this phone…" and replaced by the real ones when the connection is back. The Chats page also keeps the list of assemblies and each assembly's row (name, picture, last message). All of it is removed on sign-out and account deletion (`clearChatCache`). Messages typed offline already waited with 🕓 (the outbox).
- **"Ready for offline?"** (top of Me → Downloads, `components/member/OfflineCheck.tsx`): a list of ✅/⚠️ with plain fixes — the app's start page saved; installed as an app or only in the browser; storage kept safe (with a "Keep my saved things safe" button that asks the browser to protect it); how many chats and books are saved; and a 4-second test of the connection ("very slow or not really working although the phone says connected"). It only reads what is on the phone (plus `/api/health`).
- Books are still saved when first opened in the reader and finished loading; the check says so.

## The whole app opens without internet (saved reads)

- **What "whole app" means:** the app's start page and code are saved (service worker), and now **every screen shows what it last showed** when there is no internet. Things that need the server stay live: new messages arriving, sending, payments, sign-in.
- **How:** `lib/readCache.ts` keeps the last answer of every reading (GET) a signed-in member's screens make, in IndexedDB, per member and per language (at most 300 answers per member, none bigger than 400,000 characters; the oldest go first). `lib/api.ts` serves the saved answer when the network fails or the server answers 502–504 (and fires `api-served-saved`); otherwise errors are as before. Never kept: sign-in and sessions, chat `…/messages` (they have their own copies), signed download links, attachments, searches, `/api/admin/*` and `/api/member/central*`. Pages that already keep their own copy and show a "saved" note (the School, Learn, the leadership books reader, the chat list, assembly rows) opt out with `api.getLive` so their notes still show.
- **Main screens ready in advance:** once per visit with internet (not with "Save data" on), `OfflinePrefetch` reads the main screens' data (profile, assemblies, onboarding, friends and requests, referral links, events, prayer requests, notifications) so they open offline even before being opened. Any other screen is saved the first time it is opened.
- **Removed** on sign-out and account deletion (`deleteAllFor` → `clearReadCache`).
- **"Ready for offline?"** now also counts the saved screens. The top bar says "Connecting… You can still read what is saved."
- **Not covered:** images behind expiring links (profile and post pictures) may not show offline; only chat photos and voice notes seen once are kept. Writing offline is limited to chat messages (they wait with 🕓).

## Choosing the country in the phone box (sign-up and "Stay connected")

- The number box on the member sign-up page and on the public "Stay connected" box is now a country chooser (Cameroon first and selected, **+237**) plus the number, so people only type their own number (`components/PhoneInput.tsx`, `lib/countries.ts`). Country names come from the browser in the app's language; the code is added by itself, a leading 0 is dropped (Italy keeps it), and a number typed or pasted with its "+" is placed in the right country (longest code; Cameroon for +237, the US for +1). The page still sends one whole number (`+2376…`) to the same endpoints, so nothing changed on the server.
- Email: an address typed with its "+tag" after the provider (`name@gmail.com+test1`) now gets the usual "Did you mean …?" with the fix `name+test1@gmail.com` (`lib/emailTypo.ts`). The server still rejects the wrong form.

## New members go straight into the app; the founder's welcome carries the way back

- **After the details form** a new member now lands on **Chats** (not the full-page "steps" screen). The founder's welcome is already waiting in their private messages (it is sent before the details form answers, and Chats opens on the Private tab when something is unread). The steps page (`/member/welcome`) is still there, one tap away, and the small "Get started" card and the notification / install bars stay on top of Chats as before (they disappear by themselves once done).
- **The welcome message** (`founderWelcomeText`, new members only; those who already got the old one keep it) now says, in the member's language: the warm welcome; **two ways back**: (1) open `https://thegodnationacademy.org` (the app's own address) in any browser and they are inside the community (sign in with email and password if asked), (2) install the app and turn on notifications, with why (otherwise messages are only seen when they remember to open the website) and a link to `/member/welcome` for the one-tap steps; a line on how to reach their assembly and that writing needs the rules to be agreed first; and, if set in Admin → Settings, the community places (WhatsApp group in the member's language first, then the other language, Messenger, Facebook group/page; places not set are left out). No prices or payment links.
- A link tapped in a message opens in a new tab, so the app stays open behind WhatsApp or Facebook.

- **Update — three steps, and no rules in the welcome:** the welcome steps page and the "Get started" card now have **three** steps (turn on notifications, install the app, join us on WhatsApp and other platforms); "Read the rules and join your assembly" is no longer a step or a condition there. The assembly's rules are still agreed in the assembly itself (the card and the "I agree" button appear when the member opens it, and writing needs it, as before). The founder's welcome only points to the assembly ("open Chats, then your assembly, to read everything and meet your brothers and sisters") and no longer mentions rules or agreeing.

- **Update — a clear first screen:** the Chats page (and the Updates page) no longer show the "Get started" card, the community card or the install bar. A member's first screen shows only the **"Turn on notifications"** bar (which disappears once done) and, after installing, the one-time "The app is installed. One last step" ask. Everything else (install steps with pictures, notifications, joining us on WhatsApp and other platforms) opens from the link in the founder's welcome message (`/member/welcome`), which is also where the "I have joined" question lives.
