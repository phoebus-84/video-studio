# candidate-qtw-v1 listener submissions

Commit exactly three independently completed CSV exports here using pseudonymous names, for example:

- `listener-01.csv`
- `listener-02.csv`
- `listener-03.csv`

Do not commit real names, the listening keys, or copied audio. Each current-format CSV must contain 55 unique data rows: 54 isolated segment comparisons and one full-assembly continuity/boundary comparison. Older 54-row exports are incomplete and must be redone using the regenerated page at `evaluation/runs/candidate-qtw-v1/results/listening-review.html`.

After all files arrive:

```bash
PYTHONPATH=src .venv/bin/python evaluation/analyze_listening_scores.py \
  evaluation/listening/candidate-qtw-v1/listener-01.csv \
  evaluation/listening/candidate-qtw-v1/listener-02.csv \
  evaluation/listening/candidate-qtw-v1/listener-03.csv
```
