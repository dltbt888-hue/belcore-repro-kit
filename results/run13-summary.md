# Run 13: regression check after a pipeline change

- Setup: 13 questions that the system had answered correctly before the change.
- Change: one part of the memory pipeline was modified to fix a set of targeted questions.
- Result: the targeted questions improved, but 4 of the 13 previously correct questions were answered wrongly after the change.
- Cost of the run: $0.681 at list price.
- Takeaway: a fix can break answers that already worked. Rerun previously correct questions after every change.
