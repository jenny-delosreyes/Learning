## State Capitals Flashcard App

A simple, kid-friendly flashcard + quiz web app to learn **US states and their capitals**.

### Run it

You can run it in any modern browser.

- **Option A (quickest)**: open `index.html` directly in your browser.
- **Option B (recommended)**: run a tiny local web server:

```bash
cd "Flashcard app"
python3 -m http.server 5173
```

Then open `http://localhost:5173` in your browser.

### Features

- Flashcards (flip the card)
- Quiz mode (multiple choice)
- Study direction: **State → Capital** or **Capital → State**
- Shuffle + filters (All / Weak / New / Mastered)
- Progress and streak tracking (saved in your browser via `localStorage`)
- Optional read-aloud using your browser’s speech feature

