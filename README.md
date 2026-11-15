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

- **Path:** 11 stages → modules → sources. Each module has a short *Guide* that tells you what to look for and
  defines new terms. It has 3–6 core sources plus optional "go deeper" ones, a check-in quiz (pass with 70%), and
  in later stages a *research exercise*.
- **Listen & read along:** the app fetches the source's full text live and reads it aloud with your iPhone's voice,
  highlighting each sentence. Tap any sentence to jump there. You can change the speed (0.8×–2×) and the text size.
  Papers stop at the references, and citations like "[12]" are skipped in the audio but still shown in the text.
  - arXiv papers use arXiv's own HTML version, or the PDF if there's no HTML.
  - Open essays (Distill, Alammar, Olah, Weng…) are read straight from the author's site.
  - Publisher pages that block other apps go through the public reader service `r.jina.ai`. If that fails too, the app
    tells you how to use Safari's built-in **Listen to Page**.
  - Any paper you've opened is saved on the device, so it plays offline later.
- **Videos** (3Blue1Brown, Karpathy…) play inside the app.
- **Review:** questions you miss come back later, mixed with earlier material (spaced retrieval).
- **Notes:** each source and exercise has a notes field. Use **Settings → Export** to back up your progress.

**Limitation:** iOS pauses speech from web apps when the screen locks. The app keeps the screen on while you listen,
which you can turn off in Settings. If you want true lock-screen audio, the option is a native build (see below).

## Curriculum

| # | Stage |
|---|-------|
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
