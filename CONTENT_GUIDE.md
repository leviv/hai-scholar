# Curriculum content guide

The app ships a curriculum in `data/stages/sNN.json` (one file per stage, `s01.json` … `s11.json`).
The learner has a CS degree (algorithms, data structures) but little ML background, and the
goal is to go from zero to PhD-level literacy in Human-AI Interaction (HAI).

## Hard rules

1. **No invented material.** Every resource must be a real, well-established, publicly findable
   work: peer-reviewed papers, canonical preprints, widely used textbooks/courses, well-regarded
   explainer essays (e.g., Distill, Jay Alammar, Chris Olah, Lilian Weng), and well-known YouTube
   lectures/explainers (e.g., 3Blue1Brown, Andrej Karpathy). If you are not certain a work exists
   with that exact title/authors/year, leave it out.
2. **Every resource is verified** with `python3 tools/verify_refs.py data/stages/sNN.json`.
   Fix or remove anything marked FAIL. Look at every CHECK by hand (e.g., fetch the page).
   Use the exact title the API returns (arXiv / Crossref / YouTube oEmbed).
3. **Prefer free, legal, open access links.** Prefer arXiv (`"arxiv": "ID"`, `url` =
   `https://arxiv.org/abs/ID`) whenever a paper has an arXiv version — the app can then read the
   full text aloud in-app. For non-arXiv papers use the DOI URL `https://doi.org/...`
   (ACM DL is fully open access). If an author-hosted open PDF/HTML exists at a stable URL you
   have verified, put it in `"listen"` (optional).
4. **Guide notes and quiz questions are the only text you write.** Guide notes orient the
   learner (what to look for, how pieces connect, terms to watch for) — they never replace the
   sources and never contain claims that aren't standard textbook knowledge or stated in the
   sources. Quiz questions test what the listed sources actually say. Explanations must be
   accurate and should name the source.
5. Do not reproduce copyrighted text from sources (no long quotes).

## Schema

```jsonc
{
  "id": "s04",                 // stage id, matches file name
  "number": 4,
  "title": "From Language Models to Assistants",
  "subtitle": "Pretraining, scale, RLHF, prompting, tools",
  "overview": "2–4 sentences: what this stage is for and how it builds on earlier stages.",
  "modules": [
    {
      "id": "s04m01",
      "title": "Pretraining and scale",
      "goal": "One sentence: what you should be able to explain after this module.",
      "guide": "3–6 sentences of orientation: order to tackle the resources, what to look for, key terms with one-line plain definitions.",
      "resources": [
        {
          "id": "s04m01r01",
          "kind": "paper",          // paper | video | essay | book | course | tool
          "title": "Language Models are Few-Shot Learners",
          "authors": "Brown, Mann, Ryder, et al.",
          "year": 2020,
          "venue": "NeurIPS",        // optional; journal/conference/channel/site
          "url": "https://arxiv.org/abs/2005.14165",
          "arxiv": "2005.14165",     // optional, enables in-app read-aloud of full text
          "youtube": "VIDEOID",      // required when kind == video; url = https://www.youtube.com/watch?v=VIDEOID
          "listen": "https://…",     // optional: open HTML/PDF URL for read-aloud when not on arXiv
          "minutes": 40,             // realistic time to read/watch the recommended part
          "why": "1–2 sentences: why this matters for an HAI researcher.",
          "focus": "Optional: which sections to read, what to skim (papers are long!).",
          "optional": false          // true for stretch/extra resources
        }
      ],
      "quiz": [
        {
          "q": "Question text",
          "choices": ["A", "B", "C", "D"],   // 3–4 choices, plausible distractors
          "answer": 2,                       // 0-based index; vary the position!
          "explain": "Why the answer is right (and the key misconception behind a distractor). Name the source.",
          "ref": "s04m01r01"                 // resource in this module the question draws on
        }
      ],
      "exercise": "Optional open-ended research exercise (e.g., 'Sketch a 2x2 study design that…')."
    }
  ]
}
```

Per module: 3–6 resources (mix of a gentle explainer + the primary paper where possible), 5–7
quiz questions mixing recall, conceptual understanding, and application/"what would happen if".
Stages later in the path should include an `exercise` in most modules that builds research
skill (critique a study design, propose a follow-up experiment, identify confounds, etc.).
