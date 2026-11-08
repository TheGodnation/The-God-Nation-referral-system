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
