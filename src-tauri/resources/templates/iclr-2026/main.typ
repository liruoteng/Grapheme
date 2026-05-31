#import "/iclr.typ": iclr2026

#let authors = (
  (
    names: ([First Author], [Second Author]),
    affilation: [Department of Computer Science \ University Name],
    address: [City, Country],
    email: "first.author@example.edu",
  ),
)

#show: iclr2026.with(
  title: [Paper Title],
  authors: authors,
  keywords: ("machine learning",),
  abstract: [
    Replace this with a concise abstract describing the problem, approach,
    and key results.
  ],
  bibliography: bibliography("refs.bib"),
  accepted: false,
)

#include "content.typ"
