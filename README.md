# HAI Scholar

An iPhone app that teaches **Human-AI Interaction (HAI)**, starting from nothing and going up to research level. It does this with
real, well-established sources: peer-reviewed papers, canonical preprints, textbooks, lectures and respected
explainers. You **listen** to each source while the sentence being read is highlighted, so you can follow along. Then a
**check-in quiz** tests your understanding.

**Open it:** https://leviv.cool/hai-scholar/

## Install on your iPhone (about 30 seconds)

1. Open **https://leviv.cool/hai-scholar/** in **Safari** on your iPhone. It has to be Safari: Chrome and other iOS browsers can't install web apps on older iOS versions.
2. Tap the **Share** button (the square with an arrow pointing up). On iOS 26 it's inside the **⋯** menu in the address bar.
3. Scroll down and tap **Add to Home Screen**. Make sure **Open as Web App** is on, then tap **Add**.
4. Open **HAI Scholar** from your Home Screen. It runs full-screen like a native app and saves your progress on the phone.

**Recommended: get a better voice.** Go to iPhone **Settings → Accessibility → Spoken Content → Voices → English** and
download an **Enhanced** or **Premium** voice (for example *Ava (Premium)* or *Zoe (Premium)*). Then choose it in
the app under **Settings → Voice**. The difference is large.

## How it works

- **Path:** Stage 0 (how to learn) plus 11 stages of modules and sources. Each module has a short *Guide*, 3–6 core
  sources plus optional "go deeper" ones, a check-in (pass with 80%), and in later stages a *research exercise*.
- **Listen & read along:** the app fetches the source's full text live and reads it aloud with your iPhone's voice,
  highlighting each sentence. Tap any sentence to jump there. You can change the speed (0.8×–2×) and the text size.
  - arXiv papers use arXiv's own HTML version, or the PDF if there's no HTML.
  - Open essays are read straight from the author's site.
  - Publisher pages that block other apps go through the public reader service `r.jina.ai`. If that fails too, the app
    tells you how to use Safari's built-in **Listen to Page**.
- **Offline:** "Download for offline" on any module or stage, or "Download everything" in Settings, saves the full
  text of every paper and essay to the phone. iPhone voices run on-device, so you can listen with no connection.
  The app itself is cached too. Videos still need a connection.
- **Videos** (3Blue1Brown, Karpathy…) play inside the app.

## How it helps you learn (and remember)

Listening alone is close to rereading, which is a low-utility study technique. So the app wraps every source in the techniques with the
strongest evidence from cognitive psychology. Stage 0 teaches the research, with sources:

| Feature | Technique | Evidence |
|---|---|---|
| 3 **prequestions** before each module (you guess; answers are revealed in the check-in) | Pretesting / prequestions | Pan & Carpenter 2023 |
| **Recall pauses** at section breaks while listening | Interpolated testing | Szpunar, Khan & Schacter 2013 |
| **Free recall** after each source: main claim, evidence, connection to an earlier source, open question | Retrieval practice + elaboration / self-explanation | Roediger & Karpicke 2006; Karpicke & Blunt 2011; Chi et al. 1994 |
| **Answer in your head before choices appear** | Generation effect / recall over recognition | Slamecka & Graf 1978 |
| **Confidence rating** on every answer; confident errors are flagged; calibration chart | Hypercorrection, metacognitive calibration | Butterfield & Metcalfe 2001 |
| Explanatory **feedback** naming the source | Feedback after retrieval | Weinstein et al. 2018 |
| **Daily spaced review** of every question and every free-recall prompt; missed items repeat in-session until correct | Spacing + successive relearning | Carpenter, Pan & Butler 2022; Rawson & Dunlosky 2011; Latimier et al. 2021 |
| **Cumulative stage exams** mixing all modules | Interleaving, cumulative testing | Weinstein et al. 2018 |
| **80% mastery threshold** before a module counts as done | Mastery learning | Bloom 1984 |

A suggested routine: do the **daily review first** (it's on the home screen when cards are due), then one new source. Don't
binge a whole stage in one day. The gaps between sessions are where spacing does its work.

## Curriculum

| # | Stage |
|---|-------|
| 0 | Learning how to learn (the science behind the app) |
| 1 | Orientation: what is Human-AI Interaction? |
| 2 | Machine learning from zero |
| 3 | Language models and Transformers |
| 4 | From language models to assistants (scale, RLHF, prompting, tools) |
| 5 | Human factors: automation, trust and reliance |
| 6 | Explainability and interpretability |
| 7 | AI-assisted decision making |
| 8 | Interacting with generative AI |
| 9 | Fairness, accountability and society |
| 10 | Real-world impact and the research frontier |
| 11 | Doing HAI research (methods; can be started any time) |

**Content rules** (see `CONTENT_GUIDE.md`): every source is a real published work, and its title, authors and link were
checked against arXiv, Crossref or YouTube by `tools/verify_refs.py`. The only text the app writes itself is the
orientation guides, the quiz questions and the exercises. It never writes summaries that stand in for the sources.

## Development

It's a static site with no build step: `index.html`, `css/`, `js/` and `data/stages/*.json`.

```bash
python3 -m http.server 8791      # then open http://localhost:8791
python3 tools/verify_refs.py     # re-verify every reference
python3 tools/build_index.py     # after adding/removing a stage file
```

GitHub Pages deploys the `main` branch automatically.

### Why a web app and not a native Swift app?

There was no Xcode on the machine this was built on. Installing a native app would also need Xcode plus a re-sign every
7 days (or a $99/yr developer account). The web app installs from Safari in seconds and updates itself. If you
want a native version later, the curriculum JSON can be reused unchanged.
