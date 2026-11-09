# Journal style spec

## Publisher comparison

| Publisher | Body font | Margins | Heading case | Citation style | Caption position | Section order |
|---|---|---|---|---|---|---|
| elsevier | Times New Roman 12pt | 2.5 cm all | title case | numeric `[n]` | Table above / Figure below | Introduction / Materials and Methods / Results / Discussion / Conclusions / References |
| acs | Arial 10pt | 2.54 cm all | title case | numeric superscript | Table above / Figure below | Introduction / Experimental / Results and Discussion / Conclusions / Acknowledgements / References |
| ieee | Times New Roman 10pt | 1.9 cm all | title case + Roman H1 | numeric `[n]` | Table above / Figure below | Introduction / Related Work / Methods / Experiments / Results / Discussion / Conclusion / References |
| nature | Arial 11pt | 2.0 cm all | sentence case | numeric superscript | Table above / Figure below (`Figure n |`) | Introduction / Results / Discussion / Methods / References |
| korean-generic | Pretendard 11pt | top/bottom 3.0 cm, left/right 2.5 cm | sentence case | numeric `[n]` | Table above / Figure below | 서론 / 이론 / 방법 / 결과 / 고찰 / 결론 / 감사의 글 / 참고문헌 |

## Notes

- DOCX output remains single-column for all publishers.
- IEEE two-column behavior belongs to the optional LaTeX/PDF path.
- Every profile uses explicit CJK pairing; Hangul should render with Pretendard rather than a default fallback font.
