#import "/rlj.typ": contribution, rlj

#let affls = (
  university: (
    institution: "University Name",
    location: "City, Country",
  ),
)

#let authors = (
  (name: "First Author", affl: "university", email: "first.author@example.edu"),
  (name: "Second Author", affl: "university", email: "second.author@example.edu"),
)

#let contributions = (
  contribution[Describe the primary contribution of the paper.],
)

#show: rlj.with(
  title: [Paper Title],
  authors: (authors, affls),
  abstract: [
    Replace this with a concise abstract describing the problem, approach,
    and key results.
  ],
  keywords: ("reinforcement learning",),
  bibliography: bibliography("refs.bib", full: true),
  accepted: false,
  summary: [
    Replace this with a short summary suitable for the review cover page.
  ],
  contributions: contributions,
  running-title: [Paper Title],
)

#include "content.typ"
