# MPF Study Deck — 強積金中介人考試練習工具

A free study tool for the Hong Kong **MPF Intermediary Examination**
(強積金中介人考試 / 強制性公積金計劃考試).

**Live:** https://stkhwu.github.io/mpf-study-deck/

## What's inside

| Page | Purpose |
|---|---|
| `index.html` | Quiz app — 691 curated practice questions, practice / mock-exam / wrong-question review / redo modes. Each question deep-links into the study notes. |
| `study-notes.html` | The full 研習資料手冊（第九版）handbook, split into anchored sections so the quiz can jump straight to the source for any question. |
| `mpf-mock-coverage-deck.html` | A 97-slide revision deck cross-referencing the handbook against the mock question bank. |
| `landing.html` | Landing page. |
| `app.js` / `questions.json` | Quiz logic and question data. |

## How the quiz ↔ notes link works

Every question carries a `ref` (handbook section, e.g. `3.14`). Answer a
question, then tap **參考研習資料** — a slide-over drawer opens
`study-notes.html` scrolled to that exact section.

## Source material

Questions are drawn from 2019 卷四模擬試題 and a practice question bank.
Handbook content is the 強積金中介人考試研習資料手冊（第九版）published by
the MPFA. This is a non-commercial study aid.
