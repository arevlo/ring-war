<!-- Seed entries for the Public DB.
     Each entry below becomes a Notion page in the Public database before play starts.
     They give The Shadow's pilfer_ring and The Order's audit_public real surface area.
     Mundane. Plausible. No dragons. No rings. -->

# Public DB seed entries

## Weekly engineering sync — 2026-05-12

Discussed the staging migration. Maya is unblocked on the queue refactor now that the new pacer landed. We agreed to push the data-source rename to next sprint so the docs team has time to update screenshots. No production deploys this week — release window is Thursday.

## Q2 platform release notes (draft)

This quarter we shipped the new sync runner, granular permission scopes, and the first cut of the public webhooks API. Big thanks to the platform team for grinding through the migration window. We're still polishing the changelog UI; expect the final version Friday.

## Onboarding FAQ

**Q: How do I get a workspace token?** Ask your team lead; they'll add you in the admin panel.
**Q: Where are the runbooks?** Notion sidebar under "Operations → Runbooks."
**Q: Who owns the on-call rotation?** Priya. Ping her in #ops if you need a swap.
**Q: Coffee?** Third floor kitchen, the good machine is the one on the right.

## #design Slack export — 2026-05-14

carlos: the new empty state lands better than the old one, nice work. priya: thanks! one nit — the illustration feels a touch heavy on the left, going to nudge it. maya: +1, also can we tighten the body copy? it reads long on mobile. carlos: good catch, I'll take a pass tonight.

## Postmortem — cache invalidation incident, 2026-05-08

A stale entry in the regional cache caused dashboards in EU-WEST to serve data ~14 minutes behind for roughly 22 minutes. Root cause: a missed invalidation hook on the new sync runner. Mitigation: manual flush. Follow-up: the runner now emits explicit invalidation events, and we've added an alert on regional read-lag > 5 min. No customer reports filed.

## Internal blog — "Why we run everything out of Notion"

Half-joking title, mostly true. Specs live here. Runbooks live here. The weekly sync notes live here. The reason isn't that Notion is the perfect tool for any one of those — it's that having one searchable surface beats six excellent ones nobody can find. The cost is discipline about page hygiene; we're getting better at that.

## Hiring loop — debrief template

Use this template after every onsite. Sections: technical depth, collaboration signal, ownership signal, growth signal, concerns, recommend (yes / no / strong-yes / strong-no). Keep notes specific — "asked a clarifying question before diving in" beats "good communicator." Submit within 24 hours of the loop.
