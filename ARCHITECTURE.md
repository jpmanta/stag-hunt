# Stag Hunt Architecture (the framework)

The short version of the design (draft 1.1, November 19, 2026). Read it before any design change.

## The idea
Many hunts on one network. A hunt is a group that shares deals (a Junto; a fund or angel group is a hunt too).
Hunts choose what to share with each other. The root principle is agency: Stag Hunt informs choices and never makes them.
Every feature must trace to a first principle in section 2 of the artifact. One that traces to none gets cut.

## Invariants (true in every hunt, at every size)
- I1 A member sees others' calls on a deal only after making their own.
- I2 A call is immutable once made.
- I3 Every deal has one person who vouches for the founders and handles intros.
- I4 Stag Hunt never holds, pools or moves money. Investors invest directly.
- I5 Always free. No dues, fees, ads or sponsors, from members, founders or anyone else.
- I6 A deal is visible only to hunts it was shared with. Terms never leave them.
- I7 Only the person can share their own record or checks.
- I8 Stag Hunt suggests, never decides. Every choice can be declined, or undone where undoing breaks no lock.
- I9 No deal is ever shown publicly or advertised. Only signed-in members see deals.
- I15 Anyone can make an account. Nobody approves, nominates or invites people onto the network; admins can only remove.
- I10 A founder decides who sees their deal. It leaves its home hunt only with the founder's yes.
- I11 Every number drawn from a record is stored and shown with its sample size n.
- I12 Nobody can change a locked call or confirmed outcome without it showing, the operator included.
- I13 Every person can download their own record at any time, in a form anyone can check.
- I14 The code is public, so anyone can check that these rules run as written.

## Access (section 7.1), one function decides every read
- can_see: check fits, and the person is in the home hunt or a hunt it was shared with, and it is released to them.
- can_call: can_see, the deal is in review, and the person did not bring it.
- can_see_calls: can_see, and the person has made their own call or brought the deal.
- share to another hunt: needs the founder's yes (I10).
The app, the API and the emails must all use the same rule.

## Build plan (each phase ships alone; the site keeps working between phases)
- 0 Live: one network, open sign-up, blind locked calls, check-size tiers, records and share links, API keys, outcome confirmation, digest, hunts.
- 1 Proof: chained calls and outcomes, nightly fingerprint, record download (I12, I13). Built Nov 18.
- 2 Sharing: hunt settings (sharing, listing, joining), shares with the founder's yes, new access rules.
- 3 Sign-up: open sign-up built Nov 19. Still to do: accreditation statement, suggested hunts.
- 4 Matching: founder needs, readable match score. Matching orders deals, it never hides them.
- 5 Learning: signals with sample size n, proxies, logged suggestions, one in ten picked at random.
- 6 Listing: public hunt pages. Existing groups and funds join.
Timing in the artifact: design by end of 2026, build after the holidays.

## Waiting on the lawyer (do not build past these)
Accreditation self-statement, whether sharing a deal counts as advertising a round, public hunt records,
pledges and syndicates, non-accredited members, and whether open sign-up with I9 keeps rounds out of general solicitation.

## Where the live site stands against it (Nov 19)
- Done: I1, I2, I3, I4, I5, I7, I9, outcome confirmation, records that follow the person.
- Done Nov 17: can_call. Nobody calls the deal they brought, and calls close when a deal leaves review.
- Hunts built Nov 17 (migration 0026): hunts, memberships, invites, a home hunt on every deal.
- Proof built Nov 18 (migration 0027): the ledger. Every call and outcome is chained by hash, triggers make it
  append only, a nightly job seals the day's fingerprint (public at /api/ledger/fingerprints, and in the weekly
  digest), members download their record at /api/me/ledger, and scripts/verify-record.mjs checks it.
  Not yet: committing fingerprints to this repository nightly (needs a GitHub token).
- Open sign-up built Nov 19 (I15): the first sign-in by email code, link or Google creates the account and puts it in
  the first hunt. Nominations, join requests and admin-added members are gone. A removed person stays out.
  Members see each other's names, not email addresses; admins still see emails.
- Not built: hunt settings, shares, signals, suggestions, matching, the outcome history table, knows_founders.
- Known gap: pledges still exist; the lawyer question on them is open.
- Known gap: until Phase 2 (sharing), anyone who signs up sees every deal their check size fits, not only their hunts'.
