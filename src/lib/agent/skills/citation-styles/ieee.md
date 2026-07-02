---
name: ieee
description: IEEE citation style rules for engineering and computer science papers
when_to_use: When formatting citations in IEEE style
---

# IEEE Citation Style

## In-Text Citations

### Numbered References
- Use bracketed numbers: [1], [2], [3]
- Number in order of first appearance
- Multiple citations: [1], [3], [5] or [1]–[3]

### Usage Examples
- "As shown in [1], the algorithm..."
- "Several approaches [1]–[4] have..."
- "Smith [1] proposed..."

## Reference List Format

### Journal Article
```
[#] A. A. Author and B. B. Author, "Title of article,"
    Title of Journal, vol. X, no. X, pp. xxx–xxx, Month Year.
    doi: 10.xxxx/xxxxx
```

### Conference Paper
```
[#] A. A. Author, "Title of paper," in Proc. Name of Conf.,
    City, Country, Year, pp. xxx–xxx.
```

### Book
```
[#] A. A. Author, Title of Book, X ed. City, Country:
    Publisher, Year.
```

### Online Source
```
[#] A. A. Author. "Title." Website. [Online]. Available: URL.
    [Accessed: Month Day, Year].
```

## BibTeX Format for IEEE
```bibtex
@article{smith2020,
  title = {Title of the Article},
  author = {Smith, Alice and Jones, Bob},
  journal = {IEEE Transactions on X},
  volume = {10},
  number = {2},
  pages = {100--115},
  year = {2020},
  doi = {10.1109/XXXX.XXXXXXX}
}
```

## Key Rules
- References numbered in order of appearance
- Author first name initials before last name
- Article titles in quotation marks
- Journal titles in italics (abbreviated)
- Include DOI when available
