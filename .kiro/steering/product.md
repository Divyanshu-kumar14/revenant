---
inclusion: always
---

# Revenant — Product Steering

## What we are building

Revenant turns photographs of unidentified collection items into reviewed, searchable, citable archive records. A volunteer photographs an item; a vision model proposes a transcription and metadata; the volunteer confirms; the record is published with provenance.

The product exists for institutions with no cataloguer: small libraries, county historical societies, volunteer-run museums.

## Who decides the work

The persona is a retired teacher volunteering two days a week. She can scan and type. She does not know Dublin Core, date normalisation, name authority files, or what a confidence score means. If a screen requires that knowledge, the screen is wrong.

## The promise, and its boundary

- The system **proposes**; a human **decides**. Review is mandatory before publication. There is no auto-publish path, not even behind a flag.
- Never say the system "identifies" people. It proposes names that appear in a caption, transcription or supplied metadata.
- Never claim archival preservation. This is access: it makes items findable, not safe.
- The claim in the README, video and submission is set by the accuracy gate in `docs/decisions/0001-extraction-promise.md`. Until that file has numbers, the only allowed claim is "assisted cataloguing under review".

## Non-goals (binding)

Accounts, billing, multi-tenancy, roles; microfilm OCR; audio/video; 3D objects; crowdsourced transcription; native mobile apps; fixity, backups and preservation-grade storage; copyright clearance or legal title.

If a request falls in this list, say so and propose the smallest adjacent thing that serves the persona.

## Voice

Plain, specific, unsentimental. No horror puns in product copy — the archive-at-night atmosphere lives in the design, not the text. No exclamation marks. Numbers carry their source or they do not appear.

## What "done" means for a feature

A user can complete the job on a keyboard, with a screen reader, at 200% zoom, and the failure path leaves the data in a recoverable state. If a failure would lose an upload or publish an unreviewed record, it is a blocker, not a nice-to-have.
