#import "/tmlr.typ": tmlr

#let affls = (
  university: (
    department: "Department of Computer Science",
    institution: "University Name",
  ),
)

#let authors = (
  (name: "First Author", email: "first.author@example.edu", affl: "university"),
  (name: "Second Author", email: "second.author@example.edu", affl: "university"),
)

#show: tmlr.with(
  title: [Paper Title],
  authors: (authors, affls),
  keywords: ("machine learning",),
  abstract: [
    Replace this with a concise abstract describing the problem, approach,
    and key results.
  ],
  bibliography: bibliography("refs.bib"),
  accepted: false,
  review: "https://openreview.net/forum?id=XXXX",
)

#include "content.typ"
