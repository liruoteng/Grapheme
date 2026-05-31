#import "/jmlr.typ": jmlr

#let affls = (
  university: (
    department: "Department of Computer Science",
    institution: "University Name",
    location: "City",
    country: "Country",
  ),
)

#let authors = (
  (name: "First Author", affl: "university", email: "first.author@example.edu"),
  (name: "Second Author", affl: "university", email: "second.author@example.edu"),
)

#show: jmlr.with(
  title: [Paper Title],
  authors: (authors, affls),
  abstract: [
    Replace this with a concise abstract describing the problem, approach,
    and key results.
  ],
  keywords: ("machine learning",),
  bibliography: bibliography("refs.bib"),
)

#include "content.typ"
