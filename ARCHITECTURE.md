# Stag Hunt Architecture (the framework)

The short version of the design (draft 0.7, November 17, 2026). Read it before any design change.

## The idea
Many hunts on one network. A hunt is a group that shares deals (a Junto; a fund or angel group is a hunt too).
Hunts choose what to share with each other. The root principle is agency: Stag Hunt informs choices and never makes them.
Every feature must trace to a first principle in section 2 of the artifact. One that traces to none gets cut.

## Invariants (true in every hunt, at every size)
- I1 A member sees others' calls on a deal only after making their own.
- I2 A call is immutable once made.
- I3 Every deal has one person who vouches for the founders and handles intros.
- I4 Stag Hunt never holds, pools or moves money. Investors invest directly.
- I5 No fees from anyone.
- I6 A deal is visible only to hunts it was shared with. Terms never leave them.
- I7 Only the person can share their own record or checks.
- I8 Stag Hunt suggests, never decides. Every choice can be declined, or undone where undoing breaks no lock.
- I9 No deal is ever shown publicly or advertised. It reaches people only through someone who knows them.

## Access (section 7.1), one function decides every read
- can_see: check fits, and the person is in the home hunt or a hunt it was shared with, and it is released to them.
- can_call: can_see, the deal is in review, and the person did not bring it.
- can_see_calls: can_see, and the person has made their own call.
The app, the API and the emails must all use the same rule.

## Build plan (each phase ships alone; the site keeps working between phases)
- 0 Live: one network, blind locked calls, check-size tiers, records and share links, API keys, outcome confirmation, digest.
- 1 Hunts: create, invite, join, switch. Current members become the first hunt.
- 2 Sharing: hunt settings (sharing, listing, joining), shares, new access rules.
- 3 Sign-up: accreditation statement, profile, suggested hunts.
- 4 Matching: founder needs, readable match score.
- 5 Learning: signals with sample size n, proxies, logged suggestions.
- 6 Listing: public hunt pages. Existing groups and funds join.
Timing in the artifact: design by end of 2026, build after the holidays.

## Waiting on the lawyer (do not build past these)
Accreditation self-statement, whether sharing a deal counts as advertising a round, public hunt records,
pledges and syndicates, non-accredited members, and whether I9 keeps rounds out of general solicitation.

## Where the live site stands against it (Nov 17)
- Done: I1, I2, I3, I4, I5, I7, I9, outcome confirmation, records that follow the person.
- Done Nov 17: can_call. Nobody calls the deal they brought, and calls close when a deal leaves review.
- Phase 1 built Nov 17 (migration 0026): hunts, memberships, invites, a home hunt on every deal.
- Not built: hunt settings, shares, signals, suggestions, matching, the outcome history table, knows_founders.
- Known gap: pledges still exist; the lawyer question on them is open.
