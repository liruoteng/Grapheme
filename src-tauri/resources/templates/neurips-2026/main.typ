#import "/neurips.typ": neurips2026

#let affls = (
  university: (
    institution: "University Name",
    location: "City",
    country: "Country",
  ),
)

#let authors = (
  (name: "First Author", affl: "university", email: "first.author@example.edu"),
  (name: "Second Author", affl: "university", email: "second.author@example.edu"),
)

#show: neurips2026.with(
  title: [Paper Title],
  authors: (authors, affls),
  keywords: ("machine learning",),
  abstract: [
    Replace this with a concise abstract describing the problem, approach,
    and key results.
  ],
  bibliography: bibliography("refs.bib"),
  accepted: false,
)

#include "content.typ"
