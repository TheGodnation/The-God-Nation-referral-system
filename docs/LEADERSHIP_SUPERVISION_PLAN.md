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
